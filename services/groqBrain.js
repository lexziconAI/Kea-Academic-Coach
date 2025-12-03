/**
 * Groq Brain - Kea Academic Coaching Agent
 * This is the "thinking" layer - the parrot just speaks what brain outputs
 * 
 * V3.1: Response length options + British English/metric
 */
const https = require('https');
const { log } = require('./logging');

// Import the new conversational brain prompt and response length config from kea_coaching_system
let CONVERSATIONAL_BRAIN_PROMPT, RESPONSE_LENGTH_CONFIGS, getPromptForLength;
try {
    const keaSystem = require('./kea_coaching_system');
    CONVERSATIONAL_BRAIN_PROMPT = keaSystem.CONVERSATIONAL_BRAIN_PROMPT;
    RESPONSE_LENGTH_CONFIGS = keaSystem.RESPONSE_LENGTH_CONFIGS;
    getPromptForLength = keaSystem.getPromptForLength;
} catch (e) {
    console.warn('[BRAIN] Could not load kea_coaching_system, using fallback prompt');
}

// Fallback prompt if kea_coaching_system not available
const KEA_PROMPT_FALLBACK = `You are Kea, a friendly academic coaching assistant for students preparing their strategic sustainability reports in MAMC01810 Managing for Sustainability at Auckland International Campus.

YOU ARE A THINKING PARTNER, NOT A QUIZ MASTER!

WHAT YOU CAN DO (Be generous!):
✅ EXPLORE DEEPLY - Dive into topics, share examples, discuss concepts
✅ SHARE KNOWLEDGE - Explain frameworks, describe real-world examples
✅ DEVELOP THEIR THINKING - Ask questions that open new angles
✅ SUPPORT GENUINELY - Acknowledge what they've done well

WHAT YOU CANNOT DO (Firm boundaries):
❌ NEVER give grades, scores, or predictions
❌ NEVER say "You would get an A/B/C" or "The marker will..."
❌ NEVER write their work for them

CONVERSATION STYLE:
- Be a thinking partner, not a quiz master
- Share your thinking, don't just fire questions
- Build on their ideas generously
- Keep responses conversational in length (this is spoken!)`;

// Use the full prompt if available, otherwise fallback
const KEA_PROMPT = CONVERSATIONAL_BRAIN_PROMPT || KEA_PROMPT_FALLBACK;

async function think(text, apiKey, options = {}) {
  const startTime = Date.now();
  const responseLength = options.responseLength || 'MEDIUM';
  
  // Get length-adjusted prompt if function available, otherwise use default
  let systemPrompt;
  if (options.systemPrompt) {
    systemPrompt = options.systemPrompt;
  } else if (getPromptForLength) {
    systemPrompt = getPromptForLength(responseLength);
  } else {
    systemPrompt = KEA_PROMPT;
  }
  
  const history = options.history || [];
  
  // Get max tokens from config
  const lengthConfig = RESPONSE_LENGTH_CONFIGS?.[responseLength] || { maxTokens: 300 };
  const maxTokens = options.maxTokens || lengthConfig.maxTokens;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: text }
  ];

  const payload = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.7,
    max_tokens: maxTokens,
    stream: false
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            const response = result.choices[0]?.message?.content || '';
            log('info', `🧠 [GROQ] Thought in ${duration}ms`);
            resolve({ text: response, duration, model: 'llama-3.3-70b-versatile' });
          } catch (e) {
            reject(new Error(`Groq parse error: ${e.message}`));
          }
        } else {
          log('error', `[GROQ] Error ${res.statusCode}: ${data}`);
          reject(new Error(`Groq API error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function whisperSTT(audioBuffer, apiKey) {
  const startTime = Date.now();
  const boundary = '----FormBoundary' + Math.random().toString(36).substring(2);
  const filename = `audio_${Date.now()}.webm`;

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: audio/webm\r\n\r\n`
  );
  const modelPart = Buffer.from(
    `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-large-v3-turbo`
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([header, audioBuffer, modelPart, footer]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      port: 443,
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            log('info', `🎤 [STT] Transcribed in ${duration}ms`);
            resolve({ text: result.text, duration });
          } catch (e) {
            reject(new Error(`Groq STT parse error: ${e.message}`));
          }
        } else {
          reject(new Error(`Groq STT error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { think, whisperSTT, KEA_PROMPT, RESPONSE_LENGTH_CONFIGS };
