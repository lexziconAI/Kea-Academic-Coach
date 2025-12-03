// ═══════════════════════════════════════════════════════════════════════════════════
// 🧠 ASSESSMENT ANALYZER SERVICE - LOG 3 & LOG 4 FRACTAL EXPLORATION
// ═══════════════════════════════════════════════════════════════════════════════════
// Multi-step chain-of-thought analysis using 9-branch fractal decomposition
// Each step builds on previous context for deep understanding
// ═══════════════════════════════════════════════════════════════════════════════════

const Groq = require('groq-sdk');
const fs = require('fs');
const path = require('path');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ═══════════════════════════════════════════════════════════════════════════════════
// LOG 3: 9-BRANCH ANALYSIS STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════════
// Branch 1: Organization Identification
// Branch 2: Practice 1 Deep Analysis
// Branch 3: Practice 2 Deep Analysis
// Branch 4: Practice 3 Deep Analysis
// Branch 5: Gap Identification
// Branch 6: Strategy-Gap Connection Analysis
// Branch 7: Implementation Realism
// Branch 8: Authenticity Assessment
// Branch 9: Coaching Synthesis
// ═══════════════════════════════════════════════════════════════════════════════════

const LOG3_PROMPTS = {
    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 1: Organization Identification
    // ═══════════════════════════════════════════════════════════════════════════════
    branch1_organization: `You are analyzing a student's sustainability report. Your ONLY task is to identify the organization.

STEP 1: Scan the submission for organization names.
STEP 2: Identify the PRIMARY organization being analyzed (not examples or comparisons).
STEP 3: Determine the industry sector.
STEP 4: Identify geographic region.

Respond with ONLY this JSON:
{
  "organization": {
    "name": "exact organization name",
    "industry": "industry sector",
    "region": "geographic region",
    "confidence": "HIGH|MEDIUM|LOW",
    "reasoning": "brief explanation of how you identified this"
  }
}

STUDENT SUBMISSION:
{submission}`,

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 2-4: Practice Deep Analysis (Template for each practice)
    // ═══════════════════════════════════════════════════════════════════════════════
    branch_practice: `You are analyzing Practice {practiceNum} from a student's sustainability report on {organization}.

Your task is to deeply analyze THIS SPECIFIC PRACTICE using the Log 4 fractal method:

STEP 1 - CLAIM EXTRACTION:
What specific sustainability practice is being described?

STEP 2 - EVIDENCE AUDIT:
- Are there specific METRICS (numbers, percentages)?
- Are there specific DATES or timeframes?
- Are there PROGRAM NAMES or initiative titles?
- Are there SOURCE CITATIONS (page numbers, report names)?

STEP 3 - SPECIFICITY SCORING:
- GENERIC: Vague claims like "they care about sustainability"
- SPECIFIC: Has 1-2 of: metrics, dates, program names
- DETAILED: Has all: exact metrics, dates, program names, citations

STEP 4 - VERIFIABILITY CHECK:
Could this claim be verified in the organization's actual reports?

STEP 5 - STAKEHOLDER ANALYSIS:
Which stakeholder groups are mentioned in relation to this practice?

STEP 6 - MISSING ELEMENTS:
What specific information would strengthen this practice description?

Respond with ONLY this JSON:
{
  "practice": {
    "number": {practiceNum},
    "description": "brief description of the practice",
    "direct_quote": "exact quote from submission if available",
    "evidence": {
      "metrics_found": ["list specific numbers/percentages found"],
      "dates_found": ["list specific dates/years found"],
      "programs_found": ["list program/initiative names found"],
      "sources_cited": ["list specific citations found"],
      "metrics_present": true,
      "dates_present": true,
      "programs_present": true,
      "sources_present": true
    },
    "specificity": "GENERIC",
    "specificity_reasoning": "explain your scoring",
    "verifiable": true,
    "stakeholders_mentioned": ["list stakeholder groups"],
    "missing_elements": ["what would strengthen this"],
    "coaching_questions": [
      "question 1 to probe deeper",
      "question 2 to surface evidence",
      "question 3 to develop thinking"
    ]
  }
}

STUDENT SUBMISSION:
{submission}`,

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 5: Gap Identification
    // ═══════════════════════════════════════════════════════════════════════════════
    branch5_gaps: `You are analyzing gap identification in a student's sustainability report on {organization}.

Previous analysis found these practices:
{practices_summary}

Your task is to identify what GAPS the student found in the organization's current practices.

STEP 1 - EXPLICIT GAP SCAN:
Look for phrases like "however", "gap", "limitation", "challenge", "weakness", "opportunity for improvement"

STEP 2 - IMPLIED GAP DETECTION:
Are there gaps implied but not explicitly stated?

STEP 3 - GAP QUALITY ASSESSMENT:
For each gap found:
- Is it specific or generic?
- Does it logically follow from the practice analysis?
- Is it grounded in evidence?

STEP 4 - MISSING GAP ANALYSIS:
What obvious gaps did the student miss?

Respond with ONLY this JSON:
{
  "gaps": {
    "explicit_gaps": [
      {
        "description": "gap description",
        "quote": "direct quote if available",
        "connected_to_practice": "which practice this gap relates to",
        "specificity": "GENERIC"
      }
    ],
    "implied_gaps": [
      {
        "description": "implied gap",
        "evidence": "why you think this is implied"
      }
    ],
    "missed_gaps": ["gaps the student should have identified"],
    "overall_gap_quality": "WEAK",
    "coaching_questions": [
      "question to help identify gaps",
      "question about challenges they noticed",
      "question about what is missing"
    ]
  }
}

STUDENT SUBMISSION:
{submission}`,

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 6: Strategy-Gap Connection Analysis
    // ═══════════════════════════════════════════════════════════════════════════════
    branch6_strategies: `You are analyzing strategy-gap connections in a student's sustainability report on {organization}.

Previously identified gaps:
{gaps_summary}

Your task is to analyze EACH STRATEGY the student proposes:

STEP 1 - STRATEGY EXTRACTION:
Identify each distinct strategy/recommendation.

STEP 2 - GAP LINKAGE ANALYSIS:
For each strategy, determine:
- NONE: Strategy proposed without reference to any gap
- WEAK: Gap implied but connection not explicit
- CLEAR: Gap explicitly stated and strategy directly addresses it

STEP 3 - INDUSTRY EXAMPLE CHECK:
Does the strategy include examples from other organizations?

STEP 4 - ORIGINALITY ASSESSMENT:
Is this a generic strategy or tailored to this organization?

STEP 5 - FEASIBILITY SIGNALS:
Does the student acknowledge implementation challenges?

Respond with ONLY this JSON:
{
  "strategies": [
    {
      "number": 1,
      "description": "strategy description",
      "direct_quote": "exact quote if available",
      "addresses_gap": "which gap this addresses (or none)",
      "connection_quality": "NONE",
      "connection_reasoning": "explain the connection quality",
      "industry_examples": ["examples cited"],
      "examples_verifiable": true,
      "originality": "GENERIC",
      "feasibility_acknowledged": true,
      "coaching_questions": [
        "question about gap connection",
        "question about examples",
        "question about implementation"
      ]
    }
  ],
  "overall_strategic_quality": "WEAK",
  "coaching_focus": "main area to develop"
}

STUDENT SUBMISSION:
{submission}`,

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 7: Implementation Realism
    // ═══════════════════════════════════════════════════════════════════════════════
    branch7_implementation: `You are analyzing implementation methods in a student's sustainability report on {organization}.

Strategies proposed:
{strategies_summary}

Your task is to assess implementation REALISM:

STEP 1 - METHOD EXTRACTION:
What specific implementation methods are proposed?

STEP 2 - SPECIFICITY CHECK:
- GENERIC: "partner with stakeholders"
- SPECIFIC: Named approach but no external example
- DETAILED: Real-world example with verification

STEP 3 - EXAMPLE VERIFICATION:
Are cited examples real and verifiable?

STEP 4 - CONTEXTUAL FIT:
Do methods suit this specific organization?

STEP 5 - BARRIER AWARENESS:
Does the student acknowledge challenges, costs, or resistance?

STEP 6 - TIMELINE REALISM:
Are proposed timelines realistic?

Respond with ONLY this JSON:
{
  "implementation": {
    "methods": [
      {
        "description": "method description",
        "for_strategy": "which strategy this implements",
        "specificity": "GENERIC",
        "external_example": "example cited or none",
        "example_verifiable": true,
        "contextual_fit": "POOR",
        "reasoning": "why this fit rating"
      }
    ],
    "barriers_acknowledged": true,
    "barriers_mentioned": ["list of barriers"],
    "timeline_present": true,
    "timeline_realistic": true,
    "resources_considered": true,
    "overall_realism": "LOW",
    "coaching_questions": [
      "question about how they would implement",
      "question about barriers",
      "question about other organizations"
    ]
  }
}

STUDENT SUBMISSION:
{submission}`,

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 8: Authenticity Assessment
    // ═══════════════════════════════════════════════════════════════════════════════
    branch8_authenticity: `You are assessing authenticity markers in a student's sustainability report.

IMPORTANT: This is for coaching purposes ONLY. NEVER accuse or mention AI to the student.

Your task is to find AUTHENTIC RESEARCH MARKERS:

STEP 1 - PERSONAL VOICE SCAN:
Look for:
- First person observations ("I noticed", "I found")
- Research journey descriptions ("when I read the report...")
- Genuine uncertainty ("I was not sure about...")

STEP 2 - PROCESS MARKERS:
- Description of research process
- Mention of difficulties finding information
- Evolution of understanding

STEP 3 - SPECIFICITY INDICATORS:
- Local knowledge
- Details only available from deep reading
- Quirks and informal observations

STEP 4 - PATTERN INDICATORS (internal use only):
Note any concerning patterns but DO NOT mention these to student.

Respond with ONLY this JSON:
{
  "authenticity": {
    "positive_markers": [
      {
        "type": "personal_voice",
        "quote": "exact quote showing this marker",
        "strength": "WEAK"
      }
    ],
    "marker_count": 0,
    "overall_confidence": "HIGH",
    "confidence_reasoning": "explain without mentioning AI",
    "research_depth_indicators": ["specific things suggesting real research"],
    "coaching_questions": [
      "Walk me through your research process for this assignment.",
      "What was most challenging about finding information?",
      "Did you discover anything surprising in their reports?"
    ]
  }
}

STUDENT SUBMISSION:
{submission}`,

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 9: Coaching Synthesis
    // ═══════════════════════════════════════════════════════════════════════════════
    branch9_synthesis: `You are creating the final coaching synthesis for a student's sustainability report.

COMPLETE ANALYSIS SO FAR:
Organization: {organization}
Practices Analysis: {practices_summary}
Gaps Analysis: {gaps_summary}
Strategies Analysis: {strategies_summary}
Implementation Analysis: {implementation_summary}
Authenticity: {authenticity_summary}

Your task is to synthesize this into ACTIONABLE COACHING:

STEP 1 - PRIORITY RANKING:
Rank development areas by IMPACT on learning.

STEP 2 - STRENGTH IDENTIFICATION:
What did the student do WELL? (for positive reinforcement)

STEP 3 - QUESTION SYNTHESIS:
Select the BEST 3 Socratic questions per development area.

STEP 4 - OPENING CRAFTING:
Create a warm, curious opening question that:
- Acknowledges the organization choice
- Invites discussion about their research
- Sets a collaborative tone

STEP 5 - COACHING LANGUAGE:
Convert ALL assessment language to coaching language:
- "lacks" becomes "could be strengthened"
- "weak" becomes "has potential for development"
- "missing" becomes "would benefit from"

Respond with ONLY this JSON:
{
  "coaching_output": {
    "development_areas": [
      {
        "area": "area name in coaching language",
        "priority": 1,
        "raw_finding": "what analysis found",
        "coaching_reframe": "how to discuss with student",
        "questions": [
          "Socratic question 1",
          "Socratic question 2", 
          "Socratic question 3"
        ]
      }
    ],
    "strengths": [
      {
        "area": "strength area",
        "evidence": "what showed this strength",
        "reinforcement": "exact phrase to use with student"
      }
    ],
    "opening_question": "warm opening question",
    "conversation_flow": [
      "first topic to explore",
      "second topic to explore",
      "third topic to explore"
    ],
    "grade_deflection_ready": true,
    "topics_to_avoid": ["anything that would reveal analysis"]
  }
}

REMEMBER: The student must NEVER know they are being assessed. This is coaching, not grading.`
};

