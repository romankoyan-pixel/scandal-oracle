const mongoose = require('mongoose');
require('dotenv').config();

const cycleSchema = new mongoose.Schema({
    cycleId: Number,
    action: String,
    score: Number,
    headline: String,
    newSupply: Number,
    change: Number,
    timestamp: Date
});

const Cycle = mongoose.model('Cycle', cycleSchema);

async function analyzeCycles() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB connected');

        const from2764 = await Cycle.find({ cycleId: { $gte: 2764 } })
            .sort({ cycleId: 1 })
            .lean();

        const mints = from2764.filter(c => c.action === 'MINT');
        const burns = from2764.filter(c => c.action === 'BURN');
        const neutrals = from2764.filter(c => c.action === 'NEUTRAL');

        const startSupply = from2764[0]?.newSupply || 0;
        const endSupply = from2764[from2764.length - 1]?.newSupply || 0;
        const totalChange = endSupply - startSupply;

        console.log('\n📊 СТАТИСТИКА С ЦИКЛА 2764:\n');
        console.log(`Всего циклов: ${from2764.length}`);
        console.log(`  🟢 MINT: ${mints.length} (${(mints.length / from2764.length * 100).toFixed(1)}%)`);
        console.log(`  🔴 BURN: ${burns.length} (${(burns.length / from2764.length * 100).toFixed(1)}%)`);
        console.log(`  ⚪ NEUTRAL: ${neutrals.length} (${(neutrals.length / from2764.length * 100).toFixed(1)}%)`);
        console.log(`\nДиапазон: Цикл ${from2764[0]?.cycleId} → ${from2764[from2764.length - 1]?.cycleId}`);
        console.log(`Supply: ${startSupply.toLocaleString()} → ${endSupply.toLocaleString()}`);
        console.log(`Изменение: ${totalChange > 0 ? '+' : ''}${totalChange.toLocaleString()} (${(totalChange / startSupply * 100).toFixed(2)}%)`);

        console.log('\n📝 ПОСЛЕДНИЕ 20 ЦИКЛОВ:\n');
        from2764.slice(-20).forEach(c => {
            const actionEmoji = c.action === 'MINT' ? '🟢' : c.action === 'BURN' ? '🔴' : '⚪';
            const headline = c.headline || 'No headline';
            console.log(`${actionEmoji} Цикл ${c.cycleId}: ${c.action.padEnd(7)} | Score: ${c.score || 'N/A'}`.padEnd(40) + ` | ${headline.substring(0, 60)}...`);
        });

        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

analyzeCycles();
