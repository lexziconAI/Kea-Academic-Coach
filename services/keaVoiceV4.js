// ═══════════════════════════════════════════════════════════════════════════
// 🥝 KEA VOICE V4 - INTERRUPTIBLE CHUNKED ARCHITECTURE
// 
// NO OpenAI Realtime API - fully controlled pipeline:
// - Groq Whisper for STT
// - Groq Llama 70B for Brain
// - OpenAI GPT-4o-mini for Expression Analysis (optional)
// - OpenAI TTS for speech (chunked for interruption tracking)
//
// Key Feature: ResponseTracker knows EXACTLY what words were heard
// ═══════════════════════════════════════════════════════════════════════════

const Groq = require('groq-sdk');
const OpenAI = require('openai');
const { log } = require('./logging');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  sttModel: 'whisper-large-v3-turbo',
  brainModel: 'llama-3.3-70b-versatile',
  expressionModel: 'gpt-4o-mini',
  ttsModel: 'tts-1',
  ttsVoice: 'nova',  // Options: alloy, echo, fable, onyx, nova, shimmer
  
  // Audio settings
  sampleRate: 24000,
  chunkDurationMs: 150,  // 150ms chunks for fine-grained interruption
  
  // Brain settings
  maxTokens: 200,
  temperature: 0.7
};

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE TRACKER - Tracks what's been spoken vs what's pending
// ═══════════════════════════════════════════════════════════════════════════

class ResponseTracker {
  constructor(fullText) {
    this.fullText = fullText;
    this.chunks = [];
    this.sentChunkIndex = -1;
    this.confirmedPlayedIndex = -1;
    this.isInterrupted = false;
    this.interruptionPoint = null;
    this.startTime = Date.now();
  }

  addChunk(audioBase64, textRange, approximateText) {
    this.chunks.push({
      index: this.chunks.length,
      audio: audioBase64,
      textRange,
      approximateText,
      sentAt: null,
      playedAt: null
    });
  }

  markSent(index) {
    if (this.chunks[index]) {
      this.chunks[index].sentAt = Date.now();
      this.sentChunkIndex = index;
    }
  }

  confirmPlayed(index) {
    if (this.chunks[index]) {
      this.chunks[index].playedAt = Date.now();
      this.confirmedPlayedIndex = Math.max(this.confirmedPlayedIndex, index);
    }
  }

  interrupt(atChunkIndex, playbackPositionMs = 0) {
    this.isInterrupted = true;
    
    // Find what was heard
    const playedChunks = this.chunks.slice(0, atChunkIndex + 1);
    let heardText = '';
    
    for (const chunk of playedChunks) {
      if (chunk.approximateText) {
        heardText += chunk.approximateText;
      }
    }
    
    // Trim to last complete word if mid-chunk
    if (playbackPositionMs > 0 && playbackPositionMs < CONFIG.chunkDurationMs) {
      const ratio = playbackPositionMs / CONFIG.chunkDurationMs;
      const cutPoint = Math.floor(heardText.length * ratio);
      const lastSpace = heardText.lastIndexOf(' ', cutPoint);
      if (lastSpace > 0) {
        heardText = heardText.substring(0, lastSpace);
      }
    }
    
    heardText = heardText.trim();
    const unheardText = this.fullText.substring(heardText.length).trim();
    
    this.interruptionPoint = {
      heardText,
      unheardText,
      heardPercentage: Math.round((heardText.length / this.fullText.length) * 100),
      chunkIndex: atChunkIndex
    };

    log('log3', `[INTERRUPT] Heard ${this.interruptionPoint.heardPercentage}%: "${heardText.substring(0, 50)}..."`);
    
    return this.interruptionPoint;
  }

