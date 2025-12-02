/**
 * Realtime Parrot V3 - OpenAI Realtime as pure audio I/O with MANUAL turn handling
 * 
 * KEY INSIGHT: server_vad auto-triggers responses. We need to DISABLE auto-response
 * and manually control when responses happen (after Groq brain returns).
 * 
 * Architecture:
 *   User speaks → OpenAI Realtime (VAD + STT) → transcript
 *   transcript → Groq Llama 70B (brain) → response text  
 *   response text → inject into Realtime → OpenAI speaks (TTS)
 * 
 * V3 Changes:
 *   - Disable automatic response generation
 *   - Manual audio buffer commit
 *   - Proper barge-in handling
 */

const { RealtimeClient } = require('@openai/realtime-api-beta');
const { log } = require('./logging');
const { think } = require('./groqBrain');

// Lazy-loaded to avoid circular dependency
let setSessionSpeaking = null;
function notifySpeakingState(sessionId, isSpeaking) {
  if (!setSessionSpeaking) {
    try {
      setSessionSpeaking = require('./relayV2').setSessionSpeaking;
    } catch (e) {
      log('log4', `[PARROT] Could not load setSessionSpeaking: ${e.message}`);
      return;
    }
  }
  if (setSessionSpeaking) {
    setSessionSpeaking(sessionId, isSpeaking);
  }
}

class RealtimeParrotSession {
  constructor(sessionId, openaiKey, groqKey, options = {}) {
    this.sessionId = sessionId;
    this.openaiKey = openaiKey;
    this.groqKey = groqKey;
    this.options = options;
    this.client = null;
    this.conversationHistory = [];
    this.isConnected = false;
    this.isSpeaking = false; // Track if we're currently outputting audio
    this.pendingTranscript = null; // Buffer transcript until we're ready
    
    // Callbacks
    this.onTranscript = options.onTranscript || (() => {});
    this.onResponse = options.onResponse || (() => {});
    this.onAudio = options.onAudio || (() => {});
    this.onInterrupted = options.onInterrupted || (() => {});
    this.onError = options.onError || (() => {});
    
    // Metrics for debugging
    this.metrics = {
      speechStart: 0,
      speechEnd: 0,
      sttComplete: 0,
      brainStart: 0,
      brainEnd: 0,
      ttsStart: 0,
      ttsFirstChunk: 0,
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

    // ═══════════════════════════════════════════════════════════════════════════
    // PARROT MODE SESSION CONFIG - Tuned VAD + Manual Response Control
    // ═══════════════════════════════════════════════════════════════════════════
    this.client.updateSession({
      voice: this.options.voice || 'sage',
      instructions: 'You are a voice interface. Listen and transcribe. Do not generate responses.',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.75,           // UP from 0.6 - requires louder/clearer speech
        prefix_padding_ms: 400,    // UP from 300 - more audio context before speech
        silence_duration_ms: 1000, // UP from 700 - longer pause before turn end
        create_response: false     // CRITICAL: Don't auto-generate response on turn end
      },
      modalities: ['text', 'audio']
    });

    this.setupEventHandlers();

    // Connect!
    await this.client.connect();
    await this.client.waitForSessionCreated();
    
    this.isConnected = true;
    const connectTime = Date.now() - startTime;
    log('info', `[PARROT:${this.sessionId}] ✅ Connected in ${connectTime}ms`);
    
    return { sessionId: this.sessionId, connectTime };
  }

