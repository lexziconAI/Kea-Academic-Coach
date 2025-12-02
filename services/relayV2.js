/**
 * WebSocket Relay V2 - Bridges browser clients to RealtimeParrotSession V2
 * 
 * Architecture:
 *   Browser ↔ Relay ↔ OpenAI Realtime (Parrot) + Groq (Brain)
 * 
 * Browser sends PCM16 audio → Relay forwards to OpenAI Realtime
 * Realtime VAD detects speech → transcribes → Relay sends to Groq
 * Groq thinks → Relay injects text into Realtime → Realtime speaks
 * Realtime streams audio back → Relay forwards to Browser
 */
const WebSocket = require('ws');
const { RealtimeParrotSession } = require('./realtimeParrotV3');
const { log } = require('./logging');
const { KEA_PROMPT } = require('./groqBrain');

let sessionCounter = 0;

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO GATING - Prevent echo loop (TTS → mic → VAD → interrupt cascade)
// ═══════════════════════════════════════════════════════════════════════════
const sessionStates = new Map(); // sessionId -> { isSpeaking: boolean, lastSpeakEnd: number }

/**
 * Called by parrot when TTS starts/ends
 * When speaking=true, relay will DROP audio packets from browser
 */
function setSessionSpeaking(sessionId, isSpeaking) {
  let state = sessionStates.get(sessionId);
  if (!state) {
    state = { isSpeaking: false, lastSpeakEnd: 0 };
    sessionStates.set(sessionId, state);
  }
  state.isSpeaking = isSpeaking;
  if (!isSpeaking) {
    state.lastSpeakEnd = Date.now();
  }
  log('log3', `[relay] 🔊 Session ${sessionId} speaking: ${isSpeaking}`);
}

/**
 * Check if audio should be gated (dropped) for this session
 */
function shouldGateAudio(sessionId) {
  const state = sessionStates.get(sessionId);
  if (!state) return false;
  
  // Gate during TTS playback
  if (state.isSpeaking) {
    return 'tts_active';
  }
  
  // Gate for 300ms after TTS ends (echo decay)
  const timeSinceSpeakEnd = Date.now() - state.lastSpeakEnd;
  if (timeSinceSpeakEnd < 300) {
    return `echo_decay_${timeSinceSpeakEnd}ms`;
  }
  
  return false;
}

function createRelay(server, sessions) {
  const wss = new WebSocket.Server({ server, path: '/relay' });

  wss.on('connection', (ws, req) => {
    const clientId = `client-${++sessionCounter}`;
    log('info', `🔌 [${clientId}] Connected from ${req.socket.remoteAddress}`);

    let currentSession = null;

    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        log('log4', `[${clientId}] ← ${data.type}`);

        switch (data.type) {
          case 'start': {
            const openaiKey = process.env.OPENAI_API_KEY;
            const groqKey = process.env.GROQ_API_KEY;

            if (!openaiKey || !groqKey) {
              ws.send(JSON.stringify({ type: 'error', message: 'Missing API keys' }));
              return;
            }

            const sessionId = `kea-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            
            log('log3', `[${clientId}] Starting session ${sessionId}...`);

            const session = new RealtimeParrotSession(sessionId, openaiKey, groqKey, {
              voice: data.voice || 'sage', // sage is warm and friendly
              systemPrompt: data.systemPrompt || KEA_PROMPT,
              
              onTranscript: (text) => {
                log('log3', `[${sessionId}] → transcript: "${text}"`);
                ws.send(JSON.stringify({ type: 'transcript', text }));
              },
              
              onResponse: (text) => {
                log('log3', `[${sessionId}] → response: "${text.substring(0, 50)}..."`);
                ws.send(JSON.stringify({ type: 'response', text }));
              },
              
              onAudio: (base64Audio, isFinal) => {
                if (base64Audio) {
                  log('log4', `[${sessionId}] → audio chunk`);
                  ws.send(JSON.stringify({ type: 'audio', audio: base64Audio, final: isFinal }));
                } else if (isFinal) {
                  log('log3', `[${sessionId}] → audio complete`);
                  ws.send(JSON.stringify({ type: 'audio_done' }));
                }
              },
              
              onInterrupted: () => {
                log('log3', `[${sessionId}] → interrupted`);
                ws.send(JSON.stringify({ type: 'interrupted' }));
              },
              
              onError: (err) => {
                log('error', `[${sessionId}] Error: ${err.message || err}`);
                ws.send(JSON.stringify({ type: 'error', message: err.message || String(err) }));
              }
            });

            try {
              const result = await session.connect();
              currentSession = session;
              sessions.set(sessionId, session);
              
              ws.send(JSON.stringify({ 
                type: 'started', 
                sessionId,
                connectTime: result.connectTime
              }));
              
              log('info', `🎤 [${sessionId}] Session started (${result.connectTime}ms)`);
            } catch (err) {
              log('error', `[${sessionId}] Failed to connect: ${err.message}`);
              ws.send(JSON.stringify({ type: 'error', message: `Connection failed: ${err.message}` }));
            }
            break;
          }

          case 'audio': {
            if (!currentSession || !currentSession.isConnected) {
              log('log4', `[${clientId}] Audio received but no active session`);
              return;
            }
            
            // ═══════════════════════════════════════════════════════════════
            // AUDIO GATING: Drop packets during TTS to prevent echo loop
            // ═══════════════════════════════════════════════════════════════
            const gateReason = shouldGateAudio(currentSession.sessionId);
            if (gateReason) {
              log('log4', `[${clientId}] 🔇 Dropped audio packet (${gateReason})`);
              return; // DROP the packet - prevents VAD triggering on TTS echo
            }
            
            // Safe to forward - user is actually speaking
            currentSession.sendAudio(data.audio);
            break;
          }

          case 'cancel': {
            if (currentSession) {
              currentSession.cancel();
            }
            break;
          }

          case 'stop': {
            if (currentSession) {
              const sid = currentSession.sessionId;
              currentSession.disconnect();
              sessions.delete(sid);
              currentSession = null;
              ws.send(JSON.stringify({ type: 'stopped', sessionId: sid }));
              log('info', `🛑 [${sid}] Session stopped`);
            }
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
      if (currentSession) {
        const sid = currentSession.sessionId;
        currentSession.disconnect();
        sessions.delete(sid);
        log('info', `🔌 [${sid}] Client disconnected, session cleaned up`);
      } else {
        log('info', `🔌 [${clientId}] Client disconnected (no session)`);
      }
    });

    ws.on('error', (err) => {
      log('error', `[${clientId}] WebSocket error: ${err.message}`);
    });
  });

  log('info', '🔌 WebSocket relay V2 ready');
  return wss;
}

module.exports = { createRelay, setSessionSpeaking };
