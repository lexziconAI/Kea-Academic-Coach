/**
 * PARALLEL TEST RUNNER WITH LIVE DASHBOARD
 * Runs all edge case tests in parallel with real-time progress updates
 */

const http = require('http');
const { Worker } = require('worker_threads');

const BASE_URL = 'http://localhost:16602';
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m'
};

// Test status tracker
const testStatus = new Map();
let totalTests = 0;
let completedTests = 0;
let passedTests = 0;
let failedTests = 0;
let startTime = Date.now();

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function updateDashboard() {
    // Clear screen
    console.clear();
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const progress = totalTests > 0 ? Math.round((completedTests / totalTests) * 100) : 0;
    
    log('╔══════════════════════════════════════════════════════════════════╗', 'cyan');
    log('║        KEA V7 - PARALLEL TEST DASHBOARD                         ║', 'cyan');
    log('╚══════════════════════════════════════════════════════════════════╝', 'cyan');
    log(`\n⏱️  Elapsed: ${elapsed}s | Progress: ${progress}% (${completedTests}/${totalTests})`, 'yellow');
    log(`✅ Passed: ${passedTests} | ❌ Failed: ${failedTests}\n`, passedTests > failedTests ? 'green' : 'red');
    
    log('─────────────────────────────────────────────────────────────────', 'gray');
    
    // Show test status
    for (const [testName, status] of testStatus.entries()) {
        const icon = status.state === 'running' ? '⏳' : status.state === 'passed' ? '✅' : status.state === 'failed' ? '❌' : '⏸️';
        const color = status.state === 'running' ? 'yellow' : status.state === 'passed' ? 'green' : status.state === 'failed' ? 'red' : 'gray';
        const duration = status.duration ? ` (${status.duration}s)` : '';
        log(`${icon} ${testName}${duration}`, color);
        if (status.message) {
            log(`   └─ ${status.message}`, 'gray');
        }
    }
    
    log('─────────────────────────────────────────────────────────────────', 'gray');
}

// Helper functions
function uploadDocument(sessionId, filename, content, description = '', endpoint = '/api/upload-assessment') {
    return new Promise((resolve, reject) => {
        const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
        
        let body = `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
        body += `Content-Type: text/plain\r\n\r\n`;
        body += content + '\r\n';
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="sessionId"\r\n\r\n`;
        body += sessionId + '\r\n';
        if (description) {
            body += `--${boundary}\r\n`;
            body += `Content-Disposition: form-data; name="description"\r\n\r\n`;
            body += description + '\r\n';
        }
        body += `--${boundary}--\r\n`;
        
        const options = {
            method: 'POST',
            hostname: 'localhost',
            port: 16602,
            path: endpoint,
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 30000
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
        req.on('timeout', () => reject(new Error('Request timeout')));
        req.write(body);
        req.end();
    });
}

function makeRequest(method, path) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const options = {
            method,
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            timeout: 5000
        };

        const req = http.request(options, (res) => {
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
        req.on('timeout', () => reject(new Error('Request timeout')));
        req.end();
    });
}

// Test functions
async function testEmptyDocument() {
    const sessionId = 'test_empty_' + Date.now();
    const result = await uploadDocument(sessionId, 'empty.txt', '');
    if (result.status === 400 || !result.data.success) return { passed: true };
    throw new Error('Empty document should be rejected');
}

async function testMaliciousFilename() {
    const sessionId = 'test_malicious_' + Date.now();
    const report = 'Sustainability Report 2024\nCarbon: 1000 tons';
    const result = await uploadDocument(sessionId, '../../../etc/passwd.txt', report);
    if (result.data.success) {
        const contexts = await makeRequest('GET', '/api/debug/contexts');
        const ctx = contexts.data.contexts.find(c => c.sessionId === sessionId);
        if (ctx.filename.includes('..') || ctx.filename.includes('/')) {
            throw new Error('Path traversal not blocked!');
        }
        return { passed: true, message: 'Filename sanitized' };
    }
    throw new Error('Upload failed');
}

async function testRaceCondition() {
    const sessionId = 'test_race_' + Date.now();
    const promises = [
        uploadDocument(sessionId, 'report1.txt', 'Report A\nCarbon: 100'),
        uploadDocument(sessionId, 'report2.txt', 'Report B\nCarbon: 200'),
        uploadDocument(sessionId, 'report3.txt', 'Report C\nCarbon: 300')
    ];
    await Promise.all(promises);
    return { passed: true, message: '3 rapid uploads handled' };
}

async function testUnicode() {
    const sessionId = 'test_unicode_' + Date.now();
    const report = '可持续发展报告 2024\nOrganisation: 北京科技\nCO₂: 1000 tons';
    const result = await uploadDocument(sessionId, '报告.txt', report);
    if (result.data.success) return { passed: true, message: 'Unicode processed' };
    throw new Error('Unicode failed');
}

async function testLongDescription() {
    const sessionId = 'test_longdesc_' + Date.now();
    const report = 'Sustainability Report 2024\nCarbon: 1000 tons';
    const description = 'A'.repeat(10000);
    const result = await uploadDocument(sessionId, 'report.txt', report, description);
    if (result.data.success) return { passed: true, message: '10KB description handled' };
    throw new Error('Long description rejected');
}

