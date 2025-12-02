/**
 * KEA V7 ANTI-HALLUCINATION (Server Side)
 * 
 * Purpose:
 * 1. Filter STT results based on model confidence (Metadata Gate)
 * 2. Filter known hallucination patterns (Lexical Gate)
 */

class AntiHallucinationPipeline {
    constructor() {
        this.hallucinationPatterns = [
            /^(thank you)+$/i,
            /^(thank you(\.|!|,)?\s*)+$/i,
            /^you$/i,
            /^thank you bye$/i,
            /^thanks$/i,
            /^bye$/i,
            /^subtitles by/i,
            /^mbc/i,
            /^amara/i
        ];
    }

    process(sttResult) {
        // sttResult structure: { text: string, segments: Array (optional), provider: 'google'|'whisper' }
        
        const { text, segments, provider } = sttResult;
        
        if (!text || !text.trim()) {
            return { valid: false, reason: 'empty' };
        }

        const cleanText = text.toLowerCase().replace(/[^a-z ]/g, '').trim();
        const tokens = cleanText.split(/\s+/);

        // 1. Lexical Gate (The "Scorched Earth" Regex)
        // Applies to ALL providers
        if (this.hallucinationPatterns.some(p => p.test(cleanText))) {
            return { valid: false, reason: 'lexical_pattern_match', text };
        }

        // Short "Thank You" check
        if (tokens.length <= 3 && (tokens.includes('thank') || tokens.includes('thanks')) && tokens.includes('you')) {
            return { valid: false, reason: 'short_thank_you', text };
        }

        // 2. Metadata Gate (Whisper Specific)
        if (provider === 'whisper' && segments && Array.isArray(segments)) {
            for (const segment of segments) {
                // High probability of no speech
                if (segment.no_speech_prob > 0.6) { // Strict threshold
                    return { valid: false, reason: `high_no_speech_prob (${segment.no_speech_prob.toFixed(2)})`, text };
                }
                
                // Low confidence (logprob is negative, closer to 0 is better)
                // -1.0 is a common threshold for "unsure"
                if (segment.avg_logprob < -1.0) {
                    return { valid: false, reason: `low_confidence (${segment.avg_logprob.toFixed(2)})`, text };
                }
                
                // High compression ratio often indicates repetition loops
                if (segment.compression_ratio > 2.4) {
                    return { valid: false, reason: `high_compression (${segment.compression_ratio.toFixed(2)})`, text };
                }
            }
        }

        return { valid: true, text };
    }
}

module.exports = { AntiHallucinationPipeline };
