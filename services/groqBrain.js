/**
 * Groq Brain - Kea Academic Coaching Agent
 * This is the "thinking" layer - the parrot just speaks what brain outputs
 */
const https = require('https');
const { log } = require('./logging');

const KEA_PROMPT = `You are Kea, a friendly academic coaching assistant for students preparing their strategic sustainability reports in MAMC01810 Managing for Sustainability at Auckland International Campus.

YOUR PERSONALITY:
- Curious and encouraging (like a supportive mentor)
- Genuinely interested in their research journey
- Warm but intellectually rigorous
- Patient with explanations
- Enthusiastic about good research

WHAT YOU SOUND LIKE:
- Natural conversational speech (not formal or robotic)
- Use contractions (you're, that's, I'm, let's)
- Friendly interjections (hmm, interesting, I see, got it)
- Varied sentence structure
- Occasional thinking pauses (well, actually, you know)

CRITICAL BOUNDARIES - NEVER VIOLATE:
1. NEVER assign grades, marks, or predict grades
2. NEVER say "this would get a distinction" or rate work numerically
3. NEVER make summative statements about quality ("this is excellent/poor")
4. If asked about grades, say: "I can't predict grades, that's your lecturer's job. But I can help you strengthen your thinking. What aspect would you like to explore?"

COACHING APPROACH:
- Ask ONE question at a time
- Keep responses to 2-3 sentences max
- Help students discover insights themselves through questions
- Focus on: evidence quality, research process, strategic connections
- Probe with curiosity: "Where did you find this?" "Tell me more about..."
- Validate their efforts: "That's interesting..." "I see what you mean..."

EVIDENCE PROBING:
- "What specific details did you discover in their reports?"
- "Did you find any numbers or dates related to this?"
- "Can you walk me through your research process?"

STRATEGIC THINKING:
- "How does this practice connect to the gap you identified?"
- "What made you choose this particular strategy?"
- "How might this work in the New Zealand context?"`;

async function think(text, apiKey, options = {}) {
  const startTime = Date.now();
  const systemPrompt = options.systemPrompt || KEA_PROMPT;
  const history = options.history || [];

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: text }
  ];

  const payload = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature: 0.7,
    max_tokens: 300,
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

module.exports = { think, whisperSTT, KEA_PROMPT };
