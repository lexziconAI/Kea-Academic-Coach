// ═══════════════════════════════════════════════════════════════════════════════════
// 📈 BELLMAN OPTIMIZATION - Multi-Turn Value Function
// ═══════════════════════════════════════════════════════════════════════════════════
// V(s) = R(s) + γ × Σ V(s')
// γ = 0.85 discount factor
// ═══════════════════════════════════════════════════════════════════════════════════

const GAMMA = 0.85; // Discount factor

// ═══════════════════════════════════════════════════════════════════════════════════
// SIMULATED USER REACTIONS
// ═══════════════════════════════════════════════════════════════════════════════════

const REACTION_TEMPLATES = [
    { type: 'agreement', template: "That makes sense, thanks for explaining." },
    { type: 'followup', template: "Can you tell me more about {topic}?" },
    { type: 'challenge', template: "I'm not sure I agree because {reason}." },
    { type: 'tangent', template: "What about {related_topic}?" },
    { type: 'deeper', template: "Why does {concept} work that way?" },
    { type: 'example', template: "Can you give me an example of that?" },
    { type: 'emotional', template: "This is confusing/interesting to me." },
    { type: 'meta', template: "How do you know this?" },
    { type: 'practical', template: "How would I actually apply this?" },
    { type: 'hypothetical', template: "What if {scenario} happened?" }
];

function generateReactions(pathAnalysis) {
    // Extract topics from the analysis for templating
    const topics = extractTopics(pathAnalysis);
    
    return REACTION_TEMPLATES.map(r => ({
        type: r.type,
        reaction: fillTemplate(r.template, topics)
    }));
}

function extractTopics(analysis) {
    if (!analysis) return { topic: 'this', related_topic: 'something else', concept: 'this', reason: 'I have doubts', scenario: 'something changes' };
    
    return {
        topic: analysis.organization || 'the organization',
        related_topic: (analysis.development_areas && analysis.development_areas[0]) || 'other aspects',
        concept: (analysis.strengths && analysis.strengths[0]) || 'the main point',
        reason: 'my understanding is different',
        scenario: 'the organization changed direction'
    };
}

function fillTemplate(template, topics) {
    return template
        .replace('{topic}', topics.topic)
        .replace('{related_topic}', topics.related_topic)
        .replace('{concept}', topics.concept)
        .replace('{reason}', topics.reason)
        .replace('{scenario}', topics.scenario);
}

// ═══════════════════════════════════════════════════════════════════════════════════
// REACTION SCORING (Fast Heuristics)
// ═══════════════════════════════════════════════════════════════════════════════════

function scoreReaction(reaction, pathAnalysis) {
    // Score how well the path would handle this reaction
    // Higher score = path enables good follow-up conversation
    
    const reactionScores = {
        'agreement': 0.90,      // Easy to handle
        'followup': 0.85,       // Good for depth
        'challenge': 0.70,      // Harder to handle well
        'tangent': 0.75,        // May redirect conversation
        'deeper': 0.82,         // Shows engagement
        'example': 0.88,        // Concrete and helpful
        'emotional': 0.65,      // Requires empathy
        'meta': 0.72,           // Tests credibility
        'practical': 0.85,      // Action-oriented
        'hypothetical': 0.78    // Speculative
    };
    
    let baseScore = reactionScores[reaction.type] || 0.75;
    
    // Adjust based on path quality indicators
    if (pathAnalysis) {
        // Paths with clear gaps identified handle challenges better
        if (pathAnalysis.gaps_identified && pathAnalysis.gaps_identified.length > 0) {
            if (reaction.type === 'challenge') baseScore += 0.10;
        }
        
        // Paths with coaching questions handle follow-ups better
        if (pathAnalysis.coaching_questions && pathAnalysis.coaching_questions.length >= 3) {
            if (reaction.type === 'followup' || reaction.type === 'deeper') baseScore += 0.08;
        }
        
        // Paths with examples handle example requests better
        if (pathAnalysis.strengths && pathAnalysis.strengths.length > 0) {
            if (reaction.type === 'example') baseScore += 0.05;
        }
    }
    
    return Math.min(1.0, baseScore);
}

// ═══════════════════════════════════════════════════════════════════════════════════
// BELLMAN VALUE CALCULATION
// ═══════════════════════════════════════════════════════════════════════════════════

function calculateBellmanValue(path) {
    if (!path.analysis) {
        return {
            immediateScore: 0.5,
            futureValue: 0.5,
            bellmanValue: 0.5 + GAMMA * 0.5
        };
    }
    
    // Immediate reward = constitutional score (Yamas)
    const immediateScore = path.yamas ? path.yamas.composite : 0.7;
    
    // Generate simulated reactions
    const reactions = generateReactions(path.analysis);
    
    // Score each reaction
    const reactionScores = reactions.map(r => scoreReaction(r, path.analysis));
    
    // Expected future value = average of reaction scores
    const futureValue = reactionScores.reduce((a, b) => a + b, 0) / reactionScores.length;
    
    // Bellman equation: V(s) = R(s) + γ × E[V(s')]
    const bellmanValue = immediateScore + (GAMMA * futureValue);
    
    return {
        immediateScore,
        futureValue,
        bellmanValue,
        reactionScores
    };
}

// ═══════════════════════════════════════════════════════════════════════════════════
// OPTIMIZE ALL PATHS
// ═══════════════════════════════════════════════════════════════════════════════════

function optimizePaths(paths) {
    console.log(`[BELLMAN] Calculating multi-turn value for ${paths.length} paths (γ=${GAMMA})...`);
    
    const optimized = paths.map(path => ({
        ...path,
        bellman: calculateBellmanValue(path)
    }));
    
    // Calculate final score: constitutional * 0.6 + bellman * 0.4
    optimized.forEach(path => {
        const constitutional = path.yamas ? path.yamas.composite : 0.5;
        path.finalScore = (constitutional * 0.6) + (path.bellman.bellmanValue * 0.4);
    });
    
    // Sort by final score
    optimized.sort((a, b) => b.finalScore - a.finalScore);
    
    console.log(`[BELLMAN] Top 3 paths:`);
    optimized.slice(0, 3).forEach((p, i) => {
        console.log(`[BELLMAN] ${i + 1}. Path ${p.id}: final=${p.finalScore.toFixed(3)}, constitutional=${(p.yamas?.composite || 0).toFixed(3)}, bellman=${p.bellman.bellmanValue.toFixed(3)}`);
    });
    
    return optimized;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// SELECT WINNER
// ═══════════════════════════════════════════════════════════════════════════════════

function selectWinner(optimizedPaths) {
    if (optimizedPaths.length === 0) {
        console.log('[BELLMAN] No paths to select from!');
        return null;
    }
    
    const winner = optimizedPaths[0];
    
    console.log(`[BELLMAN] ═══════════════════════════════════════════════════════`);
    console.log(`[BELLMAN] WINNER: Path ${winner.id}`);
    console.log(`[BELLMAN] Final Score: ${winner.finalScore.toFixed(4)}`);
    console.log(`[BELLMAN] Constitutional: ${(winner.yamas?.composite || 0).toFixed(4)}`);
    console.log(`[BELLMAN] Bellman Value: ${winner.bellman.bellmanValue.toFixed(4)}`);
    console.log(`[BELLMAN] Interpretation: ${winner.interpretation}`);
    console.log(`[BELLMAN] Strategy: ${winner.strategy}`);
    console.log(`[BELLMAN] ═══════════════════════════════════════════════════════`);
    
    return winner;
}

module.exports = {
    calculateBellmanValue,
    optimizePaths,
    selectWinner,
    generateReactions,
    GAMMA
};
