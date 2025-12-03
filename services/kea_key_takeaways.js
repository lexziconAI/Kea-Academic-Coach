// ═══════════════════════════════════════════════════════════════════════════════════
// 🥝 KEA KEY TAKEAWAYS GENERATOR - LOG³×LOG⁴ ENHANCED
// ═══════════════════════════════════════════════════════════════════════════════════
//
// Designed using LOG³×LOG⁴ fractal exploration:
//
// LOG³ ANALYSIS: Purpose × Structure × Depth
//   Purpose:   Documentation | Learning Synthesis | Development Tracking
//   Structure: Topic-based | Learning-based | Action-based  
//   Depth:     Surface | Analytical | Developmental
//   
//   SELECTED: Learning Synthesis × Learning-based × Developmental
//
// LOG⁴ ANALYSIS: Integration with Analysis System
//   Integration: Standalone | Referenced | Fully Integrated
//   
//   SELECTED: Fully Integrated - Maps directly to LOG³ analysis dimensions
//
// ═══════════════════════════════════════════════════════════════════════════════════

const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ═══════════════════════════════════════════════════════════════════════════════════
// THE IMPROVED KEY TAKEAWAYS PROMPT
// ═══════════════════════════════════════════════════════════════════════════════════

const ENHANCED_KEY_TAKEAWAYS_PROMPT = `You are generating a rich "Key Takeaways" document that tracks a student's learning journey.

## CONTEXT

**Organization Being Analyzed:** {organization}
**Session ID:** {sessionId}
**Timestamp:** {timestamp}

## COACHING ANALYSIS CONTEXT (from LOG³)
{analysisContext}

## CONVERSATION TRANSCRIPT
{transcript}

## YOUR TASK

Generate a Key Takeaways document that captures LEARNING and DEVELOPMENT, not just topics discussed.

### CRITICAL PRINCIPLES

1. **STUDENT-CENTERED**: Focus on what the STUDENT said, realized, and learned - not just what the coach explained.

2. **DISCOVERY-FOCUSED**: Capture moments of insight ("Ah, I see now...") and new connections made.

3. **DEVELOPMENT-TRACKING**: Show movement from initial understanding to deeper understanding.

4. **EXPLORATION-AWARE**: Document the explorations and examples discussed, not just conclusions.

5. **ACTION-ORIENTED**: End with concrete, specific next steps.

### OUTPUT STRUCTURE

Use ONLY these HTML tags: <h2>, <h3>, <ul>, <li>, <strong>, <em>, <blockquote>, <p>

Generate these sections IN ORDER:

---

<h2>🎯 Session Focus</h2>
<p>One sentence: What was the main territory explored in this session?</p>

---

<h2>💡 Key Discoveries</h2>
<h3>What {studentName} Realized</h3>
<ul>
<li>Specific insights the student articulated or arrived at</li>
<li>Connections they made between concepts</li>
<li>Moments where understanding deepened</li>
</ul>

<h3>Concepts Explored Together</h3>
<ul>
<li>Frameworks or ideas discussed (e.g., "Materiality assessment", "Stakeholder mapping")</li>
<li>Real-world examples referenced (e.g., "Unilever's supply chain approach")</li>
<li>Comparisons made (e.g., "How this differs from Competitor X")</li>
</ul>

---

<h2>📊 Progress on Key Areas</h2>

For each development area from the LOG³ analysis, track progress:

<h3>[Development Area 1]</h3>
<ul>
<li><strong>Started at:</strong> Where was understanding at session start?</li>
<li><strong>Explored:</strong> What was discussed about this area?</li>
<li><strong>Now at:</strong> Where is understanding now?</li>
<li><strong>Remaining:</strong> What still needs development?</li>
</ul>

(Repeat for each relevant development area discussed)

---

<h2>📝 Analysis Elements Strengthened</h2>

Map to the student's actual report:

<h3>Practices</h3>
<ul>
<li>Which practices were discussed? What was added/clarified?</li>
</ul>

<h3>Gaps</h3>
<ul>
<li>Did the student identify new gaps? Deepen existing ones?</li>
</ul>

<h3>Strategies</h3>
<ul>
<li>Were strategies discussed? Any gap-strategy connections made?</li>
</ul>

<h3>Implementation</h3>
<ul>
<li>Did discussion touch on how strategies would work in practice?</li>
</ul>

---

<h2>💬 Notable Quotes</h2>
<blockquote>
"Exact quote from the student showing insight or development"
</blockquote>
<p><em>Why this matters: brief explanation</em></p>

(Include 1-3 significant student quotes)

---

<h2>❓ Open Questions</h2>
<ul>
<li>Questions the student asked that weren't fully resolved</li>
<li>Topics where they expressed continuing uncertainty</li>
<li>Areas they wanted to explore further</li>
</ul>

---

<h2>🚀 Next Steps</h2>
<h3>Immediate Actions</h3>
<ul>
<li><strong>Research:</strong> Specific things to look up or read</li>
<li><strong>Writing:</strong> Specific sections to revise or expand</li>
<li><strong>Thinking:</strong> Questions to reflect on</li>
</ul>

<h3>For Next Session</h3>
<ul>
<li>Topics to return to</li>
<li>Questions to bring back</li>
</ul>

---

<h2>📈 Session Quality Indicators</h2>
<ul>
<li><strong>Engagement Level:</strong> HIGH | MODERATE | DEVELOPING</li>
<li><strong>Depth of Exploration:</strong> SURFACE | DEVELOPING | DEEP</li>
<li><strong>Student-Led Moments:</strong> Count of times student drove the discussion</li>
<li><strong>Insights Generated:</strong> Number of "aha" moments captured</li>
</ul>

---

## IMPORTANT GUIDELINES

- Be SPECIFIC, not generic. Use names, examples, and details from the actual conversation.
- Quote the STUDENT directly when they said something insightful.
- Track DEVELOPMENT - show the journey, not just the destination.
- Connect to the LOG³ analysis - reference specific practices, gaps, strategies.
- This document should be USEFUL for the student to review before their next session.
- Do NOT include anything about grades, scores, or assessment.
- Do NOT reveal the LOG³ analysis scores or internal assessments.

Output ONLY the HTML content. No markdown code blocks. No explanations.`;

