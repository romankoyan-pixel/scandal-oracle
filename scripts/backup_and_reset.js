const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI not found in .env');
    process.exit(1);
}

// Define generic schema to read any collection
const getModel = (collectionName) => {
    return mongoose.model(collectionName, new mongoose.Schema({}, { strict: false }), collectionName);
};

// Main function
async function backupAndReset() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected');

        // Create backup directory with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDir = path.join(__dirname, '..', 'backups', `backup-${timestamp}`);

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        console.log(`📂 Backup directory: ${backupDir}`);

        // Get all collections
        const collections = await mongoose.connection.db.listCollections().toArray();

        for (const collection of collections) {
            const name = collection.name;
            console.log(`Processing collection: ${name}...`);

            // 1. Backup
            const Model = getModel(name);
            const data = await Model.find({}).lean();

            const filePath = path.join(backupDir, `${name}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`  Start backup: ${data.length} documents saved to ${filePath}`);

            // 2. Clear (Drop)
            if (data.length > 0) {
                await mongoose.connection.db.dropCollection(name);
                console.log(`  🗑️ Collection ${name} dropped.`);
            } else {
                console.log(`  Skipping drop (empty)`);
            }
        }

        console.log('✅ Backup and Reset completed successfully.');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected');
        process.exit(0);
    }
}

backupAndReset();
