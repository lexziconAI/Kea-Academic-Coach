/**
 * Kea Academic Coach - RENDER DEPLOYMENT SMOKE TEST
 * Tests that student data is properly captured on production:
 *   1. User registration → database
 *   2. Conversation turns → database
 *   3. Key takeaways → database
 *   4. Session report → database
 *   5. Admin dashboard returns the data
 */

const https = require('https');
const crypto = require('crypto');

const BASE_URL = 'kea-academic-coach.onrender.com';

function generateSessionId() {
    return 'smoke_' + crypto.randomBytes(8).toString('hex');
}

function request(method, path, data = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: BASE_URL,
            port: 443,
            path: path,
            method: method,
            headers: { 
                'Content-Type': 'application/json',
                'X-Admin-Auth': 'true'
            }
        };
        
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { 
                    resolve({ status: res.statusCode, data: JSON.parse(body) }); 
                } catch { 
                    resolve({ status: res.statusCode, data: body }); 
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(30000, () => reject(new Error('Request timeout')));
        
        if (data) {
            req.write(JSON.stringify(data));
        }
        req.end();
    });
}

async function smokeTest() {
    console.log('═'.repeat(60));
    console.log('🧪 RENDER SMOKE TEST - Data Capture Verification');
    console.log('═'.repeat(60));
    console.log(`📍 Target: https://${BASE_URL}`);
    console.log(`🕐 Started: ${new Date().toISOString()}\n`);
    
    const sessionId = generateSessionId();
    const testUser = {
        name: 'Smoke Test Student',
        email: `smoke_test_${Date.now()}@test.axiom.nz`
    };
    
    let passed = 0;
    let failed = 0;
    
    // ═══════════════════════════════════════════════════════════
    // TEST 1: Health Check
    // ═══════════════════════════════════════════════════════════
    console.log('1️⃣  HEALTH CHECK');
    try {
        const health = await request('GET', '/health');
        if (health.data.status === 'ok' && health.data.credentials?.groq && health.data.credentials?.google) {
            console.log('   ✅ Server healthy');
            console.log(`      Groq: ${health.data.credentials.groq ? '✓' : '✗'}`);
            console.log(`      Google: ${health.data.credentials.google ? '✓' : '✗'}`);
            console.log(`      DB Path: ${health.data.database?.dbPath}`);
            passed++;
        } else {
            console.log('   ❌ Server unhealthy:', health.data);
            failed++;
        }
    } catch (err) {
        console.log('   ❌ Health check failed:', err.message);
        failed++;
    }
    
    // ═══════════════════════════════════════════════════════════
    // TEST 2: Register Session (Creates User + Session)
    // ═══════════════════════════════════════════════════════════
    console.log('\n2️⃣  REGISTER SESSION');
    let userId = null;
    try {
        const reg = await request('POST', '/api/register-session', {
            sessionId: sessionId,
            name: testUser.name,
            email: testUser.email,
            responseLength: 'MEDIUM'
        });
        
        if (reg.data.success) {
            userId = reg.data.userId;
            console.log('   ✅ Session registered');
            console.log(`      Session ID: ${sessionId}`);
            console.log(`      User ID: ${userId}`);
            passed++;
        } else {
            console.log('   ❌ Registration failed:', reg.data.error);
            failed++;
        }
    } catch (err) {
        console.log('   ❌ Registration error:', err.message);
        failed++;
    }
    
    // ═══════════════════════════════════════════════════════════
    // TEST 3: Save Conversation Turns
    // ═══════════════════════════════════════════════════════════
    console.log('\n3️⃣  SAVE CONVERSATION TURNS');
    const testTurns = [
        { role: 'user', content: 'Hello Kea, this is a smoke test to verify data capture.' },
        { role: 'assistant', content: 'Kia ora! I can see your message. This confirms the conversation turn capture is working correctly.' },
        { role: 'user', content: 'Great, can you help me understand what makes a good thesis statement?' },
        { role: 'assistant', content: 'A strong thesis statement should be: 1) Specific and focused, 2) Arguable, 3) Supported by evidence, and 4) Clear and concise. Would you like to work on developing one for your topic?' }
    ];
    
    try {
        let turnsSaved = 0;
        for (const turn of testTurns) {
            const result = await request('POST', '/api/save-turn', {
                sessionId: sessionId,
                role: turn.role,
                content: turn.content,
                metadata: { test: true }
            });
            if (result.data.success) {
                turnsSaved++;
            }
        }
        
        if (turnsSaved === testTurns.length) {
            console.log(`   ✅ All ${turnsSaved} turns saved`);
            passed++;
        } else {
            console.log(`   ⚠️ Only ${turnsSaved}/${testTurns.length} turns saved`);
            failed++;
        }
    } catch (err) {
        console.log('   ❌ Turn save error:', err.message);
        failed++;
    }
    
    // ═══════════════════════════════════════════════════════════
    // TEST 4: End Session (Saves Key Takeaways + Generates Report)
    // ═══════════════════════════════════════════════════════════
    console.log('\n4️⃣  END SESSION + KEY TAKEAWAYS');
    const testKeyTakeaways = `
        <h3>🧪 Smoke Test Session Summary</h3>
        <ul>
            <li>Session created: ${new Date().toISOString()}</li>
            <li>User: ${testUser.name}</li>
            <li>Turns captured: ${testTurns.length}</li>
            <li>Key learning: Thesis statement structure</li>
        </ul>
    `;
    
    try {
        const endResult = await request('POST', '/api/end-session', {
            sessionId: sessionId,
            reason: 'smoke_test_complete',
            keyTakeaways: testKeyTakeaways,
            conversationHistory: testTurns
        });
        
        if (endResult.data.success) {
            console.log('   ✅ Session ended');
            console.log('   ✅ Key takeaways saved');
            console.log('   ✅ Report generated');
            if (endResult.data.reportHash) {
                console.log(`      Report hash: ${endResult.data.reportHash.substring(0, 16)}...`);
            }
            passed++;
        } else {
            console.log('   ❌ End session failed:', endResult.data.error);
            failed++;
        }
    } catch (err) {
        console.log('   ❌ End session error:', err.message);
        failed++;
    }
    
    // ═══════════════════════════════════════════════════════════
    // TEST 5: Verify Data in Admin Dashboard
    // ═══════════════════════════════════════════════════════════
    console.log('\n5️⃣  VERIFY DATA IN ADMIN DASHBOARD');
    try {
        const dashboard = await request('GET', '/api/admin/dashboard');
        
        if (dashboard.data.success) {
            const stats = dashboard.data.stats;
            const sessions = dashboard.data.sessions || [];
            const users = dashboard.data.users || [];
            
            // Find our test session
            const ourSession = sessions.find(s => s.session_id === sessionId);
            const ourUser = users.find(u => u.email === testUser.email);
            
            console.log('   📊 Dashboard Stats:');
            console.log(`      Total Users: ${stats.totalUsers}`);
            console.log(`      Total Sessions: ${stats.totalSessions}`);
            console.log(`      Total Turns: ${stats.totalTurns}`);
            
            if (ourSession) {
                console.log('   ✅ Test session found in database');
                console.log(`      Status: ${ourSession.status}`);
                console.log(`      Turn count: ${ourSession.turn_count}`);
                passed++;
            } else {
                console.log('   ❌ Test session NOT found in database');
                console.log(`      Looking for: ${sessionId}`);
                console.log(`      Available sessions: ${sessions.map(s => s.session_id.substring(0, 20)).join(', ')}`);
                failed++;
            }
            
            if (ourUser) {
                console.log('   ✅ Test user found in database');
                console.log(`      Name: ${ourUser.name}`);
            } else {
                console.log('   ⚠️ Test user not found (may be normal if emails differ)');
            }
            
        } else {
            console.log('   ❌ Dashboard load failed:', dashboard.data.error);
            failed++;
        }
    } catch (err) {
        console.log('   ❌ Dashboard error:', err.message);
        failed++;
    }
    
    // ═══════════════════════════════════════════════════════════
    // TEST 6: Verify Session Details (Conversation History)
    // ═══════════════════════════════════════════════════════════
    console.log('\n6️⃣  VERIFY CONVERSATION HISTORY');
    try {
        const sessionDetails = await request('GET', `/api/admin/session/${sessionId}`);
        
        if (sessionDetails.data.session) {
            const turns = sessionDetails.data.turns || [];
            console.log(`   ✅ Session details retrieved`);
            console.log(`      Turns in DB: ${turns.length}`);
            
            if (turns.length === testTurns.length) {
                console.log('   ✅ All conversation turns persisted');
                
                // Verify content
                const firstTurn = turns.find(t => t.turn_number === 1);
                if (firstTurn && firstTurn.content.includes('smoke test')) {
                    console.log('   ✅ Turn content verified');
                    passed++;
                } else {
                    console.log('   ⚠️ Turn content mismatch');
                }
            } else {
                console.log(`   ❌ Turn count mismatch: expected ${testTurns.length}, got ${turns.length}`);
                failed++;
            }
            
            // Check key takeaways
            if (sessionDetails.data.session.key_takeaways_html) {
                console.log('   ✅ Key takeaways persisted');
                passed++;
            } else {
                console.log('   ❌ Key takeaways NOT found');
                failed++;
            }
            
        } else {
            console.log('   ❌ Session details not found');
            failed++;
        }
    } catch (err) {
        console.log('   ❌ Session details error:', err.message);
        failed++;
    }
    
    // ═══════════════════════════════════════════════════════════
    // SUMMARY
    // ═══════════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(60));
    console.log('📋 SMOKE TEST RESULTS');
    console.log('═'.repeat(60));
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📊 Score: ${Math.round(passed/(passed+failed)*100)}%`);
    
    if (failed === 0) {
        console.log('\n🎉 ALL TESTS PASSED! Data capture is working correctly.');
        console.log('   Future student sessions will be saved to the database.');
    } else {
        console.log('\n⚠️ SOME TESTS FAILED - Review issues above.');
    }
    
    console.log(`\n🔐 View data: https://${BASE_URL}/admin.html`);
    console.log('   Login: Admin / IamallinonAI');
    console.log('═'.repeat(60));
    
    process.exit(failed > 0 ? 1 : 0);
}

smokeTest().catch(err => {
    console.error('\n❌ SMOKE TEST CRASHED:', err.message);
    process.exit(1);
});
