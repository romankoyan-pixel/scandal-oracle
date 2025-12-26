require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.20",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        // Local development
        hardhat: {
            chainId: 31337
        },

        // Base Sepolia Testnet
        baseSepolia: {
            url: process.env.BASE_SEPOLIA_RPC || "https://base-sepolia-rpc.publicnode.com",
            chainId: 84532,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
            gasPrice: 1000000000, // 1 gwei
        },

        // Base Mainnet (for future)
        base: {
            url: "https://mainnet.base.org",
            chainId: 8453,
            accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
        }
    },

    etherscan: {
        apiKey: {
            baseSepolia: process.env.BASESCAN_API_KEY || "empty"
        },
        customChains: [
            {
                network: "baseSepolia",
                chainId: 84532,
                urls: {
                    apiURL: "https://api-sepolia.basescan.org/api",
                    browserURL: "https://sepolia.basescan.org"
                }
            }
        ]
    },

    sourcify: {
        enabled: false
    },

    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts"
    }
};
