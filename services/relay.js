/**
 * WebSocket Relay - Bridges browser clients to RealtimeParrotSession
 * Keeps API keys server-side, enables low-latency voice streaming
 */
const WebSocket = require('ws');
const { RealtimeParrotSession } = require('./realtimeParrot');
const { log } = require('./logging');

function createRelay(server, sessions) {
  const wss = new WebSocket.Server({ server, path: '/relay' });

  wss.on('connection', (ws, req) => {
    log('info', '🔌 Client connected', req.socket.remoteAddress);

    ws.on('message', async (msg) => {
      try {
        const data = JSON.parse(msg.toString());

        switch (data.type) {
          case 'start': {
            const openaiKey = data.openaiKey || process.env.OPENAI_API_KEY;
            const groqKey = data.groqKey || process.env.GROQ_API_KEY;
            const systemPrompt = data.systemPrompt;

            if (!openaiKey) {
              ws.send(JSON.stringify({ type: 'error', message: 'Missing OpenAI API key' }));
              return;
            }

            const session = new RealtimeParrotSession(openaiKey, groqKey, {
              systemPrompt,
              onTranscript: (text) => ws.send(JSON.stringify({ type: 'transcript', text })),
              onResponse: (text) => ws.send(JSON.stringify({ type: 'response', text })),
              onAudio: (buffer, final) => ws.send(JSON.stringify({ type: 'audio', audio: buffer.toString('base64'), final })),
              onError: (err) => ws.send(JSON.stringify({ type: 'error', message: err.message || String(err) }))
            });

            await session.connect();
            const sessionId = `session-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            sessions.set(sessionId, session);
            ws._sessionId = sessionId;

            ws.send(JSON.stringify({ type: 'started', sessionId }));
            log('info', `🎤 Session started: ${sessionId}`);
            break;
          }

          case 'audio': {
            const sessionId = data.sessionId || ws._sessionId;
            const session = sessions.get(sessionId);
            if (!session) {
              ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
              return;
            }
            const chunk = Buffer.from(data.audio, 'base64');
            session.sendAudio(chunk);
            break;
          }

          case 'commit': {
            const sessionId = data.sessionId || ws._sessionId;
            const session = sessions.get(sessionId);
            if (session) session.commitAudio();
            break;
          }

          case 'stop': {
            const sessionId = data.sessionId || ws._sessionId;
            const session = sessions.get(sessionId);
            if (session) {
              session.disconnect();
              sessions.delete(sessionId);
            }
            ws.send(JSON.stringify({ type: 'stopped', sessionId }));
            break;
          }

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown command' }));
        }
      } catch (err) {
        log('error', 'Relay error:', err.message);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });

    ws.on('close', () => {
      const sid = ws._sessionId;
      if (sid) {
        const s = sessions.get(sid);
        if (s) {
          s.disconnect();
          sessions.delete(sid);
        }
      }
      log('info', '🔌 Client disconnected', sid || '-');
    });
  });

  return wss;
}

module.exports = { createRelay };
