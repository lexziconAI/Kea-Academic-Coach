/**
 * Kea - Academic Coaching Assistant V4
 * Interruptible Chunked Voice Architecture
 * 
 * Architecture:
 *   User speaks → Groq Whisper (STT) → Groq Llama 70B (brain) → OpenAI TTS (chunked)
 *   
 * Key Feature: ResponseTracker knows EXACTLY what words were heard
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Startup diagnostics
console.log('🚀 Starting Kea Academic Coach...');
console.log('📁 GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS || 'NOT SET');
console.log('📁 GOOGLE_CLOUD_PROJECT:', process.env.GOOGLE_CLOUD_PROJECT || 'NOT SET');
console.log('🔑 GROQ_API_KEY:', process.env.GROQ_API_KEY ? 'SET' : 'NOT SET');
console.log('🌐 PORT:', process.env.PORT || '16602 (default)');
console.log('📄 DOCUMENT SUPPORT: PDF, DOCX, TXT (up to 100MB, ~120k tokens)');

// Check if Google credentials file exists
const fsSync = require('fs');
const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credPath) {
    if (fsSync.existsSync(credPath)) {
        console.log('✅ Google credentials file found at:', credPath);
    } else {
        console.log('❌ Google credentials file NOT found at:', credPath);
    }
}

const http = require('http');
const fs = require('fs').promises;
const { log } = require('./services/logging');
const { createRelayV4 } = require('./services/relayV4');
const crypto = require('crypto');

// Assessment Upload & Analysis
const multer = require('multer');
const { parseDocument, validateFile } = require('./services/documentParser');
// NEW: Use LOG³ Fractal Analyzer with crypto receipts
const { 
    KeaFractalAnalyzer, 
    generateCoachingContext, 
    CONVERSATIONAL_BRAIN_PROMPT,
    runLog4Quick,
    shouldTriggerLog4
} = require('./services/kea_coaching_system');

// NEW: Enhanced Key Takeaways with LOG³ integration
const {
    generateEnhancedKeyTakeaways,
    formatAnalysisContextForTakeaways
} = require('./services/kea_key_takeaways');

// NEW: Session Database for persistence
const sessionDb = require('./services/sessionDatabase');

// NEW: Email Service for report delivery
const emailService = require('./services/emailService');

// Multer setup for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit for documents with heavy images/tables
});

// Store coaching contexts per session
const coachingContexts = new Map();

// ═══════════════════════════════════════════════════════════════════════════════
// SECURITY & PERFORMANCE SAFEGUARDS
// ═══════════════════════════════════════════════════════════════════════════════

// Rate limiting: Track upload attempts per IP
const uploadAttempts = new Map(); // ip → { count, resetTime }
const RATE_LIMIT = 20; // Max uploads per minute per IP
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const record = uploadAttempts.get(ip);
  
  if (!record || now > record.resetTime) {
    uploadAttempts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  
  if (record.count >= RATE_LIMIT) {
    return false; // Rate limit exceeded
  }
  
  record.count++;
  return true;
}

// Filename sanitization: Prevent path traversal and malicious filenames
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return 'upload_' + Date.now() + '.txt';
  }
  
  // Remove path components
  let safe = path.basename(filename);
  
  // Remove dangerous characters
  safe = safe.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  // Limit length
  if (safe.length > 100) {
    const ext = path.extname(safe);
    safe = safe.substring(0, 100 - ext.length) + ext;
  }
  
  // Ensure it's not empty
  if (!safe || safe === '') {
    safe = 'upload_' + Date.now() + '.txt';
  }
  
  return safe;
}

// Session cleanup: Remove contexts older than 24 hours
const MAX_CONTEXT_AGE = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONTEXTS = 1000; // Prevent unbounded memory growth

function cleanupOldContexts() {
  const now = Date.now();
  let cleaned = 0;
  
  // Remove old contexts
  for (const [sessionId, data] of coachingContexts.entries()) {
    if (now - data.timestamp > MAX_CONTEXT_AGE) {
      coachingContexts.delete(sessionId);
      cleaned++;
    }
  }
  
  // If still over limit, remove oldest
  if (coachingContexts.size > MAX_CONTEXTS) {
    const sorted = Array.from(coachingContexts.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = sorted.slice(0, coachingContexts.size - MAX_CONTEXTS);
    toRemove.forEach(([sessionId]) => {
      coachingContexts.delete(sessionId);
      cleaned++;
    });
  }
  
  if (cleaned > 0) {
    log('info', `🧹 [AUTO-CLEANUP] Removed ${cleaned} old contexts. Remaining: ${coachingContexts.size}`);
  }
}

// Run cleanup every hour
setInterval(cleanupOldContexts, 60 * 60 * 1000);

const { createRelayV5 } = require('./services/keaVoiceV5');
const { createRelayV6 } = require('./services/keaVoiceV6');
const { createRelayV7 } = require('./services/keaVoiceV7');
const { think, whisperSTT } = require('./services/groqBrain');

const PORT = process.env.PORT || 16602;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const sessions = new Map();

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  try {
    // Health check
    if (pathname === '/health') {
      // Get DB stats for health check
      let dbStats = { users: 0, sessions: 0, dbPath: 'unknown' };
      try {
        const users = sessionDb.getAllUsers();
        const sessions = sessionDb.getAllSessions();
        dbStats = { 
          users: users.length, 
          sessions: sessions.length,
          dbPath: process.env.NODE_ENV === 'production' ? 'render-disk' : 'local'
        };
      } catch (e) {
        dbStats.error = e.message;
      }
      
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        app: 'Kea Academic Coach',
        port: PORT,
        openai: !!OPENAI_API_KEY,
        groq: !!GROQ_API_KEY,
        database: dbStats
      }));
      return;
    }

    // Status
    if (pathname === '/api/status') {
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        activeSessions: sessions.size,
        config: {
          stt: 'OpenAI Realtime Whisper',
          brain: 'Groq Llama 3.3 70B',
          tts: 'OpenAI Realtime TTS'
        }
      }));
      return;
    }

    // Static PNG file serving (for Kea voice state icons)
    if (pathname.endsWith('.png') && req.method === 'GET') {
      const fsSync = require('fs');
      const filePath = path.join(__dirname, 'public', pathname);
      
      if (fsSync.existsSync(filePath)) {
        const fileStream = fsSync.createReadStream(filePath);
        res.writeHead(200, { 
          ...corsHeaders, 
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400' // Cache for 1 day
        });
        fileStream.pipe(res);
        return;
      } else {
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'text/plain' });
        res.end('PNG file not found');
        return;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION REGISTRATION & PERSISTENCE APIs
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Register new session with user details
    if (pathname === '/api/register-session' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { sessionId, name, email, responseLength } = JSON.parse(body);
          
          if (!sessionId || !name || !email) {
            throw new Error('sessionId, name, and email are required');
          }
          
          // Create/get user
          const user = sessionDb.getOrCreateUser(email, name);
          
          // Create session in database
          sessionDb.createSession(sessionId, user.id, responseLength || 'MEDIUM');
          
          console.log(`📝 Session registered: ${sessionId} for ${name} (${email})`);
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            userId: user.id,
            sessionId: sessionId,
            message: 'Session registered'
          }));
          
        } catch (err) {
          console.error('Registration error:', err);
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // End session (called via beacon on window close)
    if (pathname === '/api/end-session' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);
          const { sessionId, reason, keyTakeaways, conversationHistory } = data;
          
          if (!sessionId) {
            throw new Error('sessionId required');
          }
          
          console.log(`🏁 Ending session: ${sessionId} (reason: ${reason || 'manual'})`);
          
          // Save final key takeaways if provided
          if (keyTakeaways) {
            sessionDb.updateKeyTakeaways(sessionId, keyTakeaways);
          }
          
          // Save any remaining conversation turns
          if (conversationHistory && Array.isArray(conversationHistory)) {
            const existingTurns = sessionDb.getConversationHistory(sessionId);
            const existingCount = existingTurns.length;
            
            // Only add turns that weren't already saved
            for (let i = existingCount; i < conversationHistory.length; i++) {
              const turn = conversationHistory[i];
              sessionDb.addConversationTurn(sessionId, turn.role, turn.content);
            }
          }
          
          // Generate final report
          const report = sessionDb.generateSessionReport(sessionId);
          
          // Mark session as ended
          sessionDb.endSession(sessionId, reason === 'window_close' ? 'completed' : 'completed');
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            reportGenerated: !!report,
            reportHash: report?.hash?.substring(0, 16) || null
          }));
          
        } catch (err) {
          console.error('End session error:', err);
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // Save conversation turn (called after each exchange)
    if (pathname === '/api/save-turn' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { sessionId, role, content, metadata } = JSON.parse(body);
          
          if (!sessionId || !role || !content) {
            throw new Error('sessionId, role, and content are required');
          }
          
          const turnNumber = sessionDb.addConversationTurn(sessionId, role, content, metadata || {});
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, turnNumber }));
          
        } catch (err) {
          console.error('Save turn error:', err);
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // Get session report
    if (pathname === '/api/session-report' && req.method === 'GET') {
      const reportSessionId = url.searchParams.get('sessionId');
      
      if (!reportSessionId) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'sessionId required' }));
        return;
      }
      
      const report = sessionDb.getLatestReport(reportSessionId);
      
      if (report) {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          report: JSON.parse(report.report_json),
          hash: report.report_hash,
          generatedAt: report.generated_at
        }));
      } else {
        // Generate report on-demand if not exists
        const newReport = sessionDb.generateSessionReport(reportSessionId);
        if (newReport) {
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            report: newReport.report,
            hash: newReport.hash,
            generatedAt: new Date().toISOString()
          }));
        } else {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Session not found' }));
        }
      }
      return;
    }

    // ============================================
    // EMAIL ENDPOINTS
    // ============================================
    
    // Send report via email
    if (pathname === '/api/send-report-email' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { sessionId, toEmail, sessionData } = JSON.parse(body);
          
          if (!toEmail) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Email address required' }));
            return;
          }
          
          // Get session data from database if not provided
          let reportData = sessionData;
          if (!reportData && sessionId) {
            const session = sessionDb.getSession(sessionId);
            const turns = sessionDb.getConversationHistory(sessionId);
            
            if (session) {
              reportData = {
                userName: session.user_name || 'Student',
                userEmail: toEmail,
                assessmentTitle: session.assessment_title || 'Coaching Session',
                keyTakeaways: session.key_takeaways_html || '',
                createdAt: session.created_at,
                endedAt: session.ended_at || new Date().toISOString(),
                sessionStats: {
                  totalTurns: turns.length,
                  userTurns: turns.filter(t => t.role === 'user').length,
                  assistantTurns: turns.filter(t => t.role === 'assistant').length,
                  durationMinutes: session.created_at ? 
                    Math.round((new Date() - new Date(session.created_at)) / 60000) : 'N/A'
                }
              };
            }
          }
          
          if (!reportData) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'No session data available' }));
            return;
          }
          
          // Send email
          const result = await emailService.sendReportEmail(toEmail, reportData);
          
          if (result.success) {
            log('info', `📧 Report emailed to ${toEmail} for session ${sessionId}`);
            res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } else {
            res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          }
        } catch (err) {
          log('error', `Email send error: ${err.message}`);
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // ============================================
    // ADMIN ENDPOINTS
    // ============================================
    
    // Admin login
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { username, password } = JSON.parse(body);
          
          // Hardcoded admin credentials as requested
          if (username === 'Admin' && password === 'IamallinonAI') {
            res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: true, 
              message: 'Admin authenticated',
              token: 'admin-session-' + Date.now()
            }));
          } else {
            res.writeHead(401, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Invalid credentials' }));
          }
        } catch (err) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // Combined admin dashboard data endpoint
    if (pathname === '/api/admin/dashboard' && req.method === 'GET') {
      try {
        const sessions = sessionDb.getAllSessions();
        const users = sessionDb.getAllUsers();
        
        // Calculate stats
        const totalTurns = sessions.reduce((sum, s) => sum + (s.turn_count || 0), 0);
        const activeSessions = sessions.filter(s => s.status === 'active').length;
        
        // Get recent reports from session_reports table
        const reports = sessionDb.getAllReports();
        
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          stats: {
            totalUsers: users.length,
            totalSessions: sessions.length,
            activeSessions: activeSessions,
            totalTurns: totalTurns
          },
          sessions,
          users,
          reports
        }));
      } catch (err) {
        console.error('Dashboard load error:', err);
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
    
    // Get specific report by ID for download
    if (pathname.startsWith('/api/admin/report/') && req.method === 'GET') {
      try {
        const reportId = parseInt(pathname.split('/').pop());
        const report = sessionDb.getReportById(reportId);
        
        if (!report) {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Report not found' }));
          return;
        }
        
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: true, 
          report: JSON.parse(report.report_json),
          report_hash: report.report_hash,
          generated_at: report.generated_at
        }));
      } catch (err) {
        console.error('Report download error:', err);
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
    
    // Get all sessions for admin dashboard
    if (pathname === '/api/admin/sessions' && req.method === 'GET') {
      try {
        const sessions = sessionDb.getAllSessions();
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, sessions }));
      } catch (err) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
    
    // Get specific session details with all conversation turns
    if (pathname.startsWith('/api/admin/session/') && req.method === 'GET') {
      const sessionId = pathname.split('/').pop();
      try {
        const sessionDetails = sessionDb.getSessionDetails(sessionId);
        if (sessionDetails) {
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, session: sessionDetails }));
        } else {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Session not found' }));
        }
      } catch (err) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
    
    // Get all users
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      try {
        const users = sessionDb.getAllUsers();
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, users }));
      } catch (err) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
    
    // Get user's sessions
    if (pathname.startsWith('/api/admin/user/') && pathname.endsWith('/sessions') && req.method === 'GET') {
      const parts = pathname.split('/');
      const userId = parts[parts.length - 2];
      try {
        const userSessions = sessionDb.getUserSessions(userId);
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, sessions: userSessions }));
      } catch (err) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
    
    // Delete session (admin only)
    if (pathname.startsWith('/api/admin/session/') && req.method === 'DELETE') {
      const sessionId = pathname.split('/').pop();
      try {
        const deleted = sessionDb.deleteSession(sessionId);
        if (deleted) {
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, message: 'Session deleted' }));
        } else {
          res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Session not found' }));
        }
      } catch (err) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }
    
    // Export all data (admin only)
    if (pathname === '/api/admin/export' && req.method === 'GET') {
      try {
        const exportData = sessionDb.exportAllData();
        res.writeHead(200, { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="kea_sessions_export.json"'
        });
        res.end(JSON.stringify(exportData, null, 2));
      } catch (err) {
        res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // Text coaching (no voice) - with LOG4 quick mode support
    if (pathname === '/api/coach' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { text, systemPrompt, history, sessionId } = JSON.parse(body);
          if (!text) throw new Error('Text required');

          // Check if LOG4 quick mode should trigger for deep exploration
          let result;
          if (shouldTriggerLog4(text, history || [])) {
            log('info', `🔮 [LOG⁴] Deep exploration triggered for: "${text.substring(0, 50)}..."`);
            
            // Get coaching context for this session
            const contextData = coachingContexts.get(sessionId || 'default');
            const coachingContext = contextData?.coachingContext || '';
            
            // Run LOG4 quick fractal exploration
            const log4Response = await runLog4Quick(text, coachingContext, history || []);
            
            if (log4Response) {
              result = { text: log4Response, duration: 0, log4: true };
              log('info', `🔮 [LOG⁴] Quick exploration complete`);
            } else {
              // Fallback to standard brain
              result = await think(text, GROQ_API_KEY, { systemPrompt, history });
            }
          } else {
            // Standard brain call
            result = await think(text, GROQ_API_KEY, { systemPrompt, history });
          }

          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            input: text,
            response: result.text,
            latency: result.duration,
            log4Triggered: result.log4 || false
          }));
        } catch (err) {
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // Voice coaching (audio in -> brain -> audio out via simple pipeline)
    if (pathname === '/api/voice' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const pipelineStart = Date.now();
        try {
          const { audio, systemPrompt } = JSON.parse(body);
          if (!audio) throw new Error('Audio (base64) required');

          const audioBuffer = Buffer.from(audio, 'base64');
          log('log3', `[VOICE] Received ${Math.round(audioBuffer.length/1024)}KB audio`);

          // STT with Groq Whisper
          log('log3', '[VOICE] Starting STT...');
          const sttResult = await whisperSTT(audioBuffer, GROQ_API_KEY);
          if (!sttResult.text) throw new Error('No speech detected');
          log('log3', `[VOICE] STT complete: "${sttResult.text.substring(0,50)}..." (${sttResult.duration}ms)`);

          // Brain with Groq
          log('log3', '[VOICE] Starting brain...');
          const brainResult = await think(sttResult.text, GROQ_API_KEY, { systemPrompt });
          log('log3', `[VOICE] Brain complete: "${brainResult.text.substring(0,50)}..." (${brainResult.duration}ms)`);

          // TTS with OpenAI (simple HTTP TTS)
          log('log3', '[VOICE] Starting TTS...');
          const ttsResult = await openaiTTS(brainResult.text);
          log('log3', `[VOICE] TTS complete: ${Math.round(ttsResult.audio.length/1024)}KB (${ttsResult.duration}ms)`);

          const totalDuration = Date.now() - pipelineStart;
          log('info', `🎙️ Voice pipeline: ${totalDuration}ms (STT:${sttResult.duration} + Brain:${brainResult.duration} + TTS:${ttsResult.duration})`);

          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            transcript: sttResult.text,
            response: brainResult.text,
            audio: ttsResult.audio.toString('base64'),
            mimeType: 'audio/mp3',
            metrics: {
              stt: sttResult.duration,
              brain: brainResult.duration,
              tts: ttsResult.duration
            }
          }));
        } catch (err) {
          log('error', `[VOICE] Pipeline error: ${err.message}`);
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // DIAGNOSTIC ENDPOINT - Check coaching context cache
    // ═══════════════════════════════════════════════════════════════════════════════
    if (pathname === '/api/debug/contexts' && req.method === 'GET') {
      const contexts = [];
      for (const [sessionId, data] of coachingContexts.entries()) {
        contexts.push({
          sessionId,
          filename: data.filename || 'Unknown',
          organization: data.organization || data.analysis?.organization?.name || data.analysis?.analysis?.organization?.name || 'Unknown',
          contextLength: data.coachingContext?.length || 0,
          timestamp: new Date(data.timestamp).toISOString(),
          preview: data.coachingContext?.substring(0, 200) + '...'
        });
      }
      
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        totalContexts: coachingContexts.size,
        contexts: contexts
      }));
      return;
    }
    
    // Clear old contexts (older than 24 hours)
    if (pathname === '/api/debug/clear-old-contexts' && req.method === 'POST') {
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      let cleared = 0;
      
      for (const [sessionId, data] of coachingContexts.entries()) {
        if (now - data.timestamp > maxAge) {
          coachingContexts.delete(sessionId);
          cleared++;
        }
      }
      
      log('info', `🧹 [CACHE] Cleared ${cleared} old contexts. Remaining: ${coachingContexts.size}`);
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ cleared, remaining: coachingContexts.size }));
      return;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // ASSESSMENT UPLOAD ENDPOINT
    // ═══════════════════════════════════════════════════════════════════════════════
    if (pathname === '/api/upload-assessment' && req.method === 'POST') {
      // Rate limiting check
      const clientIP = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
      if (!checkRateLimit(clientIP)) {
        log('warn', `🚫 [RATE LIMIT] Upload blocked from ${clientIP}`);
        res.writeHead(429, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Rate limit exceeded. Maximum 20 uploads per minute.' 
        }));
        return;
      }
      
      // Handle multipart form data with multer
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          
          // Parse multipart form data manually (simple approach)
          const boundary = req.headers['content-type'].split('boundary=')[1];
          const parts = buffer.toString('binary').split('--' + boundary);
          
          let fileBuffer = null;
          let filename = 'upload.txt';
          let sessionId = 'default';
          let description = '';
          
          for (const part of parts) {
            if (part.includes('filename=')) {
              // Extract filename
              const filenameMatch = part.match(/filename="([^"]+)"/);
              if (filenameMatch) filename = sanitizeFilename(filenameMatch[1]);
              
              // Extract file content (after double CRLF)
              const contentStart = part.indexOf('\r\n\r\n') + 4;
              const contentEnd = part.lastIndexOf('\r\n');
              const content = part.substring(contentStart, contentEnd);
              fileBuffer = Buffer.from(content, 'binary');
            }
            if (part.includes('name="sessionId"')) {
              const valueStart = part.indexOf('\r\n\r\n') + 4;
              const valueEnd = part.lastIndexOf('\r\n');
              sessionId = part.substring(valueStart, valueEnd).trim();
              // Sanitize session ID
              sessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 128);
              if (!sessionId) sessionId = 'session_' + Date.now();
            }
            if (part.includes('name="description"')) {
              const valueStart = part.indexOf('\r\n\r\n') + 4;
              const valueEnd = part.lastIndexOf('\r\n');
              description = part.substring(valueStart, valueEnd).trim();
              // Limit description length
              if (description.length > 50000) {
                description = description.substring(0, 50000) + '... (truncated)';
              }
            }
          }
          
          if (!fileBuffer) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'No file uploaded' }));
            return;
          }
          
          log('info', `📄 [UPLOAD] Received ${filename} (${Math.round(fileBuffer.length/1024)}KB) for session ${sessionId}`);
          
          // Validate file (100MB limit for large academic papers with images/tables)
          const validation = validateFile(fileBuffer, filename, 100);
          if (!validation.valid) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: validation.error }));
            return;
          }
          
          // Parse document (supports PDF, DOCX, TXT)
          let parseResult, analysisResult, analysis, attestation;
          try {
            parseResult = await parseDocument(fileBuffer, filename);
            log('info', `📝 [UPLOAD] Extracted ${parseResult.metadata.wordCount} words from ${parseResult.metadata.extension}`);
          } catch (parseError) {
            log('error', `📝 [PARSE ERROR] ${parseError.message}`);
            res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: `Document parsing failed: ${parseError.message}` 
            }));
            return;
          }
          
          // Analyze submission with NEW LOG³ Fractal Analyzer + Crypto Receipts
          log('info', `🌀 [LOG³] Starting LOG³ fractal analysis with crypto receipts...`);
          try {
            const analyzer = new KeaFractalAnalyzer();
            analysisResult = await analyzer.executeFullAnalysis(parseResult.text);
            analysis = analysisResult.analysis;
            attestation = analysisResult.attestation;
          } catch (analysisError) {
            log('error', `🌀 [LOG³ ERROR] ${analysisError.message}`);
            log('error', `🌀 [LOG³ STACK] ${analysisError.stack}`);
            res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              success: false, 
              error: `Analysis failed: ${analysisError.message}. Please try again or contact support.` 
            }));
            return;
          }
          
          // Log LOG³ metadata
          if (analysisResult._metadata) {
            log('info', `🌀 [LOG³] ════════════════════════════════════════════`);
            log('info', `🌀 [LOG³] Method: ${analysisResult._metadata.method}`);
            log('info', `🌀 [LOG³] Branches Executed: ${analysisResult._metadata.branches_executed}`);
            log('info', `🌀 [LOG³] Total Time: ${analysisResult._metadata.total_time_ms}ms`);
            log('info', `🔐 [RECEIPTS] Chain Valid: ${attestation.chain_valid}`);
            log('info', `🔐 [RECEIPTS] Merkle Root: ${attestation.merkle_root?.substring(0, 16)}...`);
            log('info', `🔐 [RECEIPTS] Receipt Count: ${attestation.receipts?.chain_length || 0}`);
            log('info', `🌀 [LOG³] ════════════════════════════════════════════`);
          }
          
          log('info', `🧠 [UPLOAD] Analysis complete: ${analysis.coaching_strategy?.exploration_pathways?.primary?.focus || 'coaching ready'}`);
          
          // Generate coaching context from new format
          let coachingContext = generateCoachingContext(analysisResult);
          
          // Prepend user's description as guidance if provided
          if (description) {
            log('info', `📝 [UPLOAD] User guidance: "${description.substring(0, 100)}..."`);
            coachingContext = `═══ USER GUIDANCE ═══\n${description}\n\n${coachingContext}`;
          }
          
          // CRITICAL: Clear any existing context for this session to ensure clean slate
          // This is the PRIMARY REPORT upload - replaces any old data
          if (coachingContexts.has(sessionId)) {
            log('warn', `🗑️ [CONTEXT] Clearing old context for session ${sessionId} - NEW primary report uploaded`);
          }
          
          // Store for this session (include receipts for audit)
          coachingContexts.set(sessionId, {
            analysis: analysisResult,
            coachingContext,
            attestation,
            description,
            timestamp: Date.now(),
            filename: filename,
            organization: analysis.organization?.name || 'Unknown', // Store at top level for easy access
            primaryReport: true,
            additionalDocuments: [] // Will hold any extra docs uploaded during session
          });
          
          log('info', `💾 [PRIMARY REPORT] ═══════════════════════════════════`);
          log('info', `💾 [PRIMARY REPORT] Stored for session: ${sessionId}`);
          log('info', `💾 [PRIMARY REPORT] File: ${filename}`);
          log('info', `💾 [PRIMARY REPORT] Organization: ${analysis.organization?.name || 'Unknown'}`);
          log('info', `💾 [PRIMARY REPORT] Context length: ${coachingContext.length} chars`);
          log('info', `💾 [PRIMARY REPORT] Preview: ${coachingContext.substring(0, 150).replace(/\n/g, ' ')}...`);
          log('info', `💾 [PRIMARY REPORT] Map now has ${coachingContexts.size} entries`);
          log('info', `💾 [PRIMARY REPORT] ═══════════════════════════════════`);
          
          // PERSIST TO DATABASE
          try {
            sessionDb.updateSessionAssessment(sessionId, {
              organisationName: analysis.organization?.name || 'Unknown',
              filename: filename,
              wordCount: parseResult.metadata.wordCount,
              initialParse: analysisResult,  // Full JSON analysis
              coachingContext: coachingContext
            });
            log('info', `📦 [DATABASE] Session assessment saved to SQLite`);
          } catch (dbErr) {
            log('error', `📦 [DATABASE] Failed to save to database: ${dbErr.message}`);
            // Continue anyway - in-memory cache will still work
          }
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            sessionId,
            organization: analysis.organization?.name || 'Unknown',
            wordCount: parseResult.metadata.wordCount,
            // New coaching strategy format
            coachingStrategy: {
              opening: analysis.coaching_strategy?.opening,
              primaryFocus: analysis.coaching_strategy?.exploration_pathways?.primary?.focus,
              practicesAnalyzed: analysis.practices?.length || 0
            },
            // Crypto attestation (for audit)
            attestation: {
              merkleRoot: attestation.merkle_root,
              chainValid: attestation.chain_valid,
              receiptCount: attestation.receipts?.chain_length || 0
            },
            // LOG³ Metadata
            log3Metadata: analysisResult._metadata ? {
              method: analysisResult._metadata.method,
              branchesExecuted: analysisResult._metadata.branches_executed,
              totalTimeMs: analysisResult._metadata.total_time_ms,
              version: analysisResult._metadata.version
            } : null
          }));
          
        } catch (err) {
          log('error', `[UPLOAD] Error: ${err.message}`);
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // MID-SESSION FILE UPLOAD (Upload additional documents during conversation)
    // ═══════════════════════════════════════════════════════════════════════════════
    if (pathname === '/api/upload-during-session' && req.method === 'POST') {
      // Rate limiting check
      const clientIP = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
      if (!checkRateLimit(clientIP)) {
        log('warn', `🚫 [RATE LIMIT] Mid-session upload blocked from ${clientIP}`);
        res.writeHead(429, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          success: false, 
          error: 'Rate limit exceeded. Maximum 20 uploads per minute.' 
        }));
        return;
      }
      
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const boundary = req.headers['content-type'].split('boundary=')[1];
          const parts = buffer.toString('binary').split('--' + boundary);
          
          let fileBuffer = null;
          let filename = 'upload.txt';
          let sessionId = 'default';
          let description = '';
          
          // Parse multipart form data
          for (const part of parts) {
            if (part.includes('filename=')) {
              const filenameMatch = part.match(/filename="([^"]+)"/);
              if (filenameMatch) filename = sanitizeFilename(filenameMatch[1]);
              
              const contentStart = part.indexOf('\r\n\r\n') + 4;
              const contentEnd = part.lastIndexOf('\r\n');
              const content = part.substring(contentStart, contentEnd);
              fileBuffer = Buffer.from(content, 'binary');
            }
            if (part.includes('name="sessionId"')) {
              const valueStart = part.indexOf('\r\n\r\n') + 4;
              const valueEnd = part.lastIndexOf('\r\n');
              sessionId = part.substring(valueStart, valueEnd).trim();
              sessionId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 128);
              if (!sessionId) sessionId = 'session_' + Date.now();
            }
            if (part.includes('name="description"')) {
              const valueStart = part.indexOf('\r\n\r\n') + 4;
              const valueEnd = part.lastIndexOf('\r\n');
              description = part.substring(valueStart, valueEnd).trim();
              if (description.length > 50000) {
                description = description.substring(0, 50000) + '... (truncated)';
              }
            }
          }
          
          if (!fileBuffer) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'No file uploaded' }));
            return;
          }
          
          log('info', `📄 [MID-SESSION UPLOAD] ${filename} (${Math.round(fileBuffer.length/1024)}KB) for session ${sessionId}`);
          if (description) {
            log('info', `📝 [MID-SESSION] Description: "${description.substring(0, 100)}..."`);
          }
          
          // Validate file (100MB limit for large academic papers)
          const validation = validateFile(fileBuffer, filename, 100);
          if (!validation.valid) {
            res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: validation.error }));
            return;
          }
          
          // Parse document (supports PDF, DOCX, TXT)
          const parseResult = await parseDocument(fileBuffer, filename);
          log('info', `📝 [MID-SESSION] Extracted ${parseResult.metadata.wordCount} words from ${parseResult.metadata.extension}`);
          
          // Analyze with LOG³
          log('info', `🌀 [LOG³] Analyzing additional document...`);
          const analyzer = new KeaFractalAnalyzer();
          const analysisResult = await analyzer.executeFullAnalysis(parseResult.text);
          
          // Get existing context
          const existingContext = coachingContexts.get(sessionId);
          
          // Generate additional context with user's description as guidance
          let additionalContext = `\n\n═══ ADDITIONAL DOCUMENT UPLOADED ═══\n`;
          additionalContext += `Filename: ${filename}\n`;
          additionalContext += `Word Count: ${parseResult.metadata.wordCount}\n`;
          if (description) {
            additionalContext += `User Guidance: ${description}\n`;
          }
          additionalContext += `\n${generateCoachingContext(analysisResult)}\n`;
          additionalContext += `═══ END ADDITIONAL DOCUMENT ═══\n`;
          
          // Merge with existing context
          let mergedContext;
          if (existingContext) {
            mergedContext = existingContext.coachingContext + additionalContext;
            coachingContexts.set(sessionId, {
              ...existingContext,
              coachingContext: mergedContext,
              additionalDocuments: [
                ...(existingContext.additionalDocuments || []),
                {
                  filename,
                  wordCount: parseResult.metadata.wordCount,
                  description,
                  analysis: analysisResult,
                  timestamp: Date.now()
                }
              ]
            });
          } else {
            // No existing context - treat as initial upload
            mergedContext = additionalContext;
            coachingContexts.set(sessionId, {
              analysis: analysisResult,
              coachingContext: mergedContext,
              attestation: analysisResult.attestation,
              timestamp: Date.now(),
              additionalDocuments: [{
                filename,
                wordCount: parseResult.metadata.wordCount,
                description,
                analysis: analysisResult,
                timestamp: Date.now()
              }]
            });
          }
          
          log('info', `💾 [MID-SESSION] Updated context - Total length: ${mergedContext.length} chars`);
          log('info', `📊 [MID-SESSION] Total documents: ${coachingContexts.get(sessionId).additionalDocuments.length}`);
          
          // Persist to database
          try {
            sessionDb.addAdditionalDocument(sessionId, {
              filename,
              wordCount: parseResult.metadata.wordCount,
              description,
              analysis: analysisResult
            });
            log('info', `📦 [DATABASE] Additional document saved`);
          } catch (dbErr) {
            log('error', `📦 [DATABASE] Failed to save: ${dbErr.message}`);
          }
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            sessionId,
            filename,
            wordCount: parseResult.metadata.wordCount,
            description,
            totalContextLength: mergedContext.length,
            totalDocuments: coachingContexts.get(sessionId).additionalDocuments.length
          }));
          
        } catch (err) {
          log('error', `[MID-SESSION UPLOAD] Error: ${err.message}`);
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════════
    // KEY TAKEAWAYS GENERATOR (Enhanced with LOG³ integration)
    // ═══════════════════════════════════════════════════════════════════════════════
    if (pathname === '/api/generate-summary' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { sessionId, transcript, organization, turnCount, studentName } = JSON.parse(body);
          
          log('info', `📋 [TAKEAWAYS] Generating enhanced Key Takeaways for ${turnCount} turns...`);
          
          // Get coaching context and analysis for LOG³ integration
          const contextData = coachingContexts.get(sessionId);
          const analysisData = contextData?.analysis || null;
          
          // Generate enhanced Key Takeaways with LOG³ context
          const result = await generateEnhancedKeyTakeaways({
            sessionId,
            transcript,
            organization,
            studentName: studentName || 'the student',
            analysisData,
            turnCount
          });
          
          log('info', `📋 [TAKEAWAYS] Generated ${result.summaryHtml.length} chars of HTML (LOG³ enhanced)`);
          
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            success: true, 
            summaryHtml: result.summaryHtml,
            turnCount: result.turnCount,
            enhanced: true
          }));
          
        } catch (err) {
          log('error', `[TAKEAWAYS] Error: ${err.message}`);
          res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }
    
    // Get coaching context for a session
    if (pathname === '/api/coaching-context' && req.method === 'GET') {
      const sessionId = url.searchParams.get('sessionId') || 'default';
      const context = coachingContexts.get(sessionId);
      
      if (context) {
        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          coachingContext: context.coachingContext,
          analysis: context.analysis
        }));
      } else {
        res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'No context for this session' }));
      }
      return;
    }

    // Serve frontend - Redirect to V7 (latest)
    if (pathname === '/' || pathname === '/index.html') {
      res.writeHead(302, { 'Location': '/v7' });
      res.end();
      return;
    }

    // Serve V4 interruptible demo
    if (pathname === '/v4') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v4.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('V4 demo not found: ' + e.message);
      }
      return;
    }

    // Serve V5 parallel chunking demo (NEW - fastest!)
    if (pathname === '/v5') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v5.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('V5 demo not found: ' + e.message);
      }
      return;
    }

    // Serve V6 streaming AEC demo (NEWEST - barge-in support!)
    if (pathname === '/v7') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v7.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('V7 demo not found: ' + e.message);
      }
      return;
    }

    // Serve Admin Dashboard
    if (pathname === '/admin' || pathname === '/admin.html') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'admin.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Admin page not found: ' + e.message);
      }
      return;
    }

    if (pathname === '/v6') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'kea-v6.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('V6 demo not found: ' + e.message);
      }
      return;
    }

    // Serve audio worklet for V6
    if (pathname === '/audio-worklet.js') {
      try {
        const js = await fs.readFile(path.join(__dirname, 'public', 'audio-worklet.js'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(js);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Audio worklet not found: ' + e.message);
      }
      return;
    }

    // Serve anti-hallucination module for V7
    if (pathname === '/kea_v7_anti_hallucination.js') {
      try {
        const js = await fs.readFile(path.join(__dirname, 'public', 'kea_v7_anti_hallucination.js'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(js);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Anti-hallucination module not found: ' + e.message);
      }
      return;
    }

    // Serve realtime demo UI (uses OpenAI Realtime)
    if (pathname === '/realtime') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'realtime.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Realtime demo not found');
      }
      return;
    }

    // Serve demo UI (HTTP fallback)
    if (pathname === '/demo') {
      try {
        const html = await fs.readFile(path.join(__dirname, 'public', 'demo.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Demo not found');
      }
      return;
    }

    // Serve Axiom logo
    if (pathname === '/axiom-logo.png') {
      try {
        const logo = await fs.readFile(path.join(__dirname, 'public', 'axiom-logo.png'));
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(logo);
      } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Logo not found');
      }
      return;
    }

    // Favicon - return empty 204 to prevent 404 errors
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }

    // 404
    res.writeHead(404, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));

  } catch (err) {
    log('error', 'Request error:', err.message);
    res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

// Simple OpenAI TTS for HTTP voice endpoint - using tts-1 with speed boost
async function openaiTTS(text) {
  const https = require('https');
  const startTime = Date.now();

  log('log3', `[TTS] Starting synthesis for ${text.length} chars`);

  const payload = JSON.stringify({
    model: 'tts-1',  // tts-1 is actually faster than tts-1-hd
    input: text,
    voice: 'nova',
    response_format: 'mp3',
    speed: 1.1  // Slightly faster playback
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      port: 443,
      path: '/v1/audio/speech',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = [];
      let bytesReceived = 0;
      
      res.on('data', chunk => {
        chunks.push(chunk);
        bytesReceived += chunk.length;
        log('log4', `[TTS] Received chunk: ${chunk.length} bytes (total: ${bytesReceived})`);
      });
      
      res.on('end', () => {
        const duration = Date.now() - startTime;
        if (res.statusCode === 200) {
          log('log3', `[TTS] Complete: ${bytesReceived} bytes in ${duration}ms`);
          resolve({ audio: Buffer.concat(chunks), duration });
        } else {
          const body = Buffer.concat(chunks).toString();
          log('error', `[TTS] Error ${res.statusCode}: ${body}`);
          reject(new Error(`TTS error: ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Start server
const server = http.createServer(handleRequest);

// Bind to 0.0.0.0 for Render (required for external access)
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
  log('info', `
╔════════════════════════════════════════════════════════════╗
║  🥝  KEA V7 - Interactive Oral Assessments (IOAaaS)        ║
║  📚  Powered by Axiom Intelligence                         ║
╚════════════════════════════════════════════════════════════╝

🌐 Server:   http://localhost:${PORT}
🔌 Relay V4: ws://localhost:${PORT}/relay
🔌 Relay V5: ws://localhost:${PORT}/relay-v5
🔌 Relay V6: ws://localhost:${PORT}/relay-v6

🎤 Demos:
   /v6 - V6 Streaming AEC + Barge-In (NEWEST!) ⚡
   /v5 - V5 Parallel Chunking (Google Chirp) ⭐
   /v4 - V4 Interruptible (OpenAI TTS)

🔑 API Keys:
   - OpenAI: ${OPENAI_API_KEY ? '✅' : '❌'}
   - Groq:   ${GROQ_API_KEY ? '✅' : '❌'}

📡 Endpoints:
   GET  /health     - Health check
   GET  /v7         - V7 Turn-Taking (Primary!)
   GET  /v6         - V6 Streaming AEC (requires OpenAI)
   GET  /v5         - V5 Parallel Chunking (requires OpenAI)
   GET  /v4         - V4 Interruptible Voice (requires OpenAI)
   POST /api/coach  - Text coaching
   WS   /relay-v7   - V7 WebSocket relay (Turn-Taking)
  `);

  // V7 is the primary - always attach it (uses Google + Groq, no OpenAI needed)
  createRelayV7(server, '/relay-v7', coachingContexts);
  console.log('✅ V7 WebSocket relay attached (Turn-Taking / Sensory Gating)');

  // Only attach V4/V5/V6 if OpenAI key is available (they require it)
  if (OPENAI_API_KEY) {
    createRelayV4(server, sessions);
    console.log('✅ V4 WebSocket relay attached');
    
    createRelayV5(server, '/relay-v5');
    console.log('✅ V5 WebSocket relay attached');
    
    createRelayV6(server, '/relay-v6');
    console.log('✅ V6 WebSocket relay attached');
  } else {
    console.log('⚠️ V4/V5/V6 relays skipped (no OPENAI_API_KEY)');
  }
});
