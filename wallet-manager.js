/**
 * SCANDAL Wallet Manager
 * Centralized wallet connection management using sessionStorage
 * Auto-connects on page load, syncs across pages in same session
 */

class WalletManager {
    constructor() {
        this.STORAGE_KEY = 'scandal_wallet_session';
        this.provider = null;
        this.signer = null;
        this.address = null;

        // Auto-initialize
        this.init();
    }

    async init() {
        // Try to auto-connect if previously connected in this session
        const saved = this.getSavedWallet();
        if (saved && window.ethereum) {
            await this.autoConnect();
        }

        // Setup MetaMask event listeners
        this.setupListeners();
    }

    /**
     * Connect wallet (user clicks "Connect Wallet" button)
     * ALWAYS shows MetaMask popup for signature
     */
    async connect() {
        if (!window.ethereum) {
            throw new Error('MetaMask not installed. Please install MetaMask to continue.');
        }

        try {
            // Request account access - ALWAYS shows popup for signature
            await window.ethereum.request({ method: 'eth_requestAccounts' });

            this.provider = new ethers.BrowserProvider(window.ethereum);
            this.signer = await this.provider.getSigner();
            this.address = await this.signer.getAddress();

            // Save to sessionStorage
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
     * Auto-connect on page load (if wallet was connected in this session)
     */
    async autoConnect() {
        try {
            // Check if MetaMask has any accounts connected
            const accounts = await window.ethereum.request({
                method: 'eth_accounts'
            });

            const saved = this.getSavedWallet();

            // Verify saved address is still connected
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
                // Wallet disconnected - clear session
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
     * Save wallet address to sessionStorage
     */
    saveWallet(address) {
        const data = {
            address,
            connectedAt: Date.now()
        };
        sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
    }

    /**
     * Get saved wallet from sessionStorage
     */
    getSavedWallet() {
        try {
            const data = sessionStorage.getItem(this.STORAGE_KEY);
            if (!data) return null;

            const parsed = JSON.parse(data);
            return parsed.address;
        } catch (error) {
            console.error('Failed to parse saved wallet:', error);
            return null;
        }
    }

    /**
     * Clear wallet from sessionStorage
     */
    clearWallet() {
        sessionStorage.removeItem(this.STORAGE_KEY);
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
