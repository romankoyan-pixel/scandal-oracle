// Web3 Configuration for SCANDAL Protocol
// Base Sepolia Testnet

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

    // Contract addresses
    contracts: {
        token: '0x0F71E2d170dCdBE32E54D961C31e2101f8826a48',
        game: '0x15B1787F5a9BD937954EB8111F1Cc513AB41f0DB'
    },

    // Token ABI (minimal for frontend)
    tokenABI: [
        // Read functions
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function totalSupply() view returns (uint256)",
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address owner, address spender) view returns (uint256)",
        "function getTokenomics() view returns (uint256 currentSupply, uint256 currentReserve, uint256 burned, uint256 reserveMin, uint256 reserveMax, bool isTaxEnabled)",
        // Write functions
        "function approve(address spender, uint256 amount) returns (bool)",
        "function transfer(address to, uint256 amount) returns (bool)",
        // Events
        "event Transfer(address indexed from, address indexed to, uint256 value)",
        "event Approval(address indexed owner, address indexed spender, uint256 value)"
    ],

    // Game ABI (minimal for frontend)
    gameABI: [
        // Read functions
        "function minBet() view returns (uint256)",
        "function currentRoundId() view returns (uint256)",
        "function getCurrentRound() view returns (uint256 id, uint256 startTime, uint256 mintPool, uint256 burnPool, uint256 neutralPool, bool closed)",
        "function getGameStats() view returns (uint256 totalRounds, uint256 pendingOwnerFees, uint256 tokensBurned, uint256 minimumBet)",
        "function checkResult(uint256 roundId, address player) view returns (bool participated, uint8 prediction, uint8 result, bool won, bool claimed, uint256 potentialWinnings)",
        "function bets(uint256 roundId, address player) view returns (uint256 amount, uint8 prediction, bool claimed)",
        // Write functions
        "function placeBet(uint8 prediction, uint256 amount)",
        "function claimWinnings(uint256 roundId)",
        // Events
        "event BetPlaced(uint256 indexed roundId, address indexed player, uint8 prediction, uint256 amount)",
        "event RoundClosed(uint256 indexed roundId, uint8 result, uint256 rate, uint256 burned)",
        "event WinningsClaimed(uint256 indexed roundId, address indexed player, uint256 amount)"
    ]
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
