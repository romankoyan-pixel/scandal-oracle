const mongoose = require('mongoose');
require('dotenv').config();

// Define Schema to match the actual data structure
const cycleSchema = new mongoose.Schema({
    id: Number,             // Some legacy records might use 'id'
    cycleId: Number,        // Newer ones use 'cycleId'
    action: String,
    score: Number,
    articles: Array,        // To get details if stored
    timestamp: Date,
    startTime: Date,
    endTime: Date
}, { strict: false });      // Strict false to handle flexible schema

const Cycle = mongoose.model('Cycle', cycleSchema);

async function inspectCycles() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected.');

        // Fetch last 50 cycles
        const cycles = await Cycle.find({})
            .sort({ _id: -1 }) // Sort by insertion time (newest first)
            .limit(50)
            .lean();

        console.log(`\n🔍 Found ${cycles.length} recent cycles (Newest First):\n`);
        console.log('ID'.padEnd(8) + ' | ' + 'ACTION'.padEnd(10) + ' | ' + 'SCORE'.padEnd(8) + ' | ' + 'DETAILS');
        console.log('-'.repeat(80));

        cycles.forEach(c => {
            const id = c.cycleId || c.id || 'N/A';
            const action = c.action || 'PENDING';
            // FIX: Use 'averageScore' as defined in Schema, falling back to 'score' if legacy
            const scoreVal = c.averageScore !== undefined ? c.averageScore : c.score;
            const score = scoreVal !== undefined ? scoreVal.toFixed(1) : 'N/A';

            let details = 'No articles';
            if (c.articles && c.articles.length > 0) {
                // Try to get title from first article
                const first = c.articles[0];
                details = `[${c.articles.length} arts] ${first.title ? first.title.substring(0, 40) + '...' : 'No title'}`;
            } else if (c.headline) {
                details = c.headline.substring(0, 50);
            }

            let color = '';
            if (action === 'MINT') color = '🟢';
            else if (action === 'BURN') color = '🔴';
            else if (action === 'NEUTRAL') color = '⚪';
            else color = '⏳';

            console.log(`${color} ${id.toString().padEnd(6)} | ${action.padEnd(10)} | ${score.padEnd(8)} | ${details}`);
        });

        console.log('\n✅ Done.');
        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
    }
}

inspectCycles();
