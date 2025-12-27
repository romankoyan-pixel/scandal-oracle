// Web3 Configuration for SCANDAL Protocol V2
// Base Sepolia Testnet - Hybrid Deposit/Withdraw Model

const WEB3_CONFIG = {
    // Network settings
    network: {
        chainId: 84532,
        chainIdHex: '0x14A34',
        name: 'Base Sepolia',
        rpcUrl: 'https://sepolia.base.org',
        explorer: 'https://sepolia.basescan.org',
        currency: {
            name: 'ETH',
            symbol: 'ETH',
            decimals: 18
        }
    },

    // Contract addresses (V2 Security Update - deployed 2025-12-25)
    contracts: {
        token: '0x6aDbe002CA59D7C4D675428d4123D5b815b02Cb4',
        game: '0xB3dC588bcc8f11484799B7b46688D3Fb92C3a1Cb'
    },

    // API endpoints
    api: {
        base: '', // Same origin
        balance: '/api/v2/balance',
        bet: '/api/v2/bet',
        syncBalance: '/api/v2/sync-balance',
        round: '/api/v2/round'
    },

    // Token ABI (for approve/transfer)
    tokenABI: [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function totalSupply() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address owner, address spender) view returns (uint256)",
        "function getTokenomics() view returns (uint256 currentSupply, uint256 currentReserve, uint256 burned, uint256 reserveMin, uint256 reserveMax, bool isTaxEnabled)",
        "function approve(address spender, uint256 amount) returns (bool)",
        "function transfer(address to, uint256 amount) returns (bool)",
        "event Transfer(address indexed from, address indexed to, uint256 value)",
        "event Approval(address indexed owner, address indexed spender, uint256 value)"
    ],

    // V2 Game ABI - Hybrid model with deposit/withdraw
    gameABI: [
        // Read functions
        "function minDeposit() view returns (uint256)",
        "function minBet() view returns (uint256)",
        "function maxBetAmount() view returns (uint256)",
        "function currentRoundId() view returns (uint256)",
        "function balances(address) view returns (uint256)",
        "function getCurrentRound() view returns (uint256 id, uint256 startTime, uint256 totalPool, uint256 mintPool, uint256 burnPool, uint256 neutralPool, bool closed)",
        "function getRoundInfo(uint256 roundId) view returns (uint256 id, uint256 startTime, uint256 endTime, uint256 totalPool, uint8 result, bool closed, bool refunded)",
        "function isSolvent() view returns (bool)",

        // User functions (on-chain)
        "function deposit(uint256 amount)",
        "function withdraw(uint256 amount)",
        "function emergencyWithdraw()",

        // Events
        "event Deposited(address indexed user, uint256 amount, uint256 newBalance)",
        "event Withdrawn(address indexed user, uint256 amount, uint256 newBalance)",
        "event EmergencyWithdrawn(address indexed user, uint256 amount)",
        "event BetRecorded(address indexed user, uint256 roundId, uint8 prediction, uint256 amount)",
        "event BetResult(address indexed user, uint256 roundId, bool won, int256 profitLoss)",
        "event RoundClosed(uint256 indexed roundId, uint8 result, uint256 totalPool)"
    ],

    // Bet limits (should match contract)
    limits: {
        minDeposit: 1000,
        minBet: 1000,
        maxBet: 100000
    }
};

// Helper to format token amounts
function formatTokenAmount(amount, decimals = 18) {
    return (Number(amount) / Math.pow(10, decimals)).toLocaleString('en-US', {
        maximumFractionDigits: 2
    });
}

// Helper to parse token amounts
function parseTokenAmount(amount, decimals = 18) {
    return BigInt(Math.floor(Number(amount) * Math.pow(10, decimals)));
}

// V2 API Helper
const GameAPI = {
    // Get game balance for wallet
    async getBalance(wallet) {
        const res = await fetch(`${WEB3_CONFIG.api.balance}/${wallet}`);
        return res.json();
    },

    // Place instant bet (off-chain)
    async placeBet(wallet, prediction, amount) {
        const res = await fetch(WEB3_CONFIG.api.bet, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet, prediction, amount })
        });
        return res.json();
    },

    // Sync balance after on-chain deposit/withdraw
    async syncBalance(wallet) {
        const res = await fetch(WEB3_CONFIG.api.syncBalance, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ wallet })
        });
        return res.json();
    },

    // Get current round info
    async getRound() {
        const res = await fetch(WEB3_CONFIG.api.round);
        return res.json();
    }
};
