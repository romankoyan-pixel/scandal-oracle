const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { ethers } = require('ethers');
require('dotenv').config();

// Import MongoDB models
const { Player, Prediction, Cycle, SystemState } = require('./models');

// ============================================
// BLOCKCHAIN / SMART CONTRACT CONFIG
// ============================================
const BLOCKCHAIN_CONFIG = {
    rpcUrl: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    tokenAddress: '0x0F71E2d170dCdBE32E54D961C31e2101f8826a48',
    gameAddress: '0x15B1787F5a9BD937954EB8111F1Cc513AB41f0DB',
    // Game ABI for closeRound
    gameABI: [
        'function closeRound(uint8 result, uint256 rate) external',
        'function getCurrentRound() view returns (uint256 roundId, uint8 status, uint256 mintPool, uint256 burnPool, uint256 neutralPool, uint256 startTime)',
        'function currentRoundId() view returns (uint256)'
    ],
    // Token ABI for oracle operations
    tokenABI: [
        'function oracleMint(uint256 amount) external',
        'function oracleBurn(uint256 amount) external',
        'function totalSupply() view returns (uint256)'
    ]
};

// Initialize blockchain provider and contract (with Oracle wallet)
let blockchainProvider = null;
let oracleWallet = null;
let gameContract = null;
let tokenContract = null;

if (process.env.PRIVATE_KEY) {
    try {
        blockchainProvider = new ethers.JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl);
        oracleWallet = new ethers.Wallet(process.env.PRIVATE_KEY, blockchainProvider);
        gameContract = new ethers.Contract(BLOCKCHAIN_CONFIG.gameAddress, BLOCKCHAIN_CONFIG.gameABI, oracleWallet);
        tokenContract = new ethers.Contract(BLOCKCHAIN_CONFIG.tokenAddress, BLOCKCHAIN_CONFIG.tokenABI, oracleWallet);
        console.log('✅ Blockchain Oracle configured:', oracleWallet.address);
    } catch (e) {
        console.error('❌ Blockchain setup failed:', e.message);
    }
} else {
    console.log('⚠️ No PRIVATE_KEY - blockchain features disabled');
}

const app = express();
const parser = new Parser();

// ============================================
// MONGODB CONNECTION
// ============================================
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => console.error('❌ MongoDB error:', err.message));

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files (HTML, CSS, JS)

// ============================================
// MONGODB + FILE-BASED PERSISTENCE (Hybrid during migration)
// ============================================
const DATA_FILE = path.join(__dirname, 'oracle_data.json');

// Load from file (fallback during migration)
function loadDataFromFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            console.log(`📂 Loaded ${data.cycles?.length || 0} cycles from file`);
            return data;
        }
    } catch (e) {
        console.error('Error loading data:', e.message);
    }
    return { cycles: [], lastCycleId: 0, seenLinks: [], seenTitles: [] };
}

