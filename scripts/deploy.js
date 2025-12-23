const hre = require("hardhat");

async function main() {
    const [deployer] = await hre.ethers.getSigners();

    console.log("=".repeat(50));
    console.log("🚀 SCANDAL Protocol Deployment");
    console.log("=".repeat(50));
    console.log("Deployer:", deployer.address);
    console.log("Network:", hre.network.name);
    console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH");
    console.log("=".repeat(50));

    // IMPORTANT: Change these for mainnet!
    const oracleAddress = deployer.address;      // Your backend server wallet
    const marketingWallet = deployer.address;    // 1% token tax goes here
    const liquidityWallet = deployer.address;    // 1% token tax + mints go here

    // === STEP 1: Deploy SCANDAL Token ===
    console.log("\n📦 Step 1: Deploying SCANDAL Token...");
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

    // === STEP 2: Deploy Prediction Game ===
    console.log("\n📦 Step 2: Deploying Prediction Game (SCNDL bets)...");
    const PredictionGame = await hre.ethers.getContractFactory("PredictionGame");
    const game = await PredictionGame.deploy(tokenAddress, oracleAddress);
    await game.waitForDeployment();
    const gameAddress = await game.getAddress();
    console.log("✅ Prediction Game:", gameAddress);

    // Get game info
    const gameStats = await game.getGameStats();
    console.log("   Min Bet:", hre.ethers.formatEther(gameStats.minimumBet), "SCNDL");
    console.log("   Fee: 3% owner + 2% burn = 5% total");

    // === SUMMARY ===
    console.log("\n" + "=".repeat(50));
    console.log("🎉 DEPLOYMENT COMPLETE!");
    console.log("=".repeat(50));
    console.log("\n📋 Contract Addresses:");
    console.log("   SCANDAL Token:", tokenAddress);
    console.log("   Prediction Game:", gameAddress);
    console.log("\n👛 Wallets:");
    console.log("   Oracle (backend):", oracleAddress);
    console.log("   Marketing (1% tax):", marketingWallet);
    console.log("   Liquidity (1% tax):", liquidityWallet);
    console.log("\n💰 Your Earnings:");
    console.log("   Token: 1% of all trades → marketingWallet");
    console.log("   Game: 3% of all bets → call withdrawFees()");
    console.log("   Auto-burn: 2% of game bets → deflationary!");
    console.log("=".repeat(50));

    // Save addresses
    const fs = require("fs");
    const addresses = {
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
        deployedAt: new Date().toISOString()
    };

    fs.writeFileSync(
        "./deployed-addresses.json",
        JSON.stringify(addresses, null, 2)
    );
    console.log("\n💾 Saved to deployed-addresses.json");

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
