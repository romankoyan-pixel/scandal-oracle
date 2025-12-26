const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { ethers } = require('ethers');
require('dotenv').config();

// IMMEDIATE LOG - proves server started
console.log('🔥 Server.js loaded at:', new Date().toISOString());
console.log('🔥 Node version:', process.version);
console.log('🔥 MONGODB_URI exists:', !!process.env.MONGODB_URI);
console.log('🔥 OPENAI_API_KEY exists:', !!process.env.OPENAI_API_KEY);
console.log('🔥 PRIVATE_KEY exists:', !!process.env.PRIVATE_KEY);

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🚀 SCANDAL ORACLE V2.0 - ACTIVE');
console.log('🧠 AI SCORING: ENABLED (Impact/Controversy/Viral)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Import MongoDB models
const { Player, Prediction, Cycle, SystemState, GameBalance } = require('./models');

// ============================================
// BLOCKCHAIN / SMART CONTRACT CONFIG (V2)
// ============================================
const BLOCKCHAIN_CONFIG = {
    rpcUrl: process.env.BASE_SEPOLIA_RPC || 'https://base-sepolia-rpc.publicnode.com',
    tokenAddress: process.env.TOKEN_ADDRESS || '0x529bE4e4f5845EEF8e9Efc36B39d81Eb272c64B8',
    gameAddress: process.env.GAME_CONTRACT_ADDRESS || '0x623CAD34C495D28305318A30ed1fB8F391D696F8',
    // V2 Game ABI - Hybrid model with deposit/withdraw
    gameABI: [
        'function closeRound(uint8 result, uint256 rate) external',
        'function recordBet(address player, uint256 roundId, uint8 prediction, uint256 amount) external',
        'function recordBetResult(address player, uint256 roundId, bool won, uint256 payout) external',
        'function refundRound(uint256 roundId) external',
        'function refundPlayer(address player, uint256 roundId, uint256 amount) external',
        'function getCurrentRound() view returns (uint256 id, uint256 startTime, uint256 totalPool, uint256 mintPool, uint256 burnPool, uint256 neutralPool, bool closed)',
        'function currentRoundId() view returns (uint256)',
        'function balances(address) view returns (uint256)',
        'event Deposited(address indexed user, uint256 amount, uint256 newBalance)',
        'event Withdrawn(address indexed user, uint256 amount, uint256 newBalance)',
        'event BetRecorded(address indexed user, uint256 roundId, uint8 prediction, uint256 amount)',
        'event RoundClosed(uint256 indexed roundId, uint8 result, uint256 totalPool)'
    ],
    // Token ABI for oracle operations
    tokenABI: [
        'function oracleMint(uint256 rate) external',
        'function oracleBurn(uint256 rate) external',
        'function totalSupply() view returns (uint256)',
        'function balanceOf(address) view returns (uint256)',
        'function oracleReserve() view returns (uint256)',
        'function totalBurned() view returns (uint256)',
        'function getTokenomics() view returns (uint256 currentSupply, uint256 currentReserve, uint256 burned, uint256 reserveMin, uint256 reserveMax, bool isTaxEnabled)'
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

// ============================================
// SYNC STATE - Server/Blockchain synchronization
// ============================================
let syncState = {
    isSyncing: false,           // True while waiting for blockchain confirmation
    pendingCycle: null,         // Cycle waiting for blockchain confirmation
    retryCount: 0,              // Current retry attempt
    maxRetries: 3,              // Max retries before giving up
    lastBlockchainRoundId: 0,   // Last confirmed blockchain round
    lastError: null             // Last error message
};

const app = express();
const parser = new Parser();

// ============================================
// MONGODB CONNECTION (with retry)
// ============================================
const connectMongoDB = async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGODB_URI is not set!');
        return false;
    }
    try {
        await mongoose.connect(uri);
        console.log('✅ MongoDB connected');
        return true;
    } catch (err) {
        console.error('❌ MongoDB error:', err.message);
        return false;
    }
};

// Connect MongoDB (non-blocking)
connectMongoDB();

// Initialize OpenAI
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'missing-key'
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname)); // Serve static files (HTML, CSS, JS)

// ============================================
// MONGODB PERSISTENCE (No more JSON files)
// ============================================

// Load cycles and state from MongoDB only
async function loadDataFromMongo() {
    try {
        // Load system state
        const systemState = await SystemState.findOne({ key: 'main' });

        // Load recent cycles for in-memory array
        const recentCycles = await Cycle.find({ status: 'completed' })
            .sort({ cycleId: -1 })
            .limit(50)
            .lean();

        const result = {
            cycles: recentCycles.map(c => ({
                id: c.cycleId,
                startTime: c.startTime?.getTime() || Date.now(),
                endTime: c.endTime?.getTime() || Date.now(),
                status: c.status,
                articles: c.articles || [],
                averageScore: c.averageScore || 50,
                action: c.action || 'NEUTRAL',
                rate: c.rate || 0,
                ratePercentage: c.ratePercentage || '0%'
            })).reverse(),
            lastCycleId: systemState?.lastCycleId || 0,
            seenLinks: systemState?.seenLinks || [],
            seenTitles: systemState?.seenTitles || []
        };

        console.log(`🗄️ Loaded ${result.cycles.length} cycles from MongoDB`);
        return result;
    } catch (e) {
        console.error('Error loading from MongoDB:', e.message);
        return { cycles: [], lastCycleId: 0, seenLinks: [], seenTitles: [] };
    }
}

// Save state to MongoDB only (no file)
async function saveData() {
    try {
        // Update MongoDB SystemState
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

        console.log(`💾 Saved state to MongoDB`);
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
                ratePercentage: cycle.ratePercentage || '0%',
                supplyAfter: cycle.supplyAfter || null,
                supplyChange: cycle.supplyChange || 0
            },
            { upsert: true, new: true }
        );
        console.log(`🗄️ Saved cycle ${cycle.id} to MongoDB`);
        return cycleDoc;
    } catch (e) {
        console.error('Error saving cycle to MongoDB:', e.message);
    }
}

// Initialize from MongoDB only
async function initializeFromMongo() {
    try {
        // Try to get system state from MongoDB
        let systemState = await SystemState.findOne({ key: 'main' });

        if (systemState) {
            console.log(`🗄️ Found system state in MongoDB: lastCycleId=${systemState.lastCycleId}`);

            // Load ALL cycles from MongoDB (full archive)
            const recentCycles = await Cycle.find({ status: 'completed' })
                .sort({ cycleId: -1 })
                .lean();

            return {
                lastCycleId: systemState.lastCycleId,
                seenLinks: systemState.seenLinks || [],
                seenTitles: systemState.seenTitles || [],
                cycles: recentCycles.map(c => ({
                    id: c.cycleId,
                    startTime: c.startTime?.getTime() || Date.now(),
                    endTime: c.endTime?.getTime() || Date.now(),
                    status: c.status,
                    articles: c.articles || [],
                    averageScore: c.averageScore || 50,
                    action: c.action || 'NEUTRAL',
                    rate: c.rate || 0,
                    ratePercentage: c.ratePercentage || '0%'
                }))  // Removed .reverse() - cycles already sorted newest first
            };
        }

        // No state found - create new
        console.log(`🗄️ No system state in MongoDB - starting fresh`);
        await SystemState.create({
            key: 'main',
            lastCycleId: 0,
            seenLinks: [],
            seenTitles: []
        });

        return { lastCycleId: 0, seenLinks: [], seenTitles: [], cycles: [] };
    } catch (e) {
        console.error('MongoDB init error:', e.message);
        return { lastCycleId: 0, seenLinks: [], seenTitles: [], cycles: [] };
    }
}

