const hre = require("hardhat");

async function main() {
    const tokenAddress = "0x0F71E2d170dCdBE32E54D961C31e2101f8826a48";

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
