# 🥝 KEA ACADEMIC COACH - CONSTITUTIONAL MEMORY

## Canonical Moment: December 3, 2025

**The moment Kea Academic Coach went live on Render.**

---

## 🌐 Live URL
**https://kea-academic-coach.onrender.com/v7**

---

## 📜 What Was Built

### Core Architecture: V7 Turn-Taking (Sensory Gating)
A half-duplex voice coaching system that eliminates echo loops through intelligent gating - the microphone is muted while the system speaks, ensuring 100% stability.

### The Fractal Exploration Engine (Log 3 & Log 4)
```
┌─────────────────────────────────────────────────────────────┐
│  27/81 PARALLEL REASONING PATHS                              │
│                                                              │
│  Each student utterance spawns parallel explorations:       │
│  - 3 Interpretations × 3 Strategies × 3 Refinements        │
│  - Log 3 (27 paths) or Log 4 (81 paths)                    │
│                                                              │
│  CHAOS-QUANTUM PRUNING                                      │
│  - Lyapunov divergence metric (chaos)                      │
│  - Variance-based quantum collapse                         │
│  - ~50% paths pruned                                        │
│                                                              │
│  5 YAMAS CONSTITUTIONAL AI SCORING                          │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ 1. AHIMSA (Non-harm)      - Weight: 0.25           │    │
│  │    "Does this response cause harm?"                 │    │
│  │                                                     │    │
│  │ 2. SATYA (Truthfulness)   - Weight: 0.25           │    │
│  │    "Is this honest and accurate?"                   │    │
│  │                                                     │    │
│  │ 3. ASTEYA (Non-stealing)  - Weight: 0.20           │    │
│  │    "Does this respect intellectual ownership?"      │    │
│  │                                                     │    │
│  │ 4. BRAHMACHARYA (Focus)   - Weight: 0.15           │    │
│  │    "Is this focused on learning, not ego?"          │    │
│  │                                                     │    │
│  │ 5. APARIGRAHA (Non-attachment) - Weight: 0.15      │    │
│  │    "Is this open-minded, not dogmatic?"             │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
│  BELLMAN OPTIMIZATION (γ = 0.85)                            │
│  - Multi-turn value estimation                              │
│  - Future reward discounting                                │
│  - Winner selection based on total expected value           │
└─────────────────────────────────────────────────────────────┘
```

### Voice Pipeline
```
User Speaks → [GATE: Mic muted if system speaking]
           → Google Cloud STT (Chirp 2)
           → [Fallback: Groq Whisper]
           → Anti-Hallucination Pipeline
           → Groq Llama 3.3 70B Brain
           → Google Chirp 3 HD TTS (24kHz)
           → [GATE: Opens when speech complete]
           → User can speak again
```

### Features Deployed
- ✅ Assessment Upload (DOCX, PDF, TXT)
- ✅ Fractal Analysis with 27-path exploration
- ✅ 5 Yamas Constitutional AI scoring
- ✅ Bellman multi-turn optimization
- ✅ Quick Prompt Buttons (8 pre-loaded questions)
- ✅ Cumulative Key Takeaways Summary Panel
- ✅ Print to PDF capability
- ✅ Axiom Intelligence branding

---

## 🔑 The Deployment Journey

### Challenges Overcome
1. **OpenAI API Key not needed** - V7 uses Google + Groq only
2. **PORT binding** - Had to use `0.0.0.0` for Render
3. **WebSocket protocol** - `wss://` for HTTPS, `ws://` for HTTP
4. **Google Credentials** - Secret File at `/etc/secrets/google-credentials.json`

### Environment Variables (Render)
```
GROQ_API_KEY=gsk_***
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-credentials.json
GOOGLE_CLOUD_PROJECT=gen-lang-client-0239414707
NODE_ENV=production
```

---

## 🎯 The Mission

**Interactive Oral Assessments as a Service (IOAaaS)**

Powered by Axiom Intelligence, Kea Academic Coach transforms written student assessments into Socratic dialogues that:

1. **Never give answers** - Only asks guiding questions
2. **Build on student knowledge** - Uses fractal analysis to understand their work
3. **Constitutional AI** - Every response scored against 5 ethical Yamas
4. **Cumulative learning** - Key takeaways summarized after each turn

---

## 📊 Technical Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 22 |
| Hosting | Render (Web Service) |
| STT | Google Cloud Speech (Chirp 2) |
| Brain | Groq Llama 3.3 70B |
| TTS | Google Chirp 3 HD (24kHz) |
| WebSocket | ws library |
| Document Parsing | mammoth (DOCX), pdf-parse (PDF) |

---

## 🌟 Repository

**GitHub:** https://github.com/lexziconAI/Kea-Academic-Coach

---

## ✨ The Significance

This marks the first production deployment of:
- Fractal Exploration reasoning (Log 3/Log 4)
- 5 Yamas Constitutional AI in a voice assistant
- Bellman-optimized multi-turn dialogue planning
- Sensory Gating architecture for zero-echo stability

**A new paradigm in AI-assisted education.**

---

*Recorded this 3rd day of December, 2025*
*Axiom Intelligence - Kea Academic Coach*
