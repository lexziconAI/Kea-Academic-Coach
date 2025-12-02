// ═══════════════════════════════════════════════════════════════════════════════════
// 🥝 KEA V5 - OPTIMIZED VOICE STACK WITH PARALLEL CHUNKING
// ═══════════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE (Optimized from V4 + Parallel TTS Chunking):
//
// ┌─────────────────────────────────────────────────────────────────────────────────┐
// │  User Speech                                                                    │
// │       ↓                                                                         │
// │  [Groq Whisper STT] ────────────────────────────────────────→ ~50ms             │
// │       ↓                                                                         │
// │  [Groq Llama 3.3 70B Brain] ────────────────────────────────→ ~150ms            │
// │       ↓                                                                         │
// │  [Sentence Splitter] ───────────────────────────────────────→ ~1ms              │
// │       ↓                                                                         │
// │  [PARALLEL Google Chirp TTS] ───────────────────────────────→ ~400ms            │
// │       │ ├─ Sentence 1 → TTS ──┐                                                 │
// │       │ ├─ Sentence 2 → TTS ──┼─→ Stream as ready                               │
// │       │ └─ Sentence 3 → TTS ──┘                                                 │
// │       ↓                                                                         │
// │  Audio Chunks Stream to Client (first chunk in ~400ms!)                         │
// │                                                                                 │
// │  TOTAL TIME TO FIRST AUDIO: ~600ms (vs 1500ms+ sequential)                      │
// └─────────────────────────────────────────────────────────────────────────────────┘
//
// KEY OPTIMIZATION: Instead of waiting for full TTS, we:
// 1. Split response into sentences
// 2. Fire ALL TTS requests in parallel
// 3. Stream audio chunks as they complete (in order)
// 4. User hears first sentence while rest are still generating
//
// ═══════════════════════════════════════════════════════════════════════════════════

const Groq = require('groq-sdk');
const OpenAI = require('openai');
const textToSpeech = require('@google-cloud/text-to-speech');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════

const CONFIG = {
    port: process.env.PORT || 16602,
    
    // Credentials
    google_credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || 
        "C:\\Users\\regan\\ID SYSTEM\\Keys\\gen-lang-client-0219506317-e656a112d84b.json",
    
    // Models
    stt_model: 'whisper-large-v3-turbo',
    brain_model: 'llama-3.3-70b-versatile',
    tts_voice: 'en-US-Chirp3-HD-Kore',  // Fastest Chirp voice from our tests
    
    // Voice variants for emotion
    voices: {
        default: 'en-US-Chirp3-HD-Kore',
        warm: 'en-US-Chirp3-HD-Aoede',
        excited: 'en-US-Chirp3-HD-Kore',
        calm: 'en-US-Chirp3-HD-Leda',
        professional: 'en-US-Chirp3-HD-Charon',
    },
    
    // TTS settings (optimized from our tests)
    tts_encoding: 'OGG_OPUS',  // Fastest encoding
    tts_sample_rate: 24000,
    
    // Chunking settings
    max_chunk_chars: 80,  // Optimal chunk size from tests
    
    // Kea personality
    system_prompt: `You are Kea, a warm and intelligent Socratic coach helping PhD students and researchers.

Your style:
- Warm, encouraging, supportive
- Ask clarifying questions to deepen understanding
- Give direct but kind feedback
- Use natural conversational language
- Keep responses concise (2-4 sentences for voice)

You're having a real-time voice conversation. Respond naturally.`
};

// ═══════════════════════════════════════════════════════════════════════════════════
// KEA V5 VOICE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════

class KeaV5VoiceEngine {
    constructor() {
        this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.tts = new textToSpeech.TextToSpeechClient({
            keyFilename: CONFIG.google_credentials
        });
        
        this.sessions = new Map();
        this.ttsWarmedUp = false;
        
        console.log('🥝 Kea V5 Voice Engine initialized');
        console.log(`   STT: Groq ${CONFIG.stt_model}`);
        console.log(`   Brain: Groq ${CONFIG.brain_model}`);
        console.log(`   TTS: Google ${CONFIG.tts_voice} (parallel chunking)`);
        
        // Warm up TTS connection
        this.warmUpTTS();
    }
    