// Sync cycle ID with blockchain at startup
async function syncCycleWithBlockchain() {
    if (!gameContract) {
        console.log('⚠️ No game contract - skipping blockchain cycle sync');
        return null;
    }

    try {
        const blockchainRoundId = await gameContract.currentRoundId();
        const currentBlockchainRound = Number(blockchainRoundId);
        console.log(`⛓️ Blockchain current round: ${currentBlockchainRound}`);
        return currentBlockchainRound;
    } catch (e) {
        console.error('❌ Failed to get blockchain round:', e.message);
        return null;
    }
}

// Initial empty data (will be populated after MongoDB connects)
let savedData = { cycles: [], lastCycleId: 0, seenLinks: [], seenTitles: [] };

// Load RSS Feeds
const RSS_FEEDS = require('./config/feeds');

// ============================================
// CATEGORY WEIGHTS FOR SCORING
// ============================================
const CATEGORY_WEIGHTS = {
    politics: 1.5,    // Government/policy - major market impact
    breaking: 1.5,    // Breaking news - immediate impact
    crypto: 1.4,      // Crypto news - direct relevance
    business: 1.3,    // Corporate/economy news
    world: 1.0,       // Global events - varied impact
    tech: 1.0,        // Technology news
    science: 0.8,     // Science discoveries - lower financial impact
    sports: 0.6,      // Sports - low market impact
    esports: 0.5      // Gaming/esports - minimal market impact
};

// Calculate weighted average score for a cycle
function calculateWeightedCycleScore(articles) {
    if (!articles || articles.length === 0) {
        console.log('📊 No articles - returning default score 50');
        return 50;
    }

    let weightedSum = 0;
    let totalWeight = 0;
    const allScores = [];

    console.log('📊 Calculating weighted score for', articles.length, 'articles:');

    articles.forEach((article, i) => {
        const score = article.score; // No fallback! AI must give real scores
        if (score === undefined || score === null) {
            console.log(`⚠️ Article ${i + 1} has no score, skipping`);
            return;
        }

        allScores.push(score);
        const category = (article.category || 'world').toLowerCase();

        // Base weight from category
        let baseWeight = CATEGORY_WEIGHTS[category] || 1.0;
        let weight = baseWeight;

        // Extreme score multiplier (x2 for scores <=15 or >=85)
        const isExtreme = score <= 15 || score >= 85;
        if (isExtreme) {
            weight *= 2;
        }

        weightedSum += score * weight;
        totalWeight += weight;

        console.log(`   [${i + 1}] ${category}: score=${score} | baseWeight=${baseWeight}${isExtreme ? ' x2 EXTREME' : ''} = ${weight.toFixed(2)} | contrib=${(score * weight).toFixed(1)}`);
    });

    const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 50;

    // NEW: Top score gets extra weight to reduce NEUTRAL bias
    const topScore = Math.max(...allScores);
    const bottomScore = Math.min(...allScores);

    // Final score: 70% top score + 30% weighted average
    // This ensures strong signals (scandals) aren't diluted
    const finalScore = (topScore * 0.7) + (weightedAvg * 0.3);

    console.log(`📊 WeightedAvg=${weightedAvg.toFixed(1)} | TopScore=${topScore} | BottomScore=${bottomScore}`);
    console.log(` 🎯 FINAL: (${topScore} * 0.7) + (${weightedAvg.toFixed(1)} * 0.3) = ${finalScore.toFixed(1)}`);

    return finalScore;
}

// ============================================
// DYNAMIC RATE CALCULATION - NEW THRESHOLDS
// NEUTRAL zone: 40-60 (21 points) 
// ============================================
function calculateDynamicRate(avgScore) {
    // MINT zone: 0-39 (40 points)
    if (avgScore < 40) {
        let rate;
        if (avgScore <= 8) rate = 0.0030;        // 0.30%
        else if (avgScore <= 16) rate = 0.0025;  // 0.25%
        else if (avgScore <= 24) rate = 0.0020;  // 0.20%
        else if (avgScore <= 32) rate = 0.0015;  // 0.15%
        else rate = 0.0010;                       // 0.10%

        return {
            action: 'MINT',
            rate: rate,
            percentage: (rate * 100).toFixed(2) + '%'
        };
    }

    // BURN zone: 61-100 (40 points)
    if (avgScore > 60) {
        let rate;
        if (avgScore >= 92) rate = 0.0030;       // 0.30%
        else if (avgScore >= 84) rate = 0.0025;  // 0.25%
        else if (avgScore >= 76) rate = 0.0020;  // 0.20%
        else if (avgScore >= 68) rate = 0.0015;  // 0.15%
        else rate = 0.0010;                       // 0.10%

        return {
            action: 'BURN',
            rate: rate,
            percentage: (rate * 100).toFixed(2) + '%'
        };
    }

    // NEUTRAL zone: 40-60 (21 points - narrower!)
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
// ============================================
// PREDICTIONS SYSTEM (MongoDB Based)
// ============================================

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

        // End of cycle processing

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

        // End of refund processing

        console.log(`💸 Cycle ${cycleId}: Refunded ${cyclePredictions.length} bets (no articles)`);

    } catch (err) {
        console.error('Refund predictions error:', err);
    }
}

// ============================================
// V2 GAME RESULTS PROCESSING
// ============================================