// Save to both MongoDB and file (during migration)
async function saveData() {
    try {
        // Save to file as backup
        const data = {
            cycles: cycles.slice(0, 50), // Keep last 50 in file
            lastCycleId: currentCycle.id,
            seenLinks: [...seenLinks].slice(-300),
            seenTitles: [...seenTitles].slice(-300),
            savedAt: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

        // Also update MongoDB SystemState
        await SystemState.findOneAndUpdate(
            { key: 'main' },
            {
                lastCycleId: currentCycle.id,
                seenLinks: [...seenLinks].slice(-500),
                seenTitles: [...seenTitles].slice(-500),
                updatedAt: new Date()
            },
            { upsert: true }
        );

        console.log(`💾 Saved cycle data`);
    } catch (e) {
        console.error('Error saving data:', e.message);
    }
}

// Save completed cycle to MongoDB
async function saveCycleToMongo(cycle) {
    try {
        const cycleDoc = await Cycle.findOneAndUpdate(
            { cycleId: cycle.id },
            {
                cycleId: cycle.id,
                startTime: new Date(cycle.startTime),
                endTime: cycle.endTime ? new Date(cycle.endTime) : null,
                status: cycle.status,
                articles: cycle.articles.map(a => ({
                    title: a.title,
                    description: a.description,
                    source: a.source,
                    url: a.link,
                    publishedAt: a.pubDate ? new Date(a.pubDate) : null,
                    score: a.score
                })),
                averageScore: cycle.averageScore || 50,
                action: cycle.action || 'NEUTRAL',
                rate: cycle.rate || 0,
                ratePercentage: cycle.ratePercentage || '0%'
            },
            { upsert: true, new: true }
        );
        console.log(`🗄️ Saved cycle ${cycle.id} to MongoDB`);
        return cycleDoc;
    } catch (e) {
        console.error('Error saving cycle to MongoDB:', e.message);
    }
}

// Initialize from MongoDB or file
async function initializeFromMongo() {
    try {
        // Try to get system state from MongoDB
        let systemState = await SystemState.findOne({ key: 'main' });

        if (systemState) {
            console.log(`🗄️ Found system state in MongoDB: lastCycleId=${systemState.lastCycleId}`);
            return {
                lastCycleId: systemState.lastCycleId,
                seenLinks: systemState.seenLinks || [],
                seenTitles: systemState.seenTitles || []
            };
        }

        // Fallback to file
        const fileData = loadDataFromFile();

        // Create system state in MongoDB from file data
        await SystemState.create({
            key: 'main',
            lastCycleId: fileData.lastCycleId || 0,
            seenLinks: fileData.seenLinks || [],
            seenTitles: fileData.seenTitles || []
        });
        console.log(`🗄️ Migrated system state to MongoDB`);

        return fileData;
    } catch (e) {
        console.error('MongoDB init error, falling back to file:', e.message);
        return loadDataFromFile();
    }
}

// Load saved data (sync for now, will be replaced after mongoose connects)
let savedData = loadDataFromFile();

// EXPANDED RSS Feed Sources - Trusted Worldwide
const RSS_FEEDS = {
    politics: [
        'https://feeds.bbci.co.uk/news/politics/rss.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml',
        'https://feeds.npr.org/1014/rss.xml',
        'https://thehill.com/feed/',
        'https://www.politico.com/rss/politicopicks.xml',
        'https://feeds.washingtonpost.com/rss/politics'
    ],
    world: [
        'https://feeds.bbci.co.uk/news/world/rss.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',
        'https://www.aljazeera.com/xml/rss/all.xml',
        'https://www.theguardian.com/world/rss',
        'https://feeds.reuters.com/reuters/worldNews',
        'https://rss.dw.com/rdf/rss-en-world',
        'https://www.france24.com/en/rss',
        'https://feeds.skynews.com/feeds/rss/world.xml',
        'https://www.euronews.com/rss?level=theme&name=news'
    ],
    crypto: [
        'https://www.coindesk.com/arc/outboundfeeds/rss/',
        'https://cointelegraph.com/rss',
        'https://decrypt.co/feed',
        'https://www.theblock.co/rss.xml',
        'https://bitcoinmagazine.com/.rss/full/'
    ],
    business: [
        'https://feeds.bbci.co.uk/news/business/rss.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
        'https://feeds.bloomberg.com/markets/news.rss',
        'https://www.ft.com/?format=rss',
        'https://feeds.reuters.com/reuters/businessNews',
        'https://www.cnbc.com/id/100003114/device/rss/rss.html'
    ],
    tech: [
        'https://feeds.arstechnica.com/arstechnica/index',
        'https://www.theverge.com/rss/index.xml',
        'https://techcrunch.com/feed/',
        'https://www.wired.com/feed/rss',
        'https://feeds.feedburner.com/TechCrunch/',
        'https://www.engadget.com/rss.xml'
    ],
    sports: [
        'https://www.espn.com/espn/rss/news',
        'https://feeds.bbci.co.uk/sport/rss.xml',
        'https://www.skysports.com/rss/12040',
        'https://rss.nytimes.com/services/xml/rss/nyt/Sports.xml'
    ],
    esports: [
        'https://www.hltv.org/rss/news',
        'https://www.dexerto.com/feed/',
        'https://www.gamesindustry.biz/feed',
        'https://kotaku.com/rss'
    ],
    science: [
        'https://www.sciencedaily.com/rss/all.xml',
        'https://rss.nytimes.com/services/xml/rss/nyt/Science.xml',
        'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
        'https://www.nature.com/nature.rss'
    ],
    breaking: [
        'https://feeds.bbci.co.uk/news/rss.xml',
        'https://rss.cnn.com/rss/edition.rss',
        'https://feeds.reuters.com/reuters/topNews',
        'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml'
    ]
};

// ============================================
// DYNAMIC RATE CALCULATION - DISCRETE STEPS
// 0.10%, 0.15%, 0.20%, 0.25%, 0.30%
// ============================================
function calculateDynamicRate(avgScore) {
    // MINT zone: 0-32
    if (avgScore < 33) {
        // 5 steps based on score ranges
        // 0-6 → 0.30%, 7-13 → 0.25%, 14-19 → 0.20%, 20-26 → 0.15%, 27-32 → 0.10%
        let rate;
        if (avgScore <= 6) rate = 0.0030;       // 0.30%
        else if (avgScore <= 13) rate = 0.0025; // 0.25%
        else if (avgScore <= 19) rate = 0.0020; // 0.20%
        else if (avgScore <= 26) rate = 0.0015; // 0.15%
        else rate = 0.0010;                      // 0.10%

        return {
            action: 'MINT',
            rate: rate,
            percentage: (rate * 100).toFixed(2) + '%'
        };
    }

    // BURN zone: 67-100
    if (avgScore > 66) {
        // 5 steps based on score ranges
        // 67-73 → 0.10%, 74-80 → 0.15%, 81-86 → 0.20%, 87-93 → 0.25%, 94-100 → 0.30%
        let rate;
        if (avgScore >= 94) rate = 0.0030;      // 0.30%
        else if (avgScore >= 87) rate = 0.0025; // 0.25%
        else if (avgScore >= 81) rate = 0.0020; // 0.20%
        else if (avgScore >= 74) rate = 0.0015; // 0.15%
        else rate = 0.0010;                      // 0.10%

        return {
            action: 'BURN',
            rate: rate,
            percentage: (rate * 100).toFixed(2) + '%'
        };
    }

    // NEUTRAL zone: 33-66
    return {
        action: 'NEUTRAL',
        rate: 0,
        percentage: '0%'
    };
}

// CYCLE-BASED STORAGE
let cycles = savedData.cycles || [];
let currentCycle = {
    id: (savedData.lastCycleId || 0) + 1,
    startTime: Date.now(),
    articles: [],
    status: 'active'
};

// DUPLICATE DETECTION
let seenTitles = new Set(savedData.seenTitles || []);
let seenLinks = new Set(savedData.seenLinks || []);

const SCAN_INTERVAL = 20000;
const AGGREGATION_INTERVAL = 120000;
const MAX_CYCLES = 500; // Keep more cycles for news archive
const MIN_ARTICLES_FOR_GAME = 0; // TESTING: set to 5 for production

// ============================================
// PREDICTIONS SYSTEM
// ============================================
const PREDICTIONS_FILE = path.join(__dirname, 'predictions.json');

function loadPredictions() {
    try {
        if (fs.existsSync(PREDICTIONS_FILE)) {
            return JSON.parse(fs.readFileSync(PREDICTIONS_FILE, 'utf8'));
        }
    } catch (e) {
        console.error('Error loading predictions:', e.message);
    }
    return { users: {}, cycleVotes: {} };
}

function savePredictions() {
    try {
        fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(predictions, null, 2));
    } catch (e) {
        console.error('Error saving predictions:', e.message);
    }
}

