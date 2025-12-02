// ═══════════════════════════════════════════════════════════════════════════════════
// 🥝 KEA V6 - PRODUCTION STREAMING AEC WITH BARGE-IN
// ═══════════════════════════════════════════════════════════════════════════════════
//
// ARCHITECTURE (OpenAI Realtime-Style):
//
// ┌─────────────────────────────────────────────────────────────────────────────────┐
// │  Continuous Mic Stream from Browser                                             │
// │       ↓                                                                         │
// │  [Echo Detector] ──── TTS Reference ────────────────────────────────────────┐   │
// │       │                                                                      │   │
// │       ├── High correlation → ECHO (ignore)                                   │   │
// │       └── Low correlation → USER SPEECH                                      │   │
// │              ↓                                                               │   │
// │  [Server-Side VAD] ─────────────────────────────────────────────────────┐   │   │
// │       │                                                                  │   │   │
// │       ├── Speech detected during TTS → BARGE-IN!                        │   │   │
// │       │      └── Send interrupt signal to client                        │   │   │
// │       │      └── Cancel pending TTS                                     │   │   │
// │       │                                                                  │   │   │
// │       └── Speech ended → Process utterance                              │   │   │
// │              ↓                                                           │   │   │
// │  [Groq Whisper STT] ────────────────────────────────────→ ~50ms         │   │   │
// │       ↓                                                                  │   │   │
// │  [Groq Llama 3.3 70B Brain] ────────────────────────────→ ~150ms        │   │   │
// │       ↓                                                                  │   │   │
// │  [PARALLEL Google Chirp TTS] ───────────────────────────→ ~400ms        │   │   │
// │       │                                                                  │   │   │
// │       └── Store as TTS Reference ────────────────────────────────────────┘   │   │
// │       └── Stream to client ──────────────────────────────────────────────────┘   │
// │                                                                                   │
// │  TOTAL TIME TO FIRST AUDIO: ~400ms (streaming removes VAD wait!)                 │
// │  BARGE-IN LATENCY: ~100ms                                                        │
// └───────────────────────────────────────────────────────────────────────────────────┘
//
// ═══════════════════════════════════════════════════════════════════════════════════

const Groq = require('groq-sdk');
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
    
    // TTS Settings (Google Chirp 3 HD - fastest natural voice)
    tts: {
        voice: 'en-US-Chirp3-HD-Kore',
        encoding: 'LINEAR16',
        sampleRate: 24000
    },
    
    // STT Settings (Groq Whisper)
    stt: {
        model: 'whisper-large-v3-turbo'
    },
    
    // Brain Settings (Groq Llama)
    brain: {
        model: 'llama-3.3-70b-versatile',
        maxTokens: 300,
        temperature: 0.7
    },
    
    // Echo Detection Settings
    echo: {
        correlationThreshold: 0.65,    // Above this = definitely echo
        userThreshold: 0.35,           // Below this = definitely user
        searchWindowMs: 100,           // ±100ms search for echo
        fingerprintSize: 32,           // Compact fingerprint bytes
        bufferDurationMs: 3000         // 3 seconds of TTS reference
    },
    
    // VAD Settings
    vad: {
        energyThreshold: 0.002,        // RMS energy threshold (Lowered from 0.005)
        speechStartMs: 150,            // ms of speech to trigger
        silenceEndMs: 700,             // Base silence timeout
        hedgingExtensionMs: 500,       // Extra time for "um", "uh"
        maxSilenceMs: 1200             // Maximum silence timeout
    },
    
    // Latency Settings
    latency: {
        initialEstimateMs: 200,        // Starting estimate
        minSearchWindowMs: 50,
        maxSearchWindowMs: 200,
        adaptationRate: 0.1            // EMA alpha
    },
    
    // Interrupt Settings
    interrupt: {
        softThreshold: 0.6,            // Confidence for prepare_interrupt
        hardThreshold: 0.85,           // Confidence for interrupt_now
        fadeOutMs: 50                  // Audio fade out duration
    }
};

// Set Google credentials
process.env.GOOGLE_APPLICATION_CREDENTIALS = CONFIG.google_credentials;

