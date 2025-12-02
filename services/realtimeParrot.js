/**
 * OpenAI Realtime Parrot - Audio I/O only, no reasoning
 * 
 * Architecture:
 * - OpenAI Realtime handles: Audio In (STT) + Audio Out (TTS)
 * - Groq handles: Brain/reasoning
 * - This is pure parrot: listen gracefully, speak what brain says
 */
const WebSocket = require('ws');
const { log } = require('./logging');
const { think } = require('./groqBrain');

const CONFIG = {
  wsUrl: 'wss://api.openai.com/v1/realtime',
  model: 'gpt-4o-realtime-preview-2024-12-17',
  voice: 'shimmer',
  inputFormat: 'pcm16',
  outputFormat: 'pcm16',
  instructions: `You are a voice interface. Your ONLY job is to speak the text given to you naturally and clearly. Do not add reasoning or commentary. Just read exactly as provided with a warm, clinical tone.`
};

class RealtimeParrotSession {
  constructor(openaiKey, groqKey, options = {}) {
    this.openaiKey = openaiKey;
    this.groqKey = groqKey;
    this.ws = null;
    this.sessionId = null;
    this.isConnected = false;

    this.onTranscript = options.onTranscript || (() => {});
    this.onResponse = options.onResponse || (() => {});
    this.onAudio = options.onAudio || (() => {});
    this.onError = options.onError || console.error;

    this.systemPrompt = options.systemPrompt || CONFIG.instructions;
    this.conversationHistory = [];
    this.audioBuffer = [];
    this.metrics = { stt: 0, brain: 0, tts: 0, total: 0 };
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const url = `${CONFIG.wsUrl}?model=${CONFIG.model}`;

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.openaiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.ws.on('open', () => {
        log('info', '🦜 [PARROT] Connected to OpenAI Realtime');
        this.isConnected = true;

        this.sendEvent({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: CONFIG.instructions,
            voice: CONFIG.voice,
            input_audio_format: CONFIG.inputFormat,
            output_audio_format: CONFIG.outputFormat,
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500
            }
          }
        });

        resolve(this);
      });

      this.ws.on('message', (data) => this.handleMessage(data));
      this.ws.on('error', (err) => {
        log('error', '🦜 [PARROT] WebSocket error:', err.message);
        this.onError(err);
        reject(err);
      });
      this.ws.on('close', () => {
        log('info', '🦜 [PARROT] Disconnected');
        this.isConnected = false;
      });
    });
  }

  async handleMessage(data) {
    try {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case 'session.created':
          this.sessionId = event.session.id;
          log('info', `🦜 [PARROT] Session: ${this.sessionId}`);
          break;

        case 'input_audio_buffer.speech_started':
          log('log3', '🎤 Speech detected...');
          this.metrics.sttStart = Date.now();
          break;

        case 'conversation.item.input_audio_transcription.completed':
          const transcript = event.transcript;
          this.metrics.stt = Date.now() - (this.metrics.sttStart || Date.now());
          log('info', `🎤 Transcribed (${this.metrics.stt}ms): "${transcript}"`);
          this.onTranscript(transcript);
          await this.processWithBrain(transcript);
          break;

        case 'response.audio.delta':
          if (event.delta) {
            const chunk = Buffer.from(event.delta, 'base64');
            this.audioBuffer.push(chunk);
            this.onAudio(chunk, false);
          }
          break;

        case 'response.audio.done':
          this.metrics.tts = Date.now() - (this.metrics.ttsStart || Date.now());
          const fullAudio = Buffer.concat(this.audioBuffer);
          log('info', `🔊 TTS done (${this.metrics.tts}ms), ${fullAudio.length} bytes`);
          this.onAudio(fullAudio, true);
          this.audioBuffer = [];
          break;

        case 'response.done':
          this.metrics.total = Date.now() - (this.metrics.sttStart || Date.now());
          log('info', `🦜 Cycle: STT=${this.metrics.stt}ms, Brain=${this.metrics.brain}ms, TTS=${this.metrics.tts}ms, Total=${this.metrics.total}ms`);
          break;

        case 'error':
          log('error', '🦜 API Error:', event.error);
          this.onError(event.error);
          break;
      }
    } catch (e) {
      log('error', '🦜 Message parse error:', e.message);
    }
  }

  async processWithBrain(transcript) {
    try {
      this.metrics.brainStart = Date.now();

      const brainResult = await think(transcript, this.groqKey, {
        systemPrompt: this.systemPrompt,
        history: this.conversationHistory
      });

      this.metrics.brain = brainResult.duration;
      log('info', `🧠 Response: "${brainResult.text.substring(0, 60)}..."`);

      this.conversationHistory.push(
        { role: 'user', content: transcript },
        { role: 'assistant', content: brainResult.text }
      );

      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }

      this.onResponse(brainResult.text);
      this.metrics.ttsStart = Date.now();
      await this.speak(brainResult.text);

    } catch (error) {
      log('error', '🧠 Brain error:', error.message);
      this.onError(error);
      await this.speak("I apologize, I'm having trouble processing that. Could you please repeat?");
    }
  }

  sendAudio(audioChunk) {
    if (!this.isConnected) return;
    const base64 = audioChunk.toString('base64');
    this.sendEvent({ type: 'input_audio_buffer.append', audio: base64 });
  }

  commitAudio() {
    if (!this.isConnected) return;
    this.sendEvent({ type: 'input_audio_buffer.commit' });
  }

  async speak(text) {
    if (!this.isConnected) return;

    const callId = `groq-${Date.now()}`;
    this.sendEvent({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: text
      }
    });

    this.sendEvent({
      type: 'response.create',
      response: {
        modalities: ['audio'],
        instructions: 'Read the provided output aloud exactly as given. Do not add or alter content.'
      }
    });
  }

  sendEvent(event) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(event));
    }
  }

  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
  }

  clearHistory() {
    this.conversationHistory = [];
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  getMetrics() {
    return { ...this.metrics };
  }
}

module.exports = { RealtimeParrotSession, CONFIG };