    async warmUpTTS() {
        try {
            await this.tts.synthesizeSpeech({
                input: { text: 'Hi' },
                voice: { languageCode: 'en-US', name: CONFIG.tts_voice },
                audioConfig: { audioEncoding: CONFIG.tts_encoding, sampleRateHertz: CONFIG.tts_sample_rate }
            });
            this.ttsWarmedUp = true;
            console.log('   ✅ TTS connection warmed up');
        } catch (e) {
            console.log('   ⚠️ TTS warmup failed:', e.message);
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // SESSION MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════════
    
    createSession(sessionId) {
        const session = {
            id: sessionId,
            conversationHistory: [],
            createdAt: Date.now()
        };
        this.sessions.set(sessionId, session);
        return session;
    }
    
    getSession(sessionId) {
        return this.sessions.get(sessionId) || this.createSession(sessionId);
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // STEP 1: SPEECH-TO-TEXT (Groq Whisper)
    // ═══════════════════════════════════════════════════════════════════════════════
    
    async transcribe(audioBuffer, mimeType = 'audio/webm') {
        const startTime = Date.now();
        
        try {
            const audioFile = new File([audioBuffer], 'audio.webm', { type: mimeType });
            
            const transcription = await this.groq.audio.transcriptions.create({
                file: audioFile,
                model: CONFIG.stt_model,
                response_format: 'json',
                language: 'en'
            });
            
            const latency = Date.now() - startTime;
            console.log(`🎤 STT: "${transcription.text}" (${latency}ms)`);
            
            return { text: transcription.text, latency };
        } catch (error) {
            console.error('❌ STT Error:', error.message);
            throw error;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // STEP 2: BRAIN RESPONSE (Groq Llama 3.3 70B)
    // ═══════════════════════════════════════════════════════════════════════════════
    
    async generateResponse(userText, session) {
        const startTime = Date.now();
        
        session.conversationHistory.push({ role: 'user', content: userText });
        const recentHistory = session.conversationHistory.slice(-20);
        
        try {
            const completion = await this.groq.chat.completions.create({
                model: CONFIG.brain_model,
                messages: [
                    { role: 'system', content: CONFIG.system_prompt },
                    ...recentHistory
                ],
                max_tokens: 300,
                temperature: 0.7
            });
            
            const responseText = completion.choices[0].message.content;
            session.conversationHistory.push({ role: 'assistant', content: responseText });
            
            const latency = Date.now() - startTime;
            console.log(`🧠 Brain: "${responseText.substring(0, 60)}..." (${latency}ms)`);
            
            return { text: responseText, latency };
        } catch (error) {
            console.error('❌ Brain Error:', error.message);
            throw error;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // STEP 3: SENTENCE SPLITTING
    // ═══════════════════════════════════════════════════════════════════════════════
    
    splitIntoSentences(text) {
        // Split on sentence boundaries, keeping short chunks
        const sentences = text
            .replace(/([.!?])\s+/g, '$1|SPLIT|')
            .split('|SPLIT|')
            .map(s => s.trim())
            .filter(s => s.length > 0);
        
        // Merge very short sentences, split very long ones
        const chunks = [];
        let currentChunk = '';
        
        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length < CONFIG.max_chunk_chars) {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            } else {
                if (currentChunk) chunks.push(currentChunk);
                currentChunk = sentence;
            }
        }
        if (currentChunk) chunks.push(currentChunk);
        
        console.log(`📝 Split into ${chunks.length} chunks:`, chunks.map(c => `"${c.substring(0, 30)}..."`));
        return chunks;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // STEP 4: PARALLEL TTS (Fire all chunks simultaneously!)
    // ═══════════════════════════════════════════════════════════════════════════════
    
    async synthesizeChunk(text, chunkIndex) {
        const startTime = Date.now();
        
        try {
            const [response] = await this.tts.synthesizeSpeech({
                input: { text },
                voice: { languageCode: 'en-US', name: CONFIG.tts_voice },
                audioConfig: {
                    audioEncoding: CONFIG.tts_encoding,
                    sampleRateHertz: CONFIG.tts_sample_rate
                }
            });
            
            const latency = Date.now() - startTime;
            console.log(`🔊 TTS chunk ${chunkIndex}: ${latency}ms, ${(response.audioContent.length/1024).toFixed(1)}KB`);
            
            return {
                chunkIndex,
                audio: response.audioContent,
                text,
                latency
            };
        } catch (error) {
            console.error(`❌ TTS chunk ${chunkIndex} error:`, error.message);
            throw error;
        }
    }
    
    async synthesizeParallel(sentences) {
        const startTime = Date.now();
        
        // Fire ALL requests in parallel
        const promises = sentences.map((text, index) => 
            this.synthesizeChunk(text, index)
        );
        
        // Wait for all to complete
        const results = await Promise.all(promises);
        
        // Sort by chunk index to ensure correct order
        results.sort((a, b) => a.chunkIndex - b.chunkIndex);
        
        const totalLatency = Date.now() - startTime;
        console.log(`🔊 TTS parallel complete: ${totalLatency}ms for ${sentences.length} chunks`);
        
        return {
            chunks: results,
            totalLatency
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // STREAMING VERSION: Send chunks as they arrive
    // ═══════════════════════════════════════════════════════════════════════════════
    
    async synthesizeStreaming(sentences, onChunkReady) {
        const startTime = Date.now();
        const pendingChunks = new Map();
        let nextChunkToSend = 0;
        
        // Fire ALL requests in parallel
        const promises = sentences.map(async (text, index) => {
            const result = await this.synthesizeChunk(text, index);
            pendingChunks.set(index, result);
            
            // Send chunks in order as they become available
            while (pendingChunks.has(nextChunkToSend)) {
                const chunk = pendingChunks.get(nextChunkToSend);
                pendingChunks.delete(nextChunkToSend);
                onChunkReady(chunk);
                nextChunkToSend++;
            }
            
            return result;
        });
        
        await Promise.all(promises);
        
        return Date.now() - startTime;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // FULL PIPELINE
    // ═══════════════════════════════════════════════════════════════════════════════
    
    async processVoiceInput(audioBuffer, sessionId, onChunkReady) {
        const pipelineStart = Date.now();
        const session = this.getSession(sessionId);
        
        console.log('\n' + '═'.repeat(70));
        console.log('🥝 KEA V5 PIPELINE START');
        console.log('═'.repeat(70));
        
        try {
            // Step 1: Transcribe
            const stt = await this.transcribe(audioBuffer);
            if (!stt.text?.trim()) {
                console.log('⚠️ Empty transcription');
                return null;
            }
            
            // Step 2: Generate response
            const brain = await this.generateResponse(stt.text, session);
            
            // Step 3: Split into sentences
            const sentences = this.splitIntoSentences(brain.text);
            
            // Step 4: Parallel TTS with streaming
            const timeToFirstChunk = Date.now() - pipelineStart;
            let ttsLatency;
            
            if (onChunkReady) {
                // Streaming mode
                ttsLatency = await this.synthesizeStreaming(sentences, onChunkReady);
            } else {
                // Batch mode
                const tts = await this.synthesizeParallel(sentences);
                ttsLatency = tts.totalLatency;
            }
            
            const totalLatency = Date.now() - pipelineStart;
            
            console.log('─'.repeat(70));
            console.log(`📊 PIPELINE COMPLETE: ${totalLatency}ms total`);
            console.log(`   STT: ${stt.latency}ms | Brain: ${brain.latency}ms | TTS: ${ttsLatency}ms`);
            console.log(`   ⚡ First audio ready: ~${timeToFirstChunk + 400}ms`);
            console.log('═'.repeat(70) + '\n');
            
            return {
                userText: stt.text,
                responseText: brain.text,
                latencies: {
                    stt: stt.latency,
                    brain: brain.latency,
                    tts: ttsLatency,
                    total: totalLatency
                }
            };
        } catch (error) {
            console.error('❌ Pipeline Error:', error.message);
            throw error;
        }
    }
    
    async processTextInput(userText, sessionId, onChunkReady) {
        const pipelineStart = Date.now();
        const session = this.getSession(sessionId);
        
        console.log('\n' + '═'.repeat(70));
        console.log('🥝 KEA V5 TEXT PIPELINE');
        console.log('═'.repeat(70));
        console.log(`📝 User: "${userText}"`);
        
        try {
            // Step 1: Generate response
            const brain = await this.generateResponse(userText, session);
            
            // Step 2: Split into sentences
            const sentences = this.splitIntoSentences(brain.text);
            
            // Step 3: Parallel TTS
            let ttsLatency;
            let chunks = [];
            
            if (onChunkReady) {
                ttsLatency = await this.synthesizeStreaming(sentences, onChunkReady);
            } else {
                const tts = await this.synthesizeParallel(sentences);
                ttsLatency = tts.totalLatency;
                chunks = tts.chunks;
            }
            
            const totalLatency = Date.now() - pipelineStart;
            
            console.log('─'.repeat(70));
            console.log(`📊 PIPELINE COMPLETE: ${totalLatency}ms total`);
            console.log(`   Brain: ${brain.latency}ms | TTS: ${ttsLatency}ms`);
            console.log('═'.repeat(70) + '\n');
            
            return {
                userText,
                responseText: brain.text,
                chunks,
                latencies: {
                    brain: brain.latency,
                    tts: ttsLatency,
                    total: totalLatency
                }
            };
        } catch (error) {
            console.error('❌ Pipeline Error:', error.message);
            throw error;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// WEBSOCKET RELAY
// ═══════════════════════════════════════════════════════════════════════════════════

function createRelayV5(server, wsPath = '/relay-v5') {
    const kea = new KeaV5VoiceEngine();
    
    // Use noServer mode to avoid conflict with other WebSocket servers
    const wss = new WebSocket.Server({ noServer: true });
    
    // Handle upgrade requests manually
    server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        
        if (url.pathname === wsPath) {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
        // Don't close socket for other paths - let other handlers deal with them
    });
    
    wss.on('connection', (ws) => {
        const sessionId = `v5-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        console.log(`🔌 V5 WebSocket connected: ${sessionId}`);
        
        ws.send(JSON.stringify({ type: 'connected', sessionId }));
        
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                if (message.type === 'audio') {
                    // Decode base64 audio
                    const audioBuffer = Buffer.from(message.audio, 'base64');
                    
                    ws.send(JSON.stringify({ type: 'status', stage: 'transcribing' }));
                    
                    // Process with streaming chunks
                    let chunkIndex = 0;
                    const result = await kea.processVoiceInput(
                        audioBuffer, 
                        sessionId,
                        (chunk) => {
                            // Send each audio chunk as it's ready
                            ws.send(JSON.stringify({
                                type: 'audio_chunk',
                                chunkIndex: chunk.chunkIndex,
                                text: chunk.text,
                                audio: chunk.audio.toString('base64'),
                                latency: chunk.latency
                            }));
                        }
                    );
                    
                    if (result) {
                        ws.send(JSON.stringify({
                            type: 'transcript',
                            text: result.userText
                        }));
                        
                        ws.send(JSON.stringify({
                            type: 'response',
                            text: result.responseText,
                            latencies: result.latencies
                        }));
                        
                        ws.send(JSON.stringify({ type: 'speech_complete' }));
                    }
                }
                
                if (message.type === 'text') {
                    ws.send(JSON.stringify({ type: 'status', stage: 'thinking' }));
                    
                    const result = await kea.processTextInput(
                        message.text,
                        sessionId,
                        (chunk) => {
                            ws.send(JSON.stringify({
                                type: 'audio_chunk',
                                chunkIndex: chunk.chunkIndex,
                                text: chunk.text,
                                audio: chunk.audio.toString('base64'),
                                latency: chunk.latency
                            }));
                        }
                    );
                    
                    ws.send(JSON.stringify({
                        type: 'response',
                        text: result.responseText,
                        latencies: result.latencies
                    }));
                    
                    ws.send(JSON.stringify({ type: 'speech_complete' }));
                }
                
            } catch (error) {
                console.error('❌ WebSocket error:', error);
                ws.send(JSON.stringify({ type: 'error', message: error.message }));
            }
        });
        
        ws.on('close', () => {
            console.log(`🔌 V5 WebSocket disconnected: ${sessionId}`);
        });
    });
    
    console.log(`🥝 Kea V5 WebSocket relay ready at ${wsPath}`);
    return wss;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// STANDALONE SERVER (for testing)
// ═══════════════════════════════════════════════════════════════════════════════════

function createStandaloneServer() {
    const server = http.createServer((req, res) => {
        if (req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', engine: 'Kea V5' }));
            return;
        }
        
        if (req.url === '/' || req.url === '/v5') {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(getTestPageHTML());
            return;
        }
        
        res.writeHead(404);
        res.end('Not found');
    });
    
    createRelayV5(server, '/relay');
    
    server.listen(CONFIG.port, () => {
        console.log('\n' + '═'.repeat(70));
        console.log('🥝 KEA V5 STANDALONE SERVER');
        console.log('═'.repeat(70));
        console.log(`   URL: http://localhost:${CONFIG.port}`);
        console.log(`   WebSocket: ws://localhost:${CONFIG.port}/relay`);
        console.log('═'.repeat(70) + '\n');
    });
    
    return server;
}

function getTestPageHTML() {
    return `<!DOCTYPE html>
<html>
<head>
    <title>🥝 Kea V5 Test</title>
    <style>
        body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; background: #1a1a2e; color: #eee; }
        h1 { color: #4ade80; }
        textarea { width: 100%; padding: 10px; background: #0f0f23; color: #fff; border: 1px solid #333; border-radius: 8px; }
        button { background: #4ade80; color: #000; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; margin: 10px 5px 10px 0; }
        button:hover { background: #22c55e; }
        .status { padding: 10px; background: #333; border-radius: 8px; margin: 10px 0; }
        .chunk { background: #16213e; padding: 10px; margin: 5px 0; border-radius: 8px; }
        audio { width: 100%; margin: 5px 0; }
    </style>
</head>
<body>
    <h1>🥝 Kea V5 - Parallel TTS</h1>
    <p>Groq STT + Brain → Parallel Google Chirp TTS</p>
    
    <textarea id="input" rows="3" placeholder="Type a message...">How can I improve my thesis structure?</textarea>
    <br>
    <button onclick="sendText()">Send Text</button>
    <button onclick="toggleMic()" id="micBtn">🎤 Record</button>
    
    <div class="status" id="status">Ready</div>
    <div id="chunks"></div>
    <div id="response"></div>

    <script>
        let ws, mediaRecorder, isRecording = false;
        
        function connect() {
            ws = new WebSocket('ws://localhost:${CONFIG.port}/relay');
            ws.onopen = () => document.getElementById('status').textContent = '✅ Connected';
            ws.onclose = () => { document.getElementById('status').textContent = '❌ Disconnected'; setTimeout(connect, 2000); };
            ws.onmessage = handleMessage;
        }
        
        function handleMessage(e) {
            const data = JSON.parse(e.data);
            const status = document.getElementById('status');
            const chunks = document.getElementById('chunks');
            
            if (data.type === 'status') status.textContent = '⏳ ' + data.stage;
            if (data.type === 'transcript') status.textContent = '🎤 You: ' + data.text;
            if (data.type === 'response') {
                document.getElementById('response').innerHTML = '<h3>Response:</h3><p>' + data.text + '</p><p>Latency: ' + data.latencies.total + 'ms</p>';
            }
            if (data.type === 'audio_chunk') {
                const audio = new Audio('data:audio/ogg;base64,' + data.audio);
                chunks.innerHTML += '<div class="chunk">Chunk ' + data.chunkIndex + ': "' + data.text + '" (' + data.latency + 'ms)</div>';
                audio.play();
            }
            if (data.type === 'speech_complete') status.textContent = '✅ Complete';
        }
        
        function sendText() {
            const text = document.getElementById('input').value;
            document.getElementById('chunks').innerHTML = '';
            ws.send(JSON.stringify({ type: 'text', text }));
        }
        
        async function toggleMic() {
            if (isRecording) {
                mediaRecorder.stop();
                document.getElementById('micBtn').textContent = '🎤 Record';
                isRecording = false;
            } else {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                const chunks = [];
                mediaRecorder.ondataavailable = e => chunks.push(e.data);
                mediaRecorder.onstop = async () => {
                    const blob = new Blob(chunks, { type: 'audio/webm' });
                    const buffer = await blob.arrayBuffer();
                    const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
                    document.getElementById('chunks').innerHTML = '';
                    ws.send(JSON.stringify({ type: 'audio', audio: base64 }));
                };
                mediaRecorder.start();
                document.getElementById('micBtn').textContent = '⏹️ Stop';
                isRecording = true;
            }
        }
        
        connect();
    </script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════════

module.exports = { KeaV5VoiceEngine, createRelayV5, createStandaloneServer, CONFIG };

// Run standalone if executed directly
if (require.main === module) {
    createStandaloneServer();
}
