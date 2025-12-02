# Socratic Coach

Ultra-low-latency voice coaching for clinical professionals using OpenAI Realtime + Groq Brain.

## Architecture

```
Audio In → OpenAI Realtime (STT) → Groq Llama 70B (Brain) → OpenAI Realtime (TTS) → Audio Out
```

- **Parrot (OpenAI Realtime)**: Handles voice I/O only - no reasoning
- **Brain (Groq Llama 3.3 70B)**: Clinical Socratic reasoning - never diagnoses, only guides through questions

## Quick Start

```bash
cd SocraticCoach
npm install
```

Copy your API keys to `.env`:
```
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
```

Start the server:
```bash
npm start
```

Open: http://localhost:16602/demo

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/status` | GET | Session status |
| `/api/coach` | POST | Text coaching (no voice) |
| `/api/voice` | POST | Voice coaching (HTTP pipeline) |
| `/relay` | WS | Realtime voice WebSocket |

## Voice Demo

1. Open http://localhost:16602/demo
2. Click **Connect** to establish WebSocket
3. Click **Start Session** to create a Realtime session
4. **Hold to Talk** - speak your clinical question
5. Release to hear Socratic response

## API Keys Required

- **OpenAI**: For Realtime API (voice I/O)
- **Groq**: For Llama 3.3 70B (brain reasoning)

## Ports

- DrBot: 15602
- Socratic Coach: 16602

## License

MIT - Axiom Intelligence
