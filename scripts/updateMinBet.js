const hre = require("hardhat");

async function main() {
    const gameAddress = "0x15B1787F5a9BD937954EB8111F1Cc513AB41f0DB";

    console.log("🔧 Updating minBet to 100 SCNDL...");

    const game = await hre.ethers.getContractAt("PredictionGame", gameAddress);

    // 100 SCNDL with 18 decimals
    const newMinBet = hre.ethers.parseEther("100");

    const tx = await game.setMinBet(newMinBet);
    await tx.wait();

    console.log("✅ MinBet updated to 100 SCNDL!");

    // Verify
    const stats = await game.getGameStats();
    console.log("Current minBet:", hre.ethers.formatEther(stats.minimumBet), "SCNDL");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
