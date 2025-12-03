/**
 * KEA V7 ANTI-HALLUCINATION STACK
 * 
 * Layered defense against Whisper "Thank you" hallucinations
 * 
 * LAYER 1: Client-side duration/energy gate
 * LAYER 2: Server-side Silero VAD (optional, add if needed)
 * LAYER 3: Whisper no_speech_prob check
 * LAYER 4: Hallucination pattern blocklist
 * 
 * Expected result: ~98% hallucination elimination
 */

// =============================================================================
// LAYER 1: CLIENT-SIDE GATE (Add to kea-v7.html)
// =============================================================================

class AudioGateClient {
    constructor(options = {}) {
        this.minDurationMs = options.minDurationMs || 500;
        this.minEnergy = options.minEnergy || 0.005;
        this.silenceTimeoutMs = options.silenceTimeoutMs || 700;
        
        // GPT 5.1 ADDITION: Adaptive noise floor
        this.noiseFloorAlpha = options.noiseFloorAlpha || 0.1; // EMA smoothing
        this.minDbAboveNoise = options.minDbAboveNoise || 10;  // dB above noise floor
        this.noiseFloor = 0.001; // Initial estimate, will adapt
        
        this.audioBuffer = [];
        this.speechStartTime = null;
        this.silenceTimer = null;
        this.silencePendingTimer = null;
        this.isSpeaking = false;
        this.silencePendingFired = false;
        this.autoSendEnabled = true; // When false, manual mode (no auto-send)
        
        // Callbacks
        this.onSpeechComplete = options.onSpeechComplete || (() => {});
        this.onSpeechStart = options.onSpeechStart || (() => {});
        this.onDropped = options.onDropped || (() => {});
        this.onSilenceDetected = options.onSilenceDetected || null; // NEW: silence-pending callback
    }
    
    /**
     * Process incoming audio chunk
     * @param {Int16Array} samples - PCM audio samples
     */
    processChunk(samples) {
        const energy = this.calculateEnergy(samples);
        
        // GPT 5.1 ADDITION: Update adaptive noise floor during silence
        if (!this.isSpeaking) {
            // Exponential moving average of noise floor
            this.noiseFloor = this.noiseFloorAlpha * energy + 
                              (1 - this.noiseFloorAlpha) * this.noiseFloor;
        }
        
        // GPT 5.1 ADDITION: Calculate dB above noise floor
        const dbAboveNoise = this.calculateDbDifference(energy, this.noiseFloor);
        
        // Speech detection: energy above threshold AND dB above noise floor
        const isSpeechLikely = energy > this.minEnergy && 
                               dbAboveNoise >= this.minDbAboveNoise;
        
        if (isSpeechLikely) {
            // Speech detected
            if (!this.isSpeaking) {
                this.isSpeaking = true;
                this.speechStartTime = Date.now();
                this.onSpeechStart();
            }
            
            this.audioBuffer.push(samples);
            
            // Clear silence timer
            if (this.silenceTimer) {
                clearTimeout(this.silenceTimer);
                this.silenceTimer = null;
            }
            
        } else if (this.isSpeaking) {
            // Silence after speech
            this.audioBuffer.push(samples); // Include trailing silence
            
            if (!this.silenceTimer && this.autoSendEnabled) {
                // NEW: Fire silence-detected callback partway through silence timeout
                if (this.onSilenceDetected && !this.silencePendingFired) {
                    const halfSilenceTimeout = Math.floor(this.silenceTimeoutMs * 0.5);
                    this.silencePendingTimer = setTimeout(() => {
                        if (this.isSpeaking && !this.silencePendingFired) {
                            this.silencePendingFired = true;
                            const duration = Date.now() - this.speechStartTime;
                            const combinedAudio = this.combineBuffers(this.audioBuffer);
                            this.onSilenceDetected(combinedAudio, duration);
                        }
                    }, halfSilenceTimeout);
                }
                
                this.silenceTimer = setTimeout(() => {
                    this.finalizeSpeech();
                }, this.silenceTimeoutMs);
            }
        }
        // Else: silence before speech, ignore (but noise floor is updating)
    }
    
    /**
     * GPT 5.1 ADDITION: Calculate dB difference between signal and noise
     */
    calculateDbDifference(signalEnergy, noiseEnergy) {
        if (noiseEnergy <= 0) noiseEnergy = 0.0001;
        if (signalEnergy <= 0) return -100;
        return 20 * Math.log10(signalEnergy / noiseEnergy);
    }
    
