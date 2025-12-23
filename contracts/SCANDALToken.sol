// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SCANDAL Token ($SCNDL)
 * @dev ERC-20 token with Oracle-controlled dynamic supply
 * 
 * Tokenomics from Litepaper:
 * - Initial Supply: 1,000,000,000 (1B)
 * - Oracle Reserve: 200M (managed by Oracle for MINT/BURN)
 * - 3% Transaction Tax: 1% burn, 1% marketing, 1% liquidity
 * - Rate changes: 0.10% - 0.30% per cycle
 */
contract SCANDALToken is ERC20, Ownable {
    
    // === ADDRESSES ===
    address public oracle;
    address public marketingWallet;
    address public liquidityWallet;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    
    // === SUPPLY CONSTANTS ===
    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10**18;  // 1B
    uint256 public constant ORACLE_RESERVE_MIN = 50_000_000 * 10**18;  // 50M minimum
    uint256 public constant ORACLE_RESERVE_MAX = 400_000_000 * 10**18; // 400M maximum
    
    // === TAX SETTINGS ===
    uint256 public constant TAX_BURN = 100;      // 1% = 100/10000
    uint256 public constant TAX_MARKETING = 100; // 1%
    uint256 public constant TAX_LIQUIDITY = 100; // 1%
    uint256 public constant TAX_TOTAL = 300;     // 3%
    uint256 public constant TAX_DENOMINATOR = 10000;
    
    // === STATE ===
    uint256 public oracleReserve;
    uint256 public totalBurned;
    bool public taxEnabled = false; // Disabled until launch
    
    // Exclude from tax
    mapping(address => bool) public isExcludedFromTax;
    
    // === EVENTS ===
    event OracleMint(uint256 amount, uint256 rate, uint256 newReserve);
    event OracleBurn(uint256 amount, uint256 rate, uint256 newReserve);
    event OracleChanged(address indexed oldOracle, address indexed newOracle);
    event TaxCollected(uint256 burned, uint256 marketing, uint256 liquidity);
    
    // === MODIFIERS ===
    modifier onlyOracle() {
        require(msg.sender == oracle, "Only oracle");
        _;
    }
    
    constructor(
        address _oracle,
        address _marketingWallet,
        address _liquidityWallet
    ) ERC20("SCANDAL", "SCNDL") Ownable(msg.sender) {
        require(_oracle != address(0), "Invalid oracle");
        require(_marketingWallet != address(0), "Invalid marketing");
        require(_liquidityWallet != address(0), "Invalid liquidity");
        
        oracle = _oracle;
        marketingWallet = _marketingWallet;
        liquidityWallet = _liquidityWallet;
        
        // Initial Oracle Reserve: 200M (20%)
        oracleReserve = 200_000_000 * 10**18;
        
        // Mint initial supply to owner (for distribution)
        _mint(msg.sender, INITIAL_SUPPLY);
        
        // Exclude key addresses from tax
        isExcludedFromTax[msg.sender] = true;
        isExcludedFromTax[address(this)] = true;
        isExcludedFromTax[DEAD_ADDRESS] = true;
        isExcludedFromTax[_marketingWallet] = true;
        isExcludedFromTax[_liquidityWallet] = true;
    }
    
    // === ORACLE FUNCTIONS ===
    
    /**
     * @dev Oracle mints tokens from reserve (positive news = MINT)
     * @param rate Rate in basis points (e.g., 10 = 0.10%, 30 = 0.30%)
     */
    function oracleMint(uint256 rate) external onlyOracle {
        require(rate >= 10 && rate <= 30, "Rate must be 10-30 (0.10%-0.30%)");
        
        // Calculate amount based on current reserve
        uint256 amount = (oracleReserve * rate) / TAX_DENOMINATOR;
        
        require(oracleReserve >= amount, "Insufficient reserve");
        require(oracleReserve - amount >= ORACLE_RESERVE_MIN, "Would go below min reserve");
        
        oracleReserve -= amount;
        _mint(liquidityWallet, amount); // Released to liquidity
        
        emit OracleMint(amount, rate, oracleReserve);
    }
    
    /**
     * @dev Oracle burns tokens from reserve (negative news = BURN)
     * @param rate Rate in basis points (e.g., 10 = 0.10%, 30 = 0.30%)
     */
    function oracleBurn(uint256 rate) external onlyOracle {
        require(rate >= 10 && rate <= 30, "Rate must be 10-30 (0.10%-0.30%)");
        
        // Calculate amount based on current reserve
        uint256 amount = (oracleReserve * rate) / TAX_DENOMINATOR;
        
        require(oracleReserve + amount <= ORACLE_RESERVE_MAX, "Would exceed max reserve");
        
        // Take from liquidity wallet and burn
        uint256 liquidityBalance = balanceOf(liquidityWallet);
        require(liquidityBalance >= amount, "Insufficient liquidity balance");
        
        _burn(liquidityWallet, amount);
        totalBurned += amount;
        
        emit OracleBurn(amount, rate, oracleReserve);
    }
    
    // === TAX OVERRIDE ===
    
    function _update(
        address from,
        address to,
        uint256 amount
    ) internal virtual override {
        // Skip tax if disabled or excluded addresses
        if (!taxEnabled || isExcludedFromTax[from] || isExcludedFromTax[to]) {
            super._update(from, to, amount);
            return;
        }
        
        // Calculate taxes
        uint256 burnAmount = (amount * TAX_BURN) / TAX_DENOMINATOR;
        uint256 marketingAmount = (amount * TAX_MARKETING) / TAX_DENOMINATOR;
        uint256 liquidityAmount = (amount * TAX_LIQUIDITY) / TAX_DENOMINATOR;
        uint256 transferAmount = amount - burnAmount - marketingAmount - liquidityAmount;
        
        // Execute transfers
        super._update(from, DEAD_ADDRESS, burnAmount);          // 1% burn
        super._update(from, marketingWallet, marketingAmount);  // 1% marketing
        super._update(from, liquidityWallet, liquidityAmount);  // 1% liquidity
        super._update(from, to, transferAmount);                // Rest to recipient
        
        totalBurned += burnAmount;
        
        emit TaxCollected(burnAmount, marketingAmount, liquidityAmount);
    }
    
    // === ADMIN FUNCTIONS ===
    
    function enableTax(bool _enabled) external onlyOwner {
        taxEnabled = _enabled;
    }
    
    function setOracle(address _newOracle) external onlyOwner {
        require(_newOracle != address(0), "Invalid oracle");
        address old = oracle;
        oracle = _newOracle;
        emit OracleChanged(old, _newOracle);
    }
    
    function setExcludeFromTax(address account, bool excluded) external onlyOwner {
        isExcludedFromTax[account] = excluded;
    }
    
    function setMarketingWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid address");
        marketingWallet = _wallet;
    }
    
    function setLiquidityWallet(address _wallet) external onlyOwner {
        require(_wallet != address(0), "Invalid address");
        liquidityWallet = _wallet;
    }
    
    // === VIEW FUNCTIONS ===
    
    function getTokenomics() external view returns (
        uint256 currentSupply,
        uint256 currentReserve,
        uint256 burned,
        uint256 reserveMin,
        uint256 reserveMax,
        bool isTaxEnabled
    ) {
        return (
            totalSupply(),
            oracleReserve,
            totalBurned,
            ORACLE_RESERVE_MIN,
            ORACLE_RESERVE_MAX,
            taxEnabled
        );
    }
}