// ═══════════════════════════════════════════════════════════════════════════════════
// RING BUFFER - For audio storage with timestamps
// ═══════════════════════════════════════════════════════════════════════════════════

class RingBuffer {
    constructor(durationMs, sampleRate = 16000) {
        this.sampleRate = sampleRate;
        this.samplesPerMs = sampleRate / 1000;
        this.maxSamples = Math.ceil(durationMs * this.samplesPerMs);
        this.buffer = new Float32Array(this.maxSamples);
        this.timestamps = new Float64Array(this.maxSamples);
        this.writeIndex = 0;
        this.count = 0;
    }
    
    write(samples, timestamp) {
        for (let i = 0; i < samples.length; i++) {
            this.buffer[this.writeIndex] = samples[i];
            this.timestamps[this.writeIndex] = timestamp + (i / this.samplesPerMs);
            this.writeIndex = (this.writeIndex + 1) % this.maxSamples;
            this.count = Math.min(this.count + 1, this.maxSamples);
        }
    }
    
    getAtTime(timestamp, windowMs) {
        const windowSamples = Math.ceil(windowMs * this.samplesPerMs);
        const result = new Float32Array(windowSamples);
        let found = false;
        
        // Search for samples around the target timestamp
        for (let i = 0; i < this.count; i++) {
            const idx = (this.writeIndex - this.count + i + this.maxSamples) % this.maxSamples;
            if (Math.abs(this.timestamps[idx] - timestamp) < windowMs / 2) {
                const offset = Math.floor((this.timestamps[idx] - timestamp + windowMs / 2) * this.samplesPerMs);
                if (offset >= 0 && offset < windowSamples) {
                    result[offset] = this.buffer[idx];
                    found = true;
                }
            }
        }
        
        return found ? result : null;
    }
    