    finalizeSpeech() {
        const duration = Date.now() - this.speechStartTime;
        
        // Clear silence-pending timer
        if (this.silencePendingTimer) {
            clearTimeout(this.silencePendingTimer);
            this.silencePendingTimer = null;
        }
        this.silencePendingFired = false;
        
        if (duration >= this.minDurationMs && this.audioBuffer.length > 0) {
            // Valid speech - send it
            const combinedAudio = this.combineBuffers(this.audioBuffer);
            this.onSpeechComplete(combinedAudio, duration);
        } else {
            // Too short - drop it
            console.log(`[GATE] Dropped short audio: ${duration}ms`);
            this.onDropped(duration);
        }
        
        // Reset state
        this.audioBuffer = [];
        this.speechStartTime = null;
        this.isSpeaking = false;
        this.silenceTimer = null;
    }
    
    calculateEnergy(samples) {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            const normalized = samples[i] / 32768;
            sum += normalized * normalized;
        }
        return Math.sqrt(sum / samples.length);
    }
    
    combineBuffers(buffers) {
        const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
        const combined = new Int16Array(totalLength);
        let offset = 0;
        for (const buffer of buffers) {
            combined.set(buffer, offset);
            offset += buffer.length;
        }
        return combined;
    }
    
    reset() {
        this.audioBuffer = [];
        this.speechStartTime = null;
        this.isSpeaking = false;
        this.silencePendingFired = false;
        this.autoSendEnabled = true; // Re-enable for next turn
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        if (this.silencePendingTimer) {
            clearTimeout(this.silencePendingTimer);
            this.silencePendingTimer = null;
        }
    }
    
    /**
     * NEW: Reset silence timer when user clicks "Keep Listening"
     */
    resetSilenceTimer() {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        if (this.silencePendingTimer) {
            clearTimeout(this.silencePendingTimer);
            this.silencePendingTimer = null;
        }
        this.silencePendingFired = false;
        
        // If we're still "speaking" (buffering audio), restart the silence detection
        if (this.isSpeaking) {
            console.log('[GATE] Silence timer reset - continuing to listen');
        }
    }
    
    /**
     * NEW: Disable auto-send - clears all silence timers and stops auto-triggering
     * Used when user clicks "Keep Listening" to enter manual mode
     */
    disableAutoSend() {
        console.log('[GATE] Auto-send disabled - entering manual mode');
        
        // Disable timer creation for this turn
        this.autoSendEnabled = false;
        
        // Clear all existing timers to prevent auto-send
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        if (this.silencePendingTimer) {
            clearTimeout(this.silencePendingTimer);
            this.silencePendingTimer = null;
        }
        this.silencePendingFired = false;
        
        // Continue buffering audio but don't trigger any timeouts
        console.log('[GATE] Manual mode active - will buffer indefinitely until Send Now');
    }
    
    /**
     * NEW: Force flush - immediately send whatever audio is currently buffered
     * Used when user clicks "Send Now" button
     */
    forceFlush() {
        console.log('[GATE] Force flush triggered');
        
        // Clear all timers
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
        if (this.silencePendingTimer) {
            clearTimeout(this.silencePendingTimer);
            this.silencePendingTimer = null;
        }
        this.silencePendingFired = false;
        
        // If we have buffered audio, send it immediately
        if (this.audioBuffer.length > 0 && this.speechStartTime) {
            const duration = Date.now() - this.speechStartTime;
            const combinedAudio = this.combineBuffers(this.audioBuffer);
            
            console.log(`[GATE] Force flushing ${duration}ms of audio`);
            this.onSpeechComplete(combinedAudio, duration);
            
            // Reset state
            this.audioBuffer = [];
            this.speechStartTime = null;
            this.isSpeaking = false;
        } else {
            console.log('[GATE] No audio to flush');
        }
    }
    
    /**
     * GPT 5.1 ADDITION: Get current noise floor for debugging
     */
    getNoiseFloor() {
        return this.noiseFloor;
    }
}

// Usage in client:
/*
const audioGate = new AudioGateClient({
    minDurationMs: 500,
    minEnergy: 0.005,
    silenceTimeoutMs: 700,
    onSpeechComplete: (audio, duration) => {
        console.log(`[SPEECH] ${duration}ms, sending to server`);
        sendAudioToServer(audio);
    },
    onSpeechStart: () => {
        updateUI('Listening...');
    },
    onDropped: (duration) => {
        console.log(`[DROPPED] ${duration}ms - too short`);
    }
});

// In AudioWorklet message handler:
processor.port.onmessage = (event) => {
    if (event.data.type === 'audio') {
        const samples = new Int16Array(event.data.samples);
        audioGate.processChunk(samples);
    }
};
*/


