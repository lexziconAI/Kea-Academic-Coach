/**
 * Realtime Parrot V2 - OpenAI Realtime as pure audio I/O
 * 
 * Architecture:
 *   User speaks → OpenAI Realtime (VAD + STT) → transcript
 *   transcript → Groq Llama 70B (brain) → response text  
 *   response text → inject into Realtime → OpenAI speaks (TTS)
 * 
 * OpenAI Realtime handles:
 *   - Voice Activity Detection (server_vad)
 *   - Speech-to-Text (whisper)
 *   - Text-to-Speech (expressive voices)
 *   - Barge-in/interruption handling
 * 
 * Groq handles:
 *   - ALL reasoning/thinking
 */

const { RealtimeClient } = require('@openai/realtime-api-beta');
const { log } = require('./logging');
const { think } = require('./groqBrain');

class RealtimeParrotSession {
  constructor(sessionId, openaiKey, groqKey, options = {}) {
    this.sessionId = sessionId;
    this.openaiKey = openaiKey;
    this.groqKey = groqKey;
    this.options = options;
    this.client = null;
    this.conversationHistory = [];
    this.isConnected = false;
    this.onTranscript = options.onTranscript || (() => {});
    this.onResponse = options.onResponse || (() => {});
    this.onAudio = options.onAudio || (() => {});
    this.onInterrupted = options.onInterrupted || (() => {});
    this.onError = options.onError || (() => {});
    
    // Metrics
    this.metrics = {
      sttStart: 0,
      sttEnd: 0,
      brainStart: 0,
      brainEnd: 0,
      ttsStart: 0,
      audioChunks: 0
    };
  }

  async connect() {
    const startTime = Date.now();
    log('log3', `[PARROT:${this.sessionId}] Connecting to OpenAI Realtime...`);

    this.client = new RealtimeClient({ 
      apiKey: this.openaiKey,
      debug: false 
    });

    // Configure session - PARROT MODE (no instructions, we inject responses)
    this.client.updateSession({
      voice: this.options.voice || 'sage', // sage is warm and friendly
      instructions: '', // Empty - we don't want Realtime to think, just parrot
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500 // Faster response - 500ms silence
      }
    });

    // Event: User speech transcribed
    this.client.on('conversation.item.input_audio_transcription.completed', async (event) => {
      const transcript = event.transcript;
      this.metrics.sttEnd = Date.now();
      const sttDuration = this.metrics.sttEnd - this.metrics.sttStart;
      
      log('log3', `[PARROT:${this.sessionId}] 🎤 STT (${sttDuration}ms): "${transcript}"`);
      this.onTranscript(transcript);

      if (transcript && transcript.trim()) {
        // Send to Groq brain for thinking
        await this.processWithBrain(transcript);
      }
    });

    // Event: Speech started (for metrics)
    this.client.on('input_audio_buffer.speech_started', () => {
      this.metrics.sttStart = Date.now();
      log('log4', `[PARROT:${this.sessionId}] 🎙️ Speech started`);
    });

    // Event: User interrupted while assistant speaking
    this.client.on('conversation.interrupted', () => {
      log('log3', `[PARROT:${this.sessionId}] ⚡ Interrupted by user`);
      this.onInterrupted();
    });

    // Event: Audio delta (streaming audio back)
    this.client.on('conversation.updated', ({ item, delta }) => {
      if (delta?.audio) {
        this.metrics.audioChunks++;
        log('log4', `[PARROT:${this.sessionId}] 🔊 Audio chunk #${this.metrics.audioChunks}: ${delta.audio.length} samples`);
        // Convert Int16Array to base64 for browser
        const base64 = this.int16ToBase64(delta.audio);
        this.onAudio(base64, false); // false = not final
      }
      if (delta?.transcript) {
        log('log4', `[PARROT:${this.sessionId}] 📝 Response transcript: "${delta.transcript}"`);
      }
    });

    // Event: Response completed
    this.client.on('conversation.item.completed', ({ item }) => {
      if (item.role === 'assistant') {
        const totalAudioTime = Date.now() - this.metrics.ttsStart;
        log('log3', `[PARROT:${this.sessionId}] ✅ Response complete (${this.metrics.audioChunks} chunks, ${totalAudioTime}ms)`);
        this.onAudio(null, true); // true = final
        this.metrics.audioChunks = 0;
      }
    });