// Process V2 game results - update GameBalance with winnings
async function processV2GameResults(cycle, closedBlockchainRoundId = null) {
    const cycleId = cycle.id;
    const blockchainRoundId = closedBlockchainRoundId || cycleId; // Use blockchain round if provided
    const correctAnswer = cycle.action; // MINT, BURN, or NEUTRAL

    try {
        // Get all pending bets for this round from GameBalance
        const betsThisRound = await GameBalance.find({ 'pendingBet.roundId': cycleId });

        if (betsThisRound.length === 0) {
            console.log(`🎮 V2: No bets for round ${cycleId}`);
            return;
        }

        // Calculate pools
        const pools = { MINT: 0, BURN: 0, NEUTRAL: 0 };
        betsThisRound.forEach(b => {
            if (b.pendingBet?.prediction) {
                pools[b.pendingBet.prediction] += b.pendingBet.amount;
            }
        });

        const totalPool = pools.MINT + pools.BURN + pools.NEUTRAL;
        const winningPool = pools[correctAnswer];

        // Apply 5% fee (3% owner + 2% burn)
        const TOTAL_FEE = 0.05;
        const prizePool = totalPool * (1 - TOTAL_FEE);

        console.log(`🎮 V2 Round ${cycleId}: ${betsThisRound.length} bets, Total: ${totalPool}, Winner: ${correctAnswer}`);
        console.log(`   Pools: M=${pools.MINT} B=${pools.BURN} N=${pools.NEUTRAL}`);

        // Process each bet
        let winnersCount = 0;
        let losersCount = 0;

        for (const balance of betsThisRound) {
            const bet = balance.pendingBet;
            if (!bet) continue;

            const won = bet.prediction === correctAnswer;

            // Initialize betHistory if not exists
            if (!balance.betHistory) balance.betHistory = [];

            if (won && winningPool > 0) {
                // Pari-mutuel: payout proportional to bet / winning pool
                const payout = (bet.amount / winningPool) * prizePool;
                const roundedPayout = Math.floor(payout);

                balance.balance += roundedPayout;
                balance.totalWon = (balance.totalWon || 0) + roundedPayout;
                balance.wins = (balance.wins || 0) + 1;
                winnersCount++;

                // Record in bet history
                balance.betHistory.push({
                    roundId: cycleId,
                    prediction: bet.prediction,
                    amount: bet.amount,
                    won: true,
                    payout: roundedPayout,
                    timestamp: new Date()
                });

                console.log(`   ✅ ${balance.wallet.slice(0, 8)}: +${roundedPayout} SCNDL`);

                // Record on blockchain (async)
                if (gameContract) {
                    gameContract.recordBetResult(
                        balance.wallet,
                        blockchainRoundId,
                        true,
                        ethers.parseEther(roundedPayout.toString())
                    ).catch(e => console.log('Blockchain result record failed:', e.message));
                }
            } else {
                // Lost - bet already deducted
                balance.totalLost = (balance.totalLost || 0) + bet.amount;
                balance.losses = (balance.losses || 0) + 1;
                losersCount++;

                // Record in bet history
                balance.betHistory.push({
                    roundId: cycleId,
                    prediction: bet.prediction,
                    amount: bet.amount,
                    won: false,
                    payout: 0,
                    timestamp: new Date()
                });

                console.log(`   ❌ ${balance.wallet.slice(0, 8)}: -${bet.amount} SCNDL`);

                // Record loss on blockchain (async)
                if (gameContract) {
                    gameContract.recordBetResult(
                        balance.wallet,
                        blockchainRoundId,
                        false,
                        0
                    ).catch(e => console.log('Blockchain result record failed:', e.message));
                }
            }

            // Keep only last 20 bets in history
            if (balance.betHistory.length > 20) {
                balance.betHistory = balance.betHistory.slice(-20);
            }

            // Clear pending bet
            balance.pendingBet = { roundId: null, amount: 0, prediction: null };
            await balance.save();
        }

        console.log(`🎮 V2 Result: ${winnersCount} winners, ${losersCount} losers, Prize pool: ${prizePool.toFixed(0)} SCNDL`);

    } catch (err) {
        console.error('V2 game results error:', err);
    }
}

// Save cycle to MongoDB with supply tracking
async function saveCycleToMongo(cycle) {
    try {
        // Get current supply from blockchain
        let supplyAfter = 1000000000; // Default
        let supplyChange = 0;

        if (tokenContract) {
            try {
                const tokenomics = await tokenContract.getTokenomics();
                supplyAfter = Number(ethers.formatEther(tokenomics.currentSupply));
            } catch (e) {
                console.log('Could not fetch supply from blockchain:', e.message);
            }
        }

        // Calculate change based on rate
        if (cycle.action === 'MINT' && cycle.rate) {
            supplyChange = Math.floor(supplyAfter * cycle.rate / (1 + cycle.rate));
        } else if (cycle.action === 'BURN' && cycle.rate) {
            supplyChange = -Math.floor((supplyAfter / (1 - cycle.rate)) * cycle.rate);
        }

        const supplyBefore = supplyAfter - supplyChange;

        // Save to MongoDB
        await Cycle.findOneAndUpdate(
            { cycleId: cycle.id },
            {
                cycleId: cycle.id,
                startTime: new Date(cycle.startTime),
                endTime: new Date(cycle.endTime),
                status: 'completed',
                articles: cycle.articles.map(a => ({
                    title: a.title,
                    description: a.description,
                    source: a.source,
                    url: a.link,
                    score: a.score
                })),
                averageScore: cycle.averageScore,
                action: cycle.action,
                rate: cycle.rate,
                ratePercentage: cycle.ratePercentage,
                supplyBefore,
                supplyAfter,
                supplyChange
            },
            { upsert: true, new: true }
        );

        console.log(`📊 Saved cycle ${cycle.id} to MongoDB (Supply: ${supplyBefore.toLocaleString()} → ${supplyAfter.toLocaleString()})`);
    } catch (err) {
        console.error('Save cycle error:', err);
    }
}

