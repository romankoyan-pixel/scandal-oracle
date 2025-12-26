require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB Schema
const CycleSchema = new mongoose.Schema({
    cycleId: Number,
    startTime: Date,
    endTime: Date,
    status: String,
    articles: Array,
    averageScore: Number,
    action: String,
    rate: Number,
    ratePercentage: String
});

const Cycle = mongoose.model('Cycle', CycleSchema);

async function checkMongoDB() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        console.log('📍 URI:', process.env.MONGODB_URI ? 'Found in .env' : 'NOT FOUND');

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected!\n');

        // Get total count
        const totalCount = await Cycle.countDocuments();
        console.log(`📊 Total Cycles in DB: ${totalCount}`);

        // Get latest 10 cycles
        const latestCycles = await Cycle.find({ status: 'completed' })
            .sort({ cycleId: -1 })
            .limit(10)
            .select('cycleId startTime action averageScore')
            .lean();

        console.log('\n🔝 Latest 10 Cycles:');
        latestCycles.forEach((c, i) => {
            const date = new Date(c.startTime).toLocaleString('en-GB');
            console.log(`  ${i + 1}. Cycle #${c.cycleId} | ${date} | ${c.action} | Score: ${c.averageScore?.toFixed(1) || 'N/A'}`);
        });

        // Get oldest cycles
        const oldestCycles = await Cycle.find({ status: 'completed' })
            .sort({ cycleId: 1 })
            .limit(5)
            .select('cycleId startTime')
            .lean();

        console.log('\n🔻 Oldest 5 Cycles:');
        oldestCycles.forEach((c, i) => {
            const date = new Date(c.startTime).toLocaleString('en-GB');
            console.log(`  ${i + 1}. Cycle #${c.cycleId} | ${date}`);
        });

        // Check for specific cycle numbers
        const cycle2218 = await Cycle.findOne({ cycleId: 2218 });
        const cycle2702 = await Cycle.findOne({ cycleId: 2702 });

        console.log('\n🔍 Specific Cycles:');
        console.log(`  Cycle #2218: ${cycle2218 ? '✅ EXISTS' : '❌ NOT FOUND'}`);
        console.log(`  Cycle #2702: ${cycle2702 ? '✅ EXISTS' : '❌ NOT FOUND'}`);

        await mongoose.disconnect();
        console.log('\n👋 Disconnected from MongoDB');

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

checkMongoDB();