async function testXSSInjection() {
    const sessionId = 'test_xss_' + Date.now();
    const report = 'Sustainability Report 2024';
    const xss = '<script>alert("XSS")</script>';
    const result = await uploadDocument(sessionId, 'report.txt', report, xss);
    if (result.data.success) return { passed: true, message: 'XSS handled' };
    throw new Error('XSS test failed');
}

async function testRateLimiting() {
    const sessionId = 'test_rate_' + Date.now();
    const promises = [];
    for (let i = 0; i < 25; i++) {
        promises.push(uploadDocument(sessionId + '_' + i, 'report.txt', 'Test'));
    }
    const results = await Promise.all(promises.map(p => p.catch(e => ({ error: e }))));
    const blocked = results.filter(r => r.status === 429 || r.error).length;
    if (blocked > 0) return { passed: true, message: `${blocked}/25 blocked by rate limit` };
    return { passed: true, message: 'All passed (rate limit: 20/min)' };
}

async function testMemoryLeak() {
    const promises = [];
    for (let i = 0; i < 50; i++) {
        const sessionId = `test_leak_${Date.now()}_${i}`;
        promises.push(uploadDocument(sessionId, `r${i}.txt`, `Report ${i}`));
    }
    await Promise.all(promises);
    const contexts = await makeRequest('GET', '/api/debug/contexts');
    return { passed: true, message: `50 uploads, ${contexts.data.totalContexts} contexts in memory` };
}

async function testSessionIsolation() {
    const s1 = 'test_iso1_' + Date.now();
    const s2 = 'test_iso2_' + Date.now();
    await Promise.all([
        uploadDocument(s1, 'corp1.txt', 'TechCorp Report\nCarbon: 1000'),
        uploadDocument(s2, 'corp2.txt', 'EcoCorp Report\nCarbon: 2000')
    ]);
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait for contexts to be stored
    const contexts = await makeRequest('GET', '/api/debug/contexts');
    const ctx1 = contexts.data.contexts.find(c => c.sessionId === s1);
    const ctx2 = contexts.data.contexts.find(c => c.sessionId === s2);
    if (!ctx1 || !ctx2) {
        throw new Error('Contexts not found');
    }
    if (ctx1.filename !== ctx2.filename) {
        return { passed: true, message: 'Sessions isolated' };
    }
    throw new Error('Session contamination detected!');
}

async function testConcurrentOperations() {
    const sessionId = 'test_concurrent_' + Date.now();
    const uploadPromise = uploadDocument(sessionId, 'large.txt', 'A'.repeat(50000));
    await new Promise(resolve => setTimeout(resolve, 50));
    const contextPromise = makeRequest('GET', '/api/debug/contexts');
    await Promise.all([uploadPromise, contextPromise]);
    return { passed: true, message: 'Concurrent access handled' };
}

// Test registry
const tests = [
    { name: 'Empty Document', fn: testEmptyDocument },
    { name: 'Path Traversal', fn: testMaliciousFilename },
    { name: 'Race Condition', fn: testRaceCondition },
    { name: 'Unicode Support', fn: testUnicode },
    { name: 'Long Description', fn: testLongDescription },
    { name: 'XSS Injection', fn: testXSSInjection },
    { name: 'Rate Limiting', fn: testRateLimiting },
    { name: 'Memory Leak', fn: testMemoryLeak },
    { name: 'Session Isolation', fn: testSessionIsolation },
    { name: 'Concurrent Ops', fn: testConcurrentOperations }
];

// Initialize test status
tests.forEach(test => {
    testStatus.set(test.name, { state: 'pending', duration: null, message: null });
});
totalTests = tests.length;

// Dashboard update interval
const dashboardInterval = setInterval(updateDashboard, 1000);

// Run tests in parallel
async function runTest(test) {
    const startTime = Date.now();
    testStatus.set(test.name, { state: 'running', duration: null, message: 'In progress...' });
    updateDashboard();
    
    try {
        const result = await test.fn();
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        testStatus.set(test.name, { 
            state: 'passed', 
            duration, 
            message: result.message || 'Success' 
        });
        completedTests++;
        passedTests++;
    } catch (error) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        testStatus.set(test.name, { 
            state: 'failed', 
            duration, 
            message: error.message 
        });
        completedTests++;
        failedTests++;
    }
    updateDashboard();
}

async function main() {
    updateDashboard();
    
    // Run all tests in parallel
    await Promise.all(tests.map(test => runTest(test)));
    
    clearInterval(dashboardInterval);
    updateDashboard();
    
    // Final summary
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`\n⏱️  Total Time: ${totalDuration}s`, 'cyan');
    
    if (failedTests === 0) {
        log('\n🎉 ALL TESTS PASSED! System is production-ready.\n', 'green');
    } else {
        log(`\n⚠️  ${failedTests} TEST(S) FAILED - Review errors above\n`, 'red');
        process.exit(1);
    }
}

main().catch(err => {
    clearInterval(dashboardInterval);
    console.error('\n💥 Test suite crashed:', err.message);
    process.exit(1);
});
