const mongoose = require('mongoose');
require('dotenv').config();

async function checkDatabases() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const admin = mongoose.connection.db.admin();
        const { databases } = await admin.listDatabases();

        console.log('📂 DATABASES IN YOUR CLUSTER:\n');
        databases.forEach(db => {
            const sizeMB = (db.sizeOnDisk / (1024 * 1024)).toFixed(2);
            const emoji = db.name.includes('sample') ? '❌' : '✅';
            console.log(`${emoji} ${db.name.padEnd(30)} | ${sizeMB} MB`);
        });

        console.log('\n💡 РЕКОМЕНДАЦИИ:');
        console.log('❌ sample_mflix - УДАЛИТЬ (тестовая база, не нужна)');
        console.log('✅ scandal-oracle - ОСТАВИТЬ (твой проект)\n');

        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkDatabases();