// ═══════════════════════════════════════════════════════════════════════════════════
// MINI KEY TAKEAWAYS (For quick updates during conversation)
// ═══════════════════════════════════════════════════════════════════════════════════

const MINI_TAKEAWAYS_PROMPT = `Generate a quick update to the running Key Takeaways.

ORGANIZATION: {organization}
LAST FEW TURNS:
{recentTurns}

EXISTING TAKEAWAYS:
{existingTakeaways}

Add to the existing takeaways with any NEW insights, discoveries, or action items from these recent turns.

Rules:
- Only add NEW content, don't repeat what's already captured
- Focus on student realizations and insights
- Keep format consistent with existing document
- If nothing significant was added, respond with: NO_UPDATE

Output the ADDITION ONLY (to be appended), or NO_UPDATE.`;

// ═══════════════════════════════════════════════════════════════════════════════════
// ANALYSIS CONTEXT FORMATTER
// ═══════════════════════════════════════════════════════════════════════════════════

function formatAnalysisContextForTakeaways(analysis) {
    if (!analysis || !analysis.analysis) {
        return 'No prior analysis available.';
    }
    
    const a = analysis.analysis;
    let context = '';
    
    // Organization
    if (a.organization) {
        context += `**Organization:** ${a.organization.name} (${a.organization.industry || 'Unknown industry'})\n\n`;
    }
    
    // Development areas (from synthesis)
    if (a.coaching_strategy?.exploration_pathways?.primary) {
        const primary = a.coaching_strategy.exploration_pathways.primary;
        context += `**Primary Development Focus:** ${primary.focus}\n`;
        context += `**Key Concepts to Explore:** ${primary.concepts_to_explore?.join(', ') || 'Various'}\n\n`;
    }
    
    // Practice summaries
    if (a.practices && a.practices.length > 0) {
        context += `**Practices Analyzed:**\n`;
        a.practices.forEach((p, i) => {
            context += `- Practice ${i + 1}: ${p.description || 'Not described'} `;
            context += `(Depth: ${p.conceptual_depth || 'Unknown'}, Gap Type: ${p.gap_type || 'Unknown'})\n`;
        });
        context += '\n';
    }
    
    // Gaps
    if (a.gaps) {
        context += `**Gaps Identified:** ${a.gaps.overall_critical_thinking || 'Unknown'} critical thinking level\n`;
        if (a.gaps.explicit && a.gaps.explicit.length > 0) {
            context += `- Explicit gaps: ${a.gaps.explicit.length}\n`;
        }
        if (a.gaps.missed && a.gaps.missed.length > 0) {
            context += `- Gaps to discover: ${a.gaps.missed.length}\n`;
        }
        context += '\n';
    }
    
    // Strategies
    if (a.strategies && a.strategies.length > 0) {
        context += `**Strategies Proposed:** ${a.strategies.length}\n`;
        context += `- Strategic Quality: ${a.strategies[0]?.strategic_thinking_level || 'Unknown'}\n\n`;
    }
    
    // Implementation
    if (a.implementation) {
        context += `**Implementation Realism:** ${a.implementation.overall_realism || 'Unknown'}\n`;
        context += `**Practical Thinking:** ${a.implementation.practical_thinking_level || 'Unknown'}\n\n`;
    }
    
    // Authenticity (coaching implications only, never reveal concerns)
    if (a.authenticity?.coaching_implications) {
        const implications = a.authenticity.coaching_implications;
        context += `**Coaching Approach:** ${implications.safe_to_deep_dive ? 'Can deep dive' : 'Explore research process first'}\n`;
    }
    
    return context;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// GENERATE ENHANCED KEY TAKEAWAYS
// ═══════════════════════════════════════════════════════════════════════════════════

async function generateEnhancedKeyTakeaways(options) {
    const { 
        sessionId, 
        transcript, 
        organization, 
        studentName,
        analysisData,
        turnCount
    } = options;
    
    if (!transcript || transcript.length === 0) {
        return { summaryHtml: '<p>No conversation yet.</p>', turnCount: 0 };
    }
    
    // Format transcript - handle both string and array formats
    let formattedTranscript;
    if (typeof transcript === 'string') {
        formattedTranscript = transcript;
    } else if (Array.isArray(transcript)) {
        formattedTranscript = transcript.map(t => 
            `${t.speaker || t.role}: ${t.text || t.content}`
        ).join('\n\n');
    } else {
        formattedTranscript = String(transcript);
    }
    
    // Format analysis context
    const analysisContext = analysisData 
        ? formatAnalysisContextForTakeaways(analysisData)
        : 'No prior analysis available.';
    
    // Build prompt
    const prompt = ENHANCED_KEY_TAKEAWAYS_PROMPT
        .replace(/{organization}/g, organization || 'Unknown Organization')
        .replace(/{sessionId}/g, sessionId || 'N/A')
        .replace(/{timestamp}/g, new Date().toISOString())
        .replace(/{studentName}/g, studentName || 'the student')
        .replace(/{analysisContext}/g, analysisContext)
        .replace(/{transcript}/g, formattedTranscript);
    
    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                {
                    role: 'system',
                    content: 'Generate structured HTML for Key Takeaways. Track learning and development. Output ONLY valid HTML, no markdown.'
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.3,
            max_tokens: 6000
        });
        
        let summaryHtml = response.choices[0].message.content;
        
        // Clean up any markdown artifacts
        summaryHtml = summaryHtml.replace(/```html?/g, '').replace(/```/g, '').trim();
        
        // Add session metadata footer
        summaryHtml += `
<hr>
<p style="font-size: 0.8em; color: #666;">
    Session: ${sessionId || 'N/A'} | 
    Generated: ${new Date().toLocaleString()} |
    Organization: ${organization || 'Unknown'} |
    Turns: ${turnCount || 'N/A'}
</p>`;
        
        return { summaryHtml, turnCount: turnCount || 0 };
        
    } catch (error) {
        console.error('[KEA] Key Takeaways error:', error);
        throw error;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// INCREMENTAL UPDATE FUNCTION
// ═══════════════════════════════════════════════════════════════════════════════════

async function updateKeyTakeaways(existingTakeaways, recentTurns, organization) {
    // Format recent turns
    let formattedTurns;
    if (typeof recentTurns === 'string') {
        formattedTurns = recentTurns;
    } else if (Array.isArray(recentTurns)) {
        formattedTurns = recentTurns.map(t => 
            `${t.speaker || t.role}: ${t.text || t.content}`
        ).join('\n');
    } else {
        formattedTurns = String(recentTurns);
    }
    
    const prompt = MINI_TAKEAWAYS_PROMPT
        .replace('{organization}', organization)
        .replace('{recentTurns}', formattedTurns)
        .replace('{existingTakeaways}', existingTakeaways);
    
    try {
        const response = await groq.chat.completions.create({
            model: 'llama-3.3-70b-versatile',
            messages: [
                { role: 'system', content: 'Add to Key Takeaways or respond NO_UPDATE. Output HTML only.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.2,
            max_tokens: 1200
        });
        
        const addition = response.choices[0].message.content.trim();
        
        if (addition === 'NO_UPDATE') {
            return existingTakeaways;
        }
        
        // Insert addition before the closing session metadata
        const insertPoint = existingTakeaways.lastIndexOf('<hr>');
        if (insertPoint > 0) {
            return existingTakeaways.slice(0, insertPoint) + addition + '\n' + existingTakeaways.slice(insertPoint);
        }
        
        return existingTakeaways + '\n' + addition;
        
    } catch (error) {
        console.error('[KEA] Update takeaways error:', error);
        return existingTakeaways;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════════

module.exports = {
    ENHANCED_KEY_TAKEAWAYS_PROMPT,
    MINI_TAKEAWAYS_PROMPT,
    formatAnalysisContextForTakeaways,
    generateEnhancedKeyTakeaways,
    updateKeyTakeaways
};