  setupEventHandlers() {
    // Event: Speech started (VAD detected voice)
    this.client.realtime.on('server.input_audio_buffer.speech_started', () => {
      this.metrics.speechStart = Date.now();
      log('log3', `[PARROT:${this.sessionId}] 🎙️ Speech started`);
      
      // ALWAYS cancel current response on speech start (barge-in)
      if (this.isSpeaking) {
        log('log3', `[PARROT:${this.sessionId}] ⚡ BARGE-IN - cancelling response`);
        this.cancelCurrentResponse();
        this.onInterrupted();
      }
    });

    // Event: Speech ended (VAD detected silence)
    this.client.realtime.on('server.input_audio_buffer.speech_stopped', () => {
      this.metrics.speechEnd = Date.now();
      const duration = this.metrics.speechEnd - this.metrics.speechStart;
      log('log3', `[PARROT:${this.sessionId}] 🎙️ Speech ended (${duration}ms)`);
    });

    // Event: User speech transcribed
    this.client.realtime.on('server.conversation.item.input_audio_transcription.completed', async (event) => {
      const transcript = event.transcript;
      this.metrics.sttComplete = Date.now();
      const totalSttTime = this.metrics.sttComplete - this.metrics.speechStart;
      
      log('log3', `[PARROT:${this.sessionId}] 🎤 STT complete (${totalSttTime}ms): "${transcript}"`);
      
      if (transcript && transcript.trim()) {
        this.onTranscript(transcript);
        // Send to Groq brain
        await this.processWithBrain(transcript);
      } else {
        log('log3', `[PARROT:${this.sessionId}] ⚠️ Empty transcript, ignoring`);
      }
    });

    // Event: Response audio delta (streaming TTS back)
    this.client.realtime.on('server.response.audio.delta', (event) => {
      if (event.delta) {
        if (this.metrics.audioChunks === 0) {
          this.metrics.ttsFirstChunk = Date.now();
          const latency = this.metrics.ttsFirstChunk - this.metrics.brainEnd;
          log('log3', `[PARROT:${this.sessionId}] 🔊 First audio chunk (TTS latency: ${latency}ms)`);
        }
        this.metrics.audioChunks++;
        
        // Forward base64 audio to browser
        this.onAudio(event.delta, false);
      }
    });

    // Event: Response completed
    this.client.realtime.on('server.response.done', (event) => {
      const totalTime = Date.now() - this.metrics.speechStart;
      const ttsTime = Date.now() - this.metrics.ttsStart;
      log('log3', `[PARROT:${this.sessionId}] ✅ Response done (${this.metrics.audioChunks} chunks, TTS ${ttsTime}ms, total ${totalTime}ms)`);
      
      this.isSpeaking = false;
      notifySpeakingState(this.sessionId, false); // Release audio gate
      this.metrics.audioChunks = 0;
      this.onAudio(null, true); // Signal completion
    });

    // Event: Response cancelled (barge-in or manual cancel)
    this.client.realtime.on('server.response.cancelled', (event) => {
      log('log3', `[PARROT:${this.sessionId}] ⚡ Response cancelled`);
      this.isSpeaking = false;
      notifySpeakingState(this.sessionId, false); // Release audio gate
      this.onAudio(null, true); // Signal completion
    });

    // Event: Conversation interrupted (client wrapper event)
    this.client.on('conversation.interrupted', () => {
      log('log3', `[PARROT:${this.sessionId}] 🛑 Conversation interrupted`);
      this.isSpeaking = false;
      this.onInterrupted();
    });

    // Event: Errors
    this.client.realtime.on('server.error', (event) => {
      log('error', `[PARROT:${this.sessionId}] ❌ Server error:`, event.error);
      this.onError(event.error);
    });

    // Debug: All server events at log4 level
    this.client.realtime.on('server.*', (event) => {
      // Filter noisy events
      const type = event.type || 'unknown';
      if (!['input_audio_buffer.append', 'response.audio.delta'].includes(type)) {
        log('log4', `[PARROT:${this.sessionId}] [server] ${type}`);
      }
    });
  }

  /**
   * Send user audio to Realtime (from browser)
   */
  sendAudio(base64Audio) {
    if (!this.isConnected) return;
    
    // Decode base64 to Int16Array
    const buffer = Buffer.from(base64Audio, 'base64');
    const int16 = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
    
    this.client.appendInputAudio(int16);
  }

