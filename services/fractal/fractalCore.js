// ═══════════════════════════════════════════════════════════════════════════════════
// 🌀 FRACTAL CORE - 27/81 Path Generation Engine
// ═══════════════════════════════════════════════════════════════════════════════════

const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ═══════════════════════════════════════════════════════════════════════════════════
// LOG3 MODE: 3 × 3 × 3 = 27 PATHS
// LOG4 MODE: 3 × 3 × 3 × 3 = 81 PATHS
// ═══════════════════════════════════════════════════════════════════════════════════

const INTERPRETATIONS = [
    { id: 'literal', description: 'Literal interpretation - exactly what the text says' },
    { id: 'implicit', description: 'Implicit intent - what the student is really trying to convey' },
    { id: 'meta', description: 'Meta-level - underlying patterns and assumptions' }
];

const STRATEGIES = [
    { id: 'technical', description: 'Technical/precise - focus on accuracy and detail' },
    { id: 'intuitive', description: 'Intuitive/analogical - connections and patterns' },
    { id: 'practical', description: 'Practical/actionable - what can be improved' }
];

const REFINEMENTS = [
    { id: 'concise', description: 'Concise analysis (key points only)', wordTarget: 100 },
    { id: 'standard', description: 'Standard analysis (with examples)', wordTarget: 200 },
    { id: 'detailed', description: 'Detailed analysis (comprehensive)', wordTarget: 350 }
];

const POLISHES = [
    { id: 'formal', description: 'Formal/academic tone' },
    { id: 'conversational', description: 'Conversational/friendly tone' },
    { id: 'encouraging', description: 'Encouraging/supportive tone' }
];

// ═══════════════════════════════════════════════════════════════════════════════════
// FRACTAL TREE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════════

class FractalTreeGenerator {
    constructor(mode = 3) {
        this.mode = mode; // 3 = Log3 (27 paths), 4 = Log4 (81 paths)
        this.totalPaths = mode === 3 ? 27 : 81;
    }

    generatePathCombinations() {
        const paths = [];
        let pathId = 1;

        for (const interp of INTERPRETATIONS) {
            for (const strat of STRATEGIES) {
                for (const refine of REFINEMENTS) {
                    if (this.mode === 4) {
                        for (const polish of POLISHES) {
                            paths.push({
                                id: pathId++,
                                interpretation: interp,
                                strategy: strat,
                                refinement: refine,
                                polish: polish
                            });
                        }
                    } else {
                        paths.push({
                            id: pathId++,
                            interpretation: interp,
                            strategy: strat,
                            refinement: refine,
                            polish: POLISHES[1] // Default conversational
                        });
                    }
                }
            }
        }
        return paths;
    }

    buildBatchPrompt(submission, rubricContext, pathCombinations) {
        const batchPrompt = `You are a Fractal Exploration Engine analyzing a student sustainability report.

SUBMISSION TO ANALYZE:
"""
${submission.substring(0, 8000)}
"""

RUBRIC CRITERIA:
- Current Practices: Evidence specificity (metrics, dates, sources)
- Strategic Strategies: Gap-to-strategy connection quality
- Implementation Methods: Realism and examples
- Written Presentation: Structure and referencing

YOUR TASK: Generate ${pathCombinations.length} PARALLEL analysis paths.

Each path explores a different combination of:
- INTERPRETATION: How to understand the student's work
- STRATEGY: How to analyze it
- REFINEMENT: How deep to go
- POLISH: What tone for coaching

OUTPUT FORMAT: Return a JSON object with this structure:
{
  "paths": [
    {
      "id": 1,
      "interpretation": "description",
      "strategy": "description", 
      "refinement": "description",
      "analysis": {
        "organization": "identified org name",
        "practices_quality": "GENERIC|SPECIFIC|DETAILED",
        "evidence_score": 0.0-1.0,
        "gaps_identified": ["gap1", "gap2"],
        "strategy_connection": "NONE|WEAK|CLEAR",
        "implementation_realism": "LOW|MEDIUM|HIGH",
        "strengths": ["strength1"],
        "development_areas": ["area1"],
        "coaching_questions": ["q1", "q2", "q3"],
        "opening_question": "warm opening",
        "full_analysis": "complete 100-350 word analysis"
      }
    }
  ]
}

GENERATE ALL ${pathCombinations.length} PATHS NOW:

${pathCombinations.map((p, i) => `
PATH ${p.id}:
- Interpretation: ${p.interpretation.description}
- Strategy: ${p.strategy.description}
- Refinement: ${p.refinement.description}
- Polish: ${p.polish.description}
`).join('\n')}`;

        return batchPrompt;
    }

    async generateTree(submission, rubricContext) {
        const combinations = this.generatePathCombinations();
        console.log(`[FRACTAL] Generating ${this.totalPaths} parallel paths (Log${this.mode} mode)...`);

        // For practical reasons, we batch into groups of 9 paths per Groq call
        const batchSize = 9;
        const batches = [];
        
        for (let i = 0; i < combinations.length; i += batchSize) {
            batches.push(combinations.slice(i, i + batchSize));
        }

        console.log(`[FRACTAL] Split into ${batches.length} batches of ${batchSize} paths each`);

        // Execute batches in parallel (3 at a time for rate limiting)
        const allPaths = [];
        const parallelLimit = 3;

        for (let i = 0; i < batches.length; i += parallelLimit) {
            const batchGroup = batches.slice(i, i + parallelLimit);
            const batchPromises = batchGroup.map((batch, idx) => 
                this.executeBatch(submission, rubricContext, batch, i + idx)
            );
            
            const results = await Promise.all(batchPromises);
            results.forEach(paths => allPaths.push(...paths));
            
            console.log(`[FRACTAL] Completed batches ${i + 1}-${Math.min(i + parallelLimit, batches.length)} of ${batches.length}`);
        }

        return {
            mode: this.mode,
            totalPaths: allPaths.length,
            paths: allPaths,
            metadata: {
                generationTimestamp: new Date().toISOString(),
                submissionLength: submission.length
            }
        };
    }

    async executeBatch(submission, rubricContext, pathCombinations, batchIndex) {
        const prompt = this.buildBatchPrompt(submission, rubricContext, pathCombinations);
        
        try {
            const response = await groq.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    { 
                        role: 'system', 
                        content: 'You are a fractal analysis engine. Generate multiple parallel analysis paths. Return ONLY valid JSON.' 
                    },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7, // Higher for diversity
                max_tokens: 4000,
                response_format: { type: 'json_object' }
            });

            const result = JSON.parse(response.choices[0].message.content);
            return result.paths || [];
        } catch (error) {
            console.error(`[FRACTAL] Batch ${batchIndex} error:`, error.message);
            // Return empty paths with error markers
            return pathCombinations.map(p => ({
                id: p.id,
                interpretation: p.interpretation.description,
                strategy: p.strategy.description,
                error: error.message,
                analysis: null
            }));
        }
    }
}

module.exports = { FractalTreeGenerator, INTERPRETATIONS, STRATEGIES, REFINEMENTS, POLISHES };