let predictions = loadPredictions();

// Process predictions when cycle closes - MongoDB with pari-mutuel betting
async function processPredictions(cycle) {
    const cycleId = cycle.id;
    const correctAnswer = cycle.action; // MINT, BURN, or NEUTRAL

    try {
        // Get all predictions for this cycle from MongoDB
        const cyclePredictions = await Prediction.find({ cycleId, result: 'pending' });

        if (cyclePredictions.length === 0) {
            console.log(`🎮 No predictions for cycle ${cycleId}`);
            return;
        }

        // Calculate pool totals from real predictions
        const poolTotals = { MINT: 0, NEUTRAL: 0, BURN: 0 };
        cyclePredictions.forEach(p => {
            poolTotals[p.choice] += p.amount;
        });

        // Add simulated bot bets (3-10 bots betting 100 each randomly)
        // This will be removed when smart contract is connected
        const BET_AMOUNT = 100;
        const numBots = Math.floor(Math.random() * 8) + 3;
        const botBets = { MINT: 0, NEUTRAL: 0, BURN: 0 };
        for (let i = 0; i < numBots; i++) {
            const choices = ['MINT', 'NEUTRAL', 'BURN'];
            botBets[choices[Math.floor(Math.random() * 3)]] += BET_AMOUNT;
        }
        console.log(`🤖 Bot bets: M=${botBets.MINT} N=${botBets.NEUTRAL} B=${botBets.BURN}`);

        // Total pool includes bot bets
        const totalPool = (poolTotals.MINT + poolTotals.NEUTRAL + poolTotals.BURN) +
            (botBets.MINT + botBets.NEUTRAL + botBets.BURN);

        // Combined winning pool (real + bots)
        const winningPoolReal = poolTotals[correctAnswer];
        const winningPoolBots = botBets[correctAnswer];
        const winningPool = winningPoolReal + winningPoolBots;

        // Apply 5% house edge
        const HOUSE_EDGE = 0.05;
        const prizePool = totalPool * (1 - HOUSE_EDGE);

        // Find real winners
        const winners = cyclePredictions.filter(p => p.choice === correctAnswer);

        // Count bot winners for fair distribution
        const botWinnerCount = winningPoolBots / BET_AMOUNT;
        const totalWinnerUnits = winners.length + botWinnerCount;

        let prizePerWinner = 0;
        if (totalWinnerUnits > 0 && winningPool > 0) {
            // Prize split among all winner units (real players get their share, bots "get" theirs but it's virtual)
            prizePerWinner = prizePool / totalWinnerUnits;
        }

        // Process each prediction
        for (const prediction of cyclePredictions) {
            const isWin = prediction.choice === correctAnswer;
            // Safe payout calculation - avoid NaN and Infinity
            let payout = 0;
            if (isWin && winningPool > 0) {
                payout = prizePool * (prediction.amount / winningPool);
            }
            payout = Math.round(payout); // Round to whole number

            console.log(`📊 ${prediction.wallet.slice(-4)}: ${prediction.choice} → ${isWin ? 'WIN' : 'LOSE'} | Payout: ${payout}`);

            // Update prediction
            prediction.result = isWin ? 'win' : 'lose';
            prediction.payout = payout;
            await prediction.save();

            // Update player stats in MongoDB
            const player = await Player.findOne({ wallet: prediction.wallet });
            if (player) {
                console.log(`👤 Found player ${player.wallet.slice(-4)}: balance=${player.balance}, totalWon=${player.totalWon}`);
                if (isWin) {
                    player.balance += payout;
                    player.totalWon += payout;
                    player.wins += 1;
                    player.currentStreak += 1;
                    if (player.currentStreak > player.maxStreak) {
                        player.maxStreak = player.currentStreak;
                    }
                } else {
                    player.totalLost += prediction.amount;
                    player.losses += 1;
                    player.currentStreak = 0;
                }
                await player.save();
                console.log(`💾 Saved: balance=${player.balance}, totalWon=${player.totalWon}`);
            } else {
                console.log(`⚠️ Player not found: ${prediction.wallet}`);
            }
        }

        // Also update JSON predictions for backwards compatibility
        const cycleIdStr = cycleId.toString();
        const cycleVotes = predictions.cycleVotes[cycleIdStr];
        if (cycleVotes && cycleVotes.voters) {
            for (const [wallet, voteData] of Object.entries(cycleVotes.voters)) {
                const user = predictions.users[wallet];
                if (!user) continue;

                const won = voteData.vote === correctAnswer;
                user.predictions.push({
                    cycleId: cycle.id,
                    vote: voteData.vote,
                    result: won ? 'win' : 'loss',
                    correctAnswer,
                    timestamp: Date.now()
                });

                if (won) {
                    user.points += 10;
                    user.streak++;
                    if (user.streak > user.maxStreak) user.maxStreak = user.streak;
                    if (user.streak >= 3) user.points += 5;
                } else {
                    user.points -= 5;
                    user.streak = 0;
                }
            }
            savePredictions();
        }

        console.log(`🎮 Cycle ${cycleId}: ${cyclePredictions.length} real bets, ${winners.length} real winners`);
        console.log(`💰 Pool: ${totalPool} (incl bots) | Prize: ${prizePool.toFixed(0)} | Per winner: ${prizePerWinner.toFixed(0)}`);

    } catch (err) {
        console.error('Process predictions error:', err);
    }
}

