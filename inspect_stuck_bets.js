const mongoose = require('mongoose');
require('dotenv').config();

const GameBalanceSchema = new mongoose.Schema({
    wallet: String,
    balance: Number,
    pendingBet: {
        roundId: Number,
        amount: Number,
        prediction: String
    },
    betHistory: Array
}, { strict: false });

const GameBalance = mongoose.model('GameBalance', GameBalanceSchema);

// We need to know the current cycle ID to know what is "stuck"
// Let's guess it's around 2903 based on the screenshot
// But ideally we'd fetch it from the Cycle collection
const cycleSchema = new mongoose.Schema({ cycleId: Number, status: String });
const Cycle = mongoose.model('Cycle', cycleSchema);

async function inspect() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected.');

        // Get latest cycle
        const latestCycle = await Cycle.findOne().sort({ cycleId: -1 });
        const currentCycleId = latestCycle ? latestCycle.cycleId : 0;
        console.log(`ℹ️ Current Cycle ID seems to be: ${currentCycleId}`);

        // Find ALL pending bets
        const pending = await GameBalance.find({
            'pendingBet.roundId': { $ne: null }
        });

        console.log(`\n🔍 Found ${pending.length} wallets with pending bets:\n`);

        pending.forEach(p => {
            const bet = p.pendingBet;
            const isStuck = bet.roundId < currentCycleId;
            const status = isStuck ? '🔴 STUCK (Old Round)' : '🟢 OK (Current Round)';

            console.log(`Wallet: ${p.wallet}`);
            console.log(`   ID: ${bet.roundId}`);
            console.log(`   Amt: ${bet.amount}`);
            console.log(`   Pred: ${bet.prediction}`);
            console.log(`   Status: ${status}`);
            console.log('---');
        });

        if (pending.length === 0) {
            console.log('✅ No pending bets found. The database is clean.');
            console.log('If user sees "Pending", maybe it is a frontend cache issue?');
        }

        await mongoose.disconnect();
    } catch (e) {
        console.error(e);
    }
}

inspect();
