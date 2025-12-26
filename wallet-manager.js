/**
 * SCANDAL Wallet Manager
 * Centralized wallet connection management using localStorage with expiry
 * Auto-connects on page load, syncs across pages
 */

class WalletManager {
    constructor() {
        this.STORAGE_KEY = 'scandal_wallet_session';
        this.EXPIRY_HOURS = 24; // Wallet session expires after 24 hours
        this.provider = null;
        this.signer = null;
        this.address = null;

        // Auto-initialize
        this.init();
    }

    async init() {
        console.log('🔐 WalletManager initializing...');

        // Wait for ethereum provider to be available
        if (typeof window.ethereum === 'undefined') {
            console.log('⏳ Waiting for MetaMask...');
            await this.waitForEthereum();
        }

        // Try to auto-connect if previously connected and not expired
        const saved = this.getSavedWallet();
        console.log('💾 Saved wallet:', saved);

        if (saved && window.ethereum) {
            console.log('🔄 Attempting auto-connect...');
            await this.autoConnect();
        } else {
            console.log('❌ No saved wallet or MetaMask not found');
        }

        // Setup MetaMask event listeners
        this.setupListeners();
    }

    /**
     * Wait for MetaMask to be injected (max 3 seconds)
     */
    async waitForEthereum() {
        return new Promise((resolve) => {
            let attempts = 0;
            const maxAttempts = 30; // 3 seconds

            const check = setInterval(() => {
                attempts++;
                if (window.ethereum) {
                    clearInterval(check);
                    console.log('✅ MetaMask detected!');
                    resolve();
                } else if (attempts >= maxAttempts) {
                    clearInterval(check);
                    console.log('⚠️ MetaMask not found after 3s');
                    resolve();
                }
            }, 100);
        });
    }

    /**
     * Connect wallet (user clicks "Connect Wallet" button)
     * ALWAYS shows MetaMask popup using wallet_requestPermissions
     */
    async connect() {
        if (!window.ethereum) {
            throw new Error('MetaMask not installed. Please install MetaMask to continue.');
        }

        try {
            console.log('🔐 Requesting wallet connection...');

            // Request permissions first (shows account picker popup)
            // This is the same logic as game.html
            let accounts;
            try {
                await window.ethereum.request({
                    method: 'wallet_requestPermissions',
                    params: [{ eth_accounts: {} }]
                });
                accounts = await window.ethereum.request({ method: 'eth_accounts' });
                console.log('✅ Permissions granted');
            } catch (permError) {
                // If pending or rejected, fall back to simple request
                console.log('⚠️ Permission error, falling back:', permError.code);
                if (permError.code === -32002 || permError.code === 4001) {
                    accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
                } else {
                    throw permError;
                }
            }

            if (!accounts || accounts.length === 0) {
                throw new Error('No accounts found');
            }

            this.provider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await this.provider.getSigner();
            this.address = accounts[0];

            // Save to localStorage with expiry
            this.saveWallet(this.address);

            // Dispatch event for UI updates
            window.dispatchEvent(new CustomEvent('walletConnected', {
                detail: { address: this.address }
            }));

            console.log('✅ Wallet connected:', this.address);
            return this.address;

        } catch (error) {
            console.error('❌ Connection error:', error);
            throw error;
        }
    }

    /**
     * Auto-connect on page load (if wallet was connected recently)
     */
    async autoConnect() {
        try {
            // Check if MetaMask has any accounts connected
            const accounts = await window.ethereum.request({
                method: 'eth_accounts'
            });

            const saved = this.getSavedWallet();

            // Verify saved address is still connected and not expired
            if (saved && accounts.includes(saved)) {
                this.provider = new ethers.BrowserProvider(window.ethereum);
                this.signer = await this.provider.getSigner();
                this.address = saved;

                window.dispatchEvent(new CustomEvent('walletConnected', {
                    detail: { address: this.address }
                }));

                console.log('🔄 Auto-connected:', this.address);
                return true;
            } else {
                // Wallet disconnected or expired - clear storage
                this.clearWallet();
                return false;
            }
        } catch (error) {
            console.error('Auto-connect failed:', error);
            this.clearWallet();
            return false;
        }
    }

    /**
     * Disconnect wallet
     */
    disconnect() {
        this.clearWallet();
        this.provider = null;
        this.signer = null;
        this.address = null;

        window.dispatchEvent(new Event('walletDisconnected'));
        console.log('👋 Wallet disconnected');
    }

    /**
     * Save wallet address to localStorage with expiry timestamp
     */
    saveWallet(address) {
        const data = {
            address,
            connectedAt: Date.now(),
            expiresAt: Date.now() + (this.EXPIRY_HOURS * 60 * 60 * 1000)
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        console.log('💾 Wallet saved to localStorage (expires in 24h)');
    }

    /**
     * Get saved wallet from localStorage (only if not expired)
     */
    getSavedWallet() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            if (!data) return null;

            const parsed = JSON.parse(data);

            // Check if expired
            if (Date.now() > parsed.expiresAt) {
                console.log('⏰ Wallet session expired');
                this.clearWallet();
                return null;
            }

            return parsed.address;
        } catch (error) {
            console.error('Failed to parse saved wallet:', error);
            return null;
        }
    }

    /**
     * Clear wallet from localStorage
     */
    clearWallet() {
        localStorage.removeItem(this.STORAGE_KEY);
    }

    /**
     * Setup MetaMask event listeners
     */
    setupListeners() {
        if (!window.ethereum) return;

        // Account changed
        window.ethereum.on('accountsChanged', (accounts) => {
            if (accounts.length === 0) {
                // User disconnected wallet
                this.disconnect();
            } else {
                // User switched account
                const newAddress = accounts[0];
                this.address = newAddress;
                this.saveWallet(newAddress);

                window.dispatchEvent(new CustomEvent('walletChanged', {
                    detail: { address: newAddress }
                }));

                console.log('🔄 Account changed:', newAddress);
            }
        });

        // Network changed - reload page
        window.ethereum.on('chainChanged', (chainId) => {
            console.log('🌐 Network changed:', chainId);
            window.location.reload();
        });
    }

    /**
     * Check if wallet is connected
     */
    isConnected() {
        return !!this.address;
    }

    /**
     * Get current wallet address
     */
    getAddress() {
        return this.address;
    }

    /**
     * Get ethers provider
     */
    getProvider() {
        return this.provider;
    }

    /**
     * Get ethers signer
     */
    getSigner() {
        return this.signer;
    }

    /**
     * Get formatted address (0x1234...5678)
     */
    getShortAddress() {
        if (!this.address) return null;
        return `${this.address.slice(0, 6)}...${this.address.slice(-4)}`;
    }
}

// Create global instance
window.walletManager = new WalletManager();

console.log('🔐 WalletManager initialized');
