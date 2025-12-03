/**
 * Quick script to check session_reports table
 */

const sessionDb = require('./services/sessionDatabase');

console.log('\n📊 CHECKING SESSION_REPORTS TABLE...\n');

// Get all reports using our new function
const reports = sessionDb.getAllReports();

console.log(`Found ${reports.length} reports:\n`);

reports.forEach(r => {
    console.log(`  Report ID: ${r.id}`);
    console.log(`  Session: ${r.session_id}`);
    console.log(`  Generated: ${r.generated_at}`);
    console.log(`  Hash: ${r.report_hash.substring(0, 16)}...`);
    console.log('');
});

// Also check sessions
const sessions = sessionDb.getAllSessions();
console.log(`\nFound ${sessions.length} sessions:`);
sessions.forEach(s => {
    console.log(`  ${s.session_id} - ${s.user_name} - ${s.status}`);
});

console.log('\n✅ Check complete\n');
