// ═══════════════════════════════════════════════════════════════════════════════════
// 🌪️ CHAOS-QUANTUM PRUNING - Lyapunov Divergence + Variance Filtering
// ═══════════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════════
// FEATURE EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════════

function extractFeatures(path) {
    if (!path.analysis || !path.analysis.full_analysis) {
        return [0, 0, 0, 0, 0, 0, 0];
    }
    
    const text = path.analysis.full_analysis;
    const words = text.split(/\s+/);
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    
    return [
        text.length,                                           // Response length
        sentences.length,                                      // Sentence count
        words.length > 0 ? text.length / words.length : 0,    // Avg word length
        (text.match(/\?/g) || []).length,                     // Question marks
        (text.match(/!/g) || []).length,                      // Exclamations
        calculateTechnicalDensity(text),                       // Technical term density
        calculateSentiment(text)                               // Sentiment (-1 to 1)
    ];
}

function calculateTechnicalDensity(text) {
    const technicalTerms = [
        'sustainability', 'stakeholder', 'implementation', 'strategy',
        'metrics', 'evidence', 'analysis', 'framework', 'carbon',
        'emissions', 'renewable', 'circular', 'ESG', 'SDG', 'scope'
    ];
    const words = text.toLowerCase().split(/\s+/);
    const techCount = words.filter(w => technicalTerms.some(t => w.includes(t))).length;
    return words.length > 0 ? techCount / words.length : 0;
}

function calculateSentiment(text) {
    const positive = ['good', 'great', 'excellent', 'strong', 'clear', 'well', 'effective'];
    const negative = ['weak', 'poor', 'lacking', 'missing', 'unclear', 'vague', 'generic'];
    
    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    words.forEach(w => {
        if (positive.some(p => w.includes(p))) score += 0.1;
        if (negative.some(n => w.includes(n))) score -= 0.1;
    });
    return Math.max(-1, Math.min(1, score));
}

// ═══════════════════════════════════════════════════════════════════════════════════
// CHAOS METRIC (Lyapunov-Inspired Divergence)
// ═══════════════════════════════════════════════════════════════════════════════════

function calculateChaos(pathA, pathB) {
    const featuresA = extractFeatures(pathA);
    const featuresB = extractFeatures(pathB);
    
    // Euclidean distance between feature vectors
    let sumSquares = 0;
    for (let i = 0; i < featuresA.length; i++) {
        sumSquares += Math.pow(featuresA[i] - featuresB[i], 2);
    }
    const distance = Math.sqrt(sumSquares);
    
    // Logarithmic separation (Lyapunov-inspired)
    const chaosScore = Math.log(Math.max(distance, 1e-10)) / featuresA.length;
    
    return chaosScore;
}

function calculatePathChaos(path, allPaths) {
    let totalChaos = 0;
    let comparisons = 0;
    
    for (const other of allPaths) {
        if (other.id !== path.id) {
            totalChaos += calculateChaos(path, other);
            comparisons++;
        }
    }
    
    return comparisons > 0 ? totalChaos / comparisons : 0;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// QUANTUM UNCERTAINTY (Variance-Based)
// ═══════════════════════════════════════════════════════════════════════════════════

function calculateQuantum(path) {
    if (!path.analysis) return 0;
    
    // Extract numeric scores from analysis
    const scores = [
        path.analysis.evidence_score || 0.5,
        mapQualityToScore(path.analysis.practices_quality),
        mapConnectionToScore(path.analysis.strategy_connection),
        mapRealismToScore(path.analysis.implementation_realism),
        0.5 // baseline
    ];
    
    // Calculate variance
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    
    // Branch count (how many dimensions this path explored)
    const branchCount = 6; // interpretation + strategy + refinement branches
    
    // Quantum score
    return variance * Math.log(branchCount + 1);
}

function mapQualityToScore(quality) {
    const map = { 'GENERIC': 0.3, 'SPECIFIC': 0.6, 'DETAILED': 0.9 };
    return map[quality] || 0.5;
}

function mapConnectionToScore(connection) {
    const map = { 'NONE': 0.2, 'WEAK': 0.5, 'CLEAR': 0.85 };
    return map[connection] || 0.5;
}

function mapRealismToScore(realism) {
    const map = { 'LOW': 0.3, 'MEDIUM': 0.6, 'HIGH': 0.9 };
    return map[realism] || 0.5;
}

// ═══════════════════════════════════════════════════════════════════════════════════
// COMBINED CHAOS-QUANTUM PRUNING
// ═══════════════════════════════════════════════════════════════════════════════════

function prunePaths(paths, targetSurvivalRate = 0.5) {
    console.log(`[PRUNE] Starting chaos-quantum pruning on ${paths.length} paths...`);
    
    // Calculate chaos and quantum for each path
    const scoredPaths = paths.map(path => ({
        ...path,
        chaos: calculatePathChaos(path, paths),
        quantum: calculateQuantum(path)
    }));
    
    // Combined score: chaos * 0.6 + quantum * 0.4
    scoredPaths.forEach(path => {
        path.combinedScore = (path.chaos * 0.6) + (path.quantum * 0.4);
    });
    
    // Sort by combined score (higher = more diverse/exploratory)
    scoredPaths.sort((a, b) => b.combinedScore - a.combinedScore);
    
    // Keep top targetSurvivalRate paths
    const targetCount = Math.ceil(paths.length * targetSurvivalRate);
    const survivors = scoredPaths.slice(0, targetCount);
    const killed = scoredPaths.slice(targetCount);
    
    console.log(`[PRUNE] Survivors: ${survivors.length}, Killed: ${killed.length}`);
    
    // Log survival reasons
    survivors.forEach(p => {
        console.log(`[PRUNE] Path ${p.id} SURVIVED: chaos=${p.chaos.toFixed(3)}, quantum=${p.quantum.toFixed(4)}, combined=${p.combinedScore.toFixed(4)}`);
    });
    
    killed.slice(0, 5).forEach(p => {
        console.log(`[PRUNE] Path ${p.id} KILLED: Low divergence (combined=${p.combinedScore.toFixed(4)})`);
    });
    
    return {
        survivors,
        killed,
        statistics: {
            initialCount: paths.length,
            survivorCount: survivors.length,
            reductionRate: ((paths.length - survivors.length) / paths.length * 100).toFixed(1) + '%',
            avgChaos: (survivors.reduce((s, p) => s + p.chaos, 0) / survivors.length).toFixed(4),
            avgQuantum: (survivors.reduce((s, p) => s + p.quantum, 0) / survivors.length).toFixed(5)
        }
    };
}

module.exports = {
    prunePaths,
    calculateChaos,
    calculateQuantum,
    extractFeatures
};
