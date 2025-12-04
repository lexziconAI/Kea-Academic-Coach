// ═══════════════════════════════════════════════════════════════════════════════════
// 🗄️ KEA SESSION DATABASE - SQLite Persistence Layer
// ═══════════════════════════════════════════════════════════════════════════════════
//
// Captures and persists:
//   - User registration (name, email)
//   - Initial assessment parse (full JSON)
//   - All conversation turns
//   - Session metadata (timing, response length preference)
//   - Final report generation
//
// Auto-save triggers:
//   - Window close (beforeunload beacon)
//   - WebSocket disconnect
//   - Inactivity timeout (5 minutes)
//
// ═══════════════════════════════════════════════════════════════════════════════════

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Database file path - use Render disk mount in production, local data folder in dev
const isProduction = process.env.NODE_ENV === 'production';
const RENDER_DISK_PATH = '/opt/render/project/src/uploads';

// Check if Render disk is available
const useRenderDisk = isProduction && fs.existsSync(RENDER_DISK_PATH);
const DB_PATH = useRenderDisk 
    ? path.join(RENDER_DISK_PATH, 'kea_sessions.db')
    : path.join(__dirname, '..', 'data', 'kea_sessions.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize database
const db = new Database(DB_PATH);
console.log(`📦 SQLite database initialized at: ${DB_PATH} (${useRenderDisk ? 'Render persistent disk' : 'local'})`);

// Create tables
db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_session_at DATETIME
    );
    
    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT UNIQUE NOT NULL,
        user_id INTEGER,
        
        -- Session metadata
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        last_activity_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        status TEXT DEFAULT 'active',  -- active, completed, abandoned, timeout
        response_length TEXT DEFAULT 'MEDIUM',
        
        -- Assessment data
        organisation_name TEXT,
        document_filename TEXT,
        document_word_count INTEGER,
        initial_parse_json TEXT,  -- Full JSON of system analysis
        coaching_context TEXT,    -- Generated coaching context
        
        -- Summary
        key_takeaways_html TEXT,
        key_takeaways_updated_at DATETIME,
        
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    
    -- Conversation turns table
    CREATE TABLE IF NOT EXISTS conversation_turns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        role TEXT NOT NULL,  -- 'user' or 'assistant'
        content TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        
        -- Audio metadata (optional)
        audio_duration_ms INTEGER,
        latency_ms INTEGER,
        
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
    
    -- Session reports table (final exports)
    CREATE TABLE IF NOT EXISTS session_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        report_json TEXT NOT NULL,  -- Full session export
        report_hash TEXT NOT NULL,   -- SHA-256 for integrity
        
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
    );
    
    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_turns_session ON conversation_turns(session_id);
