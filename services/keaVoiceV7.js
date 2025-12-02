// ═══════════════════════════════════════════════════════════════════════════════════
// 🥝 KEA V7 - TURN-TAKING ARCHITECTURE (LOG 3 & 4)
// ═══════════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE (Sensory Gating / Half-Duplex):
//
// ┌─────────────────────────────────────────────────────────────────────────────────┐
// │  Mic Stream from Browser                                                        │
// │       ↓                                                                         │
// │  [Client Gate] <─── "SPEAKING" State ───────────────────────────────────────┐   │
// │       │                                                                      │   │
// │       ├── If System Speaking → MUTE (Send nothing)                           │   │
// │       └── If System Listening → PASS                                         │   │
// │              ↓                                                               │   │
// │  [Server Gate] <─── "SPEAKING" State (Double Safety) ───────────────────────┐   │
// │       │                                                                      │   │
// │       ├── If System Speaking → DROP                                          │   │
// │       └── If System Listening → PASS                                         │   │
// │              ↓                                                               │   │
// │  [Server-Side VAD] ─────────────────────────────────────────────────────┐   │   │
// │       │                                                                  │   │   │
// │       └── Speech detected → Buffer                                      │   │   │
// │       └── Speech ended → Process utterance                              │   │   │
// │              ↓                                                           │   │   │
// │  [Groq Whisper STT] ────────────────────────────────────→ ~50ms         │   │   │
// │       ↓                                                                  │   │   │
// │  [Groq Llama 3.3 70B Brain] ────────────────────────────→ ~150ms        │   │   │
// │       ↓                                                                  │   │   │
// │  [PARALLEL Google Chirp TTS] ───────────────────────────→ ~400ms        │   │   │
// │       │                                                                  │   │   │
// │       └── Set State = SPEAKING ──────────────────────────────────────────┘   │   │
// │       └── Stream to client ──────────────────────────────────────────────────┘   │
// │       └── On Complete → Set State = LISTENING                                    │
// │                                                                                   │
// │  BENEFITS: Zero Echo, Zero Hallucination Loops, 100% Stability                   │
// │  TRADE-OFF: No Barge-in (User must wait for system to finish)                    │
// └───────────────────────────────────────────────────────────────────────────────────┘
//
// ═══════════════════════════════════════════════════════════════════════════════════

const Groq = require('groq-sdk');
const textToSpeech = require('@google-cloud/text-to-speech');
const speech = require('@google-cloud/speech');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { AntiHallucinationPipeline } = require('./kea_v7_anti_hallucination');

// ═══════════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════════

const CONFIG = {
    port: process.env.PORT || 16602,
    
    // Credentials
    google_credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS || 
        "C:\\Users\\regan\\ID SYSTEM\\Keys\\gen-lang-client-0219506317-e656a112d84b.json",
    
    // TTS Settings (Google Chirp 3 HD - fastest natural voice)
    tts: {
        voice: 'en-US-Chirp3-HD-Kore',
        encoding: 'LINEAR16',
        sampleRate: 24000
    },
    
    // STT Settings (Google Cloud Speech)
    stt: {
        provider: 'google', // 'groq' or 'google'
        model: 'latest_long', // Google model
        languageCode: 'en-US'
    },
    
    // Brain Settings (Groq Llama)
    brain: {
        model: 'llama-3.3-70b-versatile',
        maxTokens: 300,
        temperature: 0.7
    },
    
    // VAD Settings (Can be more sensitive now that echo is impossible)
    vad: {
        energyThreshold: 0.005,        // Increased from 0.001 to reduce noise hallucinations
        speechStartMs: 150,            // ms of speech to trigger
        silenceEndMs: 1800,            // Base silence timeout - increased for thinking pauses
        hedgingExtensionMs: 1000,      // Extra time for "um", "uh", thinking
        maxSilenceMs: 3500             // Maximum silence timeout - 3.5 seconds for longer pauses
    }
};

// Set Google credentials
process.env.GOOGLE_APPLICATION_CREDENTIALS = CONFIG.google_credentials;

// ═══════════════════════════════════════════════════════════════════════════════════
// ADAPTIVE VAD - Server-side with hedging detection
// ═══════════════════════════════════════════════════════════════════════════════════

