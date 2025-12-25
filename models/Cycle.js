const mongoose = require('mongoose');

const ArticleSchema = new mongoose.Schema({
    title: String,
    description: String,
    source: String,
    url: String,
    publishedAt: Date,
    score: Number,
    analysis: String,
    sentiment: String
});

const CycleSchema = new mongoose.Schema({
    cycleId: { type: Number, required: true, unique: true, index: true },
    startTime: { type: Date, required: true },
    endTime: Date,
    status: {
        type: String,
        enum: ['active', 'completed'],
        default: 'active'
    },
    articles: [ArticleSchema],
    averageScore: { type: Number, default: 50 },
    action: {
        type: String,
        enum: ['MINT', 'NEUTRAL', 'BURN'],
        default: 'NEUTRAL'
    },
    rate: { type: Number, default: 0 },
    ratePercentage: { type: String, default: '0%' },

    // Supply tracking for chart
    supplyBefore: { type: Number, default: 1000000000 },
    supplyAfter: { type: Number, default: 1000000000 },
    supplyChange: { type: Number, default: 0 },

    // Pool statistics
    pool: {
        mint: { type: Number, default: 0 },
        neutral: { type: Number, default: 0 },
        burn: { type: Number, default: 0 },
        total: { type: Number, default: 0 }
    },

    // Winning info
    winningChoice: String,
    winnersCount: { type: Number, default: 0 },
    prizePerWinner: { type: Number, default: 0 }
}, {
    timestamps: true
});

// Index for finding latest cycles
CycleSchema.index({ startTime: -1 });
CycleSchema.index({ status: 1, startTime: -1 });

module.exports = mongoose.model('Cycle', CycleSchema);