// Refund V2 bets when no articles
async function refundV2Bets(cycleId, blockchainRoundId) {
    try {
        // Use blockchain roundId for contract calls, cycleId for DB queries
        const contractRoundId = blockchainRoundId || cycleId;

        const betsThisRound = await GameBalance.find({ 'pendingBet.roundId': cycleId });

        if (betsThisRound.length === 0) {
            console.log(`💸 V2: No bets to refund for round ${cycleId}`);
            return;
        }

        // First, mark round as refunded on blockchain
        if (gameContract) {
            try {
                console.log(`💸 V2: Calling refundRound(${contractRoundId}) on blockchain...`);
                const tx = await gameContract.refundRound(contractRoundId);
                await tx.wait();
                console.log(`✅ V2: Round ${contractRoundId} marked as refunded on blockchain`);
            } catch (e) {
                // Round might already be refunded or closed, continue with player refunds
                console.log(`⚠️ refundRound failed: ${e.message}`);
            }
        }

        // Then refund each player
        for (const balance of betsThisRound) {
            const bet = balance.pendingBet;
            if (!bet || !bet.amount) continue;

            // Return bet amount to player's balance
            balance.balance += bet.amount;

            // Mark this bet as refunded (for UI display)
            balance.betHistory.push({
                roundId: cycleId,
                prediction: bet.prediction,
                amount: bet.amount,
                won: false,
                payout: bet.amount, // Full refund
                refunded: true,
                timestamp: new Date()
            });

            balance.pendingBet = { roundId: null, amount: 0, prediction: null };
            await balance.save();

            console.log(`💸 V2 Refund: ${balance.wallet.slice(0, 8)} +${bet.amount} SCNDL`);

            // Record refund on blockchain (async)
            if (gameContract) {
                gameContract.refundPlayer(
                    balance.wallet,
                    contractRoundId,
                    ethers.parseEther(bet.amount.toString())
                ).catch(e => console.log('Blockchain refund failed:', e.message));
            }
        }

        console.log(`💸 V2: Refunded ${betsThisRound.length} bets for round ${cycleId}`);

    } catch (err) {
        console.error('V2 refund error:', err);
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

// Smart Score Checker V2 - Multi-factor Analysis
async function scoreArticle(article) {
    try {
        // Construct the "Smart Oracle" Prompt
        const systemPrompt = `You are "Scandal Oracle", an AI news analyzer. Evaluate how significant/scandalous each news item is.

# SCORING GUIDE
Rate these 3 factors (0-10 each):

1. **Market Impact**: Financial/economic significance
   - 10 = Global financial crisis, major exchange collapse, central bank action
   - 5 = Regional market news, medium company announcement
   - 0 = No financial/economic relevance

2. **Controversy/Scandal**: How negative or shocking this is
   - 10 = Fraud, arrests, war crimes, major hacks, corruption
   - 5 = Political disputes, layoffs, investigations
   - 0 = Positive developments, routine events, celebrations

3. **Viral Potential**: Media attention and shareability
   - 10 = Breaking news, unprecedented events, historic moments
   - 5 = Noteworthy but expected developments
   - 0 = Boring, routine, low interest

**Your output score = (Impact × 0.3 + Controversy × 0.5 + Viral × 0.2) × 10**

**IMPORTANT**: For routine news, use LOW values (2-4), NOT zeros! Zeros should only be for completely irrelevant news.

# CALIBRATION EXAMPLES
Example 1: "FTX collapses, CEO arrested for $8B fraud"
→ { "impact": 10, "controversy": 10, "viral": 10, "reason": "Massive crypto fraud scandal" }
→ Score: (10×0.3 + 10×0.5 + 10×0.2)×10 = 100

Example 2: "Spurs beat OKC in regular season game"
→ { "impact": 4, "controversy": 5, "viral": 5, "reason": "Routine sports game result" }
→ Score: (4×0.3 + 5×0.5 + 5×0.2)×10 = 47 (NEUTRAL zone ✅)

Example 3: "Central bank maintains interest rates"
→ { "impact": 4, "controversy": 3, "viral": 4, "reason": "Expected monetary policy decision" }
→ Score: (4×0.3 + 3×0.5 + 4×0.2)×10 = 43 (NEUTRAL zone ✅)

Example 4: "Tesla announces layoffs amid restructuring"
→ { "impact": 5, "controversy": 6, "viral": 6, "reason": "Significant corporate restructuring news" }
→ Score: (5×0.3 + 6×0.5 + 6×0.2)×10 = 63 (BURN zone)

Example 5: "War escalates, oil prices surge"
→ { "impact": 9, "controversy": 9, "viral": 10, "reason": "Major geopolitical crisis event" }
→ Score: (9×0.3 + 9×0.5 + 10×0.2)×10 = 92

# TASK
Return ONLY a JSON object: { "impact": number, "controversy": number, "viral": number, "reason": "short explanation 5 words" }`;

        const userPrompt = `News: "${article.title}" - ${article.description?.substring(0, 300) || ''}`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" }, // Enforce JSON
            max_completion_tokens: 100
        });

        const responseContent = completion.choices[0].message.content.trim();
        let result;
        try {
            result = JSON.parse(responseContent);
        } catch (e) {
            console.error('JSON parse failed, manual fallback');
            result = { impact: 5, controversy: 5, viral: 5, reason: "Parse error" };
        }

        // Calculate weighted score (0-100)
        // Weighted formula: Controversy is most important for SCANDAL theme
        const rawScore = (
            (result.impact || 0) * 0.3 +       // 30% weight
            (result.controversy || 0) * 0.5 +  // 50% weight (SCANDAL focus)
            (result.viral || 0) * 0.2          // 20% weight
        ) * 10;
        const score = Math.min(100, Math.max(0, Math.round(rawScore)));

        console.log(`🧠 AI Analysis: Score ${score} | Imp:${result.impact} Cont:${result.controversy} Vir:${result.viral} | "${result.reason}"`);

        return {
            ...article,
            score,
            analysis: {
                impact: result.impact,
                controversy: result.controversy,
                viral: result.viral,
                reason: result.reason
            }
        };

    } catch (error) {
        console.error('⚠️ Scoring error:', error.message);
        const title = article.title.toLowerCase();
        let score = 50;
        if (title.match(/scandal|corruption|crisis|war|attack|killed|fraud/)) score = 80;
        else if (title.match(/peace|success|growth|agreement|win|launch/)) score = 20;
        return { ...article, score, analysis: { reason: "Fallback logic" } };
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

        // 1. Close game round
        const tx = await gameContract.closeRound(resultCode, rateValue);
        console.log(`📤 Transaction sent: ${tx.hash}`);
        await tx.wait();
        console.log(`✅ Game round closed on blockchain!`);

        // 2. Execute MINT or BURN on token contract (if not NEUTRAL)
        if (tokenContract && rateValue > 0 && result !== 'NEUTRAL') {
            try {
                if (result === 'MINT') {
                    console.log(`🟢 Calling oracleMint(${rateValue})...`);
                    const mintTx = await tokenContract.oracleMint(rateValue);
                    await mintTx.wait();
                    console.log(`✅ Oracle MINT executed!`);
                } else if (result === 'BURN') {
                    console.log(`🔴 Calling oracleBurn(${rateValue})...`);
                    const burnTx = await tokenContract.oracleBurn(rateValue);
                    await burnTx.wait();
                    console.log(`✅ Oracle BURN executed!`);
                }
            } catch (supplyError) {
                console.error(`⚠️ Supply adjustment failed:`, supplyError.message);
                // Continue - game round was closed successfully
            }
        }

        // Update blockchain round ID after successful close
        try {
            const newRoundId = await gameContract.currentRoundId();
            syncState.lastBlockchainRoundId = Number(newRoundId);
            console.log(`⛓️ New blockchain round: ${syncState.lastBlockchainRoundId}`);
        } catch (e) {
            console.log('⚠️ Could not get new round ID');
        }

        return { success: true, txHash: tx.hash };
    } catch (error) {
        console.error('❌ closeRound blockchain error:', error.message);
        return { success: false, error: error.message };
    }
}