class AdaptiveVAD {
    constructor(config = CONFIG.vad) {
        this.config = config;
        this.state = 'idle'; // idle, speaking, silence
        this.speechStartTime = null;
        this.silenceStartTime = null;
        this.speechBuffer = [];
        this.contextAdjustment = 0;
        this.transcriptSoFar = '';
    }
    
    // Update context from partial transcript
    updateContext(partialTranscript) {
        this.transcriptSoFar = partialTranscript;
        
        // Detect hedging patterns
        if (partialTranscript.match(/(um|uh|hmm|er|ah)\.?\.?\.?$/i) ||
            partialTranscript.endsWith('...')) {
            this.contextAdjustment = this.config.hedgingExtensionMs;
        }
        // Detect sentence completion
        else if (partialTranscript.match(/[.?!]$/)) {
            this.contextAdjustment = -200;
        }
        else {
            this.contextAdjustment = 0;
        }
    }
    
    get silenceTimeout() {
        return Math.max(
            300,
            Math.min(this.config.maxSilenceMs, this.config.silenceEndMs + this.contextAdjustment)
        );
    }
    
    // Process audio chunk, returns event or null
    process(energy, timestamp, samples) {
        const isSpeech = energy > this.config.energyThreshold;
        
        switch (this.state) {
            case 'idle':
                if (isSpeech) {
                    this.speechStartTime = timestamp;
                    this.state = 'maybe_speech';
                    this.speechBuffer = [{ samples, timestamp }];
                }
                return null;
                
            case 'maybe_speech':
                if (isSpeech) {
                    this.speechBuffer.push({ samples, timestamp });
                    if (timestamp - this.speechStartTime >= this.config.speechStartMs) {
                        this.state = 'speaking';
                        return { type: 'speech_start', buffer: this.speechBuffer };
                    }
                } else {
                    this.state = 'idle';
                    this.speechBuffer = [];
                }
                return null;
                
            case 'speaking':
                if (isSpeech) {
                    this.silenceStartTime = null;
                    return { type: 'speech_continue', samples, timestamp };
                } else {
                    if (!this.silenceStartTime) {
                        this.silenceStartTime = timestamp;
                    }
                    if (timestamp - this.silenceStartTime >= this.silenceTimeout) {
                        this.state = 'idle';
                        this.silenceStartTime = null;
                        this.speechBuffer = [];
                        this.contextAdjustment = 0;
                        this.transcriptSoFar = '';
                        return { type: 'speech_end' };
                    }
                    return { type: 'speech_continue', samples, timestamp };
                }
        }
        
        return null;
    }
    
    // Force reset
    reset() {
        this.state = 'idle';
        this.speechStartTime = null;
        this.silenceStartTime = null;
        this.speechBuffer = [];
        this.contextAdjustment = 0;
        this.transcriptSoFar = '';
    }
    