`);

// Migration: Add archived column if it doesn't exist
try {
    db.exec(`ALTER TABLE sessions ADD COLUMN archived INTEGER DEFAULT 0`);
    console.log('✅ Added archived column to sessions table');
} catch (e) {
    // Column already exists, ignore error
    if (!e.message.includes('duplicate column')) {
        console.log('ℹ️ Archived column already exists');
    }
}

console.log('✅ Database tables created/verified');

// ═══════════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════════

const userStatements = {
    findByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    create: db.prepare('INSERT INTO users (email, name) VALUES (?, ?)'),
    updateLastSession: db.prepare('UPDATE users SET last_session_at = CURRENT_TIMESTAMP WHERE id = ?')
};

function getOrCreateUser(email, name) {
    let user = userStatements.findByEmail.get(email);
    
    if (!user) {
        const result = userStatements.create.run(email, name);
        user = { id: result.lastInsertRowid, email, name };
        console.log(`👤 New user created: ${name} (${email})`);
    } else {
        userStatements.updateLastSession.run(user.id);
        console.log(`👤 Returning user: ${user.name} (${email})`);
    }
    
    return user;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════════

const sessionStatements = {
    create: db.prepare(`
        INSERT INTO sessions (session_id, user_id, response_length) 
        VALUES (?, ?, ?)
    `),
    
    updateAssessment: db.prepare(`
        UPDATE sessions SET 
            organisation_name = ?,
            document_filename = ?,
            document_word_count = ?,
            initial_parse_json = ?,
            coaching_context = ?,
            last_activity_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
    `),
    
    updateActivity: db.prepare(`
        UPDATE sessions SET last_activity_at = CURRENT_TIMESTAMP WHERE session_id = ?
    `),
    
    updateStatus: db.prepare(`
        UPDATE sessions SET status = ?, ended_at = CURRENT_TIMESTAMP WHERE session_id = ?
    `),
    
    updateKeyTakeaways: db.prepare(`
        UPDATE sessions SET 
            key_takeaways_html = ?,
            key_takeaways_updated_at = CURRENT_TIMESTAMP
        WHERE session_id = ?
    `),
    
    updateResponseLength: db.prepare(`
        UPDATE sessions SET response_length = ? WHERE session_id = ?
    `),
    
    get: db.prepare(`
        SELECT s.*, u.name as user_name, u.email as user_email 
        FROM sessions s 
        LEFT JOIN users u ON s.user_id = u.id 
        WHERE s.session_id = ?
    `),
    
    getActive: db.prepare(`
        SELECT * FROM sessions WHERE status = 'active' 
        AND last_activity_at < datetime('now', '-5 minutes')
    `),
    
    getByUser: db.prepare(`
        SELECT * FROM sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 20
    `),
    
    archive: db.prepare(`UPDATE sessions SET archived = 1 WHERE session_id = ?`),
    unarchive: db.prepare(`UPDATE sessions SET archived = 0 WHERE session_id = ?`),
    getArchived: db.prepare(`SELECT * FROM sessions WHERE archived = 1 ORDER BY started_at DESC`)
};

function createSession(sessionId, userId, responseLength = 'MEDIUM') {
    try {
        sessionStatements.create.run(sessionId, userId, responseLength);
        console.log(`📝 Session created: ${sessionId}`);
        return true;
    } catch (err) {
        console.error('Failed to create session:', err.message);
        return false;
    }
}

function updateSessionAssessment(sessionId, data) {
    sessionStatements.updateAssessment.run(
        data.organisationName || null,
        data.filename || null,
        data.wordCount || 0,
        JSON.stringify(data.initialParse || {}),
        data.coachingContext || null,
        sessionId
    );
    console.log(`📊 Session assessment saved: ${sessionId}`);
}

function updateSessionActivity(sessionId) {
    sessionStatements.updateActivity.run(sessionId);
}

function endSession(sessionId, status = 'completed') {
    sessionStatements.updateStatus.run(status, sessionId);
    console.log(`🏁 Session ended: ${sessionId} (${status})`);
}

function updateKeyTakeaways(sessionId, html) {
    sessionStatements.updateKeyTakeaways.run(html, sessionId);
}

function getSession(sessionId) {
    return sessionStatements.get.get(sessionId);
}

// ═══════════════════════════════════════════════════════════════════════════════════
// CONVERSATION TRACKING
// ═══════════════════════════════════════════════════════════════════════════════════

const turnStatements = {
    add: db.prepare(`
        INSERT INTO conversation_turns (session_id, turn_number, role, content, audio_duration_ms, latency_ms)
        VALUES (?, ?, ?, ?, ?, ?)
    `),
    
    getBySession: db.prepare(`
        SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY turn_number ASC
    `),
    
    getCount: db.prepare(`
        SELECT COUNT(*) as count FROM conversation_turns WHERE session_id = ?
    `)
};

function addConversationTurn(sessionId, role, content, metadata = {}) {
    const countResult = turnStatements.getCount.get(sessionId);
    const turnNumber = (countResult?.count || 0) + 1;
    
    turnStatements.add.run(
        sessionId,
        turnNumber,
        role,
        content,
        metadata.audioDurationMs || null,
        metadata.latencyMs || null
    );
    
    // Also update session activity
    updateSessionActivity(sessionId);
    
    return turnNumber;
}

function getConversationHistory(sessionId) {
    return turnStatements.getBySession.all(sessionId);
}

// ═══════════════════════════════════════════════════════════════════════════════════
// REPORT GENERATION
// ═══════════════════════════════════════════════════════════════════════════════════

const reportStatements = {
    create: db.prepare(`
        INSERT INTO session_reports (session_id, report_json, report_hash)
        VALUES (?, ?, ?)
    `),
    
    getBySession: db.prepare(`
        SELECT * FROM session_reports WHERE session_id = ? ORDER BY generated_at DESC LIMIT 1
    `),
    
    getById: db.prepare(`
        SELECT * FROM session_reports WHERE id = ?
    `),
    
    getAll: db.prepare(`
        SELECT id, session_id, generated_at, report_hash FROM session_reports ORDER BY generated_at DESC
    `)
};

function generateSessionReport(sessionId) {
    const session = getSession(sessionId);
    if (!session) {
        console.error(`Session not found: ${sessionId}`);
        return null;
    }
    
    const turns = getConversationHistory(sessionId);
    
    // Build comprehensive report
    const report = {
        metadata: {
            reportId: crypto.randomUUID(),
            generatedAt: new Date().toISOString(),
            sessionId: sessionId,
            version: '1.0'
        },
        
        user: session.user_id ? {
            id: session.user_id
            // Note: Don't include email in report for privacy
        } : null,
        
        session: {
            startedAt: session.started_at,
            endedAt: session.ended_at || new Date().toISOString(),
            status: session.status,
            responseLength: session.response_length,
            organisation: session.organisation_name,
            documentFilename: session.document_filename,
            wordCount: session.document_word_count
        },
        
        initialAnalysis: session.initial_parse_json ? 
            JSON.parse(session.initial_parse_json) : null,
        
        coachingContext: session.coaching_context,
        
        conversation: turns.map(t => ({
            turn: t.turn_number,
            role: t.role,
            content: t.content,
            timestamp: t.timestamp,
            audioDurationMs: t.audio_duration_ms,
            latencyMs: t.latency_ms
        })),
        
        keyTakeaways: {
            html: session.key_takeaways_html,
            updatedAt: session.key_takeaways_updated_at
        },
        
        statistics: {
            totalTurns: turns.length,
            userTurns: turns.filter(t => t.role === 'user').length,
            assistantTurns: turns.filter(t => t.role === 'assistant').length,
            totalUserWords: turns
                .filter(t => t.role === 'user')
                .reduce((sum, t) => sum + (t.content?.split(/\s+/).length || 0), 0),
            totalAssistantWords: turns
                .filter(t => t.role === 'assistant')
                .reduce((sum, t) => sum + (t.content?.split(/\s+/).length || 0), 0),
            averageLatencyMs: turns.filter(t => t.latency_ms)
                .reduce((sum, t, _, arr) => sum + t.latency_ms / arr.length, 0) || null
        }
    };
    
    // Calculate hash for integrity
    const reportJson = JSON.stringify(report);
    const reportHash = crypto.createHash('sha256').update(reportJson).digest('hex');
    
    // Store report
    reportStatements.create.run(sessionId, reportJson, reportHash);
    
    console.log(`📋 Session report generated: ${sessionId} (${reportHash.substring(0, 8)}...)`);
    
    return { report, hash: reportHash };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// ADMIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════════

// Get all sessions (for admin dashboard) - excludes archived by default
function getAllSessions(includeArchived = false) {
    const archivedFilter = includeArchived ? '' : 'WHERE (s.archived = 0 OR s.archived IS NULL)';
    return db.prepare(`
        SELECT 
            s.*,
            u.name as user_name,
            u.email as user_email,
            (SELECT COUNT(*) FROM conversation_turns WHERE session_id = s.session_id) as turn_count
        FROM sessions s
        LEFT JOIN users u ON s.user_id = u.id
        ${archivedFilter}
        ORDER BY s.started_at DESC
    `).all();
}

// Get archived sessions only
function getArchivedSessions() {
    return db.prepare(`
        SELECT 
            s.*,
            u.name as user_name,
            u.email as user_email,
            (SELECT COUNT(*) FROM conversation_turns WHERE session_id = s.session_id) as turn_count
        FROM sessions s
        LEFT JOIN users u ON s.user_id = u.id
        WHERE s.archived = 1
        ORDER BY s.started_at DESC
    `).all();
}

// Archive a session (hide from main view but keep data)
function archiveSession(sessionId) {
    try {
        sessionStatements.archive.run(sessionId);
        console.log(`📦 Session archived: ${sessionId}`);
        return true;
    } catch (err) {
        console.error('Failed to archive session:', err.message);
        return false;
    }
}

// Unarchive a session (restore to main view)
function unarchiveSession(sessionId) {
    try {
        sessionStatements.unarchive.run(sessionId);
        console.log(`📤 Session unarchived: ${sessionId}`);
        return true;
    } catch (err) {
        console.error('Failed to unarchive session:', err.message);
        return false;
    }
}

// Get all users (for admin dashboard)
function getAllUsers() {
    return db.prepare(`
        SELECT 
            u.*,
            (SELECT COUNT(*) FROM sessions WHERE user_id = u.id) as session_count,
            (SELECT MAX(started_at) FROM sessions WHERE user_id = u.id) as last_session
        FROM users u
        ORDER BY u.created_at DESC
    `).all();
}

// Get full session details including all turns
function getSessionDetails(sessionId) {
    const session = getSession(sessionId);
    if (!session) return null;
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
    const turns = getConversationHistory(sessionId);
    const report = reportStatements.getBySession.get(sessionId);
    
    return {
        ...session,
        user,
        turns,
        report: report ? {
            data: JSON.parse(report.report_json),
            hash: report.report_hash,
            generatedAt: report.generated_at
        } : null
    };
}

// Delete a session and all related data
function deleteSession(sessionId) {
    const session = getSession(sessionId);
    if (!session) return false;
    
    db.transaction(() => {
        db.prepare('DELETE FROM session_reports WHERE session_id = ?').run(sessionId);
        db.prepare('DELETE FROM conversation_turns WHERE session_id = ?').run(sessionId);
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
    })();
    
    console.log(`🗑️ Session deleted: ${sessionId}`);
    return true;
}

// Export all data for backup
function exportAllData() {
    const users = getAllUsers();
    const sessions = getAllSessions();
    
    const fullSessions = sessions.map(s => getSessionDetails(s.session_id));
    
    return {
        exportedAt: new Date().toISOString(),
        version: '1.0',
        users,
        sessions: fullSessions
    };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// TIMEOUT DETECTION & CLEANUP
// ═══════════════════════════════════════════════════════════════════════════════════

function findAndCloseInactiveSessions() {
    const inactiveSessions = sessionStatements.getActive.all();
    
    for (const session of inactiveSessions) {
        console.log(`⏰ Timeout detected for session: ${session.session_id}`);
        
        // Generate final report before closing
        generateSessionReport(session.session_id);
        
        // Mark as timeout
        endSession(session.session_id, 'timeout');
    }
    
    return inactiveSessions.length;
}

// Run cleanup every minute
setInterval(() => {
    const closed = findAndCloseInactiveSessions();
    if (closed > 0) {
        console.log(`🧹 Cleaned up ${closed} inactive sessions`);
    }
}, 60000);

// ═══════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Database instance (for advanced queries)
    db,
    
    // User management
    getOrCreateUser,
    
    // Session management
    createSession,
    updateSessionAssessment,
    updateSessionActivity,
    updateKeyTakeaways,
    endSession,
    getSession,
    
    // Response length
    updateResponseLength: (sessionId, length) => {
        sessionStatements.updateResponseLength.run(length, sessionId);
    },
    
    // Conversation
    addConversationTurn,
    getConversationHistory,
    
    // Reports
    generateSessionReport,
    getLatestReport: (sessionId) => reportStatements.getBySession.get(sessionId),
    getReportById: (id) => reportStatements.getById.get(id),
    getAllReports: () => reportStatements.getAll.all(),
    
    // Cleanup
    findAndCloseInactiveSessions,
    
    // User sessions
    getUserSessions: (userId) => sessionStatements.getByUser.all(userId),
    
    // Admin functions
    getAllSessions,
    getAllUsers,
    getSessionDetails,
    deleteSession,
    exportAllData,
    
    // Archive functions
    archiveSession,
    unarchiveSession,
    getArchivedSessions
};
