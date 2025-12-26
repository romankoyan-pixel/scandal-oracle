const mongoose = require('mongoose');
require('dotenv').config();

const cycleSchema = new mongoose.Schema({
    cycleId: Number,
    action: String,
    score: Number,
    headline: String,
    description: String,
    newSupply: Number,
    timestamp: Date
});

const Cycle = mongoose.model('Cycle', cycleSchema);

async function showRealNews() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);

        const from2764 = await Cycle.find({ cycleId: { $gte: 2764 } })
            .sort({ cycleId: -1 })
            .limit(30)
            .lean();

        console.log('\n📰 ПОСЛЕДНИЕ 30 РЕАЛЬНЫХ НОВОСТЕЙ:\n');
        console.log('='.repeat(120));

        from2764.reverse().forEach(c => {
            const emoji = c.action === 'MINT' ? '🟢' : c.action === 'BURN' ? '🔴' : '⚪';
            console.log(`\n${emoji} ЦИКЛ ${c.cycleId} | ${c.action} | Score: ${c.score || 'N/A'}`);
            console.log(`📌 ${c.headline || 'No headline'}`);
            console.log(`📝 ${(c.description || 'No description').substring(0, 200)}...`);
            console.log('-'.repeat(120));
        });

        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

showRealNews();
