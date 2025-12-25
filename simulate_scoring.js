// Simulation script for new scoring system
// Run with: node simulate_scoring.js

const fs = require('fs');

// Category weights (matching actual RSS_FEEDS categories)
const CATEGORY_WEIGHTS = {
    politics: 1.5,    // Government/policy - major market impact
    breaking: 1.5,    // Breaking news - immediate impact
    crypto: 1.4,      // Crypto news - direct relevance to our token
    business: 1.3,    // Corporate/economy news
    world: 1.0,       // Global events - varied impact
    tech: 1.0,        // Technology news
    science: 0.8,     // Science discoveries - lower financial impact
    sports: 0.6,      // Sports - low market impact
    esports: 0.5      // Gaming/esports - minimal market impact
};

// OLD scoring thresholds
function oldCalculate(avgScore) {
    if (avgScore < 33) return 'MINT';
    if (avgScore > 66) return 'BURN';
    return 'NEUTRAL';
}

// NEW scoring thresholds (narrower NEUTRAL: 40-60 = 21 points)
function newCalculate(avgScore) {
    if (avgScore < 40) return 'MINT';
    if (avgScore > 60) return 'BURN';
    return 'NEUTRAL';
}

// Calculate weighted average with new system
function calculateWeightedScore(articles) {
    if (!articles || articles.length === 0) return 50;

    let weightedSum = 0;
    let totalWeight = 0;

    articles.forEach(article => {
        const score = article.score || 50;
        const category = (article.category || 'world').toLowerCase();

        // Base weight from category
        let baseWeight = CATEGORY_WEIGHTS[category] || 1.0;

        // Extreme score multiplier (x2 for scores <=15 or >=85)
        if (score <= 15 || score >= 85) {
            baseWeight *= 2;
        }

        weightedSum += score * baseWeight;
        totalWeight += baseWeight;
    });

    return totalWeight > 0 ? weightedSum / totalWeight : 50;
}

// Load data
console.log('Loading oracle data...\n');
let data;
try {
    data = JSON.parse(fs.readFileSync('oracle_data.json', 'utf8'));
} catch (e) {
    console.log('Error loading oracle_data.json:', e.message);
    process.exit(1);
}

const cycles = data.cycles || [];
console.log(`Found ${cycles.length} total cycles\n`);

// Take last 300 or all available
const cyclesToAnalyze = cycles.slice(-300);
console.log(`Analyzing last ${cyclesToAnalyze.length} cycles...\n`);

// Stats
let oldStats = { MINT: 0, BURN: 0, NEUTRAL: 0 };
let newStats = { MINT: 0, BURN: 0, NEUTRAL: 0 };
let changes = { toMINT: 0, toBURN: 0, toNEUTRAL: 0, unchanged: 0 };

// Detailed analysis
let extremeArticles = 0;
let categoryCount = {};

cyclesToAnalyze.forEach(cycle => {
    const articles = cycle.articles || [];

    // Count categories
    articles.forEach(a => {
        const cat = (a.category || 'unknown').toLowerCase();
        categoryCount[cat] = (categoryCount[cat] || 0) + 1;

        // Count extreme articles
        if (a.score <= 15 || a.score >= 85) {
            extremeArticles++;
        }
    });

    // OLD: Simple average
    const oldAvg = articles.length > 0
        ? articles.reduce((sum, a) => sum + (a.score || 50), 0) / articles.length
        : 50;
    const oldResult = oldCalculate(oldAvg);
    oldStats[oldResult]++;

    // NEW: Weighted average
    const newAvg = calculateWeightedScore(articles);
    const newResult = newCalculate(newAvg);
    newStats[newResult]++;

    // Track changes
    if (oldResult !== newResult) {
        if (newResult === 'MINT') changes.toMINT++;
        else if (newResult === 'BURN') changes.toBURN++;
        else changes.toNEUTRAL++;
    } else {
        changes.unchanged++;
    }
});

// Print results
console.log('='.repeat(60));
console.log('                    SIMULATION RESULTS');
console.log('='.repeat(60));

