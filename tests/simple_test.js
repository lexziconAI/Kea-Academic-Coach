/**
 * SIMPLIFIED SMOKE TEST - Test primary report replacement
 */

const http = require('http');

function uploadDocument(sessionId, filename, content) {
    return new Promise((resolve, reject) => {
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        
        let body = `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
        body += `Content-Type: text/plain\r\n\r\n`;
        body += content + '\r\n';
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="sessionId"\r\n\r\n`;
        body += sessionId + '\r\n';
        body += `--${boundary}--\r\n`;
        
        const options = {
            method: 'POST',
            hostname: 'localhost',
            port: 16602,
            path: '/api/upload-assessment',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = http.request(options, (res) => {
            let responseBody = '';
            res.on('data', chunk => responseBody += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(responseBody);
                    resolve({ status: res.statusCode, data });
                } catch (e) {
                    resolve({ status: res.statusCode, data: responseBody });
                }
            });
        });

        req.on('error', (err) => {
            console.error(`HTTP Request Error: ${err.message}`);
            reject(err);
        });
        req.write(body);
        req.end();
    });
}

async function main() {
    console.log('\n🧪 SIMPLE TEST: Primary Report Replacement\n');
    
    try {
        const sessionId = 'test_' + Date.now();
        
        // Upload first report
        console.log('📄 Uploading Report 1 (OldCorp)...');
        const report1 = `OldCorp Sustainability Report 2023

Company Overview: OldCorp is an outdated manufacturing company.

Carbon Emissions: 5000 tons CO2e
Renewable Energy: 10%
`;
        
        const upload1 = await uploadDocument(sessionId, 'oldcorp.txt', report1);
        console.log(`✅ Upload 1 Complete:`);
        console.log(`   Organization: ${upload1.data.organization}`);
        console.log(`   Session: ${sessionId}`);
        
        // Wait 2 seconds
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Upload second report (should REPLACE first)
        console.log('\n📄 Uploading Report 2 (NewCorp) - should REPLACE Report 1...');
        const report2 = `NewCorp Sustainability Report 2024

Company Overview: NewCorp is a modern green technology leader.

Carbon Emissions: 100 tons CO2e  
Renewable Energy: 95%
`;
        
        const upload2 = await uploadDocument(sessionId, 'newcorp.txt', report2);
        console.log(`✅ Upload 2 Complete:`);
        console.log(`   Organization: ${upload2.data.organization}`);
        console.log(`   Session: ${sessionId}`);
        
        // Check contexts via debug endpoint
        console.log('\n🔍 Checking contexts via debug endpoint...');
        const contextReq = http.get('http://localhost:16602/api/debug/contexts', (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                const contexts = JSON.parse(body);
                const sessionContext = contexts.contexts.find(c => c.sessionId === sessionId);
                
                console.log(`\n📊 Context for session ${sessionId}:`);
                console.log(`   Organization: ${sessionContext.organization}`);
                console.log(`   Filename: ${sessionContext.filename}`);
                console.log(`   Preview: ${sessionContext.preview.substring(0, 100)}...`);
                
                if (sessionContext.filename === 'newcorp.txt') {
                    console.log('\n✅ SUCCESS: Primary report was correctly REPLACED!');
                } else {
                    console.log(`\n❌ FAILURE: Expected newcorp.txt, got ${sessionContext.filename}`);
                }
            });
        });
        
        contextReq.on('error', err => {
            console.error('❌ Error fetching contexts:', err.message);
        });
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

main();