// =============================================================================
// LAYER 3 & 4: SERVER-SIDE FILTERS (Add to keaVoiceV7.js)
// =============================================================================

/**
 * LAYER 4: Hallucination Pattern Blocklist
 * 
 * ENHANCED with GPT 5.1 insights:
 * - Content word check (stopword filter)
 */
class HallucinationBlocklist {
    constructor() {
        // Exact match patterns (case-insensitive)
        this.exactPatterns = [
            'thank you',
            'thank you.',
            'thank you!',
            'you',
            'you.',
            'bye',
            'bye.',
            'bye-bye',
            'mbc',
            'okay',
            'okay.',
            'yeah',
            'yeah.',
            'yes',
            'yes.',
            'no',
            'no.',
            'hmm',
            'hmm.',
            'uh',
            'um',
            'ah',
            'thanks for watching',  // GPT addition: common Whisper hallucination
            'thanks for watching.',
        ];
        
        // Regex patterns for variations
        this.regexPatterns = [
            /^(thank you\.?\s*)+$/i,           // "Thank you. Thank you. Thank you."
            /^(you\.?\s*)+$/i,                 // "You. You. You."
            /^(bye\.?\s*)+$/i,                 // "Bye. Bye."
            /^(okay\.?\s*)+$/i,                // "Okay. Okay."
            /^[\s.,!?]+$/,                     // Only punctuation/whitespace
            /^[a-z]{1,3}\.?$/i,                // Single short word
            /^(uh|um|ah|eh|oh|hmm)+[\s.,]*$/i, // Just filler sounds
            /^thanks\s+for\s+(watching|listening)/i,  // GPT addition
        ];
        
        // Suspicious words that indicate hallucination when alone/short
        this.suspiciousWords = [
            'thank', 'thanks', 'you', 'bye', 'goodbye', 
            'okay', 'ok', 'yeah', 'yes', 'no', 'mbc',
            'hmm', 'uh', 'um', 'ah', 'eh', 'oh'
        ];
        
        // GPT 5.1 ADDITION: English stopwords for content check
        this.stopwords = new Set([
            'i', 'me', 'my', 'myself', 'we', 'our', 'ours', 'ourselves',
            'you', 'your', 'yours', 'yourself', 'yourselves',
            'he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself',
            'it', 'its', 'itself', 'they', 'them', 'their', 'theirs', 'themselves',
            'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
            'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
            'a', 'an', 'the', 'and', 'but', 'if', 'or', 'because', 'as',
            'until', 'while', 'of', 'at', 'by', 'for', 'with', 'about',
            'against', 'between', 'into', 'through', 'during', 'before',
            'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in',
            'out', 'on', 'off', 'over', 'under', 'again', 'further', 'then',
            'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all',
            'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
            'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
            's', 't', 'can', 'will', 'just', 'don', 'should', 'now', 'd',
            'll', 'm', 'o', 're', 've', 'y', 'ain', 'aren', 'couldn', 'didn',
            'doesn', 'hadn', 'hasn', 'haven', 'isn', 'ma', 'mightn', 'mustn',
            'needn', 'shan', 'shouldn', 'wasn', 'weren', 'won', 'wouldn',
            // Common filler/politeness
            'thank', 'thanks', 'please', 'okay', 'ok', 'yeah', 'yes', 'no',
            'bye', 'goodbye', 'hello', 'hi', 'hey', 'well', 'um', 'uh', 'hmm'
        ]);
    }
    
