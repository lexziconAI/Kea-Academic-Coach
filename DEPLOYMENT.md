# 🚀 Kea V7 Deployment Guide

## Production URL
**Live**: https://kea-academic-coach.onrender.com  
**Homepage**: Redirects to `/v7` (latest turn-taking architecture)

---

## ✅ Pre-Deployment Checklist

### Security Hardening Complete
- ✅ Rate limiting (20 uploads/min per IP)
- ✅ Filename sanitization (path traversal prevention)
- ✅ Session ID sanitization
- ✅ Description length limits (50KB max)
- ✅ Auto session cleanup (24h expiry)
- ✅ Memory protection (max 1000 contexts)
- ✅ Comprehensive error boundaries

### Testing Complete
- ✅ 7/7 basic smoke tests passing
- ✅ 9/10 edge case tests passing (9.1s parallel execution)
- ✅ Session isolation verified
- ✅ Multi-document upload tested
- ✅ 128k token support validated

---

## 🔧 Render Configuration

### Environment Variables Required
Set these in Render Dashboard → Environment:

```bash
# Required
GROQ_API_KEY=gsk_...                    # From console.groq.com
GOOGLE_CLOUD_PROJECT=your-project-id    # GCP Project ID
NODE_ENV=production
PORT=16602

# Google Cloud Authentication
# Upload service account JSON to Render, then set path:
GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/gcp-service-account.json
```

### Build & Start Commands
```yaml
buildCommand: npm install
startCommand: node server.js
healthCheckPath: /health
```

### Disk (Optional)
- Mount: `/opt/render/project/src/uploads`
- Size: 1GB (for temporary file uploads)

---

## 📦 What's Deployed

### V7 Features
- **Turn-taking architecture** (primary)
- **Sensory gating** + anti-hallucination pipeline
- **Multi-document upload** (primary report + supplementary papers)
- **Mid-session uploads** with pause functionality
- **128k token support** (up to 120k token documents)
- **Manual mode** (Keep Listening disables auto-send)
- **Transparent PNG icons** (Flux AI Set 1)

### Tech Stack
- **STT**: Google Cloud Speech
- **Brain**: Groq Llama 3.3 70B (128k context)
- **TTS**: Google Cloud Text-to-Speech (Chirp 3 HD)
- **Analysis**: LOG³ Fractal Analyzer with crypto receipts
- **Storage**: SQLite + in-memory Map

---

## 🧪 Post-Deployment Testing

### Manual Tests
1. **Health Check**: `curl https://kea-academic-coach.onrender.com/health`
2. **Homepage Redirect**: Visit root → should redirect to `/v7`
3. **Upload Test**: Upload a sustainability report (PDF/DOCX/TXT)
4. **Voice Test**: Click mic, speak, verify audio gating works
5. **Multi-doc Test**: Upload primary report, then upload supplementary paper

### Automated Tests (Run Locally)
```bash
# Basic smoke tests (7 tests, ~30s)
node tests/smoke_test.js

# Edge case tests (10 tests, ~10s parallel)
node tests/parallel_test_runner.js
```

---

## 📊 Monitoring

### Health Endpoint
```bash
GET /health
Response: {
  "status": "ok",
  "app": "Kea Academic Coach",
  "port": "16602",
  "groq": true,
  "openai": false
}
```

### Debug Endpoints
```bash
# View all active contexts
GET /api/debug/contexts

# Clear old contexts (24h+)
POST /api/debug/clear-old-contexts
```

### Logs to Watch
- `🛡️ [RATE LIMIT]` - Rate limiting triggered
- `🗑️ [AUTO-CLEANUP]` - Session cleanup running
- `🌀 [LOG³]` - Document analysis progress
- `💾 [PRIMARY REPORT]` - Report storage confirmation

---

## 🔄 Rollback Plan

### If Issues Occur
1. **Revert to previous version**:
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Check Render logs** for error details

3. **Verify environment variables** are set correctly

4. **Test health endpoint** before directing users

---

## 🎯 Success Metrics

- ✅ Health endpoint returns 200
- ✅ Homepage redirects to /v7
- ✅ Document upload works (PDF/DOCX/TXT)
- ✅ Voice interaction functional
- ✅ No CORS errors in browser console
- ✅ Rate limiting protects against abuse
- ✅ Session isolation prevents cross-contamination

---

## 🆘 Troubleshooting

### "Cannot read properties of null"
- **Cause**: Google credentials not set or invalid
- **Fix**: Verify `GOOGLE_APPLICATION_CREDENTIALS` path in Render

### "Rate limit exceeded"
- **Cause**: More than 20 uploads/min from same IP
- **Fix**: Expected behavior - inform user to wait

### "Context not found"
- **Cause**: Session expired (24h+ old)
- **Fix**: Expected behavior - user must re-upload

### Port 16602 not listening
- **Cause**: Environment variable `PORT` not set
- **Fix**: Add `PORT=16602` in Render environment

---

## 📝 Version History

### v1.0.0 (Current)
- Production hardening complete
- Security safeguards implemented
- Homepage redirects to V7
- 9/10 edge case tests passing

**Deployed**: December 4, 2025  
**Commit**: `f2a32ee`
