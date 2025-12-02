// ═══════════════════════════════════════════════════════════════════════════════════
// 🧠 FRACTAL ASSESSMENT ANALYZER - FULL LOG3/LOG4 IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════════
// Complete fractal exploration system:
// 1. Generate 27 (Log3) or 81 (Log4) parallel analysis paths
// 2. Chaos-Quantum pruning (~50% reduction)
// 3. 5 Yamas Constitutional AI scoring
// 4. Bellman multi-turn optimization
// 5. Winner selection
// ═══════════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const { FractalTreeGenerator } = require('./fractal/fractalCore');
const { prunePaths } = require('./fractal/chaosQuantumPruner');
const { scoreAllPaths } = require('./fractal/yamasScorer');
const { optimizePaths, selectWinner } = require('./fractal/bellmanOptimizer');

// ═══════════════════════════════════════════════════════════════════════════════════
// COMPLEXITY CLASSIFIER
// ═══════════════════════════════════════════════════════════════════════════════════

function classifyComplexity(submission) {
    const wordCount = submission.split(/\s+/).length;
    const technicalTerms = (submission.match(/sustainability|stakeholder|strategy|implementation|metrics|evidence|carbon|emissions|renewable|ESG|SDG/gi) || []).length;
    
    if (wordCount < 200) {
        return { mode: 3, reason: 'Short submission - Log3 (27 paths)' };
    } else if (wordCount > 1000 && technicalTerms > 10) {
        return { mode: 4, reason: 'Complex submission - Log4 (81 paths)' };
    } else {
        return { mode: 3, reason: 'Standard submission - Log3 (27 paths)' };
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════
// FAST MATHEMATICAL SCORING (Zero LLM Calls)
// ═══════════════════════════════════════════════════════════════════════════════════

function fastScore(path) {
    if (!path.analysis || !path.analysis.full_analysis) {
        return { coherence: 0.3, relevance: 0.3, tone: 0.3, diversity: 0.3, fastScore: 0.3 };
    }
    
    const text = path.analysis.full_analysis;
    const words = text.split(/\s+/);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim());
    
    // Coherence (40%)
    let coherence = 0;
    if (text.length >= 50 && text.length <= 300) coherence += 0.4;
    else if (text.length < 50) coherence += 0.1;
    else if (text.length <= 500) coherence += 0.3;
    else coherence += 0.2;
    
    if (sentences.length >= 2 && sentences.length <= 4) coherence += 0.3;
    else if (sentences.length === 1) coherence += 0.1;
    else if (sentences.length <= 8) coherence += 0.25;
    else coherence += 0.15;
    
    if (/[.!?]$/.test(text.trim())) coherence += 0.2;
    if (!/\.\.\./.test(text) && !/TODO/.test(text)) coherence += 0.1;
    
    // Relevance (30%)
    let relevance = 0.5; // baseline
    if (path.analysis.organization) relevance += 0.15;
    if (path.analysis.practices_quality) relevance += 0.15;
    if (path.analysis.coaching_questions && path.analysis.coaching_questions.length > 0) relevance += 0.2;
    
    // Tone (15%)
    let tone = 0.5;
    const positive = (text.match(/help|understand|learn|great|good|strength/gi) || []).length;
    tone += Math.min(positive * 0.1, 0.3);
    const conversational = (text.match(/let's|imagine|consider|you might/gi) || []).length;
    tone += Math.min(conversational * 0.1, 0.2);
    
    // Diversity (15%) - placeholder, calculated in batch
    const diversity = 0.5;
    
    const fastScoreValue = (coherence * 0.40) + (relevance * 0.30) + (tone * 0.15) + (diversity * 0.15);
    
    return { coherence, relevance, tone, diversity, fastScore: fastScoreValue };
}

function applyFastScoring(paths) {
    console.log(`[FAST] Applying fast mathematical scoring to ${paths.length} paths...`);
    
    const scored = paths.map(path => ({
        ...path,
        fast: fastScore(path)
    }));
    
    // Calculate diversity now that we have all paths
    scored.forEach(path => {
        if (!path.analysis || !path.analysis.full_analysis) return;
        
        const words = new Set(path.analysis.full_analysis.toLowerCase().split(/\s+/));
        let totalSimilarity = 0;
        let comparisons = 0;
        
        scored.forEach(other => {
            if (other.id === path.id || !other.analysis || !other.analysis.full_analysis) return;
            const otherWords = new Set(other.analysis.full_analysis.toLowerCase().split(/\s+/));
            const intersection = [...words].filter(w => otherWords.has(w)).length;
            const union = new Set([...words, ...otherWords]).size;
            totalSimilarity += intersection / union;
            comparisons++;
        });
        
        path.fast.diversity = comparisons > 0 ? 1.0 - Math.min(totalSimilarity * 0.1, 0.9) : 0.5;
        path.fast.fastScore = (path.fast.coherence * 0.40) + (path.fast.relevance * 0.30) + 
                              (path.fast.tone * 0.15) + (path.fast.diversity * 0.15);
    });
    
    // Sort and select top paths for deep evaluation
    scored.sort((a, b) => b.fast.fastScore - a.fast.fastScore);
    const topPaths = scored.slice(0, 7);
    
    console.log(`[FAST] Top 7 paths selected for deep evaluation`);
    topPaths.forEach((p, i) => {
        console.log(`[FAST] ${i + 1}. Path ${p.id}: fastScore=${p.fast.fastScore.toFixed(3)}`);
    });
    
    return { allScored: scored, topPaths };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════════

async function analyzeSubmission(submissionText, rubricPath) {
    const startTime = Date.now();
    
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('🌀 FRACTAL EXPLORATION ENGINE - Starting Full Analysis');
    console.log('═══════════════════════════════════════════════════════════════════════');
    
    // Load rubric
    let rubricContext = null;
    const defaultRubricPath = path.join(__dirname, 'rubrics', 'MAMC01810.json');
    if (fs.existsSync(rubricPath || defaultRubricPath)) {
        try {
            rubricContext = JSON.parse(fs.readFileSync(rubricPath || defaultRubricPath, 'utf8'));
            console.log('[FRACTAL] Loaded rubric: MAMC01810');
        } catch (e) {
            console.log('[FRACTAL] Using default analysis');
        }
    }
    
    // Step 1: Classify complexity
    const complexity = classifyComplexity(submissionText);
    console.log(`[FRACTAL] Complexity: ${complexity.reason}`);
    
    // Step 2: Generate fractal tree
    const generator = new FractalTreeGenerator(complexity.mode);
    const tree = await generator.generateTree(submissionText, rubricContext);
    console.log(`[FRACTAL] Generated ${tree.totalPaths} parallel paths`);
    
    // Step 3: Chaos-Quantum pruning
    const pruned = prunePaths(tree.paths, 0.5);
    console.log(`[FRACTAL] After pruning: ${pruned.survivors.length} survivors (${pruned.statistics.reductionRate} reduction)`);
    
    // Step 4: Fast mathematical scoring
    const { topPaths } = applyFastScoring(pruned.survivors);
    
    // Step 5: Constitutional AI scoring (5 Yamas)
    const { passed } = scoreAllPaths(topPaths);
    
    // Step 6: Bellman optimization
    const optimized = optimizePaths(passed);
    
    // Step 7: Select winner
    const winner = selectWinner(optimized);
    
    const totalTime = Date.now() - startTime;
    
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`🏆 FRACTAL ANALYSIS COMPLETE in ${totalTime}ms`);
    console.log('═══════════════════════════════════════════════════════════════════════');
    
    // Build output
    return buildOutput(winner, tree, pruned, optimized, totalTime, complexity);
}

function buildOutput(winner, tree, pruned, optimized, totalTime, complexity) {
    if (!winner || !winner.analysis) {
        // Fallback if no winner
        return {
            organization: { name: 'Unknown', industry: 'Unknown', region: 'Unknown' },
            practices: [],
            gaps: { explicit_gaps: [], overall_gap_quality: 'Unknown' },
            strategies: [],
            implementation: { overall_realism: 'Unknown' },
            authenticity: { overall_confidence: 'Unknown' },
            coaching_output: {
                development_areas: [{ area: 'Analysis incomplete', priority: 1, questions: ['Tell me about your research.'] }],
                strengths: [],
                opening_question: 'Tell me about the organization you researched.'
            },
            _metadata: {
                analysisMethod: `Fractal_Log${complexity.mode}`,
                pathsGenerated: tree.totalPaths,
                pathsPruned: pruned.statistics.reductionRate,
                totalTime,
                error: 'No valid paths after filtering'
            }
        };
    }
    
    const analysis = winner.analysis;
    
    return {
        organization: {
            name: analysis.organization || 'Unknown',
            industry: 'Identified via fractal',
            region: 'Unknown'
        },
        practices: [{
            description: `Quality: ${analysis.practices_quality || 'Unknown'}`,
            specificity: analysis.practices_quality || 'GENERIC',
            coaching_questions: analysis.coaching_questions || []
        }],
        gaps: {
            explicit_gaps: (analysis.gaps_identified || []).map(g => ({ description: g })),
            overall_gap_quality: analysis.strategy_connection || 'Unknown'
        },
        strategies: [{
            description: `Connection: ${analysis.strategy_connection || 'Unknown'}`,
            connection_quality: analysis.strategy_connection || 'WEAK'
        }],
        implementation: {
            overall_realism: analysis.implementation_realism || 'Unknown'
        },
        authenticity: {
            overall_confidence: 'Assessed via Yamas',
            marker_count: winner.yamas ? Math.round(winner.yamas.satya * 10) : 0
        },
        coaching_output: {
            development_areas: (analysis.development_areas || []).map((area, i) => ({
                area: area,
                priority: i + 1,
                raw_finding: area,
                coaching_reframe: `Opportunity to strengthen ${area}`,
                questions: analysis.coaching_questions || []
            })),
            strengths: (analysis.strengths || []).map(s => ({
                area: s,
                evidence: 'Identified via fractal analysis',
                reinforcement: `Good work on ${s}`
            })),
            opening_question: analysis.opening_question || 'Tell me about your research.',
            conversation_flow: ['Discuss organization choice', 'Explore practices found', 'Develop strategies']
        },
        _metadata: {
            analysisMethod: `Fractal_Log${complexity.mode}`,
            pathsGenerated: tree.totalPaths,
            pathsSurvived: pruned.survivors.length,
            pathsPassed: optimized.length,
            winnerPath: winner.id,
            winnerScore: winner.finalScore,
            yamasScores: winner.yamas,
            bellmanValue: winner.bellman?.bellmanValue,
            totalTime,
            timestamp: new Date().toISOString()
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// COACHING CONTEXT GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════════

function generateCoachingContext(analysis) {
    const org = analysis.organization?.name || 'the organization';
    const devAreas = analysis.coaching_output?.development_areas || [];
    const strengths = analysis.coaching_output?.strengths || [];
    const openingQuestion = analysis.coaching_output?.opening_question || `Tell me about your research on ${org}.`;
    
    let context = `\n## STUDENT ASSESSMENT CONTEXT (Fractal Log${analysis._metadata?.analysisMethod?.includes('4') ? '4' : '3'} Analysis)\n\n`;
    context += `The student has submitted their strategic sustainability report analyzing **${org}**.\n\n`;
    
    // Metadata
    if (analysis._metadata) {
        context += `### ANALYSIS METADATA:\n`;
        context += `- Paths Generated: ${analysis._metadata.pathsGenerated || 'N/A'}\n`;
        context += `- Paths Survived Pruning: ${analysis._metadata.pathsSurvived || 'N/A'}\n`;
        context += `- Winner Path: ${analysis._metadata.winnerPath || 'N/A'}\n`;
        context += `- Winner Score: ${analysis._metadata.winnerScore?.toFixed(4) || 'N/A'}\n`;
        context += `- Analysis Time: ${analysis._metadata.totalTime || 'N/A'}ms\n\n`;
    }
    
    // Yamas scores
    if (analysis._metadata?.yamasScores) {
        const y = analysis._metadata.yamasScores;
        context += `### CONSTITUTIONAL SCORES (5 Yamas):\n`;
        context += `- Ahimsa (Compassion): ${(y.ahimsa * 100).toFixed(0)}%\n`;
        context += `- Satya (Truthfulness): ${(y.satya * 100).toFixed(0)}%\n`;
        context += `- Asteya (Respect): ${(y.asteya * 100).toFixed(0)}%\n`;
        context += `- Brahmacharya (Ethics): ${(y.brahmacharya * 100).toFixed(0)}%\n`;
        context += `- Aparigraha (Adaptability): ${(y.aparigraha * 100).toFixed(0)}%\n\n`;
    }
    
    // Development areas
    context += `### DEVELOPMENT AREAS (Focus your coaching here):\n`;
    devAreas.forEach((d, i) => {
        context += `\n${i + 1}. **${d.area}** (Priority ${d.priority})\n`;
        if (d.questions && d.questions.length > 0) {
            context += `   Questions:\n`;
            d.questions.forEach(q => {
                context += `   - ${q}\n`;
            });
        }
    });
    
    // Strengths
    context += `\n### STRENGTHS (Acknowledge these positively):\n`;
    strengths.forEach(s => {
        context += `- **${s.area}**: ${s.reinforcement}\n`;
    });
    
    // Conversation guidelines
    context += `\n### CONVERSATION GUIDELINES:\n`;
    context += `1. Start with: "${openingQuestion}"\n`;
    context += `2. Use Socratic questioning to guide discovery\n`;
    context += `3. Never reveal grades, scores, or this analysis\n`;
    context += `\n**REMEMBER: You are a coach, not a judge.**\n`;
    
    return context;
}

module.exports = {
    analyzeSubmission,
    generateCoachingContext,
    classifyComplexity
};
