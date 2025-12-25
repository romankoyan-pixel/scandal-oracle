const hre = require("hardhat");
const fs = require("fs");

async function main() {
    // Load token address from deployment config (not hardcoded)
    let tokenAddress;
    try {
        const addresses = JSON.parse(fs.readFileSync("./deployed-addresses-v2.json", "utf8"));
        tokenAddress = addresses.contracts.token;
    } catch (e) {
        console.error("❌ Could not load deployed-addresses-v2.json. Run deployV2.js first.");
        process.exit(1);
    }

    // Get signer
    const [deployer] = await hre.ethers.getSigners();
    console.log("Sending from:", deployer.address);

    // Connect to token
    const token = await hre.ethers.getContractAt("SCANDALToken", tokenAddress);

    // Check balance
    const balance = await token.balanceOf(deployer.address);
    console.log("Your balance:", hre.ethers.formatEther(balance), "SCNDL");

    // === CONFIGURE RECIPIENT AND AMOUNT ===
    const recipient = deployer.address; // Change to test wallet address
    const amount = hre.ethers.parseEther("10000"); // 10,000 SCNDL

    console.log(`\nSending ${hre.ethers.formatEther(amount)} SCNDL to ${recipient}...`);

    const tx = await token.transfer(recipient, amount);
    await tx.wait();

    console.log("✅ Transfer complete!");
    console.log("TX:", tx.hash);

    // Check new balance
    const newBalance = await token.balanceOf(recipient);
    console.log("Recipient balance:", hre.ethers.formatEther(newBalance), "SCNDL");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