// Close cycle
async function closeCycleAndStartNew() {
    // Close cycle even if empty - just mark as NEUTRAL with 0 articles
    // Use weighted average with category weights and extreme score multipliers
    const avgScore = calculateWeightedCycleScore(currentCycle.articles);

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
    // CLOSE ROUND ON BLOCKCHAIN (with sync check)
    // ============================================
    syncState.isSyncing = true;
    syncState.pendingCycle = completedCycle;

    // Store the blockchain round that will be closed
    const closedBlockchainRoundId = syncState.lastBlockchainRoundId || completedCycle.id;

    const blockchainResult = await closeRoundOnBlockchain(
        completedCycle.action,
        completedCycle.ratePercentage.replace('%', '')
    );

    // Check if blockchain call succeeded
    if (!blockchainResult.success) {
        syncState.lastError = blockchainResult.error || blockchainResult.reason;
        syncState.retryCount++;

        if (syncState.retryCount < syncState.maxRetries) {
            console.error(`⚠️ Blockchain sync failed (${syncState.retryCount}/${syncState.maxRetries}): ${syncState.lastError}`);
            console.log(`⏳ Retrying in 10 seconds...`);
            setTimeout(() => closeCycleAndStartNew(), 10000);
            return; // DON'T start new cycle yet
        } else {
            console.error(`❌ Blockchain sync failed after ${syncState.maxRetries} retries. Continuing anyway...`);
        }
    }

    // Blockchain success or max retries reached
    syncState.isSyncing = false;
    syncState.retryCount = 0;
    syncState.lastError = null;
    syncState.pendingCycle = null;

    completedCycle.blockchainTx = blockchainResult.txHash || null;
    completedCycle.blockchainSuccess = blockchainResult.success;

    // Get current supply from blockchain and store in cycle
    if (tokenContract) {
        try {
            const tokenomics = await tokenContract.getTokenomics();
            const currentSupply = Number(ethers.formatEther(tokenomics[0])); // currentSupply is first element
            completedCycle.supplyAfter = currentSupply;
            console.log(`📊 Supply after cycle: ${currentSupply.toLocaleString()}`);
        } catch (e) {
            console.log('⚠️ Could not fetch supply from blockchain:', e.message);
        }
    }

    // Handle predictions based on article count
    if (completedCycle.articles.length === 0) {
        // No articles = refund all bets without house fee
        completedCycle.refunded = true; // Mark cycle as refunded for UI
        completedCycle.action = 'REFUNDED'; // Override NEUTRAL to show properly
        await refundPredictions(completedCycle.id);
        await refundV2Bets(completedCycle.id, closedBlockchainRoundId); // V2 refunds with blockchain roundId
    } else {
        // Has articles = process predictions normally
        await processPredictions(completedCycle);
        await processV2GameResults(completedCycle, closedBlockchainRoundId); // V2 processing with blockchain roundId
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
    } else if (!blockchainResult.success) {
        console.log(`⚠️ Blockchain: FAILED - ${syncState.lastError || 'unknown error'}`);
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
    // Use weighted average with category weights and extreme multipliers
    const avgScore = calculateWeightedCycleScore(currentCycle.articles);

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
    // Use weighted average with category weights and extreme multipliers
    const avgScore = calculateWeightedCycleScore(currentCycle.articles);

    const rateInfo = calculateDynamicRate(avgScore);

    res.json({
        cycleId: currentCycle.id,
        action: rateInfo.action,
        rate: rateInfo.rate,
        ratePercentage: rateInfo.percentage,
        score: avgScore,
        articlesCount: currentCycle.articles.length,
        totalCycles: cycles.length,
        cycleTimeRemaining: Math.max(0, AGGREGATION_INTERVAL - (Date.now() - currentCycle.startTime)),
        // Sync state for frontend
        sync: {
            isSyncing: syncState.isSyncing,
            retryCount: syncState.retryCount,
            maxRetries: syncState.maxRetries,
            lastError: syncState.lastError
        }
    });
});

