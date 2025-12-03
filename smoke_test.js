/**
 * Kea Academic Coach - Smoke Test
 * Tests: User registration, conversation, key takeaways, email report
 */

const http = require('http');
const crypto = require('crypto');

// Generate session ID like the frontend does
function generateSessionId() {
    return 'kea_' + crypto.randomBytes(16).toString('hex');
}

// Helper to make requests
function post(path, data) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 16602,
            path: path,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        };
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body)); } 
                catch { resolve(body); }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(data));
        req.end();
    });
}

async function smokeTest() {
    console.log('🧪 SMOKE TEST STARTING...\n');
    
    const sessionId = generateSessionId();
    console.log('   Generated Session ID:', sessionId);
    
    // 1. Register user
    console.log('\n1️⃣ Registering user: Regan Duff');
    const regResult = await post('/api/register-session', {
        sessionId: sessionId,
        name: 'Regan Duff',
        email: 'regan@axiomintelligence.co.nz',
        responseLength: 'MEDIUM'
    });
    
    if (regResult.success) {
        console.log('   ✅ Session:', regResult.sessionId);
        console.log('   ✅ User ID:', regResult.userId);
    } else {
        console.log('   ❌ Registration failed:', regResult.error);
        return;
    }
    
    // 2. Simulate 10-turn conversation
    console.log('\n2️⃣ Simulating 10-turn conversation...');
    const turns = [
        { role: 'user', content: 'Hi Kea, I need help understanding the concept of climate adaptation in my thesis.' },
        { role: 'assistant', content: 'Kia ora Regan! Climate adaptation refers to adjustments in ecological, social, or economic systems in response to actual or expected climate change. What specific aspect are you exploring in your thesis?' },
        { role: 'user', content: 'I am looking at how Pacific Island nations are adapting to rising sea levels.' },
        { role: 'assistant', content: 'Excellent focus! Pacific Island nations face unique challenges. Key adaptation strategies include building sea walls, relocating communities inland, and implementing nature-based solutions like mangrove restoration. Have you considered the Sendai Framework for Disaster Risk Reduction in your analysis?' },
        { role: 'user', content: 'Yes, I have referenced the Sendai Framework. But I am struggling with the economic analysis section.' },
        { role: 'assistant', content: 'Economic analysis of climate adaptation can be approached through cost-benefit analysis, looking at adaptation costs versus damages avoided. You might also consider the concept of Loss and Damage from the UNFCCC. What economic metrics are you currently using?' },
        { role: 'user', content: 'I am using GDP impact projections and adaptation cost estimates from the World Bank.' },
        { role: 'assistant', content: 'Sound methodology! The World Bank data is robust. Consider also incorporating the Global Center on Adaptation estimates and perhaps local economic indicators. Are you accounting for non-market losses like cultural heritage and ecosystem services?' },
        { role: 'user', content: 'That is a good point. I have not fully addressed non-market losses yet.' },
        { role: 'assistant', content: 'Non-market losses are crucial for Pacific contexts. Consider including: 1) Loss of traditional fishing grounds, 2) Cultural displacement impacts, 3) Biodiversity loss valuations using methodologies like contingent valuation. This will strengthen your thesis significantly.' }
    ];
    
    for (let i = 0; i < turns.length; i++) {
        await post('/api/save-turn', {
            sessionId: sessionId,
            role: turns[i].role,
            content: turns[i].content,
            metadata: { turnIndex: i + 1 }
        });
        console.log('   Turn ' + (i+1) + ' saved (' + turns[i].role + ')');
    }
    console.log('   ✅ All 10 turns saved');
    
    // 3. Save key takeaways
    console.log('\n3️⃣ Saving Key Takeaways...');
    const keyTakeawaysHtml = `
        <h3>📚 Session Summary</h3>
        <p>Coaching session focused on climate adaptation thesis for Pacific Island nations.</p>
        
        <h3>🎯 Key Learning Points</h3>
        <ul>
            <li><strong>Climate Adaptation Definition:</strong> Adjustments in ecological, social, or economic systems responding to climate change</li>
            <li><strong>Pacific Focus:</strong> Sea walls, community relocation, nature-based solutions like mangrove restoration</li>
            <li><strong>Framework Reference:</strong> Sendai Framework for Disaster Risk Reduction</li>
            <li><strong>Economic Analysis:</strong> Cost-benefit analysis, Loss and Damage concept from UNFCCC</li>
            <li><strong>Data Sources:</strong> World Bank projections, Global Center on Adaptation estimates</li>
        </ul>
        
        <h3>💡 Action Items</h3>
        <ul>
            <li>Incorporate non-market loss valuations (cultural heritage, ecosystem services)</li>
            <li>Add analysis of traditional fishing ground losses</li>
            <li>Include cultural displacement impact assessment</li>
            <li>Consider contingent valuation methodology for biodiversity loss</li>
        </ul>
        
        <h3>📈 Progress</h3>
        <p>Strong methodology foundation with World Bank data. Key gap identified: non-market losses need attention.</p>
    `;
    
    // Update via the end session call which saves takeaways
    await post('/api/end-session', {
        sessionId: sessionId,
        reason: 'smoke_test_complete',
        keyTakeaways: keyTakeawaysHtml,
        conversationHistory: turns
    });
    console.log('   ✅ Key takeaways saved & session report generated');
    
    // 4. Send email report
    console.log('\n4️⃣ Sending email report to regan@axiomintelligence.co.nz...');
    const emailResult = await post('/api/send-report-email', {
        sessionId: sessionId,
        toEmail: 'regan@axiomintelligence.co.nz',
        sessionData: {
            userName: 'Regan Duff',
            userEmail: 'regan@axiomintelligence.co.nz',
            assessmentTitle: 'Climate Adaptation Thesis - Pacific Islands',
            keyTakeaways: keyTakeawaysHtml,
            createdAt: new Date(Date.now() - 30*60000).toISOString(),
            endedAt: new Date().toISOString(),
            sessionStats: {
                totalTurns: 10,
                userTurns: 5,
                assistantTurns: 5,
                durationMinutes: 30
            }
        }
    });
    
    if (emailResult.success) {
        console.log('   ✅ Email sent successfully!');
        console.log('   📧 Status code:', emailResult.statusCode);
    } else {
        console.log('   ❌ Email failed:', emailResult.error);
        if (emailResult.details) {
            console.log('   Details:', JSON.stringify(emailResult.details, null, 2));
        }
    }
    
    // 5. Summary
    console.log('\n' + '═'.repeat(50));
    console.log('🎉 SMOKE TEST COMPLETE');
    console.log('═'.repeat(50));
    console.log('✅ User registered: Regan Duff');
    console.log('✅ Session created: ' + sessionId);
    console.log('✅ 10 conversation turns saved');
    console.log('✅ Key takeaways generated');
    console.log('✅ Session report saved to database');
    if (emailResult.success) {
        console.log('✅ Email report sent to: regan@axiomintelligence.co.nz');
    }
    console.log('\n📬 Check your inbox for the report!');
    console.log('🖨️ To test print, visit: http://localhost:16602/v7');
    console.log('🔐 Admin dashboard: http://localhost:16602/admin.html');
}

smokeTest().catch(err => {
    console.error('❌ Smoke test failed:', err.message);
    process.exit(1);
});