// Refund all bets when no articles - no house fee
async function refundPredictions(cycleId) {
    try {
        const cyclePredictions = await Prediction.find({ cycleId, result: 'pending' });

        if (cyclePredictions.length === 0) {
            console.log(`💸 No predictions to refund for cycle ${cycleId}`);
            return;
        }

        for (const prediction of cyclePredictions) {
            // Mark as refunded
            prediction.result = 'refund';
            prediction.payout = prediction.amount; // Full refund
            await prediction.save();

            // Return bet to player
            const player = await Player.findOne({ wallet: prediction.wallet });
            if (player) {
                player.balance += prediction.amount;
                await player.save();
                console.log(`💸 Refunded ${prediction.amount} $SCNDL to ${prediction.wallet.slice(-4)}`);
            }
        }

        // Also update JSON predictions
        const cycleIdStr = cycleId.toString();
        const cycleVotes = predictions.cycleVotes[cycleIdStr];
        if (cycleVotes && cycleVotes.voters) {
            for (const wallet of Object.keys(cycleVotes.voters)) {
                const user = predictions.users[wallet];
                if (user && user.predictions) {
                    const pred = user.predictions.find(p => p.cycleId === cycleId && !p.result);
                    if (pred) pred.result = 'refund';
                }
            }
            savePredictions();
        }

        console.log(`💸 Cycle ${cycleId}: Refunded ${cyclePredictions.length} bets (no articles)`);

    } catch (err) {
        console.error('Refund predictions error:', err);
    }
}

// Normalize title
function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^a-z0-9]/gi, '').substring(0, 80);
}

// Check duplicate
function isDuplicate(article) {
    if (seenLinks.has(article.link)) return true;
    if (seenTitles.has(normalizeTitle(article.title))) return true;
    return false;
}

// Mark as seen
function markAsSeen(article) {
    seenLinks.add(article.link);
    seenTitles.add(normalizeTitle(article.title));

    if (seenTitles.size > 500) seenTitles = new Set([...seenTitles].slice(-300));
    if (seenLinks.size > 500) seenLinks = new Set([...seenLinks].slice(-300));
}

// Fetch article
async function fetchLatestArticle() {
    const categories = Object.keys(RSS_FEEDS);
    const randomCategory = categories[Math.floor(Math.random() * categories.length)];
    const feeds = RSS_FEEDS[randomCategory];
    const randomFeed = feeds[Math.floor(Math.random() * feeds.length)];

    try {
        const feed = await parser.parseURL(randomFeed);

        for (const item of feed.items.slice(0, 10)) {
            const article = {
                title: item.title || 'No title',
                description: item.contentSnippet || item.content || item.description || '',
                link: item.link,
                source: feed.title || randomCategory.toUpperCase(),
                category: randomCategory,
                pubDate: item.pubDate,
                timestamp: Date.now()
            };

            if (!isDuplicate(article)) {
                markAsSeen(article);
                return article;
            }
        }
        return null;
    } catch (error) {
        console.error(`❌ ${randomFeed}:`, error.message);
        return null;
    }
}

// Score article
async function scoreArticle(article) {
    try {
        const prompt = `Rate this news 0-100 (0=very positive, 50=neutral, 100=scandalous):
"${article.title}" - ${article.description?.substring(0, 200) || ''}
Reply ONLY the number.`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: "Reply with only a number 0-100. Nothing else." },
                { role: "user", content: prompt }
            ],
            max_completion_tokens: 10
        });

        const response = completion.choices[0].message.content.trim();
        const score = parseInt(response.match(/\d+/)?.[0] || '50');
        return { ...article, score: Math.min(100, Math.max(0, score)) };
    } catch (error) {
        console.error('⚠️ Scoring error:', error.message);
        const title = article.title.toLowerCase();
        let score = 50;
        if (title.match(/scandal|corruption|crisis|war|attack|killed|fraud/)) score = 80;
        else if (title.match(/peace|success|growth|agreement|win|launch/)) score = 20;
        return { ...article, score };
    }
}

