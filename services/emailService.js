/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║  KEA ACADEMIC COACH - EMAIL SERVICE                                            ║
 * ║  SendGrid integration for report delivery                                      ║
 * ╠═══════════════════════════════════════════════════════════════════════════════╣
 * ║  Adapted from MetaGuardian email_service.py                                   ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

const sgMail = require('@sendgrid/mail');
const fs = require('fs');
const path = require('path');

// Configuration
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SENDGRID_FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'regan@axiomintelligence.co.nz';
const SENDGRID_FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Kea Academic Coach';

// Initialize SendGrid
if (SENDGRID_API_KEY) {
    sgMail.setApiKey(SENDGRID_API_KEY);
}

const FOOTER_TEXT = '© 2025 Axiom Intelligence – Interactive Oral Assessments as a Service (IOAaaS)';

/**
 * Get logo as base64 for email embedding
 */
function getLogoBase64() {
    const logoPath = path.join(__dirname, '..', 'public', 'axiom-logo.png');
    try {
        if (fs.existsSync(logoPath)) {
            const logoData = fs.readFileSync(logoPath);
            return logoData.toString('base64');
        }
    } catch (err) {
        console.error('Failed to load logo:', err.message);
    }
    return null;
}

/**
 * Generate HTML email report from session data
 */
function generateEmailReport(sessionData) {
    const {
        userName = 'Student',
        userEmail,
        assessmentTitle = 'Coaching Session',
        keyTakeaways = '',
        sessionStats = {},
        createdAt,
        endedAt
    } = sessionData;

    // Format dates
    const startDate = createdAt ? new Date(createdAt).toLocaleString('en-NZ', { 
        dateStyle: 'full', 
        timeStyle: 'short' 
    }) : 'N/A';
    
    const endDate = endedAt ? new Date(endedAt).toLocaleString('en-NZ', { 
        dateStyle: 'full', 
        timeStyle: 'short' 
    }) : 'N/A';

    // Session stats
    const totalTurns = sessionStats.totalTurns || 0;
    const userTurns = sessionStats.userTurns || 0;
    const assistantTurns = sessionStats.assistantTurns || 0;
    const duration = sessionStats.durationMinutes || 'N/A';

    // Clean up key takeaways HTML for email
    let cleanTakeaways = keyTakeaways || '<p>No key takeaways recorded for this session.</p>';
    
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Kea Academic Coach Report</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 650px;
            margin: 0 auto;
            background: white;
        }
        .header {
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header img {
            height: 80px;
            margin-bottom: 15px;
        }
        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
        }
        .header p {
            margin: 8px 0 0;
            opacity: 0.9;
            font-size: 14px;
        }
        .content {
            padding: 30px;
        }
        .greeting {
            font-size: 18px;
            color: #1a1a2e;
            margin-bottom: 20px;
        }
        .session-info {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 25px;
        }
        .session-info h3 {
            margin: 0 0 15px;
            color: #1a1a2e;
            font-size: 16px;
        }
        .info-row {
            display: flex;
            justify-content: space-between;
            padding: 8px 0;
            border-bottom: 1px solid #e9ecef;
        }
        .info-row:last-child {
            border-bottom: none;
        }
        .info-label {
            color: #666;
            font-size: 14px;
        }
        .info-value {
            color: #333;
            font-weight: 500;
            font-size: 14px;
        }
        .takeaways-section {
            background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
            border-radius: 8px;
            padding: 25px;
            margin-bottom: 25px;
        }
        .takeaways-section h2 {
            margin: 0 0 15px;
            color: #2e7d32;
            font-size: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .takeaways-content {
            background: white;
            border-radius: 6px;
            padding: 20px;
        }
        .takeaways-content h3 {
            color: #1a1a2e;
            margin: 0 0 10px;
            font-size: 16px;
        }
        .takeaways-content ul {
            margin: 0;
            padding-left: 20px;
        }
        .takeaways-content li {
            margin-bottom: 8px;
            color: #444;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin-bottom: 25px;
        }
        .stat-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            text-align: center;
        }
        .stat-number {
            font-size: 28px;
            font-weight: 700;
            color: #4CAF50;
        }
        .stat-label {
            font-size: 12px;
            color: #666;
            text-transform: uppercase;
        }
        .footer {
            background: #1a1a2e;
            color: white;
            padding: 20px;
            text-align: center;
            font-size: 12px;
        }
        .footer a {
            color: #4CAF50;
            text-decoration: none;
        }
        .cta-button {
            display: inline-block;
            background: #4CAF50;
            color: white;
            padding: 12px 30px;
            border-radius: 25px;
            text-decoration: none;
            font-weight: 600;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="cid:logo" alt="Kea Academic Coach" />
            <h1>Kea Academic Coach</h1>
            <p>Your Coaching Session Report</p>
        </div>
        
        <div class="content">
            <p class="greeting">Kia ora ${userName},</p>
            <p>Thank you for completing your coaching session with Kea. Below is a summary of your session and key takeaways.</p>
            
            <div class="session-info">
                <h3>📋 Session Details</h3>
                <div class="info-row">
                    <span class="info-label">Assessment</span>
                    <span class="info-value">${assessmentTitle}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Started</span>
                    <span class="info-value">${startDate}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Completed</span>
                    <span class="info-value">${endDate}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">Duration</span>
                    <span class="info-value">${duration} minutes</span>
                </div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number">${totalTurns}</div>
                    <div class="stat-label">Total Exchanges</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${userTurns}</div>
                    <div class="stat-label">Your Responses</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${assistantTurns}</div>
                    <div class="stat-label">Coach Prompts</div>
                </div>
            </div>
            
            <div class="takeaways-section">
                <h2>🎯 Key Takeaways</h2>
                <div class="takeaways-content">
                    ${cleanTakeaways}
                </div>
            </div>
            
            <p style="color: #666; font-size: 14px;">
                This report was generated automatically by Kea Academic Coach. Keep it for your records 
                or share it with your instructor for feedback.
            </p>
            
            <div style="text-align: center;">
                <a href="http://localhost:16602/v7" class="cta-button">Start Another Session</a>
            </div>
        </div>
        
        <div class="footer">
            <p>${FOOTER_TEXT}</p>
            <p>Powered by <a href="https://axiomintelligence.co.nz">Axiom Intelligence</a></p>
        </div>
    </div>
</body>
</html>
`;

    return html;
}

/**
 * Send session report via email
 */
async function sendReportEmail(toEmail, sessionData) {
    if (!SENDGRID_API_KEY) {
        console.error('❌ SendGrid API key not configured');
        return { success: false, error: 'Email service not configured' };
    }

    if (!toEmail) {
        return { success: false, error: 'No email address provided' };
    }

    const htmlContent = generateEmailReport(sessionData);
    const logoBase64 = getLogoBase64();

    const msg = {
        to: toEmail,
        from: {
            email: SENDGRID_FROM_EMAIL,
            name: SENDGRID_FROM_NAME
        },
        subject: `Your Kea Coaching Session Report - ${sessionData.assessmentTitle || 'Session Summary'}`,
        html: htmlContent,
        attachments: logoBase64 ? [{
            content: logoBase64,
            filename: 'axiom-logo.png',
            type: 'image/png',
            disposition: 'inline',
            content_id: 'logo'
        }] : []
    };

    try {
        const response = await sgMail.send(msg);
        console.log(`📧 Email sent to ${toEmail} - Status: ${response[0].statusCode}`);
        return { 
            success: true, 
            statusCode: response[0].statusCode,
            message: `Report sent to ${toEmail}`
        };
    } catch (error) {
        console.error('❌ Email send failed:', error.message);
        return { 
            success: false, 
            error: error.message,
            details: error.response?.body?.errors || []
        };
    }
}

module.exports = {
    sendReportEmail,
    generateEmailReport,
    SENDGRID_FROM_EMAIL
};
