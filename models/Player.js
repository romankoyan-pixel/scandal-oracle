const mongoose = require('mongoose');

const PlayerSchema = new mongoose.Schema({
    wallet: {
        type: String,
        required: true,
        unique: true,
        index: true,
        lowercase: true
    },

    // Token balance
    balance: { type: Number, default: 10000 },

    // Stats
    totalWon: { type: Number, default: 0 },
    totalLost: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },

    // Streaks
    currentStreak: { type: Number, default: 0 },
    maxStreak: { type: Number, default: 0 },

    // Activity
    totalPredictions: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now },

    // Profile
    username: String,
    avatar: String
}, {
    timestamps: true
});

// Virtual for win rate
PlayerSchema.virtual('winRate').get(function () {
    const total = this.wins + this.losses;
    if (total === 0) return 0;
    return Math.round((this.wins / total) * 100);
});

// Virtual for profit
PlayerSchema.virtual('profit').get(function () {
    return this.totalWon - this.totalLost;
});

// Ensure virtuals are included in JSON
PlayerSchema.set('toJSON', { virtuals: true });
PlayerSchema.set('toObject', { virtuals: true });

// Indexes for leaderboard
PlayerSchema.index({ balance: -1 });
PlayerSchema.index({ totalWon: -1 });
PlayerSchema.index({ wins: -1 });

module.exports = mongoose.model('Player', PlayerSchema);