// Scan and add news
async function scanAndAddNews() {
    const article = await fetchLatestArticle();

    if (article) {
        console.log(`🔍 [Cycle ${currentCycle.id}] "${article.title.substring(0, 45)}..."`);
        const scored = await scoreArticle(article);
        currentCycle.articles.push(scored);
        console.log(`✅ Score: ${scored.score} | Total: ${currentCycle.articles.length}\n`);
    } else {
        console.log(`⏭️  No new articles\n`);
    }
}

// ============================================
// BLOCKCHAIN ROUND CLOSING
// ============================================
async function closeRoundOnBlockchain(result, ratePercentage) {
    if (!gameContract) {
        console.log('⚠️ Blockchain not configured - skipping closeRound');
        return { success: false, reason: 'no_contract' };
    }

    try {
        // Convert result to contract enum (1=MINT, 2=BURN, 3=NEUTRAL)
        const resultMap = { 'MINT': 1, 'BURN': 2, 'NEUTRAL': 3 };
        const resultCode = resultMap[result] || 3;

        // Convert rate percentage to basis points (0.1% = 10, 0.30% = 30)
        const rateValue = Math.round(parseFloat(ratePercentage) * 100);

        console.log(`🔗 Calling closeRound on blockchain: result=${result}(${resultCode}), rate=${rateValue}`);

        const tx = await gameContract.closeRound(resultCode, rateValue);
        console.log(`📤 Transaction sent: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`✅ Round closed on blockchain! Block: ${receipt.blockNumber}`);

        return { success: true, txHash: tx.hash, blockNumber: receipt.blockNumber };
    } catch (error) {
        console.error('❌ closeRound blockchain error:', error.message);
        return { success: false, error: error.message };
    }
}

// Close cycle
async function closeCycleAndStartNew() {
    // Close cycle even if empty - just mark as NEUTRAL with 0 articles
    const avgScore = currentCycle.articles.length > 0
        ? currentCycle.articles.reduce((sum, a) => sum + a.score, 0) / currentCycle.articles.length
        : 50; // Default to neutral if no articles

    const rateInfo = calculateDynamicRate(avgScore);

    const completedCycle = {
        ...currentCycle,
        status: 'completed',
        endTime: Date.now(),
        averageScore: avgScore,
        action: currentCycle.articles.length === 0 ? 'NEUTRAL' : rateInfo.action,
        rate: currentCycle.articles.length === 0 ? 0 : rateInfo.rate,
        ratePercentage: currentCycle.articles.length === 0 ? '0%' : rateInfo.percentage
    };

    cycles.unshift(completedCycle);
    // No limit - keep all cycles for complete news archive

    // ============================================
    // CLOSE ROUND ON BLOCKCHAIN
    // ============================================
    const blockchainResult = await closeRoundOnBlockchain(
        completedCycle.action,
        completedCycle.ratePercentage.replace('%', '')
    );
    completedCycle.blockchainTx = blockchainResult.txHash || null;

    // Handle predictions based on article count
    if (completedCycle.articles.length === 0) {
        // No articles = refund all bets without house fee
        await refundPredictions(completedCycle.id);
    } else {
        // Has articles = process predictions normally
        await processPredictions(completedCycle);
    }

    // Save to MongoDB
    await saveCycleToMongo(completedCycle);

    // Save system state to file and MongoDB
    await saveData();

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`⚡ CYCLE ${completedCycle.id} COMPLETED`);
    console.log(`📊 Articles: ${completedCycle.articles.length} | Score: ${avgScore.toFixed(1)}`);
    console.log(`🎯 ${completedCycle.action} @ ${completedCycle.ratePercentage}`);
    if (blockchainResult.txHash) {
        console.log(`🔗 Blockchain TX: ${blockchainResult.txHash}`);
    }
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    currentCycle = {
        id: completedCycle.id + 1,
        startTime: Date.now(),
        articles: [],
        status: 'active'
    };

    console.log(`🆕 Starting Cycle ${currentCycle.id}...\n`);
}

// API Endpoints
app.get('/api/news', (req, res) => {
    const avgScore = currentCycle.articles.length > 0
        ? currentCycle.articles.reduce((sum, a) => sum + a.score, 0) / currentCycle.articles.length
        : 50;

    const rateInfo = calculateDynamicRate(avgScore);

    res.json({
        currentCycle: {
            ...currentCycle,
            averageScore: avgScore,
            projectedAction: rateInfo.action,
            projectedRate: rateInfo.rate,
            projectedRatePercentage: rateInfo.percentage,
            timeRemaining: Math.max(0, AGGREGATION_INTERVAL - (Date.now() - currentCycle.startTime))
        },
        completedCycles: cycles
    });
});

app.get('/api/status', (req, res) => {
    const avgScore = currentCycle.articles.length > 0
        ? currentCycle.articles.reduce((sum, a) => sum + a.score, 0) / currentCycle.articles.length
        : 50;

    const rateInfo = calculateDynamicRate(avgScore);

    res.json({
        cycleId: currentCycle.id,
        action: rateInfo.action,
        rate: rateInfo.rate,
        ratePercentage: rateInfo.percentage,
        score: avgScore,
        articlesCount: currentCycle.articles.length,
        totalCycles: cycles.length,
        cycleTimeRemaining: Math.max(0, AGGREGATION_INTERVAL - (Date.now() - currentCycle.startTime))
    });
});

// ============================================
// PREDICTION GAME API
// ============================================

// Vote endpoint - with MongoDB integration
app.post('/api/vote', async (req, res) => {
    const { wallet, vote, amount = 100 } = req.body;

    if (!wallet || !vote) {
        return res.status(400).json({ error: 'Wallet and vote required' });
    }

    if (!['MINT', 'BURN', 'NEUTRAL'].includes(vote)) {
        return res.status(400).json({ error: 'Invalid vote' });
    }

    const elapsed = Date.now() - currentCycle.startTime;
    const halfCycle = AGGREGATION_INTERVAL / 2;

    if (elapsed > halfCycle) {
        return res.status(400).json({ error: 'Voting closed', timeRemaining: 0 });
    }

    const cycleId = currentCycle.id;
    const walletLower = wallet.toLowerCase();

    try {
        // Check if already voted in MongoDB
        const existingPrediction = await Prediction.findOne({ wallet: walletLower, cycleId });
        if (existingPrediction) {
            return res.status(400).json({ error: 'Already voted this cycle' });
        }

        // Get or create player
        let player = await Player.findOne({ wallet: walletLower });
        if (!player) {
            player = await Player.create({
                wallet: walletLower,
                balance: 10000
            });
        }

        // Check balance
        if (player.balance < amount) {
            return res.status(400).json({ error: 'Insufficient balance' });
        }

        // Deduct bet amount
        player.balance -= amount;
        player.totalPredictions += 1;
        player.lastActiveAt = new Date();
        await player.save();

        // Save prediction to MongoDB
        await Prediction.create({
            wallet: walletLower,
            cycleId,
            choice: vote,
            amount,
            result: 'pending'
        });

        // Also update JSON for backwards compatibility
        const cycleIdStr = cycleId.toString();
        if (!predictions.cycleVotes[cycleIdStr]) {
            predictions.cycleVotes[cycleIdStr] = { MINT: 0, BURN: 0, NEUTRAL: 0, voters: {} };
        }
        predictions.cycleVotes[cycleIdStr][vote]++;
        predictions.cycleVotes[cycleIdStr].voters[wallet] = { vote, timestamp: Date.now(), amount };

        if (!predictions.users[wallet]) {
            predictions.users[wallet] = { points: 0, streak: 0, maxStreak: 0, predictions: [] };
        }

        savePredictions();

        console.log(`🎮 Vote: ${wallet.slice(0, 6)}... → ${vote} (${amount} $SCNDL)`);
        res.json({ success: true, vote, cycleId, amount, newBalance: player.balance });

    } catch (err) {
        console.error('Vote error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Game status endpoint
app.get('/api/game-status', (req, res) => {
    const elapsed = Date.now() - currentCycle.startTime;
    const halfCycle = AGGREGATION_INTERVAL / 2;
    const votingOpen = elapsed < halfCycle;

    const cycleId = currentCycle.id.toString();
    const votes = predictions.cycleVotes[cycleId] || { MINT: 0, BURN: 0, NEUTRAL: 0 };

    // Check if user voted (from query param)
    const wallet = req.query.wallet;
    let userVote = null;
    if (wallet && predictions.cycleVotes[cycleId]?.voters?.[wallet]) {
        userVote = predictions.cycleVotes[cycleId].voters[wallet].vote;
    }

    res.json({
        cycleId: currentCycle.id,
        votingOpen,
        votingTimeRemaining: Math.max(0, halfCycle - elapsed),
        cycleTimeRemaining: Math.max(0, AGGREGATION_INTERVAL - elapsed),
        totalVotes: votes.MINT + votes.BURN + votes.NEUTRAL,
        articlesCount: currentCycle.articles.length,
        minArticlesRequired: MIN_ARTICLES_FOR_GAME,
        userVote
    });
});

// Leaderboard endpoint - MongoDB
app.get('/api/leaderboard', async (req, res) => {
    try {
        // Get top 20 players by balance
        const players = await Player.find()
            .sort({ balance: -1 })
            .limit(20)
            .lean();

        const leaderboard = players.map(p => ({
            wallet: p.wallet.slice(0, 6) + '...' + p.wallet.slice(-4),
            fullWallet: p.wallet,
            balance: p.balance,
            totalWon: p.totalWon,
            totalLost: p.totalLost,
            wins: p.wins,
            losses: p.losses,
            winRate: p.wins + p.losses > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0,
            profit: p.totalWon - p.totalLost,
            streak: p.currentStreak,
            maxStreak: p.maxStreak
        }));

        res.json({ leaderboard });
    } catch (err) {
        console.error('Leaderboard error:', err);
        // Fallback to JSON data
        const users = Object.entries(predictions.users)
            .map(([wallet, data]) => ({
                wallet: wallet.slice(0, 6) + '...' + wallet.slice(-4),
                fullWallet: wallet,
                balance: 10000 + (data.points * 10),
                totalWon: data.points > 0 ? data.points * 10 : 0,
                totalLost: data.points < 0 ? Math.abs(data.points) * 10 : 0,
                profit: data.points * 10,
                streak: data.streak,
                maxStreak: data.maxStreak
            }))
            .sort((a, b) => b.balance - a.balance)
            .slice(0, 20);

        res.json({ leaderboard: users });
    }
});

// Record blockchain bet for leaderboard tracking
app.post('/api/predict', async (req, res) => {
    const { wallet, prediction, amount = 100, txHash } = req.body;
    if (!wallet || !prediction) {
        return res.status(400).json({ error: 'Wallet and prediction required' });
    }

    const walletLower = wallet.toLowerCase();
    const cycleId = currentCycle.id;

    try {
        // Get or create player
        let player = await Player.findOne({ wallet: walletLower });
        if (!player) {
            player = await Player.create({
                wallet: walletLower,
                balance: 10000
            });
        }

        // Record the bet (deduction happens on blockchain, just track here)
        player.totalPredictions += 1;
        player.lastActiveAt = new Date();
        await player.save();

        // Save prediction for tracking
        await Prediction.findOneAndUpdate(
            { wallet: walletLower, cycleId },
            { wallet: walletLower, cycleId, choice: prediction, amount, txHash, timestamp: new Date() },
            { upsert: true, new: true }
        );

        res.json({ success: true, cycleId, txHash });
    } catch (err) {
        console.error('Predict error:', err);
        res.json({ success: false, error: err.message });
    }
});

// Report blockchain result for stats tracking
app.post('/api/report-result', async (req, res) => {
    const { wallet, roundId, won, amount } = req.body;
    if (!wallet) {
        return res.status(400).json({ error: 'Wallet required' });
    }

    const walletLower = wallet.toLowerCase();

    try {
        let player = await Player.findOne({ wallet: walletLower });
        if (!player) {
            player = await Player.create({ wallet: walletLower, balance: 10000 });
        }

        if (won) {
            player.wins += 1;
            player.totalWon += amount;
            player.currentStreak = (player.currentStreak > 0) ? player.currentStreak + 1 : 1;
            if (player.currentStreak > player.maxStreak) {
                player.maxStreak = player.currentStreak;
            }
        } else {
            player.losses += 1;
            player.totalLost += amount;
            player.currentStreak = (player.currentStreak < 0) ? player.currentStreak - 1 : -1;
        }

        player.lastActiveAt = new Date();
        await player.save();

        res.json({ success: true, stats: { wins: player.wins, losses: player.losses, totalWon: player.totalWon, totalLost: player.totalLost } });
    } catch (err) {
        console.error('Report result error:', err);
        res.json({ success: false, error: err.message });
    }
});

// Get individual user stats
app.get('/api/user-stats/:wallet', async (req, res) => {
    const walletLower = req.params.wallet.toLowerCase();

    try {
        const player = await Player.findOne({ wallet: walletLower });
        if (!player) {
            return res.json({ wins: 0, losses: 0, totalWon: 0, totalLost: 0 });
        }

        res.json({
            wins: player.wins || 0,
            losses: player.losses || 0,
            totalWon: player.totalWon || 0,
            totalLost: player.totalLost || 0,
            balance: player.balance || 10000,
            streak: player.currentStreak || 0
        });
    } catch (err) {
        console.error('User stats error:', err);
        res.json({ wins: 0, losses: 0, totalWon: 0, totalLost: 0 });
    }
});

// Get last completed cycle
app.get('/api/last-cycle', async (req, res) => {
    try {
        // Try to get from MongoDB first
        const lastCycleFromDB = await Cycle.findOne({ status: 'completed' })
            .sort({ id: -1 })
            .lean();

        if (lastCycleFromDB) {
            return res.json({
                lastCycle: lastCycleFromDB,
                currentCycleId: currentCycle.id
            });
        }

        // Fallback to local cycles array
        const completedCycles = cycles.filter(c => c.status === 'completed');
        if (completedCycles.length > 0) {
            // Sort by id descending and get first
            completedCycles.sort((a, b) => b.id - a.id);
            return res.json({
                lastCycle: completedCycles[0],
                currentCycleId: currentCycle.id
            });
        }

        res.json({ lastCycle: null, currentCycleId: currentCycle.id });
    } catch (error) {
        console.error('Error getting last cycle:', error);
        res.json({ lastCycle: null, currentCycleId: currentCycle.id });
    }
});

// User stats endpoint - MongoDB
app.get('/api/user-stats/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        let player = await Player.findOne({ wallet });

        if (!player) {
            // Create new player with starting balance
            player = await Player.create({
                wallet,
                balance: 10000,
                totalWon: 0,
                totalLost: 0,
                wins: 0,
                losses: 0,
                currentStreak: 0,
                maxStreak: 0,
                totalPredictions: 0
            });
        }

        res.json({
            balance: player.balance,
            totalWon: player.totalWon,
            totalLost: player.totalLost,
            wins: player.wins,
            losses: player.losses,
            winRate: player.wins + player.losses > 0 ? Math.round((player.wins / (player.wins + player.losses)) * 100) : 0,
            streak: player.currentStreak,
            maxStreak: player.maxStreak,
            totalPredictions: player.totalPredictions
        });
    } catch (err) {
        console.error('User stats error:', err);
        res.json({ balance: 10000, totalWon: 0, totalLost: 0, wins: 0, losses: 0, winRate: 0, streak: 0, maxStreak: 0 });
    }
});

// Check prediction result for a cycle - MongoDB
app.get('/api/prediction-result/:wallet/:cycleId', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        const cycleId = parseInt(req.params.cycleId);

        const prediction = await Prediction.findOne({ wallet, cycleId });

        if (!prediction) {
            return res.json({ found: false });
        }

        // Get the cycle data to find the correct answer
        const cycleData = cycles.find(c => c.id === cycleId);
        const correctAnswer = cycleData?.action || 'NEUTRAL';

        res.json({
            found: true,
            choice: prediction.choice,
            result: prediction.result,
            correctAnswer,
            payout: prediction.payout || 0,
            amount: prediction.amount
        });
    } catch (err) {
        console.error('Prediction result error:', err);
        res.json({ found: false, error: err.message });
    }
});

// ============================================
// NEWS ARCHIVE API
// ============================================
app.get('/api/news', (req, res) => {
    const { category, search, startDate, endDate, limit = 50, offset = 0 } = req.query;

    // Collect all articles from all cycles
    let allArticles = [];
    cycles.forEach(cycle => {
        if (cycle.articles) {
            cycle.articles.forEach(article => {
                allArticles.push({
                    ...article,
                    cycleId: cycle.id,
                    cycleAction: cycle.action
                });
            });
        }
    });

    // Add current cycle articles
    if (currentCycle.articles) {
        currentCycle.articles.forEach(article => {
            allArticles.push({
                ...article,
                cycleId: currentCycle.id,
                cycleAction: 'PENDING'
            });
        });
    }

    // Sort by timestamp descending (newest first)
    allArticles.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Apply filters
    if (category && category !== 'all') {
        allArticles = allArticles.filter(a => a.category === category);
    }

    if (search) {
        const searchLower = search.toLowerCase();
        allArticles = allArticles.filter(a =>
            (a.title && a.title.toLowerCase().includes(searchLower)) ||
            (a.description && a.description.toLowerCase().includes(searchLower))
        );
    }

    if (startDate) {
        const start = new Date(startDate).getTime();
        allArticles = allArticles.filter(a => a.timestamp >= start);
    }

    if (endDate) {
        const end = new Date(endDate).getTime() + 86400000; // Include full day
        allArticles = allArticles.filter(a => a.timestamp <= end);
    }

    // Get total before pagination
    const total = allArticles.length;

    // Apply pagination
    const paginated = allArticles.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    // Get available categories
    const categories = [...new Set(cycles.flatMap(c => c.articles?.map(a => a.category) || []))].filter(Boolean);

    res.json({
        articles: paginated,
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        categories
    });
});

// Sync cycle ID from frontend (one-time fix for legacy data)
app.post('/api/sync-cycle-id', (req, res) => {
    const { lastCycleId } = req.body;

    if (lastCycleId && lastCycleId > currentCycle.id) {
        console.log(`🔄 Syncing cycle ID: ${currentCycle.id} → ${lastCycleId + 1}`);
        currentCycle.id = lastCycleId + 1;
        saveData();
        res.json({ success: true, newCycleId: currentCycle.id });
    } else {
        res.json({ success: false, currentCycleId: currentCycle.id });
    }
});

// Save on exit
process.on('SIGINT', async () => {
    console.log('\n💾 Saving data before exit...');
    await saveData();
    process.exit();
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n🚀 SCANDAL Oracle v2.3 (MongoDB Edition)`);
    console.log(`📡 ${Object.values(RSS_FEEDS).flat().length} RSS feeds`);

    // Initialize from MongoDB after connection
    try {
        const mongoData = await initializeFromMongo();

        // Update local state from MongoDB
        seenLinks = new Set(mongoData.seenLinks || []);
        seenTitles = new Set(mongoData.seenTitles || []);

        // Update currentCycle ID from MongoDB
        if (mongoData.lastCycleId > currentCycle.id - 1) {
            currentCycle.id = mongoData.lastCycleId + 1;
        }

        console.log(`🗄️ MongoDB initialized: lastCycle=${mongoData.lastCycleId}`);
    } catch (e) {
        console.log(`⚠️ MongoDB init failed, using file data`);
    }

    console.log(`📊 Rate steps: 0.10% | 0.15% | 0.20% | 0.25% | 0.30%`);
    console.log(`📂 Loaded ${cycles.length} cycles | ${seenLinks.size} seen links`);
    console.log(`🆕 Starting Cycle ${currentCycle.id}...\n`);

    await scanAndAddNews();

    setInterval(async () => { await scanAndAddNews(); }, SCAN_INTERVAL);
    setInterval(() => { closeCycleAndStartNew(); }, AGGREGATION_INTERVAL);
});