// ═══════════════════════════════════════════════════════════════════════════════════
// LOG 4: 81-PATH EXECUTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════════

class FractalAnalyzer {
    constructor() {
        this.analysisState = {
            organization: null,
            practices: [],
            gaps: null,
            strategies: null,
            implementation: null,
            authenticity: null,
            synthesis: null
        };
        this.executionLog = [];
    }

    log(branch, message) {
        var entry = {
            timestamp: new Date().toISOString(),
            branch: branch,
            message: message
        };
        this.executionLog.push(entry);
        console.log('[LOG4 ' + branch + '] ' + message);
    }

    async callGroq(prompt, branch) {
        var startTime = Date.now();
        this.log(branch, 'Starting Groq call...');
        
        try {
            var response = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { 
                        role: 'system', 
                        content: 'You are an expert academic assessor. Respond with ONLY valid JSON, no markdown, no explanation.' 
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.1,
                max_tokens: 5000,
                response_format: { type: 'json_object' }
            });
            
            var latency = Date.now() - startTime;
            this.log(branch, 'Groq response received in ' + latency + 'ms');
            
            return JSON.parse(response.choices[0].message.content);
        } catch (error) {
            this.log(branch, 'ERROR: ' + error.message);
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 1: Organization Identification
    // ═══════════════════════════════════════════════════════════════════════════════
    async analyzeBranch1(submission) {
        this.log('B1', 'Executing Branch 1: Organization Identification');
        
        var prompt = LOG3_PROMPTS.branch1_organization.replace('{submission}', submission);
        var result = await this.callGroq(prompt, 'B1');
        
        this.analysisState.organization = result.organization;
        this.log('B1', 'Identified: ' + result.organization.name + ' (' + result.organization.confidence + ')');
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCHES 2-4: Practice Deep Analysis
    // ═══════════════════════════════════════════════════════════════════════════════
    async analyzePractice(submission, practiceNum) {
        var branch = 'B' + (practiceNum + 1);
        this.log(branch, 'Executing Branch ' + (practiceNum + 1) + ': Practice ' + practiceNum + ' Analysis');
        
        var prompt = LOG3_PROMPTS.branch_practice
            .replace(/{practiceNum}/g, practiceNum)
            .replace('{organization}', this.analysisState.organization ? this.analysisState.organization.name : 'the organization')
            .replace('{submission}', submission);
        
        var result = await this.callGroq(prompt, branch);
        
        this.analysisState.practices.push(result.practice);
        this.log(branch, 'Practice ' + practiceNum + ': ' + result.practice.specificity + ' specificity');
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 5: Gap Identification
    // ═══════════════════════════════════════════════════════════════════════════════
    async analyzeBranch5(submission) {
        this.log('B5', 'Executing Branch 5: Gap Identification');
        
        var practicesSummary = this.analysisState.practices.map(function(p, i) {
            return 'Practice ' + (i + 1) + ': ' + p.description + ' (' + p.specificity + ')';
        }).join('\n');
        
        var prompt = LOG3_PROMPTS.branch5_gaps
            .replace('{organization}', this.analysisState.organization ? this.analysisState.organization.name : 'the organization')
            .replace('{practices_summary}', practicesSummary)
            .replace('{submission}', submission);
        
        var result = await this.callGroq(prompt, 'B5');
        
        this.analysisState.gaps = result.gaps;
        var gapCount = result.gaps.explicit_gaps ? result.gaps.explicit_gaps.length : 0;
        this.log('B5', 'Found ' + gapCount + ' explicit gaps, quality: ' + result.gaps.overall_gap_quality);
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 6: Strategy-Gap Connection
    // ═══════════════════════════════════════════════════════════════════════════════
    async analyzeBranch6(submission) {
        this.log('B6', 'Executing Branch 6: Strategy-Gap Connection');
        
        var gapsSummary = 'No gaps identified';
        if (this.analysisState.gaps && this.analysisState.gaps.explicit_gaps) {
            gapsSummary = this.analysisState.gaps.explicit_gaps.map(function(g, i) {
                return 'Gap ' + (i + 1) + ': ' + g.description;
            }).join('\n');
        }
        
        var prompt = LOG3_PROMPTS.branch6_strategies
            .replace('{organization}', this.analysisState.organization ? this.analysisState.organization.name : 'the organization')
            .replace('{gaps_summary}', gapsSummary)
            .replace('{submission}', submission);
        
        var result = await this.callGroq(prompt, 'B6');
        
        this.analysisState.strategies = result;
        var stratCount = result.strategies ? result.strategies.length : 0;
        this.log('B6', 'Found ' + stratCount + ' strategies, quality: ' + result.overall_strategic_quality);
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 7: Implementation Realism
    // ═══════════════════════════════════════════════════════════════════════════════
    async analyzeBranch7(submission) {
        this.log('B7', 'Executing Branch 7: Implementation Realism');
        
        var strategiesSummary = 'No strategies identified';
        if (this.analysisState.strategies && this.analysisState.strategies.strategies) {
            strategiesSummary = this.analysisState.strategies.strategies.map(function(s, i) {
                return 'Strategy ' + (i + 1) + ': ' + s.description;
            }).join('\n');
        }
        
        var prompt = LOG3_PROMPTS.branch7_implementation
            .replace('{organization}', this.analysisState.organization ? this.analysisState.organization.name : 'the organization')
            .replace('{strategies_summary}', strategiesSummary)
            .replace('{submission}', submission);
        
        var result = await this.callGroq(prompt, 'B7');
        
        this.analysisState.implementation = result.implementation;
        this.log('B7', 'Implementation realism: ' + result.implementation.overall_realism);
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 8: Authenticity Assessment
    // ═══════════════════════════════════════════════════════════════════════════════
    async analyzeBranch8(submission) {
        this.log('B8', 'Executing Branch 8: Authenticity Assessment');
        
        var prompt = LOG3_PROMPTS.branch8_authenticity.replace('{submission}', submission);
        var result = await this.callGroq(prompt, 'B8');
        
        this.analysisState.authenticity = result.authenticity;
        this.log('B8', 'Authenticity confidence: ' + result.authenticity.overall_confidence + ', markers: ' + result.authenticity.marker_count);
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // BRANCH 9: Coaching Synthesis
    // ═══════════════════════════════════════════════════════════════════════════════
    async analyzeBranch9(submission) {
        this.log('B9', 'Executing Branch 9: Coaching Synthesis');
        
        var prompt = LOG3_PROMPTS.branch9_synthesis
            .replace('{organization}', JSON.stringify(this.analysisState.organization))
            .replace('{practices_summary}', JSON.stringify(this.analysisState.practices))
            .replace('{gaps_summary}', JSON.stringify(this.analysisState.gaps))
            .replace('{strategies_summary}', JSON.stringify(this.analysisState.strategies))
            .replace('{implementation_summary}', JSON.stringify(this.analysisState.implementation))
            .replace('{authenticity_summary}', JSON.stringify(this.analysisState.authenticity));
        
        var result = await this.callGroq(prompt, 'B9');
        
        this.analysisState.synthesis = result.coaching_output;
        var devCount = result.coaching_output.development_areas ? result.coaching_output.development_areas.length : 0;
        this.log('B9', 'Synthesis complete: ' + devCount + ' development areas');
        
        return result;
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // FULL 9-BRANCH EXECUTION
    // ═══════════════════════════════════════════════════════════════════════════════
    async executeFullAnalysis(submission) {
        var startTime = Date.now();
        this.log('MAIN', '═══════════════════════════════════════════════════════════');
        this.log('MAIN', 'Starting Log 3 & Log 4 Fractal Analysis');
        this.log('MAIN', 'Submission length: ' + submission.length + ' characters');
        this.log('MAIN', '═══════════════════════════════════════════════════════════');
        
        var self = this;
        
        try {
            // Branch 1: Organization (must be first)
            await this.analyzeBranch1(submission);
            
            // Branches 2-4: Practices (can run in parallel)
            this.log('MAIN', 'Starting parallel practice analysis...');
            await Promise.all([
                this.analyzePractice(submission, 1),
                this.analyzePractice(submission, 2),
                this.analyzePractice(submission, 3)
            ]);
            
            // Branch 5: Gaps (depends on practices)
            await this.analyzeBranch5(submission);
            
            // Branch 6: Strategies (depends on gaps)
            await this.analyzeBranch6(submission);
            
            // Branch 7: Implementation (depends on strategies)
            await this.analyzeBranch7(submission);
            
            // Branch 8: Authenticity (independent)
            await this.analyzeBranch8(submission);
            
            // Branch 9: Synthesis (depends on all above)
            await this.analyzeBranch9(submission);
            
            var totalTime = Date.now() - startTime;
            this.log('MAIN', '═══════════════════════════════════════════════════════════');
            this.log('MAIN', 'Analysis complete in ' + totalTime + 'ms');
            this.log('MAIN', '═══════════════════════════════════════════════════════════');
            
            return this.buildFinalOutput(totalTime);
            
        } catch (error) {
            this.log('MAIN', 'FATAL ERROR: ' + error.message);
            throw error;
        }
    }

    buildFinalOutput(totalTime) {
        return {
            organization: this.analysisState.organization,
            practices: this.analysisState.practices,
            gaps: this.analysisState.gaps,
            strategies: this.analysisState.strategies ? this.analysisState.strategies.strategies : [],
            implementation: this.analysisState.implementation,
            authenticity: this.analysisState.authenticity,
            coaching_output: this.analysisState.synthesis,
            _metadata: {
                analysisMethod: 'Log3_Log4_Fractal',
                branchesExecuted: 9,
                totalTime: totalTime,
                executionLog: this.executionLog,
                timestamp: new Date().toISOString()
            }
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════════

async function analyzeSubmission(submissionText, rubricPath) {
    // Load rubric context (used in prompts)
    var rubricContext = null;
    var defaultRubricPath = path.join(__dirname, 'rubrics', 'MAMC01810.json');
    if (fs.existsSync(rubricPath || defaultRubricPath)) {
        try {
            rubricContext = JSON.parse(fs.readFileSync(rubricPath || defaultRubricPath, 'utf8'));
            console.log('[ANALYZER] Loaded rubric: MAMC01810');
        } catch (e) {
            console.log('[ANALYZER] Using default rubric');
        }
    }
    
    // Create analyzer and run
    var analyzer = new FractalAnalyzer();
    var result = await analyzer.executeFullAnalysis(submissionText);
    
    return result;
}

function generateCoachingContext(analysis) {
    var org = analysis.organization ? analysis.organization.name : 'the organization';
    var devAreas = analysis.coaching_output ? analysis.coaching_output.development_areas : [];
    var strengths = analysis.coaching_output ? analysis.coaching_output.strengths : [];
    var openingQuestion = analysis.coaching_output ? analysis.coaching_output.opening_question : 'Tell me about your research on ' + org + '.';
    
    if (!devAreas) devAreas = [];
    if (!strengths) strengths = [];
    
    var context = '\n## STUDENT ASSESSMENT CONTEXT (Log3/Log4 Analysis)\n\n';
    context += 'The student has submitted their strategic sustainability report analyzing **' + org + '**.\n\n';
    
    // Add detailed practice findings
    if (analysis.practices && analysis.practices.length > 0) {
        context += '### PRACTICE-BY-PRACTICE ANALYSIS:\n';
        analysis.practices.forEach(function(p, i) {
            context += '\n**Practice ' + (i + 1) + ':** ' + (p.description || 'Not described') + '\n';
            context += '- Evidence Specificity: ' + (p.specificity || 'Unknown') + '\n';
            if (p.coaching_questions) {
                context += '- Coaching Questions:\n';
                p.coaching_questions.forEach(function(q) {
                    context += '  - ' + q + '\n';
                });
            }
        });
    }
    
    // Add gap analysis
    if (analysis.gaps) {
        context += '\n### GAP ANALYSIS:\n';
        context += '- Overall Quality: ' + (analysis.gaps.overall_gap_quality || 'Unknown') + '\n';
        if (analysis.gaps.explicit_gaps) {
            context += '- Explicit Gaps Found: ' + analysis.gaps.explicit_gaps.length + '\n';
        }
        if (analysis.gaps.coaching_questions) {
            context += '- Gap Coaching Questions:\n';
            analysis.gaps.coaching_questions.forEach(function(q) {
                context += '  - ' + q + '\n';
            });
        }
    }
    
    // Add strategy analysis
    if (analysis.strategies && analysis.strategies.length > 0) {
        context += '\n### STRATEGY ANALYSIS:\n';
        analysis.strategies.forEach(function(s, i) {
            context += '\n**Strategy ' + (i + 1) + ':** ' + (s.description || 'Not described') + '\n';
            context += '- Gap Connection: ' + (s.connection_quality || 'Unknown') + '\n';
            if (s.coaching_questions) {
                context += '- Coaching Questions:\n';
                s.coaching_questions.forEach(function(q) {
                    context += '  - ' + q + '\n';
                });
            }
        });
    }
    
    // Add development areas
    context += '\n### DEVELOPMENT AREAS (Focus your coaching here):\n';
    devAreas.forEach(function(d, i) {
        context += '\n' + (i + 1) + '. **' + d.area + '** (Priority ' + d.priority + ')\n';
        context += '   Raw Finding: ' + (d.raw_finding || 'See above') + '\n';
        context += '   Coaching Reframe: ' + (d.coaching_reframe || 'Develop this area') + '\n';
        if (d.questions) {
            context += '   Questions:\n';
            d.questions.forEach(function(q) {
                context += '   - ' + q + '\n';
            });
        }
    });
    
    // Add strengths
    context += '\n### STRENGTHS (Acknowledge these positively):\n';
    strengths.forEach(function(s) {
        context += '- **' + s.area + '**: ' + s.reinforcement + '\n';
    });
    
    // Add conversation flow
    context += '\n### CONVERSATION GUIDELINES:\n';
    context += '1. Start with: "' + openingQuestion + '"\n';
    if (analysis.coaching_output && analysis.coaching_output.conversation_flow) {
        context += '2. Conversation flow:\n';
        analysis.coaching_output.conversation_flow.forEach(function(topic, i) {
            context += '   ' + (i + 1) + '. ' + topic + '\n';
        });
    }
    context += '\n**REMEMBER: NEVER mention grades, scores, analysis, or AI detection.**\n';
    
    return context;
}

async function quickAnalysis(submissionText) {
    console.log('[ANALYZER] Running quick analysis (short submission)...');
    
    var response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
            { 
                role: 'system', 
                content: 'Extract the organization name from this student submission. Respond with JSON: {"organization": "name"}' 
            },
            { role: 'user', content: submissionText }
        ],
        temperature: 0.1,
        max_tokens: 800,
        response_format: { type: 'json_object' }
    });
    
    var quick = JSON.parse(response.choices[0].message.content);
    var orgName = quick.organization || 'an organization';
    
    return {
        organization: { name: orgName, industry: 'Unknown', region: 'Unknown' },
        coaching_output: {
            development_areas: [
                {
                    area: 'submission completeness',
                    priority: 1,
                    questions: [
                        'It looks like your submission might be incomplete. Can you tell me more about your research so far?',
                        'What sustainability practices have you found in your research?',
                        'Have you had a chance to look at their sustainability reports yet?'
                    ]
                }
            ],
            strengths: [],
            opening_question: 'I see you are working on analyzing ' + orgName + '. Tell me about where you are at with your research so far.'
        },
        _metadata: { quickAnalysis: true, reason: 'Submission under 500 words' }
    };
}

module.exports = {
    analyzeSubmission: analyzeSubmission,
    generateCoachingContext: generateCoachingContext,
    quickAnalysis: quickAnalysis,
    FractalAnalyzer: FractalAnalyzer
};
