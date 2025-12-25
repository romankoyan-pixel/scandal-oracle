const mongoose = require('mongoose');

/**
 * Game Balance Model - Tracks user's deposited balance in the game
 * This mirrors the on-chain balance in PredictionGameV2 contract
 */
const GameBalanceSchema = new mongoose.Schema({
    wallet: {
        type: String,
        required: true,
        unique: true,
        index: true,
        lowercase: true
    },

    // Current playable balance (deposited - pending bets)
    balance: { type: Number, default: 0 },

    // Pending bet for current round (locked until round closes)
    pendingBet: {
        roundId: { type: Number, default: null },
        amount: { type: Number, default: 0 },
        prediction: { type: String, enum: ['MINT', 'BURN', 'NEUTRAL', null], default: null }
    },

    // Deposit/Withdraw history
    totalDeposited: { type: Number, default: 0 },
    totalWithdrawn: { type: Number, default: 0 },

    // Betting statistics
    totalBet: { type: Number, default: 0 },
    totalWon: { type: Number, default: 0 },
    totalLost: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },

    // Last activity
    lastDepositAt: { type: Date, default: null },
    lastWithdrawAt: { type: Date, default: null },
    lastBetAt: { type: Date, default: null },

    // Bet history (last 20 results)
    betHistory: [{
        roundId: Number,
        prediction: String,
        amount: Number,
        won: Boolean,
        payout: { type: Number, default: 0 },
        timestamp: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true
});

// Virtual for win rate
GameBalanceSchema.virtual('winRate').get(function () {
    const total = this.wins + this.losses;
    if (total === 0) return 0;
    return Math.round((this.wins / total) * 100);
});

// Virtual for profit
GameBalanceSchema.virtual('profit').get(function () {
    return this.totalWon - this.totalLost;
});

// Ensure virtuals are included in JSON
GameBalanceSchema.set('toJSON', { virtuals: true });
GameBalanceSchema.set('toObject', { virtuals: true });

// Indexes for leaderboard
GameBalanceSchema.index({ balance: -1 });
GameBalanceSchema.index({ totalWon: -1 });
GameBalanceSchema.index({ profit: -1 });

module.exports = mongoose.model('GameBalance', GameBalanceSchema);