  /**
   * Process transcript with Groq brain, then speak the response
   */
  async processWithBrain(transcript) {
    // Cancel any in-progress response before starting new one
    if (this.isSpeaking) {
      log('log3', `[PARROT:${this.sessionId}] 🛑 Cancelling previous response before new brain call`);
      this.cancelCurrentResponse();
      // Small delay to let cancellation process
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.metrics.brainStart = Date.now();
    log('log3', `[PARROT:${this.sessionId}] 🧠 Sending to Groq brain...`);

    try {
      // Add to conversation history
      this.conversationHistory.push({ role: 'user', content: transcript });

      // Think with Groq
      const result = await think(transcript, this.groqKey, {
        history: this.conversationHistory.slice(-10),
        systemPrompt: this.options.systemPrompt
      });

      this.metrics.brainEnd = Date.now();
      const brainDuration = this.metrics.brainEnd - this.metrics.brainStart;
      
      log('log3', `[PARROT:${this.sessionId}] 🧠 Brain response (${brainDuration}ms): "${result.text.substring(0, 80)}..."`);
      this.onResponse(result.text);

      // Add to history
      this.conversationHistory.push({ role: 'assistant', content: result.text });

      // Speak the response via Realtime TTS
      this.speak(result.text);

    } catch (err) {
      log('error', `[PARROT:${this.sessionId}] Brain error: ${err.message}`);
      this.onError(err);
    }
  }

  /**
   * speak() - Get OpenAI Realtime to speak our text
   * 
   * Strategy: Use response.create with instructions containing our text.
   * The model will speak whatever we put in the instructions.
   * This is the "parrot" pattern - we control the content, OpenAI provides the voice.
   */
  async speak(text) {
    if (!this.isConnected) {
      log('error', `[PARROT:${this.sessionId}] Cannot speak - not connected`);
      return;
    }

    // STEP 1: Cancel any existing response to prevent "active response" errors
    if (this.isSpeaking) {
      log('log3', `[PARROT:${this.sessionId}] 🛑 Cancelling previous response before speaking`);
      try {
        this.client.realtime.send('response.cancel');
        await new Promise(r => setTimeout(r, 150)); // Wait for cancel to process
      } catch (e) {
        log('log4', `[PARROT:${this.sessionId}] Cancel warning: ${e.message}`);
      }
    }

    // STEP 2: Set speaking state - triggers audio gating in relay
    this.isSpeaking = true;
    notifySpeakingState(this.sessionId, true);
    this.metrics.ttsStart = Date.now();
    this.metrics.audioChunks = 0;

    log('log3', `[PARROT:${this.sessionId}] 🦜 Speaking: "${text.substring(0, 50)}..."`);

    // STEP 3: Request response with instructions containing our text
    // The model will speak exactly what's in the instructions
    try {
      this.client.realtime.send('response.create', {
        response: {
          modalities: ['text', 'audio'],
          instructions: `Say exactly this, word for word, with natural expression: "${text}"`
        }
      });
    } catch (error) {
      log('error', `[PARROT:${this.sessionId}] speak() failed: ${error.message}`);
      this.isSpeaking = false;
      notifySpeakingState(this.sessionId, false);
    }
  }

  /**
   * Cancel current response (for barge-in)
   */
  cancelCurrentResponse() {
    if (this.isSpeaking) {
      log('log3', `[PARROT:${this.sessionId}] 🛑 Cancelling current response`);
      try {
        this.client.realtime.send('response.cancel');
      } catch (e) {
        log('log4', `[PARROT:${this.sessionId}] Cancel warning: ${e.message}`);
      }
      this.isSpeaking = false;
      notifySpeakingState(this.sessionId, false); // Release audio gate
    }
  }

  /**
   * Cancel from external (browser cancel button)
   */
  cancel() {
    this.cancelCurrentResponse();
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
}

module.exports = { RealtimeParrotSession };