  getTextForMemory() {
    if (this.isInterrupted && this.interruptionPoint) {
      if (this.interruptionPoint.heardText.length === 0) {
        return null;
      }
      return `${this.interruptionPoint.heardText} [interrupted]`;
    }
    return this.fullText;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// KEA VOICE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

class KeaVoiceEngine {
  constructor(groqKey, openaiKey) {
    this.groq = new Groq({ apiKey: groqKey });
    this.openai = new OpenAI({ apiKey: openaiKey });
    this.sessions = new Map();
  }

  getSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        history: [],
        activeResponse: null,
        isSpeaking: false
      });
    }
    return this.sessions.get(sessionId);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TRANSCRIBE with Groq Whisper
  // ═══════════════════════════════════════════════════════════════════════
  
  async transcribe(audioBuffer, format = 'webm') {
    const startTime = Date.now();
    
    // Create file-like object for Groq
    const file = new File([audioBuffer], `audio.${format}`, {
      type: `audio/${format}`
    });

    const result = await this.groq.audio.transcriptions.create({
      file: file,
      model: CONFIG.sttModel,
      language: 'en',
      response_format: 'text'
    });

    const duration = Date.now() - startTime;
    log('log3', `[STT] Transcribed in ${duration}ms: "${result.substring(0, 50)}..."`);

    return {
      text: result,
      duration
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // THINK with Groq Llama 70B
  // ═══════════════════════════════════════════════════════════════════════
  
  async think(sessionId, userMessage, systemPrompt) {
    const session = this.getSession(sessionId);
    const startTime = Date.now();
    
    // Add user message to history
    session.history.push({ role: 'user', content: userMessage });

    const messages = [
      {
        role: 'system',
        content: systemPrompt || `You are Kea, a warm AI academic coach at the University of Auckland.

IMPORTANT CONTEXT ABOUT INTERRUPTIONS:
- Messages marked with [interrupted] mean the user cut you off mid-sentence
- This is NORMAL in voice conversations - people interrupt to redirect or clarify  
- Don't apologize for being interrupted
- Don't repeat the interrupted content unless asked
- Just continue naturally from the new topic

Your style:
- Warm, curious, Socratic
- Keep responses SHORT (2-3 sentences max for voice)
- Ask follow-up questions
- Celebrate insights
- Use Aotearoa references naturally`
      },
      ...session.history.slice(-10)
    ];

    const response = await this.groq.chat.completions.create({
      model: CONFIG.brainModel,
      messages,
      max_tokens: CONFIG.maxTokens,
      temperature: CONFIG.temperature
    });

    const text = response.choices[0].message.content;
    const duration = Date.now() - startTime;
    
    log('log3', `[BRAIN] Thought in ${duration}ms: "${text.substring(0, 50)}..."`);

    return { text, duration };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SYNTHESIZE with OpenAI TTS (chunked for interruption)
  // ═══════════════════════════════════════════════════════════════════════
  
  async synthesize(text) {
    const startTime = Date.now();

    // Get full audio from OpenAI TTS
    const response = await this.openai.audio.speech.create({
      model: CONFIG.ttsModel,
      voice: CONFIG.ttsVoice,
      input: text,
      response_format: 'pcm',  // Raw PCM for chunking
      speed: 1.0
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const duration = Date.now() - startTime;

    // Calculate bytes per chunk (24kHz, 16-bit mono)
    const bytesPerMs = (CONFIG.sampleRate * 2) / 1000;
    const bytesPerChunk = Math.floor(bytesPerMs * CONFIG.chunkDurationMs);

    // Estimate characters per ms (rough approximation)
    const totalDurationMs = (audioBuffer.length / bytesPerMs);
    const charsPerMs = text.length / totalDurationMs;

    // Split into chunks with text mapping
    const chunks = [];
    let charPosition = 0;

    for (let i = 0; i < audioBuffer.length; i += bytesPerChunk) {
      const chunkAudio = audioBuffer.slice(i, Math.min(i + bytesPerChunk, audioBuffer.length));
      const chunkIndex = chunks.length;
      
      // Estimate text for this chunk
      const chunkChars = Math.floor(CONFIG.chunkDurationMs * charsPerMs);
      const textStart = charPosition;
      const textEnd = Math.min(charPosition + chunkChars, text.length);
      const approximateText = text.substring(textStart, textEnd);
      
      chunks.push({
        audio: chunkAudio.toString('base64'),
        textRange: { start: textStart, end: textEnd },
        approximateText,
        durationMs: CONFIG.chunkDurationMs,
        isLast: i + bytesPerChunk >= audioBuffer.length
      });

      charPosition = textEnd;
    }

    log('log3', `[TTS] Synthesized in ${duration}ms: ${chunks.length} chunks`);

    return {
      chunks,
      totalDurationMs,
      duration
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // HANDLE INTERRUPTION
  // ═══════════════════════════════════════════════════════════════════════
  
  handleInterruption(sessionId, chunkIndex, playbackPositionMs) {
    const session = this.getSession(sessionId);
    
    if (!session.activeResponse) {
      log('log3', '[INTERRUPT] No active response to interrupt');
      return null;
    }

    const interruptionPoint = session.activeResponse.interrupt(chunkIndex, playbackPositionMs);
    
    // Store truncated response in history
    const textForMemory = session.activeResponse.getTextForMemory();
    if (textForMemory) {
      session.history.push({
        role: 'assistant',
        content: textForMemory
      });
      log('log3', `[MEMORY] Stored: "${textForMemory.substring(0, 60)}..."`);
    }

    session.activeResponse = null;
    session.isSpeaking = false;

    return interruptionPoint;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // COMPLETE RESPONSE (no interruption)
  // ═══════════════════════════════════════════════════════════════════════
  
  completeResponse(sessionId) {
    const session = this.getSession(sessionId);
    
    if (session.activeResponse && !session.activeResponse.isInterrupted) {
      session.history.push({
        role: 'assistant',
        content: session.activeResponse.fullText
      });
      log('log3', `[MEMORY] Stored full: "${session.activeResponse.fullText.substring(0, 60)}..."`);
    }

    session.activeResponse = null;
    session.isSpeaking = false;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FULL PIPELINE
  // ═══════════════════════════════════════════════════════════════════════
  
  async processUtterance(sessionId, audioBuffer, format, callbacks, systemPrompt) {
    const session = this.getSession(sessionId);
    const timings = {};

    try {
      // 1. TRANSCRIBE
      callbacks.onStatus?.('transcribing');
      const stt = await this.transcribe(audioBuffer, format);
      timings.stt = stt.duration;

      if (!stt.text.trim()) {
        callbacks.onStatus?.('idle');
        return { success: false, reason: 'empty_transcript' };
      }

      callbacks.onTranscript?.(stt.text);

      // 2. THINK
      callbacks.onStatus?.('thinking');
      const brain = await this.think(sessionId, stt.text, systemPrompt);
      timings.brain = brain.duration;

      callbacks.onResponse?.(brain.text);

      // 3. SYNTHESIZE
      callbacks.onStatus?.('synthesizing');
      const synthesis = await this.synthesize(brain.text);
      timings.tts = synthesis.duration;

      // Create tracker
      const tracker = new ResponseTracker(brain.text);
      synthesis.chunks.forEach((chunk, i) => {
        tracker.addChunk(chunk.audio, chunk.textRange, chunk.approximateText);
      });

      session.activeResponse = tracker;
      session.isSpeaking = true;

      // 4. STREAM CHUNKS
      callbacks.onStatus?.('speaking');

      for (let i = 0; i < synthesis.chunks.length; i++) {
        // Check if interrupted
        if (session.activeResponse?.isInterrupted) {
          log('log3', `[STREAM] Stopping at chunk ${i} due to interruption`);
          break;
        }

        const chunk = synthesis.chunks[i];
        tracker.markSent(i);

        callbacks.onAudioChunk?.({
          chunkIndex: i,
          audio: chunk.audio,
          approximateText: chunk.approximateText,
          isLast: chunk.isLast,
          progress: (i + 1) / synthesis.chunks.length
        });

        // Small delay between chunks
        await new Promise(r => setTimeout(r, 10));
      }

      // If not interrupted, signal complete
      if (!session.activeResponse?.isInterrupted) {
        callbacks.onSpeechComplete?.({
          timings,
          totalLatency: timings.stt + timings.brain + timings.tts
        });
      }

      return {
        success: true,
        transcript: stt.text,
        response: brain.text,
        timings
      };

    } catch (error) {
      log('error', `[PIPELINE ERROR] ${error.message}`);
      callbacks.onError?.(error.message);
      session.isSpeaking = false;
      throw error;
    }
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }
}

module.exports = { KeaVoiceEngine, ResponseTracker, CONFIG };
