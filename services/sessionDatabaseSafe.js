// ═══════════════════════════════════════════════════════════════════════════════════
// 🗄️ KEA SESSION DATABASE - SQLite Persistence Layer (Safe Wrapper)
// ═══════════════════════════════════════════════════════════════════════════════════
//
// This wrapper ensures the server doesn't crash if SQLite fails to initialize.
// Falls back to in-memory storage if database is unavailable.
//
// ═══════════════════════════════════════════════════════════════════════════════════

let realDb = null;
let dbAvailable = false;

// In-memory fallback storage
const memoryStore = {
    users: [],
    sessions: [],
    turns: [],
    reports: []
};

try {
    realDb = require('./sessionDatabase');
    dbAvailable = true;
    console.log('✅ Database module loaded successfully');
} catch (err) {
    console.error('⚠️ Database initialization failed, using in-memory fallback:', err.message);
    dbAvailable = false;
}

// Helper to generate IDs for in-memory storage
let memoryIdCounter = 1;
const generateId = () => memoryIdCounter++;

// Safe wrapper functions that fall back to memory storage
const safeWrapper = {
    // Check if DB is available
    isAvailable: () => dbAvailable,
    
    // User management
    getOrCreateUser: (email, name) => {
        if (dbAvailable) return realDb.getOrCreateUser(email, name);
        
        let user = memoryStore.users.find(u => u.email === email);
        if (!user) {
            user = { id: generateId(), email, name, created_at: new Date().toISOString() };
            memoryStore.users.push(user);
        }
        return user;
    },
    
    // Session management
    createSession: (sessionId, userId, responseLength) => {
        if (dbAvailable) return realDb.createSession(sessionId, userId, responseLength);
        
        const session = {
            session_id: sessionId,
            user_id: userId,
            response_length: responseLength,
            started_at: new Date().toISOString(),
            status: 'active',
            turn_count: 0
        };
        memoryStore.sessions.push(session);
        return session;
    },
    
    updateSessionAssessment: (sessionId, data) => {
        if (dbAvailable) return realDb.updateSessionAssessment(sessionId, data);
        
        const session = memoryStore.sessions.find(s => s.session_id === sessionId);
        if (session) Object.assign(session, data);
    },
    
    updateSessionActivity: (sessionId) => {
        if (dbAvailable) return realDb.updateSessionActivity(sessionId);
        
        const session = memoryStore.sessions.find(s => s.session_id === sessionId);
        if (session) session.last_activity_at = new Date().toISOString();
    },
    
    updateKeyTakeaways: (sessionId, html) => {
        if (dbAvailable) return realDb.updateKeyTakeaways(sessionId, html);
        
        const session = memoryStore.sessions.find(s => s.session_id === sessionId);
        if (session) {
            session.key_takeaways_html = html;
            session.key_takeaways_updated_at = new Date().toISOString();
        }
    },
    
    endSession: (sessionId, status) => {
        if (dbAvailable) return realDb.endSession(sessionId, status);
        
        const session = memoryStore.sessions.find(s => s.session_id === sessionId);
        if (session) {
            session.status = status || 'completed';
            session.ended_at = new Date().toISOString();
        }
    },
    
    getSession: (sessionId) => {
        if (dbAvailable) return realDb.getSession(sessionId);
        return memoryStore.sessions.find(s => s.session_id === sessionId) || null;
    },
    
    // Response length
    updateResponseLength: (sessionId, length) => {
        if (dbAvailable) return realDb.updateResponseLength(sessionId, length);
        
        const session = memoryStore.sessions.find(s => s.session_id === sessionId);
        if (session) session.response_length = length;
    },
    
    // Conversation
    addConversationTurn: (sessionId, role, content, metadata = {}) => {
        if (dbAvailable) return realDb.addConversationTurn(sessionId, role, content, metadata);
        
        const turnNumber = memoryStore.turns.filter(t => t.session_id === sessionId).length + 1;
        const turn = {
            id: generateId(),
            session_id: sessionId,
            turn_number: turnNumber,
            role,
            content,
            timestamp: new Date().toISOString(),
            ...metadata
        };
        memoryStore.turns.push(turn);
        
        // Update session turn count
        const session = memoryStore.sessions.find(s => s.session_id === sessionId);
        if (session) session.turn_count = turnNumber;
        
        return turnNumber;
    },
    
    getConversationHistory: (sessionId) => {
        if (dbAvailable) return realDb.getConversationHistory(sessionId);
        return memoryStore.turns.filter(t => t.session_id === sessionId);
    },
    
    // Reports
    generateSessionReport: (sessionId) => {
        if (dbAvailable) return realDb.generateSessionReport(sessionId);
        
        const session = memoryStore.sessions.find(s => s.session_id === sessionId);
        const turns = memoryStore.turns.filter(t => t.session_id === sessionId);
        const user = session ? memoryStore.users.find(u => u.id === session.user_id) : null;
        
        const reportData = { session, turns, user, generatedAt: new Date().toISOString() };
        const reportJson = JSON.stringify(reportData);
        const reportHash = require('crypto').createHash('sha256').update(reportJson).digest('hex');
        
        const report = {
            id: generateId(),
            session_id: sessionId,
            report_json: reportJson,
            report_hash: reportHash,
            generated_at: new Date().toISOString()
        };
        memoryStore.reports.push(report);
        
        return { hash: reportHash, data: reportData };
    },
    
    getLatestReport: (sessionId) => {
        if (dbAvailable) return realDb.getLatestReport(sessionId);
        const reports = memoryStore.reports.filter(r => r.session_id === sessionId);
        return reports[reports.length - 1] || null;
    },
    
    getReportById: (id) => {
        if (dbAvailable) return realDb.getReportById(id);
        return memoryStore.reports.find(r => r.id === id) || null;
    },
    
    getAllReports: () => {
        if (dbAvailable) return realDb.getAllReports();
        return memoryStore.reports;
    },
    
    // Cleanup
    findAndCloseInactiveSessions: () => {
        if (dbAvailable) return realDb.findAndCloseInactiveSessions();
        // In-memory: just log
        console.log('[Memory] Would close inactive sessions');
    },
    
    // User sessions
    getUserSessions: (userId) => {
        if (dbAvailable) return realDb.getUserSessions(userId);
        return memoryStore.sessions.filter(s => s.user_id === userId);
    },
    
    // Admin functions
    getAllSessions: () => {
        if (dbAvailable) return realDb.getAllSessions();
        return memoryStore.sessions;
    },
    
    getAllUsers: () => {
        if (dbAvailable) return realDb.getAllUsers();
        return memoryStore.users;
    },
    
    getSessionDetails: (sessionId) => {
        if (dbAvailable) return realDb.getSessionDetails(sessionId);
        
        const session = memoryStore.sessions.find(s => s.session_id === sessionId);
        if (!session) return null;
        
        const user = memoryStore.users.find(u => u.id === session.user_id);
        const turns = memoryStore.turns.filter(t => t.session_id === sessionId);
        const report = memoryStore.reports.find(r => r.session_id === sessionId);
        
        return { ...session, user, turns, report };
    },
    
    deleteSession: (sessionId) => {
        if (dbAvailable) return realDb.deleteSession(sessionId);
        
        memoryStore.sessions = memoryStore.sessions.filter(s => s.session_id !== sessionId);
        memoryStore.turns = memoryStore.turns.filter(t => t.session_id !== sessionId);
        memoryStore.reports = memoryStore.reports.filter(r => r.session_id !== sessionId);
        return true;
    },
    
    exportAllData: () => {
        if (dbAvailable) return realDb.exportAllData();
        return memoryStore;
    }
};

module.exports = safeWrapper;
