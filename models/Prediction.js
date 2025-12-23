const mongoose = require('mongoose');

const PredictionSchema = new mongoose.Schema({
    wallet: {
        type: String,
        required: true,
        lowercase: true,
        index: true
    },
    cycleId: {
        type: Number,
        required: true,
        index: true
    },

    // Prediction details
    choice: {
        type: String,
        enum: ['MINT', 'NEUTRAL', 'BURN'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        default: 100
    },

    // Result
    result: {
        type: String,
        enum: ['pending', 'win', 'lose'],
        default: 'pending'
    },
    payout: { type: Number, default: 0 },

    // Timestamp
    placedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// Compound index for finding user's prediction in a cycle
PredictionSchema.index({ wallet: 1, cycleId: 1 }, { unique: true });

// Index for finding all predictions in a cycle
PredictionSchema.index({ cycleId: 1, choice: 1 });

module.exports = mongoose.model('Prediction', PredictionSchema);