    /**
     * Check if transcript is likely a hallucination
     * @param {string} transcript 
     * @returns {{isHallucination: boolean, reason: string}}
     */
    check(transcript) {
        if (!transcript) {
            return { isHallucination: true, reason: 'empty' };
        }
        
        const clean = transcript.trim().toLowerCase();
        
        // Check exact matches
        if (this.exactPatterns.includes(clean)) {
            return { isHallucination: true, reason: `exact_match: "${clean}"` };
        }
        
        // Check regex patterns
        for (const pattern of this.regexPatterns) {
            if (pattern.test(clean)) {
                return { isHallucination: true, reason: `regex_match: ${pattern}` };
            }
        }
        
        // Check short transcripts with suspicious words
        const words = clean.split(/\s+/).filter(w => w.length > 0);
        if (words.length <= 2) {
            const cleanWords = words.map(w => w.replace(/[.,!?]/g, ''));
            const hasSuspicious = cleanWords.some(w => this.suspiciousWords.includes(w));
            if (hasSuspicious) {
                return { isHallucination: true, reason: `short_suspicious: "${clean}"` };
            }
        }
        
        // Check for repetitive content (same word repeated)
        if (words.length >= 2) {
            const uniqueWords = new Set(words.map(w => w.replace(/[.,!?]/g, '')));
            if (uniqueWords.size === 1) {
                return { isHallucination: true, reason: `repetitive: "${clean}"` };
            }
        }
        
        // GPT 5.1 ADDITION: Content word check
        // If utterance has NO content words (only stopwords), reject it
        const contentWords = words
            .map(w => w.replace(/[.,!?]/g, ''))
            .filter(w => w.length > 0 && !this.stopwords.has(w));
        
        if (contentWords.length === 0 && words.length > 0) {
            return { isHallucination: true, reason: `no_content_words: "${clean}"` };
        }
        
        return { isHallucination: false, reason: null };
    }
    
    /**
     * Add a new pattern (for learning from production)
     */
    addExactPattern(pattern) {
        const clean = pattern.trim().toLowerCase();
        if (!this.exactPatterns.includes(clean)) {
            this.exactPatterns.push(clean);
            console.log(`[BLOCKLIST] Added pattern: "${clean}"`);
        }
    }
}


/**
 * LAYER 3: Whisper Confidence Check
 * 
 * ENHANCED with GPT 5.1 insights:
 * - avg_logprob check (hallucination indicator)
 * - compression_ratio check (hallucination indicator)
 */
class WhisperConfidenceFilter {
    constructor(options = {}) {
        this.noSpeechThreshold = options.noSpeechThreshold || 0.7;
        this.minConfidence = options.minConfidence || 0.5;
        // GPT 5.1 additions: known Whisper hallucination thresholds
        this.avgLogprobThreshold = options.avgLogprobThreshold || -1.0;
        this.compressionRatioThreshold = options.compressionRatioThreshold || 2.4;
    }
    
    /**
     * Check Whisper response for confidence indicators
     * @param {Object} response - Groq Whisper verbose_json response
     * @returns {{valid: boolean, reason: string, confidence: number}}
     */
    check(response) {
        // Handle different response formats
        if (!response) {
            return { valid: false, reason: 'no_response', confidence: 0 };
        }
        
        // Check top-level no_speech_prob (if available)
        if (response.no_speech_prob !== undefined) {
            if (response.no_speech_prob > this.noSpeechThreshold) {
                return { 
                    valid: false, 
                    reason: `no_speech_prob=${response.no_speech_prob.toFixed(2)}`,
                    confidence: 1 - response.no_speech_prob
                };
            }
        }
        
        // Check segments (verbose_json format)
        if (response.segments && response.segments.length > 0) {
            let totalNoSpeech = 0;
            let totalLogprob = 0;
            let totalCompression = 0;
            let segmentCount = 0;
            
            for (const segment of response.segments) {
                segmentCount++;
                
                if (segment.no_speech_prob !== undefined) {
                    totalNoSpeech += segment.no_speech_prob;
                }
                if (segment.avg_logprob !== undefined) {
                    totalLogprob += segment.avg_logprob;
                }
                if (segment.compression_ratio !== undefined) {
                    totalCompression += segment.compression_ratio;
                }
                
                // GPT 5.1 ADDITION: Per-segment hallucination detection
                // This combination is a known Whisper hallucination signature
                if (segment.avg_logprob !== undefined && 
                    segment.compression_ratio !== undefined) {
                    if (segment.avg_logprob <= this.avgLogprobThreshold && 
                        segment.compression_ratio >= this.compressionRatioThreshold) {
                        return {
                            valid: false,
                            reason: `hallucination_signature: logprob=${segment.avg_logprob.toFixed(2)}, compression=${segment.compression_ratio.toFixed(2)}`,
                            confidence: 0.1
                        };
                    }
                }
            }
            
            if (segmentCount > 0) {
                const avgNoSpeech = totalNoSpeech / segmentCount;
                if (avgNoSpeech > this.noSpeechThreshold) {
                    return {
                        valid: false,
                        reason: `avg_no_speech_prob=${avgNoSpeech.toFixed(2)}`,
                        confidence: 1 - avgNoSpeech
                    };
                }
                
                // GPT 5.1 ADDITION: Average logprob check
                const avgLogprob = totalLogprob / segmentCount;
                const avgCompression = totalCompression / segmentCount;
                if (avgLogprob <= this.avgLogprobThreshold && 
                    avgCompression >= this.compressionRatioThreshold) {
                    return {
                        valid: false,
                        reason: `avg_hallucination_signature: logprob=${avgLogprob.toFixed(2)}, compression=${avgCompression.toFixed(2)}`,
                        confidence: 0.2
                    };
                }
            }
        }
        
        // Check overall confidence (if available)
        if (response.confidence !== undefined) {
            if (response.confidence < this.minConfidence) {
                return {
                    valid: false,
                    reason: `low_confidence=${response.confidence.toFixed(2)}`,
                    confidence: response.confidence
                };
            }
        }
        
        return { valid: true, reason: null, confidence: 1.0 };
    }
}


