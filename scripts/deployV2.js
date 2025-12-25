const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("=".repeat(50));
    console.log("🚀 SCANDAL Protocol V2 Deployment");
    console.log("   Hybrid Model - Deposit/Withdraw");
    console.log("=".repeat(50));
    console.log("Deployer:", deployer.address);
    console.log("Network:", hre.network.name);
    console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("=".repeat(50));

    // IMPORTANT: Change these for mainnet!
    const oracleAddress = deployer.address;      // Your backend server wallet
    const marketingWallet = deployer.address;    // 1% token tax goes here
    const liquidityWallet = deployer.address;    // 1% token tax + mints go here

    // === STEP 1: Deploy SCANDAL Token (with fixed oracleBurn) ===
    console.log("\n📦 Step 1: Deploying SCANDAL Token (fixed oracleBurn)...");
    const SCANDALToken = await hre.ethers.getContractFactory("SCANDALToken");
    const token = await SCANDALToken.deploy(
        oracleAddress,
        marketingWallet,
        liquidityWallet
    );
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();
    console.log("✅ SCANDAL Token:", tokenAddress);

    // Get tokenomics info
    const tokenomics = await token.getTokenomics();
    console.log("   Initial Supply:", hre.ethers.formatEther(tokenomics.currentSupply), "SCNDL");
    console.log("   Oracle Reserve:", hre.ethers.formatEther(tokenomics.currentReserve), "SCNDL");

    // === STEP 2: Deploy Prediction Game V2 (Hybrid Model) ===
    console.log("\n📦 Step 2: Deploying Prediction Game V2 (Hybrid - Deposit/Withdraw)...");
    const PredictionGameV2 = await hre.ethers.getContractFactory("PredictionGameV2");
    const game = await PredictionGameV2.deploy(tokenAddress, oracleAddress);
    await game.waitForDeployment();
    const gameAddress = await game.getAddress();
    console.log("✅ Prediction Game V2:", gameAddress);

    // Get game info
    const minDeposit = await game.minDeposit();
    const minBet = await game.minBet();
    const maxBet = await game.maxBetAmount();
    console.log("   Min Deposit:", hre.ethers.formatEther(minDeposit), "SCNDL");
    console.log("   Min Bet:", hre.ethers.formatEther(minBet), "SCNDL");
    console.log("   Max Bet:", hre.ethers.formatEther(maxBet), "SCNDL");
    console.log("   Fee: 3% owner + 2% burn = 5% total");

    // === SECURITY VERIFICATION ===
    console.log("\n🔐 Security Features:");
    console.log("   ✓ Users can ALWAYS withdraw (even when paused)");
    console.log("   ✓ Emergency withdraw available");
    console.log("   ✓ Owner cannot touch user deposits");
    console.log("   ✓ Reentrancy protection on all functions");
    console.log("   ✓ Pausable for emergencies");

    // === SUMMARY ===
    console.log("\n" + "=".repeat(50));
    console.log("🎉 V2 DEPLOYMENT COMPLETE!");
    console.log("=".repeat(50));
    console.log("\n📋 Contract Addresses:");
    console.log("   SCANDAL Token:", tokenAddress);
    console.log("   Prediction Game V2:", gameAddress);
    console.log("\n👛 Wallets:");
    console.log("   Oracle (backend):", oracleAddress);
    console.log("   Marketing (1% tax):", marketingWallet);
    console.log("   Liquidity (1% tax):", liquidityWallet);
    console.log("\n🎮 V2 Game Flow:");
    console.log("   1. User deposits SCNDL → balance stored on-chain");
    console.log("   2. User bets via server → INSTANT (no MetaMask per bet)");
    console.log("   3. Oracle records results on-chain");
    console.log("   4. User withdraws anytime");
    console.log("=".repeat(50));

    // Save addresses
    const fs = require("fs");
    const addresses = {
        version: "V2",
        network: hre.network.name,
        chainId: hre.network.config.chainId,
        contracts: {
            token: tokenAddress,
            game: gameAddress
        },
        wallets: {
            deployer: deployer.address,
            oracle: oracleAddress,
            marketing: marketingWallet,
            liquidity: liquidityWallet
        },
        fees: {
            tokenTax: "3% (1% burn + 1% marketing + 1% liquidity)",
            gameFee: "5% (3% owner + 2% burn)"
        },
        security: [
            "Users can always withdraw",
            "Emergency withdraw bypasses pause",
            "Owner cannot access user funds",
            "Reentrancy protection",
            "Events for all actions"
        ],
        deployedAt: new Date().toISOString()
    };

    fs.writeFileSync(
        "./deployed-addresses-v2.json",
        JSON.stringify(addresses, null, 2)
    );
    console.log("\n💾 Saved to deployed-addresses-v2.json");

    // Verification commands
    console.log("\n📝 To verify on BaseScan:");
    console.log(`npx hardhat verify --network baseSepolia ${tokenAddress} "${oracleAddress}" "${marketingWallet}" "${liquidityWallet}"`);
    console.log(`npx hardhat verify --network baseSepolia ${gameAddress} "${tokenAddress}" "${oracleAddress}"`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