console.log('\n📊 OLD SCORING SYSTEM (thresholds 33/66):');
console.log(`   MINT:    ${oldStats.MINT} cycles (${(oldStats.MINT / cyclesToAnalyze.length * 100).toFixed(1)}%)`);
console.log(`   NEUTRAL: ${oldStats.NEUTRAL} cycles (${(oldStats.NEUTRAL / cyclesToAnalyze.length * 100).toFixed(1)}%)`);
console.log(`   BURN:    ${oldStats.BURN} cycles (${(oldStats.BURN / cyclesToAnalyze.length * 100).toFixed(1)}%)`);

console.log('\n📊 NEW SCORING SYSTEM (thresholds 43/57 + weights):');
console.log(`   MINT:    ${newStats.MINT} cycles (${(newStats.MINT / cyclesToAnalyze.length * 100).toFixed(1)}%)`);
console.log(`   NEUTRAL: ${newStats.NEUTRAL} cycles (${(newStats.NEUTRAL / cyclesToAnalyze.length * 100).toFixed(1)}%)`);
console.log(`   BURN:    ${newStats.BURN} cycles (${(newStats.BURN / cyclesToAnalyze.length * 100).toFixed(1)}%)`);

console.log('\n🔄 CHANGES from old to new:');
console.log(`   Changed to MINT:    ${changes.toMINT}`);
console.log(`   Changed to BURN:    ${changes.toBURN}`);
console.log(`   Changed to NEUTRAL: ${changes.toNEUTRAL}`);
console.log(`   Unchanged:          ${changes.unchanged}`);

console.log('\n📰 ARTICLE STATISTICS:');
console.log(`   Total articles analyzed: ${Object.values(categoryCount).reduce((a, b) => a + b, 0)}`);
console.log(`   Extreme articles (score ≤15 or ≥85): ${extremeArticles}`);
console.log('\n   By category:');
Object.entries(categoryCount)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, count]) => {
        const weight = CATEGORY_WEIGHTS[cat] || 1.0;
        console.log(`   - ${cat}: ${count} articles (weight: ${weight}x)`);
    });

console.log('\n' + '='.repeat(60));
console.log('Simulation complete!');

// Save to file for easier reading
const output = `
SIMULATION RESULTS
==================

Cycles analyzed: ${cyclesToAnalyze.length}

OLD SCORING (thresholds 33/66):
  MINT:    ${oldStats.MINT} (${(oldStats.MINT / cyclesToAnalyze.length * 100).toFixed(1)}%)
  NEUTRAL: ${oldStats.NEUTRAL} (${(oldStats.NEUTRAL / cyclesToAnalyze.length * 100).toFixed(1)}%)
  BURN:    ${oldStats.BURN} (${(oldStats.BURN / cyclesToAnalyze.length * 100).toFixed(1)}%)

NEW SCORING (thresholds 40/60 + weights):
  MINT:    ${newStats.MINT} (${(newStats.MINT / cyclesToAnalyze.length * 100).toFixed(1)}%)
  NEUTRAL: ${newStats.NEUTRAL} (${(newStats.NEUTRAL / cyclesToAnalyze.length * 100).toFixed(1)}%)
  BURN:    ${newStats.BURN} (${(newStats.BURN / cyclesToAnalyze.length * 100).toFixed(1)}%)

CHANGES:
  To MINT:    ${changes.toMINT}
  To BURN:    ${changes.toBURN}
  To NEUTRAL: ${changes.toNEUTRAL}
  Unchanged:  ${changes.unchanged}

ARTICLES:
  Total: ${Object.values(categoryCount).reduce((a, b) => a + b, 0)}
  Extreme (<=15 or >=85): ${extremeArticles}
  
BY CATEGORY:
${Object.entries(categoryCount).sort((a, b) => b[1] - a[1]).map(([cat, count]) => `  ${cat}: ${count} (weight: ${CATEGORY_WEIGHTS[cat] || 1.0}x)`).join('\n')}
`;

fs.writeFileSync('simulation_results.txt', output);
console.log('\nResults saved to simulation_results.txt');