    isActive() {
        return this.state === 'speaking' || this.state === 'maybe_speech';
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// MAIN V7 ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════

class KeaV7Engine {
    constructor() {
        // Initialize APIs
        this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        this.ttsClient = new textToSpeech.TextToSpeechClient();
        this.sttClient = new speech.SpeechClient();
        
        // Anti-Hallucination Pipeline
        this.antiHallucination = new AntiHallucinationPipeline({
            noSpeechThreshold: 0.6,
            minConfidence: 0.5
        });
        
        // Sessions
        this.sessions = new Map();
        
        console.log('🥝 Kea V7 Engine initialized (Turn-Taking Architecture)');
        console.log(`   STT: ${CONFIG.stt.provider === 'google' ? 'Google Cloud Speech' : 'Groq Whisper'}`);
        console.log(`   Brain: Groq ${CONFIG.brain.model}`);
        console.log(`   TTS: Google ${CONFIG.tts.voice}`);
        console.log(`   Mode: Sensory Gating + Anti-Hallucination Pipeline`);
    }
    
    // Create or get session
    getSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                vad: new AdaptiveVAD(),
                conversationHistory: [],
                audioBuffer: [],
                isSpeaking: false, // The Gate
                mode: 'heuristic',
                coachingContext: null // Dynamic context from server
            });
        }
        return this.sessions.get(sessionId);
    }

    // Set coaching context for a session
    setCoachingContext(sessionId, context) {
        const session = this.getSession(sessionId);
        session.coachingContext = context;
        console.log(`📚 [${sessionId}] Coaching context updated: ${context ? context.substring(0, 50) + '...' : 'cleared'}`);
        return true;
    }

    // Get coaching context for a session
    getCoachingContext(sessionId) {
        const session = this.getSession(sessionId);
        return session.coachingContext;
    }
    
    // Process incoming audio chunk from client
    // NOTE: With client-side AudioGateClient, we now receive COMPLETE speech segments
    // rather than a continuous stream. We can skip server-side VAD.
    async processAudioChunk(sessionId, samples, timestamp, callbacks) {
        const session = this.getSession(sessionId);
        
        // 🛡️ SENSORY GATING: If system is speaking, IGNORE all input
        if (session.isSpeaking) {
            return { processed: false, reason: 'gated' };
        }
        
        // Calculate energy for logging
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        const energy = Math.sqrt(sum / samples.length);
        const durationMs = (samples.length / 16000) * 1000;
        
        console.log(`🎤 [${sessionId}] Received pre-gated chunk: ${durationMs.toFixed(0)}ms, energy=${energy.toFixed(4)}`);
        
        // Client-side gate already validated this is speech.
        // Process it directly as a complete utterance.
        if (callbacks.onSpeechStart) callbacks.onSpeechStart();
        if (callbacks.onSpeechEnd) callbacks.onSpeechEnd();
        
        await this.processUtterance(sessionId, [samples], callbacks);
        
        return { 
            processed: true, 
            energy: energy
        };
    }
    
    // Process complete utterance
    async processUtterance(sessionId, audioBuffers, callbacks) {
        const session = this.getSession(sessionId);
        const startTime = Date.now();
        
        console.log(`🔍 [${sessionId}] Processing Utterance...`);

        try {
            // Combine audio buffers
            const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);
            const combinedAudio = new Float32Array(totalLength);
            let offset = 0;
            for (const buf of audioBuffers) {
                combinedAudio.set(buf, offset);
                offset += buf.length;
            }
            
            // ════════════════════════════════════════════════════════════════════════
            // 🛡️ GATE 1: AUDIO LEVEL (Signal Processing)
            // ════════════════════════════════════════════════════════════════════════
            let sumSq = 0;
            for(let i=0; i<combinedAudio.length; i++) sumSq += combinedAudio[i]*combinedAudio[i];
            const rms = Math.sqrt(sumSq / combinedAudio.length);
            const durationMs = (combinedAudio.length / 16000) * 1000;

            // Thresholds: RMS > 0.002 (approx -54dB) AND Duration > 400ms
            if (rms < 0.002 || durationMs < 400) {
                console.log(`🚫 [${sessionId}] GATE 1 REJECT: RMS=${rms.toFixed(4)}, Dur=${durationMs.toFixed(0)}ms`);
                return;
            }

            // Convert to WAV buffer for STT
            const wavBuffer = this.float32ToWav(combinedAudio, 16000);
            
            // Step 1: STT
            if (callbacks.onStatus) callbacks.onStatus('transcribing');
            const sttStart = Date.now();
            let userText = '';
            let sttMetadata = null; // For Gate 2

            if (CONFIG.stt.provider === 'google') {
                try {
                    // Google Cloud Speech-to-Text
                    // Send RAW PCM (skip 44 byte header)
                    const audioBytes = wavBuffer.slice(44).toString('base64');
                    const request = {
                        audio: { content: audioBytes },
                        config: {
                            encoding: 'LINEAR16',
                            sampleRateHertz: 16000,
                            languageCode: CONFIG.stt.languageCode,
                            model: CONFIG.stt.model,
                            useEnhanced: true
                        },
                    };
                    
                    const [response] = await this.sttClient.recognize(request);
                    userText = response.results
                        .map(result => result.alternatives[0].transcript)
                        .join('\n')
                        .trim();
                } catch (googleError) {
                    console.error(`⚠️ [${sessionId}] Google STT Failed:`, googleError.message);
                    if (googleError.code === 7 || googleError.message.includes('SERVICE_DISABLED')) {
                        console.error('🚨 CRITICAL: Google Cloud Speech API is NOT ENABLED. Please enable it in Google Cloud Console.');
                    }
                    console.log(`🔄 [${sessionId}] Falling back to Groq Whisper...`);
                    
                    // Fallback to Groq
                    try {
                        const transcription = await this.groq.audio.transcriptions.create({
                            file: new File([wavBuffer], 'audio.wav', { type: 'audio/wav' }),
                            model: 'whisper-large-v3-turbo',
                            language: 'en',
                            response_format: 'verbose_json'
                        });
                        userText = transcription.text?.trim();
                        sttMetadata = transcription.segments;
                    } catch (e) {
                        console.error(`❌ [${sessionId}] Whisper Fallback Failed:`, e.message);
                        return;
                    }
                }
            } else {
                // Groq Whisper Primary
                try {
                    const transcription = await this.groq.audio.transcriptions.create({
                        file: new File([wavBuffer], 'audio.wav', { type: 'audio/wav' }),
                        model: CONFIG.stt.model,
                        language: 'en',
                        response_format: 'verbose_json'
                    });
                    userText = transcription.text?.trim();
                    sttMetadata = transcription.segments;
                } catch (e) {
                    console.error(`❌ [${sessionId}] Whisper Failed:`, e.message);
                    return;
                }
            }
            
            const sttLatency = Date.now() - sttStart;
            
            if (!userText) {
                console.log(`[${sessionId}] Empty transcription, ignoring`);
                return;
            }

            console.log(`🗣️ [${sessionId}] RAW STT: "${userText}"`);

            // ════════════════════════════════════════════════════════════════════════
            // 🛡️ ANTI-HALLUCINATION PIPELINE (Combined Gates 2 & 3)
            // ════════════════════════════════════════════════════════════════════════
            const pipelineResult = this.antiHallucination.process({
                text: userText,
                segments: sttMetadata
            });

            if (!pipelineResult.valid) {
                console.log(`🚫 [${sessionId}] PIPELINE REJECT: "${userText}" | Reason: ${pipelineResult.reason}`);
                return;
            }

            console.log(`✅ [${sessionId}] ACCEPTED: "${userText}"`);
            if (callbacks.onTranscript) callbacks.onTranscript(userText);
            
            session.vad.updateContext(userText);
            
            // Step 2: Brain
            if (callbacks.onStatus) callbacks.onStatus('thinking');
            const brainStart = Date.now();
            
            session.conversationHistory.push({ role: 'user', content: userText });
            
            // Get system prompt with fractal coaching context
            const systemPrompt = this.getSystemPrompt(sessionId);
            const hasCoachingContext = systemPrompt.includes('STUDENT ASSESSMENT CONTEXT');
            console.log(`🧠 [${sessionId}] Groq call - Coaching context injected: ${hasCoachingContext ? '✅ YES' : '❌ NO'}`);
            if (hasCoachingContext) {
                console.log(`🧠 [${sessionId}] System prompt length: ${systemPrompt.length} chars`);
            }
            
            const response = await this.groq.chat.completions.create({
                model: CONFIG.brain.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...session.conversationHistory.slice(-10)
                ],
                max_tokens: CONFIG.brain.maxTokens,
                temperature: CONFIG.brain.temperature
            });
            
            const brainLatency = Date.now() - brainStart;
            const responseText = response.choices[0]?.message?.content?.trim();
            
            if (!responseText) {
                console.log(`[${sessionId}] Empty brain response`);
                return;
            }
            
            console.log(`🧠 [${sessionId}] Brain (${brainLatency}ms): "${responseText.substring(0, 50)}..."`);
            session.conversationHistory.push({ role: 'assistant', content: responseText });
            
            if (callbacks.onResponse) callbacks.onResponse(responseText);
            
            // Step 3: TTS with Gating
            if (callbacks.onStatus) callbacks.onStatus('speaking');
            
            // 🔒 CLOSE THE GATE
            session.isSpeaking = true;
            if (callbacks.onStateChange) callbacks.onStateChange('speaking');
            
            await this.synthesizeAndStream(sessionId, responseText, callbacks);
            
            // 🔓 OPEN THE GATE
            session.isSpeaking = false;
            if (callbacks.onStateChange) callbacks.onStateChange('listening');
            if (callbacks.onStatus) callbacks.onStatus('listening');
            
            const totalLatency = Date.now() - startTime;
            console.log(`✅ [${sessionId}] Total: ${totalLatency}ms`);
            
            if (callbacks.onComplete) {
                callbacks.onComplete({ sttLatency, brainLatency, totalLatency });
            }
            
        } catch (error) {
            console.error(`❌ [${sessionId}] Error:`, error);
            if (callbacks.onError) callbacks.onError(error.message);
            
            // Ensure gate is opened on error
            session.isSpeaking = false;
            if (callbacks.onStateChange) callbacks.onStateChange('listening');
        }
    }
    
    // Synthesize and stream TTS
    async synthesizeAndStream(sessionId, text, callbacks) {
        const chunks = this.splitIntoChunks(text);
        console.log(`🔊 [${sessionId}] TTS: ${chunks.length} chunks`);
        
        // Parallel synthesis
        const ttsPromises = chunks.map((chunk, index) => 
            this.synthesizeChunk(chunk, index)
        );
        
        const results = await Promise.all(ttsPromises);
        
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result && result.audio) {
                // Add WAV header for client playback
                const wavAudio = this.addWavHeader(result.audio, CONFIG.tts.sampleRate);
                
                console.log(`📤 [${sessionId}] Sending Chunk ${i+1}/${chunks.length}`);

                if (callbacks.onAudioChunk) {
                    callbacks.onAudioChunk({
                        chunkIndex: i,
                        totalChunks: chunks.length,
                        text: result.text,
                        audio: wavAudio,
                        latency: result.latency
                    });
                }
            }
        }
        
        if (callbacks.onSpeechComplete) {
            callbacks.onSpeechComplete();
        }
    }
    
    // Synthesize single chunk
    async synthesizeChunk(text, index) {
        const startTime = Date.now();
        try {
            const [response] = await this.ttsClient.synthesizeSpeech({
                input: { text },
                voice: {
                    languageCode: 'en-US',
                    name: CONFIG.tts.voice
                },
                audioConfig: {
                    audioEncoding: CONFIG.tts.encoding,
                    sampleRateHertz: CONFIG.tts.sampleRate
                }
            });
            return {
                index,
                text,
                audio: response.audioContent,
                latency: Date.now() - startTime
            };
        } catch (error) {
            console.error(`TTS error for chunk ${index}:`, error);
            return null;
        }
    }
    
    // Split text into speakable chunks
    splitIntoChunks(text) {
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        const chunks = [];
        let current = '';
        for (const sentence of sentences) {
            if (current.length + sentence.length < 100) {
                current += sentence;
            } else {
                if (current) chunks.push(current.trim());
                current = sentence;
            }
        }
        if (current) chunks.push(current.trim());
        return chunks.filter(c => c.length > 0);
    }
    
    // Convert Float32 samples to WAV buffer
    float32ToWav(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
        };
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, samples.length * 2, true);
        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }
        return Buffer.from(buffer);
    }
    
    // Add WAV header to 16-bit PCM buffer
    addWavHeader(pcmBuffer, sampleRate) {
        const buffer = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + buffer.length, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16);
        header.writeUInt16LE(1, 20);
        header.writeUInt16LE(1, 22);
        header.writeUInt32LE(sampleRate, 24);
        header.writeUInt32LE(sampleRate * 2, 28);
        header.writeUInt16LE(2, 32);
        header.writeUInt16LE(16, 34);
        header.write('data', 36);
        header.writeUInt32LE(buffer.length, 40);
        return Buffer.concat([header, buffer]);
    }

    getSystemPrompt(sessionId) {
        const basePrompt = `You are Kea, a friendly voice-based academic research coach having a real-time spoken conversation.
You help PhD students and researchers think through their work using Socratic questioning.

Key behaviors:
- You are speaking out loud - keep responses natural and conversational
- Ask clarifying questions to understand their research
- Challenge assumptions gently
- Help them discover insights themselves
- Keep responses SHORT (1-2 sentences max) - this is a voice conversation
- Be encouraging but intellectually rigorous
- NEVER say you are "text-based" or cannot hear - you ARE a voice assistant`;

        // Get coaching context if available
        let coachingContext = null;
        if (sessionId) {
            const session = this.sessions.get(sessionId);
            if (session && session.coachingContext) {
                coachingContext = session.coachingContext;
            }
        }

        // Append coaching context if available
        if (coachingContext) {
            return `${basePrompt}\n\n${coachingContext}`;
        }

        // Default fallback context
        return `${basePrompt}\n\nCurrent course context: MAMC01810 - Managing for Sustainability`;
    }
    
    destroySession(sessionId) {
        this.sessions.delete(sessionId);
    }

    setMode(sessionId, mode) {
        const session = this.getSession(sessionId);
        if (['heuristic', 'llm_repair', 'acoustic_gating'].includes(mode)) {
            session.mode = mode;
            console.log(`🔄 [${sessionId}] Switched to mode: ${mode.toUpperCase()}`);
            return true;
        }
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// WEBSOCKET RELAY - V7 Streaming Protocol
// ═══════════════════════════════════════════════════════════════════════════════════

function createRelayV7(server, wsPath = '/relay-v7', coachingContexts = null) {
    const engine = new KeaV7Engine();
    const wss = new WebSocket.Server({ noServer: true });
    
    // Store reference to coaching contexts for session access
    engine.coachingContexts = coachingContexts;
    
    server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (url.pathname === wsPath) {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
    });
    
    wss.on('connection', (ws) => {
        const sessionId = `v7-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        console.log(`🔌 V7 WebSocket connected: ${sessionId}`);
        
        ws.send(JSON.stringify({ type: 'connected', sessionId, version: 'v7' }));
        
        const callbacks = {
            onStatus: (stage) => ws.send(JSON.stringify({ type: 'status', stage })),
            onSpeechStart: () => ws.send(JSON.stringify({ type: 'speech_start' })),
            onSpeechEnd: () => ws.send(JSON.stringify({ type: 'speech_end' })),
            onTranscript: (text) => ws.send(JSON.stringify({ type: 'transcript', text })),
            onResponse: (text) => ws.send(JSON.stringify({ type: 'response', text })),
            onAudioChunk: (chunk) => ws.send(JSON.stringify({
                type: 'audio_chunk',
                chunkIndex: chunk.chunkIndex,
                totalChunks: chunk.totalChunks,
                text: chunk.text,
                audio: chunk.audio.toString('base64'),
                latency: chunk.latency
            })),
            onSpeechComplete: () => ws.send(JSON.stringify({ type: 'speech_complete' })),
            onStateChange: (state) => ws.send(JSON.stringify({ type: 'state', state })),
            onError: (message) => ws.send(JSON.stringify({ type: 'error', message })),
            onComplete: (latencies) => ws.send(JSON.stringify({ type: 'complete', latencies }))
        };
        
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                // Handle init message with sessionId to load coaching context
                if (message.type === 'init' && message.sessionId) {
                    console.log(`🔗 [${sessionId}] Client sessionId: ${message.sessionId}`);
                    
                    // Load coaching context from server-side map
                    if (engine.coachingContexts && engine.coachingContexts.has(message.sessionId)) {
                        const contextData = engine.coachingContexts.get(message.sessionId);
                        if (contextData && contextData.coachingContext) {
                            engine.setCoachingContext(sessionId, contextData.coachingContext);
                            console.log(`✅ [${sessionId}] FRACTAL COACHING CONTEXT LOADED!`);
                            console.log(`   Organization: ${contextData.analysis?.organization?.name || 'Unknown'}`);
                            console.log(`   Context length: ${contextData.coachingContext.length} chars`);
                            console.log(`   Dev areas: ${contextData.analysis?.coaching_output?.development_areas?.length || 0}`);
                            ws.send(JSON.stringify({ 
                                type: 'coaching_context_loaded', 
                                success: true,
                                organization: contextData.analysis?.organization?.name || 'Unknown'
                            }));
                        }
                    } else {
                        console.log(`⚠️ [${sessionId}] No coaching context found for client session ${message.sessionId}`);
                    }
                }
                
                if (message.type === 'set_mode') {
                    engine.setMode(sessionId, message.mode);
                }

                if (message.type === 'set_coaching_context') {
                    engine.setCoachingContext(sessionId, message.context);
                    ws.send(JSON.stringify({ type: 'coaching_context_set', success: true }));
                }

                // Handle text input (from quick prompts or text entry)
                if (message.type === 'text_input') {
                    console.log(`📝 [${sessionId}] Text input received: "${message.text.substring(0, 50)}..."`);
                    
                    try {
                        // Get the session
                        const session = engine.sessions.get(sessionId);
                        if (!session) {
                            throw new Error('Session not found');
                        }
                        
                        // Mark as processing
                        if (callbacks.onStateChange) callbacks.onStateChange('thinking');
                        
                        // Add user message to conversation history
                        session.conversationHistory.push({
                            role: 'user',
                            content: message.text
                        });
                        
                        // Send transcript event for text input
                        if (callbacks.onTranscript) callbacks.onTranscript(message.text);
                        
                        // Call brain
                        const brainStart = Date.now();
                        const systemPrompt = engine.getSystemPrompt(sessionId);
                        const hasCoachingContext = systemPrompt.includes('STUDENT ASSESSMENT CONTEXT');
                        console.log(`🧠 [${sessionId}] Text input - Coaching context injected: ${hasCoachingContext ? '✅ YES' : '❌ NO'}`);
                        
                        const response = await engine.groq.chat.completions.create({
                            model: CONFIG.brain.model,
                            messages: [
                                { role: 'system', content: systemPrompt },
                                ...session.conversationHistory.slice(-10)
                            ],
                            max_tokens: CONFIG.brain.maxTokens,
                            temperature: CONFIG.brain.temperature
                        });
                        
                        const brainLatency = Date.now() - brainStart;
                        const responseText = response.choices[0]?.message?.content?.trim();
                        
                        if (!responseText) {
                            throw new Error('Empty brain response');
                        }
                        
                        console.log(`🧠 [${sessionId}] Brain response (${brainLatency}ms): "${responseText.substring(0, 100)}..."`);
                        
                        // Add AI response to history
                        session.conversationHistory.push({
                            role: 'assistant',
                            content: responseText
                        });
                        
                        // Send AI response text
                        if (callbacks.onResponse) callbacks.onResponse(responseText);
                        
                        // Synthesize and stream speech
                        if (callbacks.onStateChange) callbacks.onStateChange('speaking');
                        session.isSpeaking = true;
                        
                        await engine.synthesizeAndStream(sessionId, responseText, callbacks);
                        
                        session.isSpeaking = false;
                        if (callbacks.onStateChange) callbacks.onStateChange('listening');
                        
                        // Send completion
                        if (callbacks.onComplete) {
                            callbacks.onComplete({
                                sttLatency: 0,
                                brainLatency,
                                totalLatency: Date.now() - brainStart
                            });
                        }
                    } catch (error) {
                        console.error(`❌ [${sessionId}] Text input processing error:`, error);
                        if (callbacks.onError) callbacks.onError(error.message);
                        if (callbacks.onStateChange) callbacks.onStateChange('listening');
                    }
                }

                if (message.type === 'audio_chunk') {
                    const samples = new Float32Array(Buffer.from(message.audio, 'base64').buffer);
                    const timestamp = message.timestamp || Date.now();
                    await engine.processAudioChunk(sessionId, samples, timestamp, callbacks);
                }
                
            } catch (error) {
                console.error('❌ WebSocket error:', error);
                ws.send(JSON.stringify({ type: 'error', message: error.message }));
            }
        });
        
        ws.on('close', () => {
            console.log(`🔌 V7 WebSocket disconnected: ${sessionId}`);
            engine.destroySession(sessionId);
        });
    });
    
    console.log(`🥝 Kea V7 WebSocket relay ready at ${wsPath}`);
    return wss;
}

module.exports = { KeaV7Engine, createRelayV7 };
