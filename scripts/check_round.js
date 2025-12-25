// Script to check current blockchain round ID
const { ethers } = require("hardhat");

async function main() {
    const gameAddress = "0x9CA0B4e427Fd4A79B510a4A5542c804046210F36";

    const game = await ethers.getContractAt("PredictionGameV2", gameAddress);
    const roundId = await game.currentRoundId();

    console.log("=== Blockchain Round Status ===");
    console.log(`Current Round ID: ${roundId.toString()}`);

    // Get round info for first few rounds
    for (let i = 1; i <= Math.min(Number(roundId), 5); i++) {
        try {
            const info = await game.getRoundInfo(i);
            console.log(`\nRound ${i}:`);
            console.log(`  - Closed: ${info.closed}`);
            console.log(`  - Refunded: ${info.refunded}`);
            console.log(`  - Result: ${info.result} (1=MINT, 2=BURN, 3=NEUTRAL)`);
            console.log(`  - Total Pool: ${ethers.formatEther(info.totalPool)} SCNDL`);
        } catch (e) {
            console.log(`Round ${i}: Error - ${e.message}`);
        }
    }
}

main().catch(console.error);
