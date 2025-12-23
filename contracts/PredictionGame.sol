// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SCANDAL Prediction Game (SCNDL Token Version)
 * @dev Pari-mutuel betting on MINT/BURN/NEUTRAL outcomes using $SCNDL
 * 
 * Fee Distribution:
 * - 3% → Owner (your earnings)
 * - 2% → Burned (deflationary)
 * - 95% → Winners pool
 */
contract PredictionGame is Ownable, ReentrancyGuard {
    
    // Token interface
    IERC20 public scndlToken;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    
    // Prediction types
    uint8 public constant MINT = 1;
    uint8 public constant BURN = 2;
    uint8 public constant NEUTRAL = 3;
    
    // Oracle address
    address public oracle;
    
    // Fee settings (total 5%)
    uint256 public constant FEE_OWNER = 300;    // 3% → to you
    uint256 public constant FEE_BURN = 200;     // 2% → burned
    uint256 public constant FEE_TOTAL = 500;    // 5% total
    uint256 public constant FEE_DENOMINATOR = 10000;
    
    // Minimum bet (1000 SCNDL)
    uint256 public minBet = 1000 * 10**18;
    
    // Round data
    struct Round {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        uint256 mintPool;
        uint256 burnPool;
        uint256 neutralPool;
        uint8 result;      // 0=pending, 1=MINT, 2=BURN, 3=NEUTRAL
        uint256 rate;      // Rate % * 100
        bool closed;
        bool refunded;
    }
    
    // Bet data
    struct Bet {
        uint256 amount;
        uint8 prediction;
        bool claimed;
    }
    
    // Storage
    uint256 public currentRoundId;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => Bet)) public bets;
    mapping(uint256 => address[]) public roundPlayers;
    
    // Accumulated fees
    uint256 public ownerFees;        // 3% - your earnings
    uint256 public totalBurned;      // 2% - deflationary
    
    // Events
    event RoundStarted(uint256 indexed roundId, uint256 startTime);
    event BetPlaced(uint256 indexed roundId, address indexed player, uint8 prediction, uint256 amount);
    event RoundClosed(uint256 indexed roundId, uint8 result, uint256 rate, uint256 burned);
    event WinningsClaimed(uint256 indexed roundId, address indexed player, uint256 amount);
    event RoundRefunded(uint256 indexed roundId);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event TokensBurned(uint256 amount, uint256 totalBurned);
    
    // Modifiers
    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }
    
    constructor(address _token, address _oracle) Ownable(msg.sender) {
        require(_token != address(0), "Invalid token");
        require(_oracle != address(0), "Invalid oracle");
        scndlToken = IERC20(_token);
        oracle = _oracle;
        _startNewRound();
    }
    
    /**
     * @dev Place a bet with SCNDL tokens
     * @param prediction 1=MINT, 2=BURN, 3=NEUTRAL
     * @param amount Amount of SCNDL to bet
     */
    function placeBet(uint8 prediction, uint256 amount) external nonReentrant {
        require(amount >= minBet, "Bet too small (min 1000 SCNDL)");
        require(prediction >= MINT && prediction <= NEUTRAL, "Invalid prediction");
        
        Round storage round = rounds[currentRoundId];
        require(!round.closed, "Round closed");
        
        Bet storage bet = bets[currentRoundId][msg.sender];
        require(bet.amount == 0, "Already bet this round");
        
        // Transfer SCNDL from player to contract
        require(scndlToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        // Record bet
        bet.amount = amount;
        bet.prediction = prediction;
        roundPlayers[currentRoundId].push(msg.sender);
        
        // Add to pool
        if (prediction == MINT) {
            round.mintPool += amount;
        } else if (prediction == BURN) {
            round.burnPool += amount;
        } else {
            round.neutralPool += amount;
        }
        
        emit BetPlaced(currentRoundId, msg.sender, prediction, amount);
    }
    
    /**
     * @dev Oracle closes round with result
     * @param result 1=MINT, 2=BURN, 3=NEUTRAL
     * @param rate Rate percentage * 100
     */
    function closeRound(uint8 result, uint256 rate) external onlyOracle {
        require(result >= MINT && result <= NEUTRAL, "Invalid result");
        
        Round storage round = rounds[currentRoundId];
        require(!round.closed, "Already closed");
        
        round.result = result;
        round.rate = rate;
        round.endTime = block.timestamp;
        round.closed = true;
        
        // Calculate fees from total pool
        uint256 totalPool = round.mintPool + round.burnPool + round.neutralPool;
        
        if (totalPool > 0) {
            // 3% to owner
            uint256 ownerFee = (totalPool * FEE_OWNER) / FEE_DENOMINATOR;
            ownerFees += ownerFee;
            
            // 2% burned (sent to dead address)
            uint256 burnFee = (totalPool * FEE_BURN) / FEE_DENOMINATOR;
            require(scndlToken.transfer(DEAD_ADDRESS, burnFee), "Burn failed");
            totalBurned += burnFee;
            
            emit TokensBurned(burnFee, totalBurned);
        }
        
        emit RoundClosed(currentRoundId, result, rate, totalPool > 0 ? (totalPool * FEE_BURN) / FEE_DENOMINATOR : 0);
        
        // Start new round
        _startNewRound();
    }
    
    /**
     * @dev Refund all bets if no news in round
     */
    function refundRound(uint256 roundId) external onlyOracle {
        Round storage round = rounds[roundId];
        require(!round.refunded, "Already refunded");
        
        round.refunded = true;
        round.closed = true;
        
        // Refund all players (no fees taken)
        address[] memory players = roundPlayers[roundId];
        for (uint256 i = 0; i < players.length; i++) {
            Bet storage bet = bets[roundId][players[i]];
            if (bet.amount > 0 && !bet.claimed) {
                bet.claimed = true;
                require(scndlToken.transfer(players[i], bet.amount), "Refund failed");
            }
        }
        
        emit RoundRefunded(roundId);
    }
    
    /**
     * @dev Claim winnings from a closed round
     */
    function claimWinnings(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        require(round.closed, "Round not closed");
        require(!round.refunded, "Round was refunded");
        
        Bet storage bet = bets[roundId][msg.sender];
        require(bet.amount > 0, "No bet found");
        require(!bet.claimed, "Already claimed");
        require(bet.prediction == round.result, "Did not win");
        
        bet.claimed = true;
        
        // Calculate winnings (pari-mutuel)
        uint256 totalPool = round.mintPool + round.burnPool + round.neutralPool;
        uint256 poolAfterFee = totalPool - ((totalPool * FEE_TOTAL) / FEE_DENOMINATOR);
        
        uint256 winningPool;
        if (round.result == MINT) {
            winningPool = round.mintPool;
        } else if (round.result == BURN) {
            winningPool = round.burnPool;
        } else {
            winningPool = round.neutralPool;
        }
        
        // Proportional share
        uint256 winnings = (bet.amount * poolAfterFee) / winningPool;
        
        require(scndlToken.transfer(msg.sender, winnings), "Claim failed");
        emit WinningsClaimed(roundId, msg.sender, winnings);
    }
    
    /**
     * @dev Owner withdraws accumulated fees (3%)
     */
    function withdrawFees() external onlyOwner {
        uint256 amount = ownerFees;
        require(amount > 0, "No fees to withdraw");
        ownerFees = 0;
        require(scndlToken.transfer(owner(), amount), "Withdraw failed");
        emit FeesWithdrawn(owner(), amount);
    }
    
    /**
     * @dev Get current round info
     */
    function getCurrentRound() external view returns (
        uint256 id,
        uint256 startTime,
        uint256 mintPool,
        uint256 burnPool,
        uint256 neutralPool,
        bool closed
    ) {
        Round storage round = rounds[currentRoundId];
        return (
            round.id,
            round.startTime,
            round.mintPool,
            round.burnPool,
            round.neutralPool,
            round.closed
        );
    }
    
    /**
     * @dev Get game stats
     */
    function getGameStats() external view returns (
        uint256 totalRounds,
        uint256 pendingOwnerFees,
        uint256 tokensBurned,
        uint256 minimumBet
    ) {
        return (currentRoundId, ownerFees, totalBurned, minBet);
    }
    
    /**
     * @dev Check result for a player
     */
    function checkResult(uint256 roundId, address player) external view returns (
        bool participated,
        uint8 prediction,
        uint8 result,
        bool won,
        bool claimed,
        uint256 potentialWinnings
    ) {
        Round storage round = rounds[roundId];
        Bet storage bet = bets[roundId][player];
        
        participated = bet.amount > 0;
        prediction = bet.prediction;
        result = round.result;
        won = round.closed && bet.prediction == round.result;
        claimed = bet.claimed;
        
        if (won && !claimed) {
            uint256 totalPool = round.mintPool + round.burnPool + round.neutralPool;
            uint256 poolAfterFee = totalPool - ((totalPool * FEE_TOTAL) / FEE_DENOMINATOR);
            uint256 winningPool = round.result == MINT ? round.mintPool : 
                                  round.result == BURN ? round.burnPool : round.neutralPool;
            potentialWinnings = (bet.amount * poolAfterFee) / winningPool;
        }
    }
    
    // Admin functions
    function setOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid oracle");
        oracle = _oracle;
    }
    
    function setMinBet(uint256 _minBet) external onlyOwner {
        minBet = _minBet;
    }
    
    // Internal
    function _startNewRound() internal {
        currentRoundId++;
        rounds[currentRoundId] = Round({
            id: currentRoundId,
            startTime: block.timestamp,
            endTime: 0,
            mintPool: 0,
            burnPool: 0,
            neutralPool: 0,
            result: 0,
            rate: 0,
            closed: false,
            refunded: false
        });
        emit RoundStarted(currentRoundId, block.timestamp);
    }
}
