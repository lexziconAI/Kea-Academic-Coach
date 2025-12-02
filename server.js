/**
 * Kea - Academic Coaching Assistant V4
 * Interruptible Chunked Voice Architecture
 * 
 * Architecture:
 *   User speaks → Groq Whisper (STT) → Groq Llama 70B (brain) → OpenAI TTS (chunked)
 *   
 * Key Feature: ResponseTracker knows EXACTLY what words were heard
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Startup diagnostics
console.log('🚀 Starting Kea Academic Coach...');
console.log('📁 GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS || 'NOT SET');
console.log('📁 GOOGLE_CLOUD_PROJECT:', process.env.GOOGLE_CLOUD_PROJECT || 'NOT SET');
console.log('🔑 GROQ_API_KEY:', process.env.GROQ_API_KEY ? 'SET' : 'NOT SET');
console.log('🌐 PORT:', process.env.PORT || '16602 (default)');

// Check if Google credentials file exists
const fsSync = require('fs');
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath) {
    if (fsSync.existsSync(credPath)) {
        console.log('✅ Google credentials file found at:', credPath);
    } else {
        console.log('❌ Google credentials file NOT found at:', credPath);
    }
}

const http = require('http');
const fs = require('fs').promises;
const { log } = require('./services/logging');
const { createRelayV4 } = require('./services/relayV4');

// Assessment Upload & Analysis
const multer = require('multer');
const { parseDocument, validateFile } = require('./services/documentParser');
const { analyzeSubmission, generateCoachingContext } = require('./services/fractalAssessmentAnalyzer');

// Multer setup for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Store coaching contexts per session
const coachingContexts = new Map();
const { createRelayV5 } = require('./services/keaVoiceV5');
const { createRelayV6 } = require('./services/keaVoiceV6');
const { createRelayV7 } = require('./services/keaVoiceV7');
const { think, whisperSTT } = require('./services/groqBrain');

const PORT = process.env.PORT || 16602;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const sessions = new Map();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  try {
    // Health check
    if (pathname === '/health') {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        app: 'Kea Academic Coach',
        port: PORT,
        openai: !!OPENAI_API_KEY,
        groq: !!GROQ_API_KEY
      }));
      return;
    }

    // Status
    if (pathname === '/api/status') {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        activeSessions: sessions.size,
        config: {
          stt: 'OpenAI Realtime Whisper',
          brain: 'Groq Llama 3.3 70B',
          tts: 'OpenAI Realtime TTS'
        }
      }));
      return;
    }

    // Text coaching (no voice)
    if (pathname === '/api/coach' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { text, systemPrompt, history } = JSON.parse(body);
          if (!text) throw new Error('Text required');

          const result = await think(text, GROQ_API_KEY, { systemPrompt, history });

          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            input: text,
            response: result.text,
            latency: result.duration
          }));
        } catch (err) {
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // Voice coaching (audio in -> brain -> audio out via simple pipeline)
    if (pathname === '/api/voice' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const pipelineStart = Date.now();
        try {
          const { audio, systemPrompt } = JSON.parse(body);
          if (!audio) throw new Error('Audio (base64) required');

          const audioBuffer = Buffer.from(audio, 'base64');
          log('log3', `[VOICE] Received ${Math.round(audioBuffer.length/1024)}KB audio`);

          // STT with Groq Whisper
          log('log3', '[VOICE] Starting STT...');
          const sttResult = await whisperSTT(audioBuffer, GROQ_API_KEY);
          if (!sttResult.text) throw new Error('No speech detected');
          log('log3', `[VOICE] STT complete: "${sttResult.text.substring(0,50)}..." (${sttResult.duration}ms)`);

          // Brain with Groq
          log('log3', '[VOICE] Starting brain...');
          const brainResult = await think(sttResult.text, GROQ_API_KEY, { systemPrompt });
          log('log3', `[VOICE] Brain complete: "${brainResult.text.substring(0,50)}..." (${brainResult.duration}ms)`);

          // TTS with OpenAI (simple HTTP TTS)
          log('log3', '[VOICE] Starting TTS...');
          const ttsResult = await openaiTTS(brainResult.text);
          log('log3', `[VOICE] TTS complete: ${Math.round(ttsResult.audio.length/1024)}KB (${ttsResult.duration}ms)`);

          const totalDuration = Date.now() - pipelineStart;
          log('info', `🎙️ Voice pipeline: ${totalDuration}ms (STT:${sttResult.duration} + Brain:${brainResult.duration} + TTS:${ttsResult.duration})`);

          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            transcript: sttResult.text,
            response: brainResult.text,
            audio: ttsResult.audio.toString('base64'),
            mimeType: 'audio/mp3',
            metrics: {
              stt: sttResult.duration,
              brain: brainResult.duration,
              tts: ttsResult.duration
            }
          }));
        } catch (err) {
          log('error', `[VOICE] Pipeline error: ${err.message}`);
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ASSESSMENT UPLOAD ENDPOINT
    // ═══════════════════════════════════════════════════════════════════════════════
    if (pathname === '/api/upload-assessment' && req.method === 'POST') {
      // Handle multipart form data with multer
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          
          // Parse multipart form data manually (simple approach)
          const boundary = req.headers['content-type'].split('boundary=')[1];
          const parts = buffer.toString('binary').split('--' + boundary);
          
          let fileBuffer = null;
          let filename = 'upload.txt';
          let sessionId = 'default';
          
          for (const part of parts) {
            if (part.includes('filename=')) {
              // Extract filename
              const filenameMatch = part.match(/filename="([^"]+)"/);
              if (filenameMatch) filename = filenameMatch[1];
              
              // Extract file content (after double CRLF)
              const contentStart = part.indexOf('\r\n\r\n') + 4;
              const contentEnd = part.lastIndexOf('\r\n');
              const content = part.substring(contentStart, contentEnd);
              fileBuffer = Buffer.from(content, 'binary');
            }
            if (part.includes('name="sessionId"')) {
              const valueStart = part.indexOf('\r\n\r\n') + 4;
              const valueEnd = part.lastIndexOf('\r\n');
              sessionId = part.substring(valueStart, valueEnd).trim();
            }
          }
          
          if (!fileBuffer) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'No file uploaded' }));
            return;
          }
          
          log('info', `📄 [UPLOAD] Received ${filename} (${Math.round(fileBuffer.length/1024)}KB) for session ${sessionId}`);
          
          // Validate file
          const validation = validateFile(fileBuffer, filename);
          if (!validation.valid) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: validation.error }));
            return;
          }
          
          // Parse document
          const parseResult = await parseDocument(fileBuffer, filename);
          log('info', `📝 [UPLOAD] Extracted ${parseResult.metadata.wordCount} words`);
          
          // Analyze submission with Groq - FULL FRACTAL DECOMPOSITION
          log('info', `🌀 [FRACTAL] Starting full fractal decomposition...`);
          const analysis = await analyzeSubmission(parseResult.text);
          
          // Log fractal metadata
          if (analysis._metadata) {
            log('info', `🌀 [FRACTAL] ════════════════════════════════════════════`);
            log('info', `🌀 [FRACTAL] Method: ${analysis._metadata.analysisMethod}`);
            log('info', `🌀 [FRACTAL] Paths Generated: ${analysis._metadata.pathsGenerated}`);
            log('info', `🌀 [FRACTAL] Paths Survived Pruning: ${analysis._metadata.pathsSurvived}`);
            log('info', `🌀 [FRACTAL] Paths Passed Yamas: ${analysis._metadata.pathsPassed}`);
            log('info', `🌀 [FRACTAL] Winner Path ID: ${analysis._metadata.winnerPath}`);
            log('info', `🌀 [FRACTAL] Winner Score: ${analysis._metadata.winnerScore?.toFixed(4)}`);
            log('info', `🌀 [FRACTAL] Bellman Value: ${analysis._metadata.bellmanValue?.toFixed(4)}`);
            log('info', `🌀 [FRACTAL] Total Time: ${analysis._metadata.totalTime}ms`);
            if (analysis._metadata.yamasScores) {
              const y = analysis._metadata.yamasScores;
              log('info', `🕉️ [YAMAS] Ahimsa: ${(y.ahimsa * 100).toFixed(0)}% | Satya: ${(y.satya * 100).toFixed(0)}% | Asteya: ${(y.asteya * 100).toFixed(0)}% | Brahmacharya: ${(y.brahmacharya * 100).toFixed(0)}% | Aparigraha: ${(y.aparigraha * 100).toFixed(0)}%`);
            }
            log('info', `🌀 [FRACTAL] ════════════════════════════════════════════`);
          }
          
          log('info', `🧠 [UPLOAD] Analysis complete: ${analysis.coaching_output?.development_areas?.length || 0} dev areas`);
          
          // Generate coaching context
          const coachingContext = generateCoachingContext(analysis);
          
          // Store for this session
          coachingContexts.set(sessionId, {
            analysis,
            coachingContext,
            timestamp: Date.now()
          });
          
          log('info', `💾 [CONTEXT] Stored coaching context for sessionId: ${sessionId}`);
          log('info', `💾 [CONTEXT] Context length: ${coachingContext.length} chars`);
          log('info', `💾 [CONTEXT] Map now has ${coachingContexts.size} entries`);
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            sessionId,
            organization: analysis.organization?.name || 'Unknown',
            wordCount: parseResult.metadata.wordCount,
            developmentAreas: analysis.coaching_output?.development_areas?.length || 0,
            strengths: analysis.coaching_output?.strengths?.length || 0,
            openingQuestion: analysis.coaching_output?.opening_question,
            // FRACTAL METADATA - proves full decomposition ran
            fractalMetadata: analysis._metadata ? {
              method: analysis._metadata.analysisMethod,
              pathsGenerated: analysis._metadata.pathsGenerated,
              pathsSurvived: analysis._metadata.pathsSurvived,
              pathsPassed: analysis._metadata.pathsPassed,
              winnerPath: analysis._metadata.winnerPath,
              winnerScore: analysis._metadata.winnerScore,
              bellmanValue: analysis._metadata.bellmanValue,
              totalTimeMs: analysis._metadata.totalTime,
              yamasScores: analysis._metadata.yamasScores
            } : null
          }));
          
        } catch (err) {
          log('error', `[UPLOAD] Error: ${err.message}`);
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // SUMMARY GENERATION API - Cumulative key takeaways
    // ═══════════════════════════════════════════════════════════════════════════════
    if (pathname === '/api/generate-summary' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { sessionId, transcript, organization, turnCount } = JSON.parse(body);
          
          log('info', `📋 [SUMMARY] Generating summary for ${turnCount} turns...`);
          
          // Get coaching context for additional context
          const contextData = coachingContexts.get(sessionId);
          const devAreas = contextData?.analysis?.coaching_output?.development_areas || [];
          
          // Generate summary with Groq
          const Groq = require('groq-sdk');
          const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
          
          const summaryPrompt = `You are summarizing a coaching conversation for a student. Generate a cumulative "Key Takeaways" document.

ORGANIZATION: ${organization}
CONVERSATION SO FAR:
${transcript}

${devAreas.length > 0 ? `KNOWN DEVELOPMENT AREAS: ${devAreas.map(d => d.area).join(', ')}` : ''}

Generate a structured HTML summary with these sections. Use ONLY these HTML tags: <h2>, <h3>, <ul>, <li>, <strong>, <em>

Required sections:
1. <h2>📊 Topic Overview</h2> - What are we discussing?
2. <h2>💡 Key Insights Discovered</h2> - What has the student learned/realized so far?
3. <h2>🎯 Action Items</h2> - Concrete next steps mentioned or implied
4. <h2>❓ Questions to Explore</h2> - Open questions still to address
5. <h2>📈 Progress Notes</h2> - How is the conversation developing?

Guidelines:
- Be concise but comprehensive
- Extract actual insights from the conversation
- Use bullet points (<ul><li>) for lists
- Highlight key terms with <strong>
- This summary should grow and improve with each conversation turn
- Focus on what the STUDENT said and learned, not just what the coach said

Output ONLY the HTML content, no markdown, no code blocks.`;

          const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'You generate clean HTML summaries. Output only HTML tags, no markdown.' },
              { role: 'user', content: summaryPrompt }
            ],
            max_tokens: 1500,
            temperature: 0.3
          });
          
          let summaryHtml = response.choices[0]?.message?.content || '';
          
          // Clean up any markdown artifacts
          summaryHtml = summaryHtml.replace(/```html/g, '').replace(/```/g, '').trim();
          
          log('info', `📋 [SUMMARY] Generated ${summaryHtml.length} chars of HTML`);
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            summaryHtml,
            turnCount
          }));
          
        } catch (err) {
          log('error', `[SUMMARY] Error: ${err.message}`);
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // Get coaching context for a session
    if (pathname === '/api/coaching-context' && req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId') || 'default';
      const context = coachingContexts.get(sessionId);
      
      if (context) {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          coachingContext: context.coachingContext,
          analysis: context.analysis
        }));
      } else {
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No context for this session' }));
      }
      return;
    }

    // Serve frontend
    if (pathname === '/' || pathname === '/index.html') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v4.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!doctype html><html><head><title>Kea V4 - Academic Coach</title></head><body>
          <h1>🥝 Kea V4 - Academic Coach</h1>
          <p>Server running on port ${PORT}</p>
          <p>WebSocket relay at ws://localhost:${PORT}/relay</p>
          <p><a href="/v4">Open V4 Demo (recommended)</a></p>
          <p><a href="/realtime">Open Realtime Demo (legacy)</a></p>
        </body></html>`);
      }
      return;
    }

    // Serve V4 interruptible demo
    if (pathname === '/v4') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v4.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('V4 demo not found: ' + e.message);
      }
      return;
    }

    // Serve V5 parallel chunking demo (NEW - fastest!)
    if (pathname === '/v5') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v5.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('V5 demo not found: ' + e.message);
      }
      return;
    }

    // Serve V6 streaming AEC demo (NEWEST - barge-in support!)
    if (pathname === '/v7') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v7.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('V7 demo not found: ' + e.message);
      }
      return;
    }

    if (pathname === '/v6') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v6.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('V6 demo not found: ' + e.message);
      }
      return;
    }

    // Serve audio worklet for V6
    if (pathname === '/audio-worklet.js') {
      try {
        const js = await fs.readFile(path.join(__dirname, 'public', 'audio-worklet.js'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(js);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Audio worklet not found: ' + e.message);
      }
      return;
    }

    // Serve anti-hallucination module for V7
    if (pathname === '/kea_v7_anti_hallucination.js') {
      try {
        const js = await fs.readFile(path.join(__dirname, 'public', 'kea_v7_anti_hallucination.js'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(js);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Anti-hallucination module not found: ' + e.message);
      }
      return;
    }

    // Serve realtime demo UI (uses OpenAI Realtime)
    if (pathname === '/realtime') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'realtime.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Realtime demo not found');
      }
      return;
    }

    // Serve demo UI (HTTP fallback)
    if (pathname === '/demo') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'demo.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Demo not found');
      }
      return;
    }

    // Serve Axiom logo
    if (pathname === '/axiom-logo.png') {
      try {
        const logo = await fs.readFile(path.join(__dirname, 'public', 'axiom-logo.png'));
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(logo);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Logo not found');
      }
      return;
    }

    // Favicon - return empty 204 to prevent 404 errors
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 404
    res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (err) {
    log('error', 'Request error:', err.message);
    res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

// Simple OpenAI TTS for HTTP voice endpoint - using tts-1 with speed boost
async function openaiTTS(text) {
  const https = require('https');
  const startTime = Date.now();

  log('log3', `[TTS] Starting synthesis for ${text.length} chars`);

  const payload = JSON.stringify({
    model: 'tts-1',  // tts-1 is actually faster than tts-1-hd
    input: text,
    voice: 'nova',
    response_format: 'mp3',
    speed: 1.1  // Slightly faster playback
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = [];
      let bytesReceived = 0;
      
      res.on('data', chunk => {
        chunks.push(chunk);
        bytesReceived += chunk.length;
        log('log4', `[TTS] Received chunk: ${chunk.length} bytes (total: ${bytesReceived})`);
      });
      
      res.on('end', () => {
        const duration = Date.now() - startTime;
        if (res.statusCode === 200) {
          log('log3', `[TTS] Complete: ${bytesReceived} bytes in ${duration}ms`);
          resolve({ audio: Buffer.concat(chunks), duration });
        } else {
          const body = Buffer.concat(chunks).toString();
          log('error', `[TTS] Error ${res.statusCode}: ${body}`);
          reject(new Error(`TTS error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Start server
const server = http.createServer(handleRequest);

// Bind to 0.0.0.0 for Render (required for external access)
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  log('info', `
╔════════════════════════════════════════════════════════════╗
║  🥝  KEA V7 - Interactive Oral Assessments (IOAaaS)        ║
║  📚  Powered by Axiom Intelligence                         ║
╚════════════════════════════════════════════════════════════╝

🌐 Server:   http://localhost:${PORT}
🔌 Relay V4: ws://localhost:${PORT}/relay
🔌 Relay V5: ws://localhost:${PORT}/relay-v5
🔌 Relay V6: ws://localhost:${PORT}/relay-v6

🎤 Demos:
   /v6 - V6 Streaming AEC + Barge-In (NEWEST!) ⚡
   /v5 - V5 Parallel Chunking (Google Chirp) ⭐
   /v4 - V4 Interruptible (OpenAI TTS)

🔑 API Keys:
   - OpenAI: ${OPENAI_API_KEY ? '✅' : '❌'}
   - Groq:   ${GROQ_API_KEY ? '✅' : '❌'}

📡 Endpoints:
   GET  /health     - Health check
   GET  /v7         - V7 Turn-Taking (Primary!)
   GET  /v6         - V6 Streaming AEC (requires OpenAI)
   GET  /v5         - V5 Parallel Chunking (requires OpenAI)
   GET  /v4         - V4 Interruptible Voice (requires OpenAI)
   POST /api/coach  - Text coaching
   WS   /relay-v7   - V7 WebSocket relay (Turn-Taking)
  `);

  // V7 is the primary - always attach it (uses Google + Groq, no OpenAI needed)
  createRelayV7(server, '/relay-v7', coachingContexts);
  console.log('✅ V7 WebSocket relay attached (Turn-Taking / Sensory Gating)');

  // Only attach V4/V5/V6 if OpenAI key is available (they require it)
  if (OPENAI_API_KEY) {
    createRelayV4(server, sessions);
    console.log('✅ V4 WebSocket relay attached');
    
    createRelayV5(server, '/relay-v5');
    console.log('✅ V5 WebSocket relay attached');
    
    createRelayV6(server, '/relay-v6');
    console.log('✅ V6 WebSocket relay attached');
  } else {
    console.log('⚠️ V4/V5/V6 relays skipped (no OPENAI_API_KEY)');
  }
});