/**
 * Combined Anti-Hallucination Pipeline
 */
class AntiHallucinationPipeline {
    constructor(options = {}) {
        this.blocklist = new HallucinationBlocklist();
        this.confidenceFilter = new WhisperConfidenceFilter({
            noSpeechThreshold: options.noSpeechThreshold || 0.7,
            minConfidence: options.minConfidence || 0.5
        });
        
        // Stats
        this.stats = {
            total: 0,
            blocked: 0,
            blockedByConfidence: 0,
            blockedByBlocklist: 0,
            passed: 0
        };
    }
    
    /**
     * Process transcription through all filters
     * @param {Object} whisperResponse - Full Whisper response (verbose_json)
     * @returns {{valid: boolean, transcript: string, reason: string}}
     */
    process(whisperResponse) {
        this.stats.total++;
        
        const transcript = whisperResponse.text || whisperResponse.transcript || '';
        
        // LAYER 3: Confidence check
        const confidenceResult = this.confidenceFilter.check(whisperResponse);
        if (!confidenceResult.valid) {
            this.stats.blocked++;
            this.stats.blockedByConfidence++;
            console.log(`[PIPELINE] Blocked by confidence: ${confidenceResult.reason}`);
            return { 
                valid: false, 
                transcript: null, 
                reason: `confidence: ${confidenceResult.reason}` 
            };
        }
        
        // LAYER 4: Blocklist check
        const blocklistResult = this.blocklist.check(transcript);
        if (blocklistResult.isHallucination) {
            this.stats.blocked++;
            this.stats.blockedByBlocklist++;
            console.log(`[PIPELINE] Blocked by blocklist: ${blocklistResult.reason}`);
            return { 
                valid: false, 
                transcript: null, 
                reason: `blocklist: ${blocklistResult.reason}` 
            };
        }
        
        // Passed all filters
        this.stats.passed++;
        return { valid: true, transcript: transcript.trim(), reason: null };
    }
    
    getStats() {
        return {
            ...this.stats,
            blockRate: this.stats.total > 0 
                ? (this.stats.blocked / this.stats.total * 100).toFixed(1) + '%'
                : '0%'
        };
    }
}


// =============================================================================
// INTEGRATION EXAMPLE
// =============================================================================

/*
// In your keaVoiceV7.js:

const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const pipeline = new AntiHallucinationPipeline({
    noSpeechThreshold: 0.7,
    minConfidence: 0.5
});

async function transcribeAudio(audioBuffer) {
    try {
        // Use verbose_json to get confidence data
        const response = await groq.audio.transcriptions.create({
            file: audioBuffer,
            model: 'whisper-large-v3-turbo',
            response_format: 'verbose_json',
            language: 'en'
        });
        
        // Run through anti-hallucination pipeline
        const result = pipeline.process(response);
        
        if (!result.valid) {
            console.log(`[STT] Hallucination blocked: ${result.reason}`);
            return null;
        }
        
        console.log(`[STT] Valid transcript: "${result.transcript}"`);
        return result.transcript;
        
    } catch (error) {
        console.error('[STT] Error:', error);
        return null;
    }
}

// Periodically log stats
setInterval(() => {
    console.log('[PIPELINE STATS]', pipeline.getStats());
}, 60000);
*/


// =============================================================================
// EXPORTS
// =============================================================================

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AudioGateClient,
        HallucinationBlocklist,
        WhisperConfidenceFilter,
        AntiHallucinationPipeline
    };
}