    // Event: Errors
    this.client.on('error', (error) => {
      log('error', `[PARROT:${this.sessionId}] ❌ Error:`, error);
      this.onError(error);
    });

    // Event: All realtime events (for log4 deep debugging)
    this.client.on('realtime.event', ({ time, source, event }) => {
      log('log4', `[PARROT:${this.sessionId}] [${source}] ${event.type}`);
    });

    // Connect!
    await this.client.connect();
    await this.client.waitForSessionCreated();
    
    this.isConnected = true;
    const connectTime = Date.now() - startTime;
    log('info', `[PARROT:${this.sessionId}] ✅ Connected in ${connectTime}ms`);
    
    return { sessionId: this.sessionId, connectTime };
  }

  /**
   * Send user audio to Realtime (from browser)
   * @param {string} base64Audio - Base64 encoded PCM16 audio
   */
  sendAudio(base64Audio) {
    if (!this.isConnected) {
      log('error', `[PARROT:${this.sessionId}] Cannot send audio - not connected`);
      return;
    }
    
    const audioData = this.base64ToInt16(base64Audio);
    log('log4', `[PARROT:${this.sessionId}] 📤 Sending ${audioData.length} samples`);
    this.client.appendInputAudio(audioData);
  }

  /**
   * Process transcript with Groq brain, then inject response into Realtime to speak
   */
  async processWithBrain(transcript) {
    this.metrics.brainStart = Date.now();
    log('log3', `[PARROT:${this.sessionId}] 🧠 Sending to Groq brain...`);

    try {
      // Add to conversation history
      this.conversationHistory.push({ role: 'user', content: transcript });

      // Think with Groq
      const result = await think(transcript, this.groqKey, {
        history: this.conversationHistory.slice(-10), // Last 10 messages for context
        systemPrompt: this.options.systemPrompt
      });

      this.metrics.brainEnd = Date.now();
      const brainDuration = this.metrics.brainEnd - this.metrics.brainStart;
      
      log('log3', `[PARROT:${this.sessionId}] 🧠 Brain (${brainDuration}ms): "${result.text.substring(0, 60)}..."`);
      this.onResponse(result.text);

      // Add to history
      this.conversationHistory.push({ role: 'assistant', content: result.text });

      // Inject into Realtime to speak (PARROT!)
      this.metrics.ttsStart = Date.now();
      this.speak(result.text);

    } catch (err) {
      log('error', `[PARROT:${this.sessionId}] Brain error: ${err.message}`);
      this.onError(err);
    }
  }

  /**
   * Inject text into Realtime to speak (the parrot action)
   */
  speak(text) {
    if (!this.isConnected) {
      log('error', `[PARROT:${this.sessionId}] Cannot speak - not connected`);
      return;
    }

    log('log3', `[PARROT:${this.sessionId}] 🦜 Injecting response to speak...`);

    // Create a user message with the response we want spoken
    // Then trigger a response that will just echo it
    this.client.realtime.send('conversation.item.create', {
      item: {
        type: 'message',
        role: 'assistant', 
        content: [{ type: 'text', text: text }]
      }
    });

    // Request audio generation for this message
    this.client.realtime.send('response.create', {
      response: {
        modalities: ['audio'],
        instructions: `Read this text exactly as written, with natural expression: "${text}"`
      }
    });
  }

  /**
   * Cancel current response (for barge-in)
   */
  cancel() {
    if (this.isConnected) {
      log('log3', `[PARROT:${this.sessionId}] 🛑 Canceling response`);
      this.client.realtime.send('response.cancel');
    }
  }

  /**
   * Disconnect session
   */
  disconnect() {
    if (this.client) {
      log('info', `[PARROT:${this.sessionId}] Disconnecting...`);
      this.client.disconnect();
      this.isConnected = false;
    }
  }

  // Utility: Base64 to Int16Array
  base64ToInt16(base64) {
    const binary = Buffer.from(base64, 'base64');
    return new Int16Array(binary.buffer, binary.byteOffset, binary.length / 2);
  }

  // Utility: Int16Array to Base64
  int16ToBase64(int16Array) {
    const buffer = Buffer.from(int16Array.buffer);
    return buffer.toString('base64');
  }
}

module.exports = { RealtimeParrotSession };
