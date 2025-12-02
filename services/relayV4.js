// ═══════════════════════════════════════════════════════════════════════════
// 🥝 KEA RELAY V4 - WebSocket Bridge for Interruptible Voice
// 
// Protocol:
// Client → audio      : User speech (webm/base64)
// Client → interrupt  : Barge-in signal with playback position
// Client → chunk_played : Confirm chunk was played
// Client → speech_finished : Confirm full response heard
// 
// Server → audio_chunk : TTS audio chunk with text mapping
// Server → interrupted : Confirmation of interruption
// Server → response_committed : Full response stored in memory
// ═══════════════════════════════════════════════════════════════════════════

const WebSocket = require('ws');
const { KeaVoiceEngine } = require('./keaVoiceV4');
const { log } = require('./logging');
const { KEA_PROMPT } = require('./groqBrain');

let sessionCounter = 0;

function createRelayV4(server, sessions) {
  // Use noServer mode to avoid conflict with other WebSocket servers
  const wss = new WebSocket.Server({ noServer: true });
  
  // Handle upgrade requests manually
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    
    if (url.pathname === '/relay') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
    // Don't close socket for other paths - let other handlers deal with them
  });
  
  // Create shared voice engine
  const engine = new KeaVoiceEngine(
    process.env.GROQ_API_KEY,
    process.env.OPENAI_API_KEY
  );

  wss.on('connection', (ws, req) => {
    const clientId = `client-${++sessionCounter}`;
    const sessionId = `kea-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    
    log('info', `🔌 [${clientId}] Connected, session: ${sessionId}`);

    ws.send(JSON.stringify({ type: 'connected', sessionId }));

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        log('log4', `[${clientId}] ← ${data.type}`);

        switch (data.type) {
          case 'audio': {
            // User sent audio - process full pipeline
            const audioBuffer = Buffer.from(data.audio, 'base64');
            
            await engine.processUtterance(
              sessionId,
              audioBuffer,
              data.format || 'webm',
              {
                onStatus: (stage) => {
                  ws.send(JSON.stringify({ type: 'status', stage }));
                },
                onTranscript: (text) => {
                  log('log3', `[${sessionId}] STT: "${text}"`);
                  ws.send(JSON.stringify({ type: 'transcript', text }));
                },
                onResponse: (text) => {
                  log('log3', `[${sessionId}] Brain: "${text.substring(0, 50)}..."`);
                  ws.send(JSON.stringify({ type: 'response', text }));
                },
                onAudioChunk: (chunk) => {
                  log('log4', `[${sessionId}] → audio_chunk ${chunk.chunkIndex}`);
                  ws.send(JSON.stringify({ type: 'audio_chunk', ...chunk }));
                },
                onSpeechComplete: (info) => {
                  log('log3', `[${sessionId}] Speech complete: ${info.totalLatency}ms`);
                  ws.send(JSON.stringify({ type: 'speech_complete', ...info }));
                },
                onError: (message) => {
                  ws.send(JSON.stringify({ type: 'error', message }));
                }
              },
              data.systemPrompt || KEA_PROMPT
            );
            break;
          }

          case 'chunk_played': {
            // Client confirms chunk was played
            const session = engine.getSession(sessionId);
            if (session.activeResponse) {
              session.activeResponse.confirmPlayed(data.chunkIndex);
            }
            break;
          }

          case 'interrupt': {
            // User interrupted (barge-in)
            log('log3', `[${sessionId}] ⚡ INTERRUPT at chunk ${data.chunkIndex}`);
            
            const result = engine.handleInterruption(
              sessionId,
              data.chunkIndex,
              data.playbackPositionMs || 0
            );
            
            ws.send(JSON.stringify({
              type: 'interrupted',
              heardText: result?.heardText || '',
              heardPercentage: result?.heardPercentage || 0
            }));
            break;
          }

          case 'speech_finished': {
            // Client confirms all audio played (no interruption)
            engine.completeResponse(sessionId);
            ws.send(JSON.stringify({ type: 'response_committed' }));
            break;
          }

          case 'get_history': {
            const session = engine.getSession(sessionId);
            ws.send(JSON.stringify({
              type: 'history',
              messages: session.history
            }));
            break;
          }

          case 'clear_history': {
            engine.clearSession(sessionId);
            ws.send(JSON.stringify({ type: 'history_cleared' }));
            break;
          }

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            log('log4', `[${clientId}] Unknown message type: ${data.type}`);
        }
      } catch (err) {
        log('error', `[${clientId}] Message error: ${err.message}`);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => {
      log('info', `🔌 [${sessionId}] Client disconnected`);
    });

    ws.on('error', (err) => {
      log('error', `[${clientId}] WebSocket error: ${err.message}`);
    });
  });

  log('info', '🔌 WebSocket relay V4 ready (Interruptible Chunked)');
  return wss;
}

module.exports = { createRelayV4 };
