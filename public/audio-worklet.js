// ═══════════════════════════════════════════════════════════════════════════════════
// 🥝 KEA V6 - AUDIO WORKLET PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════════════
//
// This runs in a separate audio thread for low-latency continuous streaming.
// Collects 20ms chunks (320 samples @ 16kHz) and sends to main thread.
//
// ═══════════════════════════════════════════════════════════════════════════════════

class KeaAudioProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        
        // Configuration
        this.sampleRate = options?.processorOptions?.sampleRate || 16000;
        this.chunkSizeMs = options?.processorOptions?.chunkSizeMs || 20;
        this.chunkSizeSamples = Math.floor(this.sampleRate * this.chunkSizeMs / 1000);
        
        // Buffer for collecting samples
        this.buffer = new Float32Array(this.chunkSizeSamples);
        this.bufferIndex = 0;
        
        // Resampling state (48kHz browser default → 16kHz for processing)
        this.browserSampleRate = 48000; // Default, will be detected
        this.resampleRatio = this.browserSampleRate / this.sampleRate;
        
        // Mute control
        this.isMuted = false;
        
        // Listen for messages from main thread
        this.port.onmessage = (event) => {
            if (event.data.type === 'mute') {
                this.isMuted = event.data.muted;
            }
            if (event.data.type === 'browserSampleRate') {
                this.browserSampleRate = event.data.rate;
                this.resampleRatio = this.browserSampleRate / this.sampleRate;
            }
        };
        
        console.log(`🎤 KeaAudioProcessor initialized: ${this.chunkSizeMs}ms chunks @ ${this.sampleRate}Hz`);
    }
    
    // Simple linear downsampling
    downsample(inputSamples) {
        if (this.resampleRatio === 1) return inputSamples;
        
        const outputLength = Math.floor(inputSamples.length / this.resampleRatio);
        const output = new Float32Array(outputLength);
        
        for (let i = 0; i < outputLength; i++) {
            const srcIndex = i * this.resampleRatio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples.length - 1);
            const frac = srcIndex - srcIndexFloor;
            
            // Linear interpolation
            output[i] = inputSamples[srcIndexFloor] * (1 - frac) + inputSamples[srcIndexCeil] * frac;
        }
        
        return output;
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        
        const inputChannel = input[0];
        
        // If muted, send zeros
        const samples = this.isMuted 
            ? new Float32Array(inputChannel.length)
            : inputChannel;
        
        // Downsample from browser rate to our target rate
        const downsampled = this.downsample(samples);
        
        // Fill buffer
        for (let i = 0; i < downsampled.length; i++) {
            this.buffer[this.bufferIndex] = downsampled[i];
            this.bufferIndex++;
            
            // When buffer is full, send chunk
            if (this.bufferIndex >= this.chunkSizeSamples) {
                // Calculate energy for early VAD hint
                let energy = 0;
                for (let j = 0; j < this.buffer.length; j++) {
                    energy += this.buffer[j] * this.buffer[j];
                }
                energy = Math.sqrt(energy / this.buffer.length);
                
                // Send to main thread
                this.port.postMessage({
                    type: 'audio',
                    buffer: this.buffer.slice(), // Copy the buffer
                    timestamp: currentTime * 1000, // Convert to milliseconds
                    energy: energy
                });
                
                // Reset buffer
                this.bufferIndex = 0;
            }
        }
        
        return true;
    }
}

registerProcessor('audio-processor', KeaAudioProcessor);
