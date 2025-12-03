const Database = require('better-sqlite3');
const db = new Database('./data/kea_sessions.db');

console.log('=== TABLE SCHEMA ===');
const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all();
tables.forEach(t => {
    console.log('\n' + t.name + ':');
    console.log(t.sql);
});

console.log('\n\n=== USERS ===');
const users = db.prepare('SELECT * FROM users').all();
console.table(users);

console.log('\n=== SESSIONS ===');
const sessions = db.prepare('SELECT * FROM sessions LIMIT 10').all();
sessions.forEach(s => console.log(s));

console.log('\n=== CONVERSATION TURNS ===');
const turns = db.prepare('SELECT session_id, COUNT(*) as turn_count FROM conversation_turns GROUP BY session_id').all();
console.table(turns);

db.close();