    clear() {
        this.writeIndex = 0;
        this.count = 0;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// AUDIO FINGERPRINT - Compact representation for fast comparison
// ═══════════════════════════════════════════════════════════════════════════════════

class AudioFingerprint {
    constructor(size = 32) {
        this.size = size;
    }
    
    // Extract fingerprint from audio samples (simplified spectral peaks)
    extract(samples) {
        if (!samples || samples.length === 0) return null;
        
        const fingerprint = new Float32Array(this.size);
        const chunkSize = Math.floor(samples.length / this.size);
        
        for (let i = 0; i < this.size; i++) {
            let sum = 0;
            let sumSq = 0;
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, samples.length);
            
            for (let j = start; j < end; j++) {
                sum += samples[j];
                sumSq += samples[j] * samples[j];
            }
            
            const count = end - start;
            const mean = sum / count;
            const rms = Math.sqrt(sumSq / count);
            
            // Combine mean and RMS into fingerprint
            fingerprint[i] = rms * Math.sign(mean + 0.001);
        }
        
        return fingerprint;
    }
    
    // Compare two fingerprints (0 = different, 1 = identical)
    compare(fp1, fp2) {
        if (!fp1 || !fp2) return 0;
        
        let dotProduct = 0;
        let norm1 = 0;
        let norm2 = 0;
        
        for (let i = 0; i < this.size; i++) {
            dotProduct += fp1[i] * fp2[i];
            norm1 += fp1[i] * fp1[i];
            norm2 += fp2[i] * fp2[i];
        }
        
        if (norm1 === 0 || norm2 === 0) return 0;
        
        return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ADAPTIVE LATENCY TRACKER
// ═══════════════════════════════════════════════════════════════════════════════════

class AdaptiveLatencyTracker {
    constructor(config = CONFIG.latency) {
        this.config = config;
        this.currentEstimate = config.initialEstimateMs;
        this.searchWindow = config.minSearchWindowMs;
        this.measurements = [];
        this.maxMeasurements = 50;
    }
    
    update(measuredLatency) {
        this.measurements.push(measuredLatency);
        if (this.measurements.length > this.maxMeasurements) {
            this.measurements.shift();
        }
        
        // Exponential moving average
        this.currentEstimate = (1 - this.config.adaptationRate) * this.currentEstimate + 
                               this.config.adaptationRate * measuredLatency;
        
        // Adjust search window based on variance
        if (this.measurements.length >= 5) {
            const variance = this.calculateVariance();
            this.searchWindow = Math.min(
                this.config.maxSearchWindowMs,
                Math.max(this.config.minSearchWindowMs, 50 + variance * 2)
            );
        }
    }
    
    calculateVariance() {
        if (this.measurements.length < 2) return 0;
        const mean = this.measurements.reduce((a, b) => a + b, 0) / this.measurements.length;
        const squaredDiffs = this.measurements.map(x => Math.pow(x - mean, 2));
        return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / squaredDiffs.length);
    }
    
    getEstimate() {
        return this.currentEstimate;
    }
    
    getSearchWindow() {
        return this.searchWindow;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ECHO DETECTOR - Multi-level with fallbacks
// ═══════════════════════════════════════════════════════════════════════════════════

class EchoDetector {
    constructor(config = CONFIG.echo) {
        this.config = config;
        this.ttsBuffer = new RingBuffer(config.bufferDurationMs);
        this.fingerprinter = new AudioFingerprint(config.fingerprintSize);
        this.latencyTracker = new AdaptiveLatencyTracker();
        this.ttsFingerprints = [];
        this.maxFingerprints = 150; // ~3 seconds at 20ms chunks
        this.isTTSPlaying = false;
        this.lastTTSEnergy = 0;
    }
    
    // Record TTS audio as reference
    recordTTSReference(samples, timestamp) {
        this.ttsBuffer.write(samples, timestamp);
        
        const fingerprint = this.fingerprinter.extract(samples);
        if (fingerprint) {
            this.ttsFingerprints.push({ 
                fingerprint, 
                timestamp,
                energy: this.calculateEnergy(samples)
            });
            
            if (this.ttsFingerprints.length > this.maxFingerprints) {
                this.ttsFingerprints.shift();
            }
            
            this.lastTTSEnergy = this.calculateEnergy(samples);
        }
        
        this.isTTSPlaying = true;
    }
    
    // Mark TTS as stopped
    stopTTS() {
        this.isTTSPlaying = false;
    }
    
    // Clear old references
    clearOldReferences(beforeTimestamp) {
        this.ttsFingerprints = this.ttsFingerprints.filter(
            fp => fp.timestamp > beforeTimestamp
        );
    }
    
    // Calculate RMS energy
    calculateEnergy(samples) {
        if (!samples || samples.length === 0) return 0;
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }
    
    // Process incoming mic audio - multi-level detection
    process(micSamples, timestamp) {
        const micFingerprint = this.fingerprinter.extract(micSamples);
        const micEnergy = this.calculateEnergy(micSamples);
        
        // Level 1: Fingerprint correlation (best)
        const latencyEstimate = this.latencyTracker.getEstimate();
        const searchWindow = this.latencyTracker.getSearchWindow();
        
        let bestCorrelation = 0;
        let matchedTimestamp = null;
        
        for (const ref of this.ttsFingerprints) {
            const timeDiff = Math.abs((timestamp - latencyEstimate) - ref.timestamp);
            if (timeDiff < searchWindow) {
                const correlation = this.fingerprinter.compare(micFingerprint, ref.fingerprint);
                if (correlation > bestCorrelation) {
                    bestCorrelation = correlation;
                    matchedTimestamp = ref.timestamp;
                }
            }
        }
        
        // High confidence echo detection
        if (bestCorrelation > this.config.correlationThreshold) {
            // Update latency model with confirmed echo
            if (matchedTimestamp) {
                this.latencyTracker.update(timestamp - matchedTimestamp);
            }
            return { 
                isEcho: true, 
                confidence: bestCorrelation, 
                method: 'fingerprint',
                energy: micEnergy
            };
        }
        
        // High confidence user speech
        if (bestCorrelation < this.config.userThreshold) {
            return { 
                isEcho: false, 
                confidence: 1 - bestCorrelation, 
                method: 'fingerprint',
                energy: micEnergy
            };
        }
        
        // Level 2: Energy ratio check (fallback)
        if (this.isTTSPlaying && this.lastTTSEnergy > 0) {
            const energyRatio = micEnergy / this.lastTTSEnergy;
            if (energyRatio < 1.5) {
                return { 
                    isEcho: true, 
                    confidence: 0.6, 
                    method: 'energy',
                    energy: micEnergy
                };
            }
        }
        
        // Level 3: Conservative gating (ultimate fallback)
        if (this.isTTSPlaying && bestCorrelation > 0.3) {
            console.log('⚠️ Echo detection uncertain, defaulting to echo');
            return { 
                isEcho: true, 
                confidence: 0.4, 
                method: 'fallback',
                energy: micEnergy
            };
        }
        
        return { 
            isEcho: false, 
            confidence: 1 - bestCorrelation, 
            method: 'fingerprint',
            energy: micEnergy
        };
    }
}

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
    
    // Force reset (e.g., on barge-in)
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
// PREDICTIVE INTERRUPT CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════════

class InterruptController {
    constructor(config = CONFIG.interrupt) {
        this.config = config;
        this.softSignalSent = false;
        this.hardSignalSent = false;
        this.pendingTTSChunks = [];
        this.onInterrupt = null;
    }
    
    // Check if we should interrupt based on confidence
    checkInterrupt(confidence, isTTSPlaying) {
        if (!isTTSPlaying) {
            this.reset();
            return null;
        }
        
        if (confidence >= this.config.hardThreshold && !this.hardSignalSent) {
            this.hardSignalSent = true;
            return { type: 'interrupt_now', confidence };
        }
        
        if (confidence >= this.config.softThreshold && !this.softSignalSent) {
            this.softSignalSent = true;
            return { type: 'prepare_interrupt', confidence };
        }
        
        return null;
    }
    
    // Add pending TTS chunk
    addPendingChunk(chunk) {
        this.pendingTTSChunks.push(chunk);
    }
    
    // Cancel all pending chunks
    cancelPending() {
        const cancelled = this.pendingTTSChunks.length;
        this.pendingTTSChunks = [];
        return cancelled;
    }
    
    reset() {
        this.softSignalSent = false;
        this.hardSignalSent = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// MAIN V6 ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════

class KeaV6Engine {
    constructor() {
        // Initialize APIs
        this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        this.ttsClient = new textToSpeech.TextToSpeechClient();
        
        // Sessions
        this.sessions = new Map();
        
        console.log('🥝 Kea V6 Engine initialized');
        console.log(`   STT: Groq ${CONFIG.stt.model}`);
        console.log(`   Brain: Groq ${CONFIG.brain.model}`);
        console.log(`   TTS: Google ${CONFIG.tts.voice}`);
        console.log(`   Echo Detection: Fingerprint + Energy + Fallback`);
        console.log(`   Barge-In: Enabled (predictive interruption)`);
    }
    
    // Create or get session
    getSession(sessionId) {
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                echoDetector: new EchoDetector(),
                vad: new AdaptiveVAD(),
                interruptController: new InterruptController(),
                conversationHistory: [],
                audioBuffer: [],
                isTTSPlaying: false,
                currentResponseId: null
            });
        }
        return this.sessions.get(sessionId);
    }
    
    // Process incoming audio chunk from client
    async processAudioChunk(sessionId, samples, timestamp, callbacks) {
        const session = this.getSession(sessionId);
        
        // Step 1: Echo detection
        const echoResult = session.echoDetector.process(samples, timestamp);
        
        if (echoResult.isEcho) {
            // It's echo, ignore but check for barge-in during uncertain cases
            return { processed: true, isEcho: true, confidence: echoResult.confidence };
        }
        
        // Step 2: Check for barge-in during TTS
        if (session.isTTSPlaying) {
            const userConfidence = echoResult.confidence;
            const interruptSignal = session.interruptController.checkInterrupt(
                userConfidence, 
                session.isTTSPlaying
            );
            
            if (interruptSignal) {
                if (interruptSignal.type === 'interrupt_now') {
                    // Hard interrupt - stop TTS, cancel pending, start listening
                    console.log(`⚡ [${sessionId}] BARGE-IN! Confidence: ${userConfidence.toFixed(2)}`);
                    
                    session.isTTSPlaying = false;
                    session.echoDetector.stopTTS();
                    const cancelled = session.interruptController.cancelPending();
                    session.currentResponseId = null;
                    
                    if (callbacks.onInterrupt) {
                        callbacks.onInterrupt({ 
                            type: 'interrupt_now',
                            cancelledChunks: cancelled 
                        });
                    }
                } else if (interruptSignal.type === 'prepare_interrupt') {
                    // Soft interrupt - warn client to prepare
                    console.log(`⚠️ [${sessionId}] Prepare interrupt, confidence: ${userConfidence.toFixed(2)}`);
                    
                    if (callbacks.onInterrupt) {
                        callbacks.onInterrupt({ type: 'prepare_interrupt' });
                    }
                }
            }
        }
        
        // Step 3: Server-side VAD
        const vadEvent = session.vad.process(echoResult.energy, timestamp, samples);
        
        if (vadEvent) {
            switch (vadEvent.type) {
                case 'speech_start':
                    console.log(`🎤 [${sessionId}] Speech started`);
                    session.audioBuffer = vadEvent.buffer.map(b => b.samples);
                    if (callbacks.onSpeechStart) callbacks.onSpeechStart();
                    break;
                    
                case 'speech_continue':
                    session.audioBuffer.push(samples);
                    break;
                    
                case 'speech_end':
                    console.log(`🎤 [${sessionId}] Speech ended, processing...`);
                    if (callbacks.onSpeechEnd) callbacks.onSpeechEnd();
                    
                    // Process the collected audio
                    await this.processUtterance(sessionId, session.audioBuffer, callbacks);
                    session.audioBuffer = [];
                    break;
            }
        }
        
        return { 
            processed: true, 
            isEcho: false, 
            vadState: session.vad.state,
            energy: echoResult.energy,
            confidence: echoResult.confidence
        };
    }
    
    // Process complete utterance
    async processUtterance(sessionId, audioBuffers, callbacks) {
        const session = this.getSession(sessionId);
        const startTime = Date.now();
        const mode = session.mode || 'heuristic'; // Default to heuristic
        
        console.log(`🔍 [${sessionId}] Processing Utterance | Mode: ${mode.toUpperCase()}`);

        try {
            // Combine audio buffers
            const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.length, 0);
            const combinedAudio = new Float32Array(totalLength);
            let offset = 0;
            for (const buf of audioBuffers) {
                combinedAudio.set(buf, offset);
                offset += buf.length;
            }
            
            // Convert to WAV buffer for STT
            const wavBuffer = this.float32ToWav(combinedAudio, 16000);
            
            // Step 1: STT
            if (callbacks.onStatus) callbacks.onStatus('transcribing');
            const sttStart = Date.now();
            
            const transcription = await this.groq.audio.transcriptions.create({
                file: new File([wavBuffer], 'audio.wav', { type: 'audio/wav' }),
                model: CONFIG.stt.model,
                language: 'en'
            });
            
            const sttLatency = Date.now() - sttStart;
            let userText = transcription.text?.trim();
            
            if (!userText) {
                console.log(`[${sessionId}] Empty transcription, ignoring`);
                return;
            }

            console.log(`🗣️ [${sessionId}] RAW STT: "${userText}"`);

            // ════════════════════════════════════════════════════════════════════════
            // 🛡️ ARCHITECTURE SWITCHER
            // ════════════════════════════════════════════════════════════════════════

            let isValid = true;
            let dropReason = null;

            // MODE A: HEURISTIC GUARD (The Scalpel)
            if (mode === 'heuristic') {
                const cleanText = userText.toLowerCase().replace(/[^a-z ]/g, '');
                
                // 1. Repetition loop
                if (cleanText.split(' ').length > 4) {
                    const words = cleanText.split(' ');
                    const uniqueWords = new Set(words);
                    if (uniqueWords.size < 3 && words.length > 8) {
                        isValid = false;
                        dropReason = 'Repetition Loop (Regex)';
                    }
                }
                // 2. "Thank you" on short audio
                if ((cleanText === 'thank you' || cleanText === 'you') && totalLength < 16000 * 1.5) {
                    isValid = false;
                    dropReason = 'Phantom "Thank You" (Duration Check)';
                }
                // 3. Known artifacts
                if (cleanText.includes('mbc') || cleanText.includes('amara') || cleanText.includes('subtitles by')) {
                    isValid = false;
                    dropReason = 'Known Artifact (Regex)';
                }
            }

            // MODE B: LLM REPAIR (The Editor)
            else if (mode === 'llm_repair') {
                console.log(`🤖 [${sessionId}] Invoking Llama-3-8b for Repair...`);
                const repairStart = Date.now();
                
                const repairResponse = await this.groq.chat.completions.create({
                    model: 'llama3-8b-8192',
                    messages: [
                        { 
                            role: 'system', 
                            content: `You are a transcript cleaner. 
                            Input: Raw STT text.
                            Task: Remove hallucinations like "Old Old Old", "Thank you" (on silence), or "MBC".
                            Output: The cleaned text ONLY. If the input is pure hallucination, output "EMPTY".` 
                        },
                        { role: 'user', content: userText }
                    ],
                    temperature: 0,
                    max_tokens: 50
                });
                
                const repairedText = repairResponse.choices[0]?.message?.content?.trim();
                const repairLatency = Date.now() - repairStart;
                console.log(`🤖 [${sessionId}] Repaired: "${repairedText}" (${repairLatency}ms)`);

                if (repairedText === 'EMPTY' || !repairedText) {
                    isValid = false;
                    dropReason = 'LLM Rejected';
                } else {
                    userText = repairedText;
                }
            }

            // MODE C: ACOUSTIC GATING (The Shield)
            else if (mode === 'acoustic_gating') {
                // Check energy profile
                let sumSq = 0;
                for(let i=0; i<combinedAudio.length; i++) sumSq += combinedAudio[i]*combinedAudio[i];
                const rms = Math.sqrt(sumSq / combinedAudio.length);
                
                console.log(`🛡️ [${sessionId}] Acoustic Check | RMS: ${rms.toFixed(4)}`);

                if (rms < 0.001) { // Lowered from 0.002
                    isValid = false;
                    dropReason = 'Low RMS Energy (Acoustic Gate)';
                }
                
                // Also apply basic heuristics as backup
                if (userText.toLowerCase().includes('thank you') && totalLength < 16000 * 1.0) {
                    isValid = false;
                    dropReason = 'Short Duration (Acoustic Gate)';
                }
            }

            // ════════════════════════════════════════════════════════════════════════

            if (!isValid) {
                console.log(`🚫 [${sessionId}] DROPPED: "${userText}" | Reason: ${dropReason}`);
                if (callbacks.onLog) callbacks.onLog(`🚫 DROPPED: "${userText}" (${dropReason})`, 'error');
                return;
            }

            console.log(`✅ [${sessionId}] ACCEPTED: "${userText}"`);
            if (callbacks.onTranscript) callbacks.onTranscript(userText);
            
            // Update VAD context for adaptive silence
            session.vad.updateContext(userText);
            
            // Step 2: Brain
            if (callbacks.onStatus) callbacks.onStatus('thinking');
            const brainStart = Date.now();
            
            session.conversationHistory.push({ role: 'user', content: userText });
            
            const response = await this.groq.chat.completions.create({
                model: CONFIG.brain.model,
                messages: [
                    { role: 'system', content: this.getSystemPrompt() },
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
            
            // Step 3: TTS with parallel chunking
            if (callbacks.onStatus) callbacks.onStatus('speaking');
            const responseId = `resp-${Date.now()}`;
            session.currentResponseId = responseId;
            session.isTTSPlaying = true;
            
            await this.synthesizeAndStream(sessionId, responseId, responseText, callbacks);
            
            const totalLatency = Date.now() - startTime;
            console.log(`✅ [${sessionId}] Total: ${totalLatency}ms (STT: ${sttLatency}ms, Brain: ${brainLatency}ms)`);
            
            if (callbacks.onComplete) {
                callbacks.onComplete({
                    sttLatency,
                    brainLatency,
                    totalLatency
                });
            }
            
        } catch (error) {
            console.error(`❌ [${sessionId}] Error:`, error);
            if (callbacks.onError) callbacks.onError(error.message);
        }
    }
    
    // Synthesize and stream TTS with parallel chunking
    async synthesizeAndStream(sessionId, responseId, text, callbacks) {
        const session = this.getSession(sessionId);
        
        // Split into sentences
        const chunks = this.splitIntoChunks(text);
        console.log(`🔊 [${sessionId}] TTS: ${chunks.length} chunks`);
        
        // Fire ALL TTS requests in parallel
        const ttsPromises = chunks.map((chunk, index) => 
            this.synthesizeChunk(chunk, index)
        );
        
        // Stream results as they complete (in order)
        const results = await Promise.all(ttsPromises);
        
        for (let i = 0; i < results.length; i++) {
            // Check if we've been interrupted
            if (session.currentResponseId !== responseId) {
                console.log(`🛑 [${sessionId}] Response ${responseId} interrupted, stopping at chunk ${i}`);
                break;
            }
            
            const result = results[i];
            if (result && result.audio) {
                // Record TTS as echo reference
                const samples = this.audioToFloat32(result.audio);
                session.echoDetector.recordTTSReference(samples, Date.now());
                
                // Add WAV header for client playback (Browser needs WAV container for decodeAudioData)
                const wavAudio = this.addWavHeader(result.audio, CONFIG.tts.sampleRate);
                
                console.log(`📤 [${sessionId}] Sending Chunk ${i+1}/${chunks.length} | PCM: ${result.audio.length}b → WAV: ${wavAudio.length}b`);

                // Send to client
                if (callbacks.onAudioChunk) {
                    callbacks.onAudioChunk({
                        chunkIndex: i,
                        totalChunks: chunks.length,
                        text: result.text,
                        audio: wavAudio, // Send WAV instead of raw PCM
                        latency: result.latency
                    });
                }
            }
        }
        
        // Mark TTS as complete
        if (session.currentResponseId === responseId) {
            session.isTTSPlaying = false;
            session.echoDetector.stopTTS();
            session.interruptController.reset();
            
            if (callbacks.onSpeechComplete) {
                callbacks.onSpeechComplete();
            }
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
        // Split on sentence boundaries
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
        
        // Merge very short sentences
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
        
        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
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
        
        // Audio data
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
        // Ensure pcmBuffer is a Buffer
        const buffer = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);
        
        const header = Buffer.alloc(44);
        
        // RIFF chunk descriptor
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + buffer.length, 4);
        header.write('WAVE', 8);
        
        // fmt sub-chunk
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); // Subchunk1Size (16 for PCM)
        header.writeUInt16LE(1, 20);  // AudioFormat (1 for PCM)
        header.writeUInt16LE(1, 22);  // NumChannels (1 for Mono)
        header.writeUInt32LE(sampleRate, 24); // SampleRate
        header.writeUInt32LE(sampleRate * 2, 28); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
        header.writeUInt16LE(2, 32);  // BlockAlign (NumChannels * BitsPerSample/8)
        header.writeUInt16LE(16, 34); // BitsPerSample
        
        // data sub-chunk
        header.write('data', 36);
        header.writeUInt32LE(buffer.length, 40);
        
        return Buffer.concat([header, buffer]);
    }

    // Convert audio buffer to Float32 samples
    audioToFloat32(audioBuffer) {
        // Handle 16-bit PCM (LINEAR16)
        // Check for WAV header
        let offset = 0;
        if (audioBuffer.length > 44 && 
            audioBuffer.toString('ascii', 0, 4) === 'RIFF' && 
            audioBuffer.toString('ascii', 8, 12) === 'WAVE') {
            offset = 44; // Skip WAV header
        }

        const int16Count = Math.floor((audioBuffer.length - offset) / 2);
        const samples = new Float32Array(int16Count);
        
        for (let i = 0; i < int16Count; i++) {
            // Read 16-bit signed integer (Little Endian)
            const int16 = audioBuffer.readInt16LE(offset + i * 2);
            // Normalize to -1.0 to 1.0
            samples[i] = int16 / 32768.0;
        }
        return samples;
    }
    
    // System prompt
    getSystemPrompt() {
        return `You are Kea, a friendly and knowledgeable academic research coach. 
You help PhD students and researchers think through their work using Socratic questioning.

Key behaviors:
- Ask clarifying questions to understand their research
- Challenge assumptions gently
- Help them discover insights themselves
- Keep responses conversational and concise (2-3 sentences)
- Be encouraging but intellectually rigorous

Current course context: MAMC01810 - Managing for Sustainability`;
    }
    
    // Cleanup session
    destroySession(sessionId) {
        this.sessions.delete(sessionId);
    }

    // Set Architecture Mode
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
// WEBSOCKET RELAY - V6 Streaming Protocol
// ═══════════════════════════════════════════════════════════════════════════════════

function createRelayV6(server, wsPath = '/relay-v6') {
    const engine = new KeaV6Engine();
    const wss = new WebSocket.Server({ noServer: true });
    
    // Handle upgrade
    server.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        
        if (url.pathname === wsPath) {
            wss.handleUpgrade(request, socket, head, (ws) => {
                wss.emit('connection', ws, request);
            });
        }
    });
    
    wss.on('connection', (ws) => {
        const sessionId = `v6-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
        console.log(`🔌 V6 WebSocket connected: ${sessionId}`);
        
        ws.send(JSON.stringify({ type: 'connected', sessionId, version: 'v6' }));
        
        const callbacks = {
            onStatus: (stage) => {
                ws.send(JSON.stringify({ type: 'status', stage }));
            },
            onSpeechStart: () => {
                ws.send(JSON.stringify({ type: 'speech_start' }));
            },
            onSpeechEnd: () => {
                ws.send(JSON.stringify({ type: 'speech_end' }));
            },
            onTranscript: (text) => {
                ws.send(JSON.stringify({ type: 'transcript', text }));
            },
            onResponse: (text) => {
                ws.send(JSON.stringify({ type: 'response', text }));
            },
            onAudioChunk: (chunk) => {
                ws.send(JSON.stringify({
                    type: 'audio_chunk',
                    chunkIndex: chunk.chunkIndex,
                    totalChunks: chunk.totalChunks,
                    text: chunk.text,
                    audio: chunk.audio.toString('base64'),
                    latency: chunk.latency
                }));
            },
            onSpeechComplete: () => {
                ws.send(JSON.stringify({ type: 'speech_complete' }));
            },
            onInterrupt: (signal) => {
                ws.send(JSON.stringify({ type: 'interrupt', ...signal }));
            },
            onError: (message) => {
                ws.send(JSON.stringify({ type: 'error', message }));
            },
            onComplete: (latencies) => {
                ws.send(JSON.stringify({ type: 'complete', latencies }));
            }
        };
        
        ws.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                if (message.type === 'set_mode') {
                    engine.setMode(sessionId, message.mode);
                }

                if (message.type === 'audio_chunk') {
                    // Streaming audio from client
                    const samples = new Float32Array(
                        Buffer.from(message.audio, 'base64').buffer
                    );
                    const timestamp = message.timestamp || Date.now();
                    
                    const result = await engine.processAudioChunk(sessionId, samples, timestamp, callbacks);
                    
                    // Send echo status back to client (throttled? no, let's see)
                    // Only send if we have useful info
                    if (result) {
                        ws.send(JSON.stringify({
                            type: 'echo_status',
                            isEcho: result.isEcho,
                            confidence: result.confidence || 0,
                            energy: result.energy || 0
                        }));
                    }
                }
                
                if (message.type === 'audio') {
                    // Batch audio (fallback mode)
                    const audioBuffer = Buffer.from(message.audio, 'base64');
                    // Convert to samples and process as single utterance
                    // This is for backwards compatibility
                    console.log(`📦 [${sessionId}] Received batch audio (fallback mode)`);
                }
                
            } catch (error) {
                console.error('❌ WebSocket error:', error);
                ws.send(JSON.stringify({ type: 'error', message: error.message }));
            }
        });
        
        ws.on('close', () => {
            console.log(`🔌 V6 WebSocket disconnected: ${sessionId}`);
            engine.destroySession(sessionId);
        });
    });
    
    console.log(`🥝 Kea V6 WebSocket relay ready at ${wsPath}`);
    return wss;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════════

module.exports = { 
    KeaV6Engine, 
    createRelayV6,
    EchoDetector,
    AdaptiveVAD,
    InterruptController,
    AdaptiveLatencyTracker,
    CONFIG 
};