// Supply history for chart (uses in-memory cycles + MongoDB)
app.get('/api/supply-history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 500;
        let history = [];

        // Try MongoDB first
        const mongoCycles = await Cycle.find({ status: 'completed' })
            .sort({ cycleId: -1 })
            .limit(limit)
            .select('cycleId action rate supplyAfter supplyChange averageScore endTime')
            .lean();

        if (mongoCycles.length > 0) {
            // Use MongoDB data - filter out corrupt entries (exact 1B usually means restart bug)
            history = mongoCycles
                .filter(c => c.supplyAfter && c.supplyAfter !== 1000000000)
                .reverse()
                .map(c => ({
                    cycle: c.cycleId,
                    supply: c.supplyAfter,
                    action: c.action,
                    change: c.supplyChange || 0,
                    rate: c.rate || 0,
                    score: c.averageScore,
                    timestamp: c.endTime
                }));
        } else {
            // Fallback: use in-memory cycles array
            const inMemoryCycles = cycles.slice(-limit).reverse();
            let currentSupply = 1000000000;

            history = inMemoryCycles.map(c => {
                const rate = c.rate || 0;
                let change = 0;
                if (c.action === 'MINT' && rate > 0) {
                    change = Math.floor(currentSupply * rate);
                    currentSupply += change;
                } else if (c.action === 'BURN' && rate > 0) {
                    change = Math.floor(currentSupply * rate);
                    currentSupply -= change;
                }
                return {
                    cycle: c.id,
                    supply: currentSupply,
                    action: c.action,
                    change: change,
                    rate: rate,
                    score: c.averageScore,
                    timestamp: c.endTime
                };
            }).reverse();

            // Filter out 1B entries from in-memory too
            history = history.filter(h => h.supply !== 1000000000);
        }

        // NO GENESIS POINT - just real data
        // If empty, return empty array
        if (history.length === 0) {
            return res.json({
                history: [],
                totalCycles: 0,
                source: 'empty'
            });
        }

        res.json({
            history,
            totalCycles: history.length,
            source: mongoCycles.length > 0 ? 'mongodb' : 'memory'
        });
    } catch (error) {
        console.error('Supply history error:', error);
        res.status(500).json({ error: error.message });
    }
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

        // Legacy JSON logic removed
        // savePredictions();

        console.log(`🎮 Vote: ${wallet.slice(0, 6)}... → ${vote} (${amount} $SCNDL)`);
        res.json({ success: true, vote, cycleId, amount, newBalance: player.balance });

    } catch (err) {
        console.error('Vote error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Game status endpoint - with V2 pool data
app.get('/api/game-status', async (req, res) => {
    const elapsed = Date.now() - currentCycle.startTime;
    const halfCycle = AGGREGATION_INTERVAL / 2;
    const votingOpen = elapsed < halfCycle;
    const wallet = req.query.wallet; // Extract wallet from query params

    const cycleId = currentCycle.id.toString();
    let userVote = null;
    let userPendingBet = null;

    // Legacy vote check removed
    // if (wallet && predictions.cycleVotes[cycleId]?.voters?.[wallet]) {
    //     userVote = predictions.cycleVotes[cycleId].voters[wallet].vote;
    // }

    // V2 pending bet check from GameBalance
    if (wallet) {
        try {
            const balance = await GameBalance.findOne({ wallet });
            if (balance?.pendingBet?.roundId === currentCycle.id) {
                userPendingBet = balance.pendingBet;
                userVote = balance.pendingBet.prediction; // Override with V2 bet
            }
        } catch (e) {
            console.log('GameBalance lookup error:', e.message);
        }
    }

    // Calculate V2 pool from all pending bets for current round
    let pools = { mint: 0, neutral: 0, burn: 0 };
    try {
        const bets = await GameBalance.find({ 'pendingBet.roundId': currentCycle.id });
        bets.forEach(b => {
            if (b.pendingBet?.prediction) {
                const pred = b.pendingBet.prediction.toLowerCase();
                if (pools[pred] !== undefined) {
                    pools[pred] += b.pendingBet.amount || 0;
                }
            }
        });
    } catch (e) {
        console.log('Pool calculation error:', e.message);
    }

    // Calculate current Oracle score for race animation
    const avgScore = calculateWeightedCycleScore(currentCycle.articles);
    const rateInfo = calculateDynamicRate(avgScore);

    res.json({
        cycleId: currentCycle.id,
        votingOpen,
        votingTimeRemaining: Math.max(0, halfCycle - elapsed),
        cycleTimeRemaining: Math.max(0, AGGREGATION_INTERVAL - elapsed),
        cycleTotal: AGGREGATION_INTERVAL,
        cycleProgress: Math.min(1, elapsed / AGGREGATION_INTERVAL), // 0 to 1
        averageScore: avgScore, // Oracle score for race
        projectedAction: rateInfo.action, // MINT, BURN, or NEUTRAL
        totalVotes: pools.mint + pools.burn + pools.neutral,
        articlesCount: currentCycle.articles.length,
        minArticlesRequired: MIN_ARTICLES_FOR_GAME,
        userVote,
        userPendingBet,
        pools,
        poolTotal: pools.mint + pools.neutral + pools.burn
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
        res.json({ leaderboard: [] });
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

// REMOVED INSECURE & REDUNDANT ENDPOINTS

// Get last completed cycle
app.get('/api/last-cycle', async (req, res) => {
    try {
        // Try to get from MongoDB first - sort by cycleId, not mongo _id
        const lastCycleFromDB = await Cycle.findOne({ status: 'completed' })
            .sort({ cycleId: -1 })
            .lean();

        if (lastCycleFromDB) {
            // Map cycleId to id for frontend compatibility
            const responseData = {
                ...lastCycleFromDB,
                id: lastCycleFromDB.cycleId, // Frontend expects 'id'
                action: lastCycleFromDB.action || 'NEUTRAL' // Ensure action is set
            };
            return res.json({
                lastCycle: responseData,
                currentCycleId: currentCycle.id
            });
        }

        // Fallback to local cycles array
        const completedCycles = cycles.filter(c => c.status === 'completed');
        if (completedCycles.length > 0) {
            // Sort by id descending and get first
            completedCycles.sort((a, b) => b.id - a.id);
            const lastCycle = {
                ...completedCycles[0],
                action: completedCycles[0].action || 'NEUTRAL'
            };
            return res.json({
                lastCycle,
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

// ============================================
// PENDING REFUNDS API - for Oracle Arena UI
// ============================================
app.get('/api/v2/pending-refunds/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        const balance = await GameBalance.findOne({ wallet });

        if (!balance || !balance.betHistory) {
            return res.json({ pendingRefunds: [], totalRefundable: 0 });
        }

        // Find refunded bets that haven't been claimed
        const pendingRefunds = balance.betHistory
            .filter(bet => bet.refunded && bet.payout > 0)
            .map(bet => ({
                roundId: bet.roundId,
                amount: bet.payout,
                prediction: bet.prediction,
                timestamp: bet.timestamp
            }));

        const totalRefundable = pendingRefunds.reduce((sum, r) => sum + r.amount, 0);

        res.json({ pendingRefunds, totalRefundable });
    } catch (err) {
        console.error('Pending refunds error:', err);
        res.json({ pendingRefunds: [], totalRefundable: 0, error: err.message });
    }
});

// Pool statistics for Oracle Arena scales
app.get('/api/v2/pool-stats', async (req, res) => {
    try {
        // Get all pending bets for current round
        const bets = await GameBalance.find({ 'pendingBet.roundId': currentCycle.id });

        let pools = { mint: 0, neutral: 0, burn: 0 };
        let betters = { mint: 0, neutral: 0, burn: 0 };

        bets.forEach(b => {
            if (b.pendingBet?.prediction && b.pendingBet?.amount) {
                const pred = b.pendingBet.prediction.toLowerCase();
                if (pools[pred] !== undefined) {
                    pools[pred] += b.pendingBet.amount;
                    betters[pred]++;
                }
            }
        });

        const totalPool = pools.mint + pools.neutral + pools.burn;
        const totalBetters = betters.mint + betters.neutral + betters.burn;

        // Calculate percentages
        const percentages = {
            mint: totalPool > 0 ? Math.round((pools.mint / totalPool) * 100) : 0,
            neutral: totalPool > 0 ? Math.round((pools.neutral / totalPool) * 100) : 0,
            burn: totalPool > 0 ? Math.round((pools.burn / totalPool) * 100) : 0
        };

        // Calculate scale tilt: positive = MINT heavier, negative = BURN heavier
        const scaleTilt = percentages.mint - percentages.burn;

        res.json({
            roundId: currentCycle.id,
            pools,
            percentages,
            totalPool,
            betters,
            totalBetters,
            scaleTilt  // -100 to +100, 0 = balanced
        });
    } catch (err) {
        console.error('Pool stats error:', err);
        res.json({ pools: { mint: 0, neutral: 0, burn: 0 }, totalPool: 0, percentages: { mint: 0, neutral: 0, burn: 0 }, scaleTilt: 0 });
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

// ============================================
// V2 HYBRID GAME API ENDPOINTS
// ============================================

// Get user's game balance
app.get('/api/v2/balance/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        let balance = await GameBalance.findOne({ wallet });

        if (!balance) {
            balance = { wallet, balance: 0, pendingBet: null };
        }

        // AUTO-CLEAR STALE BETS: If pending bet is from an old cycle, clear it
        // This fixes the "Stuck Bet" issue on frontend
        if (balance.pendingBet && balance.pendingBet.roundId && balance.pendingBet.roundId < currentCycle.id) {
            console.log(`🧹 Auto-clearing stale bet for ${wallet}: Round ${balance.pendingBet.roundId} < Current ${currentCycle.id}`);

            // We need to fetch the real document to save it
            const realBalance = await GameBalance.findOne({ wallet });
            if (realBalance) {
                realBalance.pendingBet = { roundId: null, amount: 0, prediction: null };
                await realBalance.save();
                // Update local variable for response
                balance.pendingBet = null;
            }
        }

        // Also get on-chain balance for verification
        let onChainBalance = 0;
        if (gameContract) {
            try {
                const contractBalance = await gameContract.balances(wallet);
                onChainBalance = Number(ethers.formatEther(contractBalance));
            } catch (e) {
                console.log('Could not fetch on-chain balance');
            }
        }

        res.json({
            wallet,
            balance: balance.balance,
            pendingBet: balance.pendingBet,
            onChainBalance,
            stats: {
                totalDeposited: balance.totalDeposited || 0,
                totalWithdrawn: balance.totalWithdrawn || 0,
                totalWon: balance.totalWon || 0,
                totalLost: balance.totalLost || 0,
                wins: balance.wins || 0,
                losses: balance.losses || 0,
                winRate: (balance.wins || 0) + (balance.losses || 0) > 0
                    ? Math.round(((balance.wins || 0) / ((balance.wins || 0) + (balance.losses || 0))) * 100)
                    : 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Sync balance from blockchain to MongoDB (called after deposit/withdraw)
app.post('/api/v2/sync-balance', async (req, res) => {
    const { wallet } = req.body;
    if (!wallet) {
        return res.status(400).json({ error: 'Wallet required' });
    }

    const walletLower = wallet.toLowerCase();

    try {
        // Get current balance from blockchain
        let onChainBalance = 0;
        if (gameContract) {
            try {
                const contractBalance = await gameContract.balances(walletLower);
                onChainBalance = Number(ethers.formatEther(contractBalance));
            } catch (e) {
                console.log('Could not fetch on-chain balance:', e.message);
            }
        }

        // Update or create GameBalance in MongoDB
        let balance = await GameBalance.findOne({ wallet: walletLower });

        if (!balance) {
            balance = new GameBalance({
                wallet: walletLower,
                balance: onChainBalance,
                pendingBet: { roundId: null, amount: 0, prediction: null }
            });
        } else {
            balance.balance = onChainBalance;
        }

        await balance.save();

        console.log(`🔄 Synced balance for ${walletLower.slice(0, 8)}: ${onChainBalance} SCNDL`);

        res.json({
            success: true,
            wallet: walletLower,
            balance: onChainBalance
        });
    } catch (error) {
        console.error('Sync balance error:', error);
        res.status(500).json({ error: error.message });
    }
});

// REMOVED: /api/v2/reset-stats/:wallet - SECURITY RISK (allowed anyone to reset any player's stats)

// Get player bet history
app.get('/api/v2/history/:wallet', async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        const balance = await GameBalance.findOne({ wallet });

        if (!balance) {
            return res.json({ history: [] });
        }

        // Build history from bet results stored in GameBalance
        const history = [];

        // Add pending bet if exists
        if (balance.pendingBet && balance.pendingBet.roundId) {
            history.push({
                roundId: balance.pendingBet.roundId,
                prediction: balance.pendingBet.prediction,
                amount: balance.pendingBet.amount,
                pending: true
            });
        }

        // Add past bets from betHistory array (if we track it)
        if (balance.betHistory) {
            balance.betHistory.slice(-20).reverse().forEach(bet => {
                history.push(bet);
            });
        }

        res.json({ history });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Leaderboard - Top players by profit (only real game winnings)
app.get('/api/v2/leaderboard', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const sortBy = req.query.sortBy || 'profit'; // profit, totalWon, wins, winRate

        // Get all players who have played (wins + losses > 0)
        const players = await GameBalance.find({
            $or: [{ wins: { $gt: 0 } }, { losses: { $gt: 0 } }]
        }).select('wallet totalWon totalLost wins losses balance');

        // Calculate profit and win rate for each player
        const leaderboard = players.map(p => ({
            wallet: p.wallet,
            profit: (p.totalWon || 0) - (p.totalLost || 0),
            totalWon: p.totalWon || 0,
            totalLost: p.totalLost || 0,
            wins: p.wins || 0,
            losses: p.losses || 0,
            winRate: (p.wins || 0) + (p.losses || 0) > 0
                ? Math.round((p.wins / ((p.wins || 0) + (p.losses || 0))) * 100)
                : 0
        }));

        // Sort based on requested field
        if (sortBy === 'totalWon') {
            leaderboard.sort((a, b) => b.totalWon - a.totalWon);
        } else if (sortBy === 'wins') {
            leaderboard.sort((a, b) => b.wins - a.wins);
        } else if (sortBy === 'winRate') {
            leaderboard.sort((a, b) => b.winRate - a.winRate);
        } else {
            // Default: sort by profit
            leaderboard.sort((a, b) => b.profit - a.profit);
        }

        res.json({
            leaderboard: leaderboard.slice(0, limit),
            totalPlayers: players.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/v2/bet', async (req, res) => {
    try {
        const { wallet, prediction, amount } = req.body;

        if (!wallet || !prediction || !amount) {
            return res.status(400).json({ error: 'Missing wallet, prediction, or amount' });
        }

        const walletLower = wallet.toLowerCase();
        const betAmount = Number(amount);

        // Validate prediction
        const validPredictions = ['MINT', 'BURN', 'NEUTRAL'];
        if (!validPredictions.includes(prediction.toUpperCase())) {
            return res.status(400).json({ error: 'Invalid prediction. Use MINT, BURN, or NEUTRAL' });
        }

        // Get or create user balance
        let balance = await GameBalance.findOne({ wallet: walletLower });
        if (!balance) {
            balance = new GameBalance({ wallet: walletLower });
        }

        // ATOMIC UPDATE: Check balance AND deduct in one operation to prevent race conditions
        const updatedBalance = await GameBalance.findOneAndUpdate(
            {
                wallet: walletLower,
                balance: { $gte: betAmount } // Condition: Must have equal or more than betAmount
            },
            {
                $inc: { balance: -betAmount }, // Atomically deduct
                $set: {
                    pendingBet: {
                        roundId: currentCycle.id,
                        amount: betAmount,
                        prediction: prediction.toUpperCase()
                    },
                    lastBetAt: new Date()
                },
                $inc: { totalBet: betAmount } // Atomically increment total bet
            },
            { new: true } // Return the updated document
        );

        if (!updatedBalance) {
            // Check why it failed - either wallet doesn't exist OR insufficient funds
            // We can use the 'balance' variable we fetched at the start of the function
            // to provide a better error message if it exists

            // Re-fetch to be sure (in case of very rapid concurrent updates)
            const checkBalance = await GameBalance.findOne({ wallet: walletLower });

            if (!checkBalance) {
                return res.status(400).json({ error: 'Wallet not found' });
            }
            if (checkBalance.pendingBet && checkBalance.pendingBet.roundId === currentCycle.id) {
                return res.status(400).json({ error: 'Already bet this round' });
            }

            return res.status(400).json({
                error: 'Insufficient balance',
                available: checkBalance.balance,
                requested: betAmount
            });
        }

        // Record bet on blockchain (async - don't block game)
        // Use blockchain roundId (may differ from server cycleId)
        const blockchainRoundId = syncState.lastBlockchainRoundId || currentCycle.id;
        if (gameContract) {
            const predictionCode = { 'MINT': 1, 'BURN': 2, 'NEUTRAL': 3 }[prediction.toUpperCase()];
            // Fire and forget - sync happens at round close
            gameContract.recordBet(
                walletLower,
                blockchainRoundId,
                predictionCode,
                ethers.parseEther(betAmount.toString())
            ).then(tx => {
                console.log(`⛓️ Bet TX sent: ${tx.hash}`);
                return tx.wait();
            }).then(() => {
                console.log(`✅ Bet confirmed on blockchain`);
            }).catch(e => {
                console.error(`❌ Blockchain bet failed (will sync at round close): ${e.message}`);
            });
        }

        console.log(`🎲 BET: ${walletLower.slice(0, 8)} → ${prediction} ${betAmount} SCNDL (Round ${currentCycle.id})`);

        res.json({
            success: true,
            roundId: currentCycle.id,
            prediction: prediction.toUpperCase(),
            amount: betAmount,
            newBalance: balance.balance
        });

    } catch (error) {
        console.error('Bet error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Sync balance from blockchain (after deposit/withdraw on-chain)
app.post('/api/v2/sync-balance', async (req, res) => {
    try {
        const { wallet } = req.body;
        if (!wallet) {
            return res.status(400).json({ error: 'Missing wallet' });
        }

        const walletLower = wallet.toLowerCase();

        // SECURITY: Check for pending bets to prevent 'Double Spend'
        // User cannot restore balance while a bet is in 'pending' state
        let balance = await GameBalance.findOne({ wallet: walletLower });
        if (balance && balance.pendingBet && balance.pendingBet.roundId) {
            // If bet is older than 5 minutes, assume it failed and allow sync
            const betAge = balance.lastBetAt ? (Date.now() - new Date(balance.lastBetAt).getTime()) : 0;
            if (betAge < 300000) { // 5 minutes
                console.warn(`🛑 Blocked sync-balance for ${walletLower} (Active pending bet)`);
                return res.status(400).json({
                    error: 'Cannot sync while bet is pending',
                    code: 'PENDING_BET'
                });
            }
        }

        // Get on-chain balance
        if (!gameContract) {
            return res.status(500).json({ error: 'Blockchain not configured' });
        }

        const contractBalance = await gameContract.balances(walletLower);
        const onChainBalance = Number(ethers.formatEther(contractBalance));

        // Update local balance
        if (!balance) {
            balance = new GameBalance({ wallet: walletLower });
        }

        const oldBalance = balance.balance;
        balance.balance = onChainBalance;

        // Track deposit/withdraw
        if (onChainBalance > oldBalance) {
            balance.totalDeposited = (balance.totalDeposited || 0) + (onChainBalance - oldBalance);
            balance.lastDepositAt = new Date();
        } else if (onChainBalance < oldBalance) {
            balance.totalWithdrawn = (balance.totalWithdrawn || 0) + (oldBalance - onChainBalance);
            balance.lastWithdrawAt = new Date();
        }

        await balance.save();

        console.log(`💰 SYNC: ${walletLower.slice(0, 8)} balance: ${oldBalance} → ${onChainBalance}`);

        res.json({
            success: true,
            wallet: walletLower,
            oldBalance,
            newBalance: onChainBalance,
            change: onChainBalance - oldBalance
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get current round info for V2
app.get('/api/v2/round', async (req, res) => {
    try {
        const avgScore = currentCycle.articles.length > 0
            ? currentCycle.articles.reduce((sum, a) => sum + a.score, 0) / currentCycle.articles.length
            : 50;

        const rateInfo = calculateDynamicRate(avgScore);

        // Count pending bets for this round
        const bets = await GameBalance.find({ 'pendingBet.roundId': currentCycle.id });
        const totalBets = bets.reduce((sum, b) => sum + (b.pendingBet?.amount || 0), 0);
        const pools = {
            mint: bets.filter(b => b.pendingBet?.prediction === 'MINT').reduce((s, b) => s + b.pendingBet.amount, 0),
            burn: bets.filter(b => b.pendingBet?.prediction === 'BURN').reduce((s, b) => s + b.pendingBet.amount, 0),
            neutral: bets.filter(b => b.pendingBet?.prediction === 'NEUTRAL').reduce((s, b) => s + b.pendingBet.amount, 0)
        };

        res.json({
            roundId: currentCycle.id,
            startTime: currentCycle.startTime,
            timeRemaining: Math.max(0, AGGREGATION_INTERVAL - (Date.now() - currentCycle.startTime)),
            projectedAction: rateInfo.action,
            projectedRate: rateInfo.percentage,
            score: avgScore,
            articlesCount: currentCycle.articles.length,
            totalPool: totalBets,
            pools,
            playerCount: bets.length,
            sync: {
                isSyncing: syncState.isSyncing,
                retryCount: syncState.retryCount
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
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

        // Load cycles from MongoDB into memory
        if (mongoData.cycles && mongoData.cycles.length > 0) {
            cycles = mongoData.cycles;
        }

        // Update currentCycle ID from MongoDB
        if (mongoData.lastCycleId > currentCycle.id - 1) {
            currentCycle.id = mongoData.lastCycleId + 1;
        }

        console.log(`🗄️ MongoDB initialized: ${cycles.length} cycles, lastCycle=${mongoData.lastCycleId}`);
    } catch (e) {
        console.log(`⚠️ MongoDB init failed: ${e.message}`);
    }

    // Sync with blockchain currentRoundId
    if (gameContract) {
        try {
            const blockchainRoundId = await gameContract.currentRoundId();
            const bcRound = Number(blockchainRoundId);
            console.log(`⛓️ Blockchain currentRoundId: ${bcRound}`);

            // Use blockchain round ID if it's higher than our local ID
            if (bcRound >= currentCycle.id) {
                console.log(`⛓️ Syncing server cycle to blockchain: ${currentCycle.id} → ${bcRound}`);
                currentCycle.id = bcRound;
            } else {
                // Blockchain is behind - store for reference
                console.log(`⚠️ Blockchain (${bcRound}) is behind server (${currentCycle.id})`);
                console.log(`⚠️ Bets will use blockchain roundId: ${bcRound}`);
            }
            // Always store blockchain round ID for betting
            syncState.lastBlockchainRoundId = bcRound;
        } catch (e) {
            console.log(`⚠️ Blockchain sync failed: ${e.message}`);
        }
    }

    console.log(`📊 Rate steps: 0.10% | 0.15% | 0.20% | 0.25% | 0.30%`);
    console.log(`🗄️ Ready: ${cycles.length} cycles | ${seenLinks.size} seen links`);
    console.log(`🆕 Starting Cycle ${currentCycle.id}...`);

    await scanAndAddNews();

    setInterval(async () => { await scanAndAddNews(); }, SCAN_INTERVAL);
    setInterval(() => { closeCycleAndStartNew(); }, AGGREGATION_INTERVAL);
});
