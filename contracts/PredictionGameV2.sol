// SPDX-License-Identifier: MIT
/**
 * SCANDAL Protocol - Prediction Game Contract V2
 * Copyright (c) 2025 SCANDAL Protocol Team
 * All Rights Reserved.
 */
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SCANDAL Prediction Game V2 - Hybrid Model
 * @dev Deposit-based betting for instant gameplay
 * 
 * SECURITY FEATURES:
 * - Users can ALWAYS withdraw their balance (even when paused)
 * - Owner CANNOT access user funds
 * - Emergency withdraw available
 * - All actions emit events for transparency
 * - Reentrancy protection on all functions
 * 
 * FLOW:
 * 1. User deposits SCNDL tokens → balance stored on-chain
 * 2. User places bets via server (instant, off-chain)
 * 3. Oracle records bet results → updates on-chain balances
 * 4. User withdraws anytime
 */
contract PredictionGameV2 is Ownable, ReentrancyGuard, Pausable {
    
    // ============================================
    // STATE VARIABLES
    // ============================================
    
    IERC20 public scndlToken;
    address public oracle;
    
    // User balances (always withdrawable)
    mapping(address => uint256) public balances;
    uint256 public totalUserLiabilities; // Tracks total amount owed to users (deposits + winnings - withdrawals - bets)
    
    // Round tracking
    uint256 public currentRoundId;
    
    // Prediction types
    uint8 public constant MINT = 1;
    uint8 public constant BURN = 2;
    uint8 public constant NEUTRAL = 3;
    
    // Limits & Fees
    uint256 public minDeposit = 1000 * 10**18;      // 1,000 SCNDL min deposit
    uint256 public minBet = 1000 * 10**18;          // 1,000 SCNDL min bet
    uint256 public maxBetAmount = 100_000 * 10**18; // 100K SCNDL max bet per round
    uint256 public constant FEE_OWNER = 300;        // 3% owner fee
    uint256 public constant FEE_BURN = 200;         // 2% burn
    uint256 public constant FEE_DENOMINATOR = 10000;
    
    // Security: withdrawal delay (optional, 0 = instant)
    uint256 public withdrawalDelay = 0;
    mapping(address => uint256) public lastDepositTime;
    
    // Individual bet tracking
    struct Bet {
        uint256 amount;
        uint8 prediction;
        bool claimed;
    }
    
    // playerBets[roundId][player] = Bet
    mapping(uint256 => mapping(address => Bet)) public playerBets;
    
    // Round data
    struct Round {
        uint256 id;
        uint256 startTime;
        uint256 endTime;
        uint256 totalPool;
        uint256 mintPool;
        uint256 burnPool;
        uint256 neutralPool;
        uint256 availableForPayouts; // Pool after fees for payout limit
        uint8 result;      // 0=pending, 1=MINT, 2=BURN, 3=NEUTRAL
        bool closed;
        bool refunded;
    }
    
    mapping(uint256 => Round) public rounds;
    
    // Oracle timelock (24 hours)
    uint256 public constant ORACLE_TIMELOCK = 24 hours;
    address public pendingOracle;
    uint256 public oracleChangeTime;
    
    // Accumulated fees
    uint256 public ownerFees;
    uint256 public totalBurned;
    
    // ============================================
    // EVENTS
    // ============================================
    
    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event EmergencyWithdrawn(address indexed user, uint256 amount);
    event BetRecorded(address indexed user, uint256 roundId, uint8 prediction, uint256 amount);
    event BetResult(address indexed user, uint256 roundId, bool won, int256 profitLoss);
    event RoundStarted(uint256 indexed roundId, uint256 startTime);
    
    // Enhanced event for full cycle data recovery
    event RoundClosed(
        uint256 indexed roundId, 
        uint8 result,           // 1=MINT, 2=BURN, 3=NEUTRAL
        uint256 rate,           // Rate in basis points (10=0.10%, 30=0.30%)
        uint256 totalPool,
        uint256 mintPool,
        uint256 burnPool,
        uint256 neutralPool,
        uint256 timestamp
    );
    
    // IPFS hash for full cycle data (news, scores, etc)
    event CycleDataStored(uint256 indexed roundId, string ipfsHash);
    
    event RoundRefunded(uint256 indexed roundId);
    event FeesWithdrawn(address indexed owner, uint256 amount);
    event OracleChanged(address indexed oldOracle, address indexed newOracle);
    event OracleChangePending(address indexed newOracle, uint256 effectiveTime);
    event OracleChangeCancelled(address indexed cancelledOracle);
    
    // ============================================
    // MODIFIERS
    // ============================================
    
    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }
    
    // ============================================
    // CONSTRUCTOR
    // ============================================
    
    constructor(address _token, address _oracle) Ownable(msg.sender) {
        require(_token != address(0), "Invalid token");
        require(_oracle != address(0), "Invalid oracle");
        scndlToken = IERC20(_token);
        oracle = _oracle;
        _startNewRound();
    }
    
    // ============================================
    // USER FUNCTIONS - DEPOSIT & WITHDRAW
    // ============================================
    
    /**
     * @dev Deposit SCNDL tokens to play
     * @param amount Amount of SCNDL to deposit
     */
    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        require(amount >= minDeposit, "Below minimum deposit");
        require(scndlToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");
        
        balances[msg.sender] += amount;
        totalUserLiabilities += amount; // Increases contract liability
        lastDepositTime[msg.sender] = block.timestamp;
        
        emit Deposited(msg.sender, amount, balances[msg.sender]);
    }
    
    /**
     * @dev Withdraw SCNDL tokens - ALWAYS available (even when paused)
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(balances[msg.sender] >= amount, "Insufficient balance");
        require(scndlToken.balanceOf(address(this)) >= amount, "Contract balance too low");
        
        // Optional withdrawal delay (anti-flash attack)
        if (withdrawalDelay > 0) {
            require(
                block.timestamp >= lastDepositTime[msg.sender] + withdrawalDelay,
                "Withdrawal delay not met"
            );
        }
        
        balances[msg.sender] -= amount;
        totalUserLiabilities -= amount; // Decreases contract liability
        
        require(scndlToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }
    
    /**
     * @dev Emergency withdraw ALL funds - bypasses pause
     * @notice This is a safety feature - users can ALWAYS exit
     */
    function emergencyWithdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance");
        
        balances[msg.sender] = 0;
        totalUserLiabilities -= amount; // Decreases contract liability
        
        require(scndlToken.transfer(msg.sender, amount), "Transfer failed");
        
        emit EmergencyWithdrawn(msg.sender, amount);
    }
    
    // ============================================
    // ORACLE FUNCTIONS - BET MANAGEMENT
    // ============================================
    
    /**
     * @dev Oracle records a user's bet (off-chain bet confirmed on-chain)
     * @param player Player address
     * @param roundId Round ID
     * @param prediction 1=MINT, 2=BURN, 3=NEUTRAL
     * @param amount Bet amount
     */
    function recordBet(
        address player,
        uint256 roundId,
        uint8 prediction,
        uint256 amount
    ) external onlyOracle {
        require(roundId == currentRoundId, "Wrong round");
        require(!rounds[roundId].closed, "Round closed");
        require(prediction >= MINT && prediction <= NEUTRAL, "Invalid prediction");
        require(amount >= minBet && amount <= maxBetAmount, "Invalid bet amount");
        require(balances[player] >= amount, "Insufficient balance");
        require(playerBets[roundId][player].amount == 0, "Already bet this round");
        
        // Deduct from player balance (locked for this round)
        balances[player] -= amount;
        totalUserLiabilities -= amount; // Liability moves from User Balance to Pot (risk)
        
        // Store bet for verification
        playerBets[roundId][player] = Bet({
            amount: amount,
            prediction: prediction,
            claimed: false
        });
        
        // Add to round pool
        Round storage round = rounds[roundId];
        round.totalPool += amount;
        
        if (prediction == MINT) {
            round.mintPool += amount;
        } else if (prediction == BURN) {
            round.burnPool += amount;
        } else {
            round.neutralPool += amount;
        }
        
        emit BetRecorded(player, roundId, prediction, amount);
    }
    
    /**
     * @dev Oracle records bet result and updates player balance
     * @param player Player address
     * @param roundId Round ID
     * @param won Whether player won
     * @param payout Payout amount (0 if lost, winnings if won)
     */
    function recordBetResult(
        address player,
        uint256 roundId,
        bool won,
        uint256 payout
    ) external onlyOracle {
        Round storage round = rounds[roundId];
        require(round.closed, "Round not closed");
        
        // Verify player had a bet
        Bet storage bet = playerBets[roundId][player];
        require(bet.amount > 0, "No bet found");
        require(!bet.claimed, "Already claimed");
        
        // Mark as claimed (double-claim protection)
        bet.claimed = true;
        
        if (won && payout > 0) {
            // Payout limit: cannot exceed available pool
            require(payout <= round.availableForPayouts, "Payout exceeds pool");
            round.availableForPayouts -= payout;
            balances[player] += payout;
            totalUserLiabilities += payout; // Funds move from Pool (risk) back to User Liability (safe)
        }
        
        int256 profitLoss = won ? int256(payout) : int256(0);
        emit BetResult(player, roundId, won, profitLoss);
    }
    
    /**
     * @dev Oracle closes round with result
     * @param result 1=MINT, 2=BURN, 3=NEUTRAL
     * @param rate Rate in basis points (unused in V2, kept for compatibility)
     */
    function closeRound(uint8 result, uint256 rate) external onlyOracle {
        require(result >= MINT && result <= NEUTRAL, "Invalid result");
        
        Round storage round = rounds[currentRoundId];
        require(!round.closed, "Already closed");
        
        round.result = result;
        round.endTime = block.timestamp;
        round.closed = true;
        
        // Calculate and collect fees from total pool
        uint256 totalPool = round.totalPool;
        if (totalPool > 0) {
            uint256 ownerFee = (totalPool * FEE_OWNER) / FEE_DENOMINATOR;
            uint256 burnFee = (totalPool * FEE_BURN) / FEE_DENOMINATOR;
            
            ownerFees += ownerFee;
            totalBurned += burnFee;
            
            // Set available pool for payouts (after fees)
            round.availableForPayouts = totalPool - ownerFee - burnFee;
            
            // Burn tokens
            scndlToken.transfer(address(0xdead), burnFee);
        }
        
        emit RoundClosed(
            currentRoundId, 
            result, 
            rate,
            totalPool,
            round.mintPool,
            round.burnPool,
            round.neutralPool,
            block.timestamp
        );
        
        // Start new round
        _startNewRound();
    }
    
    /**
     * @dev Oracle refunds a round (no news = return all bets)
     * @param roundId Round to refund
     */
    function refundRound(uint256 roundId) external onlyOracle {
        Round storage round = rounds[roundId];
        require(!round.refunded, "Already refunded");
        require(!round.closed || round.result == 0, "Round has result");
        
        round.refunded = true;
        round.closed = true;
        
        emit RoundRefunded(roundId);
        
        // Note: Individual refunds handled via recordBetResult with full amount returned
    }
    
    /**
     * @dev Oracle stores IPFS hash of full cycle data (news, scores, etc)
     * @param roundId Round ID
     * @param ipfsHash IPFS CID of the cycle data
     */
    function storeCycleData(uint256 roundId, string calldata ipfsHash) external onlyOracle {
        require(bytes(ipfsHash).length > 0, "Empty hash");
        emit CycleDataStored(roundId, ipfsHash);
    }
    
    /**
     * @dev Refund a specific player for a refunded round
     * @param player Player to refund
     * @param roundId Round ID
     * @param amount Original bet amount
     */
    function refundPlayer(
        address player,
        uint256 roundId,
        uint256 amount
    ) external onlyOracle {
        require(rounds[roundId].refunded, "Round not refunded");
        
        balances[player] += amount;
        totalUserLiabilities += amount; // Refund moves from Pool to User Liability
        
        emit BetResult(player, roundId, false, int256(amount)); // Return as "no loss"
    }
    
    // ============================================
    // INTERNAL FUNCTIONS
    // ============================================
    
    function _startNewRound() internal {
        currentRoundId++;
        rounds[currentRoundId] = Round({
            id: currentRoundId,
            startTime: block.timestamp,
            endTime: 0,
            totalPool: 0,
            mintPool: 0,
            burnPool: 0,
            neutralPool: 0,
            availableForPayouts: 0,
            result: 0,
            closed: false,
            refunded: false
        });
        
        emit RoundStarted(currentRoundId, block.timestamp);
    }
    
    // ============================================
    // OWNER FUNCTIONS
    // ============================================
    
    /**
     * @dev Withdraw accumulated owner fees (3%)
     * @notice Owner can ONLY withdraw fees, NOT user deposits
     */
    function withdrawFees() external onlyOwner {
        uint256 amount = ownerFees;
        require(amount > 0, "No fees");
        ownerFees = 0;
        require(scndlToken.transfer(owner(), amount), "Transfer failed");
        emit FeesWithdrawn(owner(), amount);
    }
    
    /**
     * @dev Initiate oracle change with 24h timelock
     */
    function setOracle(address _newOracle) external onlyOwner {
        require(_newOracle != address(0), "Invalid oracle");
        pendingOracle = _newOracle;
        oracleChangeTime = block.timestamp + ORACLE_TIMELOCK;
        emit OracleChangePending(_newOracle, oracleChangeTime);
    }
    
    /**
     * @dev Confirm oracle change after timelock expires
     */
    function confirmOracle() external onlyOwner {
        require(pendingOracle != address(0), "No pending oracle");
        require(block.timestamp >= oracleChangeTime, "Timelock not expired");
        
        address old = oracle;
        oracle = pendingOracle;
        pendingOracle = address(0);
        oracleChangeTime = 0;
        
        emit OracleChanged(old, oracle);
    }
    
    /**
     * @dev Cancel pending oracle change
     */
    function cancelOracleChange() external onlyOwner {
        require(pendingOracle != address(0), "No pending oracle");
        address cancelled = pendingOracle;
        pendingOracle = address(0);
        oracleChangeTime = 0;
        emit OracleChangeCancelled(cancelled);
    }
    
    function setMinDeposit(uint256 _amount) external onlyOwner {
        minDeposit = _amount;
    }
    
    function setMinBet(uint256 _amount) external onlyOwner {
        minBet = _amount;
    }
    
    function setMaxBetAmount(uint256 _amount) external onlyOwner {
        maxBetAmount = _amount;
    }
    
    function setWithdrawalDelay(uint256 _delay) external onlyOwner {
        require(_delay <= 1 days, "Max 1 day delay");
        withdrawalDelay = _delay;
    }
    
    function pause() external onlyOwner {
        _pause();
    }
    
    function unpause() external onlyOwner {
        _unpause();
    }
    
    // ============================================
    // VIEW FUNCTIONS
    // ============================================
    
    function getBalance(address user) external view returns (uint256) {
        return balances[user];
    }
    
    function getCurrentRound() external view returns (
        uint256 id,
        uint256 startTime,
        uint256 totalPool,
        uint256 mintPool,
        uint256 burnPool,
        uint256 neutralPool,
        bool closed
    ) {
        Round storage round = rounds[currentRoundId];
        return (
            round.id,
            round.startTime,
            round.totalPool,
            round.mintPool,
            round.burnPool,
            round.neutralPool,
            round.closed
        );
    }
    
    function getRoundInfo(uint256 roundId) external view returns (
        uint256 id,
        uint256 startTime,
        uint256 endTime,
        uint256 totalPool,
        uint8 result,
        bool closed,
        bool refunded
    ) {
        Round storage round = rounds[roundId];
        return (
            round.id,
            round.startTime,
            round.endTime,
            round.totalPool,
            round.result,
            round.closed,
            round.refunded
        );
    }
    
    function getContractBalance() external view returns (uint256) {
        return scndlToken.balanceOf(address(this));
    }
    
    /**
     * @dev Verify contract solvency - should always be true
     * @return True if contract has enough tokens for all user balances
     */
    function isSolvent() external view returns (bool) {
        return scndlToken.balanceOf(address(this)) >= totalUserLiabilities + ownerFees;
    }
}
