const mongoose = require('mongoose');
require('dotenv').config();

const cycleSchema = new mongoose.Schema({
    cycleId: Number,
    action: String,
    averageScore: Number,
    articles: [{
        title: String,
        description: String,
        score: Number,
        analysis: String,
        sentiment: String,
        source: String
    }],
    timestamp: Date
});

const Cycle = mongoose.model('Cycle', cycleSchema);

async function analyzeRSSNews() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB connected\n');

        // Найти последние 20 циклов с articles
        const cycles = await Cycle.find({
            cycleId: { $gte: 2764 },
            'articles.0': { $exists: true } // Только с новостями
        })
            .sort({ cycleId: -1 })
            .limit(20)
            .lean();

        console.log('📰 ЧТО ПРИХОДИТ ИЗ RSS И КАК GPT ОЦЕНИВАЕТ:\n');
        console.log('='.repeat(120));

        cycles.reverse().forEach(cycle => {
            const emoji = cycle.action === 'MINT' ? '🟢' : cycle.action === 'BURN' ? '🔴' : '⚪';

            console.log(`\n${emoji} ЦИКЛ ${cycle.cycleId} | ${cycle.action} | Avg Score: ${cycle.averageScore || 'N/A'}`);
            console.log('-'.repeat(120));

            if (cycle.articles && cycle.articles.length > 0) {
                cycle.articles.forEach((article, idx) => {
                    console.log(`\n  📌 Новость ${idx + 1}/${cycle.articles.length}:`);
                    console.log(`     Заголовок: ${article.title || 'N/A'}`);
                    console.log(`     Описание:  ${(article.description || 'N/A').substring(0, 150)}...`);
                    console.log(`     Источник:  ${article.source || 'N/A'}`);
                    console.log(`     🤖 GPT Score: ${article.score || 'N/A'}`);
                    console.log(`     🎭 Sentiment: ${article.sentiment || 'N/A'}`);
                    if (article.analysis) {
                        console.log(`     💬 Analysis: ${article.analysis.substring(0, 200)}...`);
                    }
                });
            } else {
                console.log('  ❌ Нет новостей в articles');
            }

            console.log('\n' + '='.repeat(120));
        });

        // Статистика по источникам
        const allArticles = cycles.flatMap(c => c.articles || []);
        const sources = {};
        const sentiments = { positive: 0, negative: 0, neutral: 0 };

        allArticles.forEach(a => {
            if (a.source) sources[a.source] = (sources[a.source] || 0) + 1;
            if (a.sentiment) sentiments[a.sentiment.toLowerCase()] = (sentiments[a.sentiment.toLowerCase()] || 0) + 1;
        });

        console.log('\n📊 СТАТИСТИКА RSS ИСТОЧНИКОВ:');
        Object.entries(sources).forEach(([source, count]) => {
            console.log(`  ${source}: ${count} новостей`);
        });

        console.log('\n🎭 СТАТИСТИКА GPT SENTIMENT:');
        console.log(`  Positive: ${sentiments.positive}`);
        console.log(`  Negative: ${sentiments.negative}`);
        console.log(`  Neutral: ${sentiments.neutral}`);

        await mongoose.disconnect();
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

analyzeRSSNews();
