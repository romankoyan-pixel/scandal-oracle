const mongoose = require('mongoose');

const SystemStateSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    lastCycleId: { type: Number, default: 0 },
    seenLinks: [String],
    seenTitles: [String],
    updatedAt: { type: Date, default: Date.now }
});

// Keep only last 500 seen items to prevent unbounded growth
SystemStateSchema.methods.addSeen = function (link, title) {
    const MAX_SEEN = 500;

    if (link && !this.seenLinks.includes(link)) {
        this.seenLinks.push(link);
        if (this.seenLinks.length > MAX_SEEN) {
            this.seenLinks = this.seenLinks.slice(-MAX_SEEN);
        }
    }

    if (title && !this.seenTitles.includes(title)) {
        this.seenTitles.push(title);
        if (this.seenTitles.length > MAX_SEEN) {
            this.seenTitles = this.seenTitles.slice(-MAX_SEEN);
        }
    }

    this.updatedAt = new Date();
};

module.exports = mongoose.model('SystemState', SystemStateSchema);
