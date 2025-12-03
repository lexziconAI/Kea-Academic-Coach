/**
 * KEA ACADEMIC COACH - COMPREHENSIVE SMOKE TESTS
 * 
 * Tests multi-document upload isolation and context management
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:16602';
const TEST_RESULTS = [];

// ANSI colors
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function makeRequest(method, path, data = null, contentType = 'application/json') {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            headers: contentType ? { 'Content-Type': contentType } : {}
        };

        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve({ status: res.statusCode, data: json });
                } catch {
                    resolve({ status: res.statusCode, data: body });
                }
            });
        });

        req.on('error', reject);
        if (data) req.write(typeof data === 'string' ? data : JSON.stringify(data));
        req.end();
    });
}

function createMultipartData(filename, content, sessionId, description = '') {
    const boundary = '----FormBoundary' + Math.random().toString(36);
    let body = '';
    
    // File part
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
    body += `Content-Type: text/plain\r\n\r\n`;
    body += content + '\r\n';
    
    // SessionId part
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="sessionId"\r\n\r\n`;
    body += sessionId + '\r\n';
    
    // Description part (if provided)
    if (description) {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="description"\r\n\r\n`;
        body += description + '\r\n';
    }
    
    body += `--${boundary}--\r\n`;
    
    return { body, boundary };
}

async function uploadDocument(sessionId, filename, content, description = '', endpoint = '/api/upload-assessment') {
    const { body, boundary } = createMultipartData(filename, content, sessionId, description);
    
    return new Promise((resolve, reject) => {
        const options = {
            method: 'POST',
            hostname: 'localhost',
            port: 16602,
            path: endpoint,
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
                    resolve({ status: res.statusCode, data: JSON.parse(responseBody) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: responseBody });
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

async function test1_HealthCheck() {
    log('\n📋 TEST 1: Health Check', 'cyan');
    try {
        const res = await makeRequest('GET', '/health');
        log(`  Response: ${JSON.stringify(res)}`, 'yellow');
        if (res.status === 200 && res.data.status === 'ok') {
            log('✅ PASS: Server is healthy', 'green');
            TEST_RESULTS.push({ name: 'Health Check', status: 'PASS' });
            return true;
        }
        throw new Error(`Health check failed: ${JSON.stringify(res.data)}`);
    } catch (error) {
        log(`❌ FAIL: ${error.message}`, 'red');
        log(`  Stack: ${error.stack}`, 'red');
        TEST_RESULTS.push({ name: 'Health Check', status: 'FAIL', error: error.message });
        return false;
    }
}

async function test2_SessionIsolation() {
    log('\n📋 TEST 2: Session Isolation (Different Sessions)', 'cyan');
    try {
        const session1 = 'session_test_' + Date.now() + '_1';
        const session2 = 'session_test_' + Date.now() + '_2';
        
        // Upload doc to session 1 - More realistic sustainability report format
        const report1 = `TechCorp Sustainability Report 2024
        
Company Overview: TechCorp is a technology company committed to reducing our environmental impact.

Carbon Emissions:
- Scope 1: 500 tons CO2e
- Scope 2: 500 tons CO2e  
- Total: 1000 tons CO2e

Our goal is to reduce emissions by 50% by 2030 through renewable energy adoption and efficiency improvements.`;
        const upload1 = await uploadDocument(session1, 'techcorp_report.txt', report1);
        
        if (!upload1.data.success) throw new Error('Upload 1 failed');
        log(`  Session 1: Uploaded TechCorp (${upload1.data.organization})`, 'yellow');
        
        // Upload doc to session 2 - Different organization
        const report2 = `GreenEnergy Inc Sustainability Report 2024

Company Overview: GreenEnergy Inc is a renewable energy provider leading the transition to clean power.

Renewable Energy:
- Solar: 60% of portfolio
- Wind: 35% of portfolio
- Total Renewable: 95%

We are committed to 100% renewable energy by 2025.`;
        const upload2 = await uploadDocument(session2, 'greenenergy_report.txt', report2);
        
        if (!upload2.data.success) throw new Error('Upload 2 failed');
        log(`  Session 2: Uploaded GreenEnergy Inc (${upload2.data.organization})`, 'yellow');
        
        // Check contexts are different
        const contexts = await makeRequest('GET', '/api/debug/contexts');
        const session1Context = contexts.data.contexts.find(c => c.sessionId === session1);
        const session2Context = contexts.data.contexts.find(c => c.sessionId === session2);
        
        if (!session1Context || !session2Context) {
            throw new Error('Contexts not found in cache');
        }
        
        if (session1Context.organization === session2Context.organization) {
            throw new Error('Organizations should be different but are the same!');
        }
        
        log('✅ PASS: Sessions are properly isolated', 'green');
        TEST_RESULTS.push({ name: 'Session Isolation', status: 'PASS' });
        return true;
    } catch (error) {
        log(`❌ FAIL: ${error.message}`, 'red');
        TEST_RESULTS.push({ name: 'Session Isolation', status: 'FAIL', error: error.message });
        return false;
    }
}

async function test3_PrimaryReportReplacement() {
    log('\n📋 TEST 3: Primary Report Replacement (Same Session)', 'cyan');
    try {
        const sessionId = 'session_test_' + Date.now() + '_replace';
        
        // Upload first report
        const report1 = `Organization: OldCorp\nThis is the old report that should be replaced`;
        const upload1 = await uploadDocument(sessionId, 'oldcorp.txt', report1);
        if (!upload1.data.success) throw new Error('Upload 1 failed');
        log(`  First upload: OldCorp (${upload1.data.organization})`, 'yellow');
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Upload second report to SAME session - should REPLACE
        const report2 = `Organization: NewCorp\nThis is the NEW report that replaces the old one`;
        const upload2 = await uploadDocument(sessionId, 'newcorp.txt', report2);
        if (!upload2.data.success) throw new Error('Upload 2 failed');
        log(`  Second upload: NewCorp (${upload2.data.organization})`, 'yellow');
        
        // Check context - should only have NewCorp
        const contexts = await makeRequest('GET', '/api/debug/contexts');
        const sessionContext = contexts.data.contexts.find(c => c.sessionId === sessionId);
        
        if (!sessionContext) throw new Error('Session context not found');
        
        if (sessionContext.organization !== 'NewCorp') {
            throw new Error(`Expected NewCorp, got ${sessionContext.organization}`);
        }
        
        if (sessionContext.preview.includes('OldCorp')) {
            throw new Error('Old context still present - not replaced!');
        }
        
        log('✅ PASS: Primary report correctly replaced', 'green');
        TEST_RESULTS.push({ name: 'Primary Report Replacement', status: 'PASS' });
        return true;
    } catch (error) {
        log(`❌ FAIL: ${error.message}`, 'red');
        TEST_RESULTS.push({ name: 'Primary Report Replacement', status: 'FAIL', error: error.message });
        return false;
    }
}

async function test4_AdditionalDocuments() {
    log('\n📋 TEST 4: Additional Documents (Multi-Document Session)', 'cyan');
    try {
        const sessionId = 'session_test_' + Date.now() + '_multi';
        
        // Upload primary report
        const primaryReport = `Organization: EcoTech\nPrimary sustainability report`;
        const upload1 = await uploadDocument(sessionId, 'ecotech_primary.txt', primaryReport);
        if (!upload1.data.success) throw new Error('Primary upload failed');
        log(`  Primary: EcoTech uploaded`, 'yellow');
        
        // Upload additional document 1
        const academicPaper1 = `Academic Paper: Climate Change Impacts\nBy Dr. Smith, 2024`;
        const upload2 = await uploadDocument(
            sessionId, 
            'climate_paper.txt', 
            academicPaper1,
            'Focus on methodology gaps',
            '/api/upload-during-session'
        );
        if (!upload2.data.success) throw new Error('Additional doc 1 failed');
        log(`  Additional doc 1: Climate paper (${upload2.data.totalDocuments} total)`, 'yellow');
        
        // Upload additional document 2
        const academicPaper2 = `Academic Paper: Renewable Energy Solutions\nBy Dr. Jones, 2024`;
        const upload3 = await uploadDocument(
            sessionId,
            'renewable_paper.txt',
            academicPaper2,
            'Compare with my proposed strategies',
            '/api/upload-during-session'
        );
        if (!upload3.data.success) throw new Error('Additional doc 2 failed');
        log(`  Additional doc 2: Renewable paper (${upload3.data.totalDocuments} total)`, 'yellow');
        
        // Verify context contains all documents
        const contexts = await makeRequest('GET', '/api/debug/contexts');
        const sessionContext = contexts.data.contexts.find(c => c.sessionId === sessionId);
        
        if (!sessionContext) throw new Error('Session context not found');
        if (sessionContext.organization !== 'EcoTech') {
            throw new Error('Primary organization changed!');
        }
        
        // Check that preview contains references to additional docs
        if (!sessionContext.preview.includes('ADDITIONAL DOCUMENT') && upload3.data.totalDocuments > 1) {
            log('  ⚠️  Warning: Additional docs may not be reflected in preview', 'yellow');
        }
        
        log('✅ PASS: Multi-document session handled correctly', 'green');
        TEST_RESULTS.push({ name: 'Additional Documents', status: 'PASS' });
        return true;
    } catch (error) {
        log(`❌ FAIL: ${error.message}`, 'red');
        TEST_RESULTS.push({ name: 'Additional Documents', status: 'FAIL', error: error.message });
        return false;
    }
}

async function test5_DescriptionGuidance() {
    log('\n📋 TEST 5: Description Guidance', 'cyan');
    try {
        const sessionId = 'session_test_' + Date.now() + '_guidance';
        
        const report = `Organization: TestOrg\nSample report content`;
        const description = 'Focus on stakeholder engagement and methodology gaps';
        
        const upload = await uploadDocument(sessionId, 'test_report.txt', report, description);
        if (!upload.data.success) throw new Error('Upload failed');
        
        // Check context contains the guidance
        const contexts = await makeRequest('GET', '/api/debug/contexts');
        const sessionContext = contexts.data.contexts.find(c => c.sessionId === sessionId);
        
        if (!sessionContext) throw new Error('Context not found');
        
        if (!sessionContext.preview.includes('USER GUIDANCE') && description) {
            throw new Error('User guidance not prepended to context');
        }
        
        log('✅ PASS: Description guidance correctly included', 'green');
        TEST_RESULTS.push({ name: 'Description Guidance', status: 'PASS' });
        return true;
    } catch (error) {
        log(`❌ FAIL: ${error.message}`, 'red');
        TEST_RESULTS.push({ name: 'Description Guidance', status: 'FAIL', error: error.message });
        return false;
    }
}

async function test6_LargeDocument() {
    log('\n📋 TEST 6: Large Document Handling', 'cyan');
    try {
        const sessionId = 'session_test_' + Date.now() + '_large';
        
        // Create a large document (simulate ~10k words)
        const words = 'sustainability climate carbon emissions renewable energy policy framework implementation '.split(' ');
        let largeContent = 'Organization: LargeCorp\n\n';
        for (let i = 0; i < 10000; i++) {
            largeContent += words[i % words.length] + ' ';
        }
        
        log(`  Uploading ~${Math.round(largeContent.length / 1024)}KB document...`, 'yellow');
        const upload = await uploadDocument(sessionId, 'large_report.txt', largeContent);
        
        if (!upload.data.success) throw new Error('Large upload failed');
        if (upload.data.wordCount < 9000) throw new Error('Word count seems incorrect');
        
        log(`  ✓ Processed ${upload.data.wordCount} words`, 'yellow');
        log('✅ PASS: Large document handled successfully', 'green');
        TEST_RESULTS.push({ name: 'Large Document', status: 'PASS' });
        return true;
    } catch (error) {
        log(`❌ FAIL: ${error.message}`, 'red');
        TEST_RESULTS.push({ name: 'Large Document', status: 'FAIL', error: error.message });
        return false;
    }
}

async function test7_ConcurrentSessions() {
    log('\n📋 TEST 7: Concurrent Sessions', 'cyan');
    try {
        const session1 = 'session_test_' + Date.now() + '_concurrent1';
        const session2 = 'session_test_' + Date.now() + '_concurrent2';
        const session3 = 'session_test_' + Date.now() + '_concurrent3';
        
        // Upload 3 documents concurrently
        const uploads = await Promise.all([
            uploadDocument(session1, 'report1.txt', 'Organization: Corp1\nReport 1'),
            uploadDocument(session2, 'report2.txt', 'Organization: Corp2\nReport 2'),
            uploadDocument(session3, 'report3.txt', 'Organization: Corp3\nReport 3')
        ]);
        
        if (!uploads.every(u => u.data.success)) {
            throw new Error('Some uploads failed');
        }
        
        // Verify all 3 contexts exist independently
        const contexts = await makeRequest('GET', '/api/debug/contexts');
        const ctx1 = contexts.data.contexts.find(c => c.sessionId === session1);
        const ctx2 = contexts.data.contexts.find(c => c.sessionId === session2);
        const ctx3 = contexts.data.contexts.find(c => c.sessionId === session3);
        
        if (!ctx1 || !ctx2 || !ctx3) throw new Error('Not all contexts found');
        if (new Set([ctx1.organization, ctx2.organization, ctx3.organization]).size !== 3) {
            throw new Error('Organizations are not unique - context bleeding!');
        }
        
        log('✅ PASS: Concurrent sessions handled correctly', 'green');
        TEST_RESULTS.push({ name: 'Concurrent Sessions', status: 'PASS' });
        return true;
    } catch (error) {
        log(`❌ FAIL: ${error.message}`, 'red');
        TEST_RESULTS.push({ name: 'Concurrent Sessions', status: 'FAIL', error: error.message });
        return false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

async function runAllTests() {
    log('\n╔══════════════════════════════════════════════════════════╗', 'magenta');
    log('║   KEA ACADEMIC COACH - SMOKE TEST SUITE                 ║', 'magenta');
    log('╚══════════════════════════════════════════════════════════╝', 'magenta');
    
    const tests = [
        test1_HealthCheck,
        test2_SessionIsolation,
        test3_PrimaryReportReplacement,
        test4_AdditionalDocuments,
        test5_DescriptionGuidance,
        test6_LargeDocument,
        test7_ConcurrentSessions
    ];
    
    for (const test of tests) {
        await test();
        await new Promise(resolve => setTimeout(resolve, 200)); // Brief pause between tests
    }
    
    // Summary
    log('\n╔══════════════════════════════════════════════════════════╗', 'magenta');
    log('║   TEST SUMMARY                                           ║', 'magenta');
    log('╚══════════════════════════════════════════════════════════╝', 'magenta');
    
    const passed = TEST_RESULTS.filter(r => r.status === 'PASS').length;
    const failed = TEST_RESULTS.filter(r => r.status === 'FAIL').length;
    
    TEST_RESULTS.forEach(result => {
        const icon = result.status === 'PASS' ? '✅' : '❌';
        const color = result.status === 'PASS' ? 'green' : 'red';
        log(`${icon} ${result.name}`, color);
        if (result.error) {
            log(`   Error: ${result.error}`, 'red');
        }
    });
    
    log(`\n📊 Results: ${passed} passed, ${failed} failed`, failed === 0 ? 'green' : 'red');
    
    if (failed === 0) {
        log('\n🎉 ALL TESTS PASSED! System is ready for production.', 'green');
        process.exit(0);
    } else {
        log('\n⚠️  SOME TESTS FAILED - Review errors above', 'red');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(error => {
    log(`\n💥 CRITICAL ERROR: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});
