/**
 * Solana Payment Handler
 * Uses @solana/web3.js for transaction signing
 */

const { logger } = require('../utils/logger');

class SolanaHandler {
    constructor() {
        this.connection = null;
        this.keypair = null;
        this.publicKey = null;
        this.initialized = false;
    }

    /**
     * Initialize with private key from environment
     */
    async initialize() {
        if (this.initialized) return true;

        try {
            const { Connection, Keypair, clusterApiUrl } = require('@solana/web3.js');
            const bs58 = require('bs58');

            const privateKeyB58 = process.env.SOL_PRIVATE_KEY;
            if (!privateKeyB58) {
                throw new Error('SOL_PRIVATE_KEY not set in environment');
            }

            // Decode base58 private key (trim to avoid whitespace issues)
            const secretKey = bs58.decode(privateKeyB58.trim());
            this.keypair = Keypair.fromSecretKey(secretKey);
            this.publicKey = this.keypair.publicKey;

            // Connect to mainnet
            this.connection = new Connection(clusterApiUrl('mainnet-beta'), 'confirmed');

            this.initialized = true;
            logger.info('SOL handler initialized', { address: this.publicKey.toString() });
            return true;
        } catch (error) {
            logger.error('SOL init failed', { error: error.message });
            return false;
        }
    }

    /**
     * Validate Solana address format
     * @param {string} address 
     * @returns {boolean}
     */
    validateAddress(address) {
        // Solana addresses are Base58 encoded, 32-44 characters
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
            return false;
        }

        try {
            const { PublicKey } = require('@solana/web3.js');
            new PublicKey(address);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get wallet balance
     * @returns {Promise<{balance: number}>}
     */
    async getBalance() {
        if (!await this.initialize()) {
            return { balance: 0, error: 'Not initialized' };
        }

        try {
            const lamports = await this.connection.getBalance(this.publicKey);
            const balance = lamports / 1000000000; // Convert to SOL
            return { balance };
        } catch (error) {
            return { balance: 0, error: error.message };
        }
    }

    /**
     * Send Solana payment
     * @param {string} toAddress - Recipient address
     * @param {number} amount - Amount in SOL
     * @returns {Promise<{success: boolean, txId?: string, error?: string}>}
     */
    async sendPayment(toAddress, amount) {
        if (!await this.initialize()) {
            return { success: false, error: 'Handler not initialized' };
        }

        if (!this.validateAddress(toAddress)) {
            return { success: false, error: 'Invalid recipient address' };
        }

        try {
            const {
                PublicKey,
                Transaction,
                SystemProgram,
                sendAndConfirmTransaction
            } = require('@solana/web3.js');

            const lamports = Math.floor(amount * 1000000000);
            const toPublicKey = new PublicKey(toAddress);

            // Create transfer instruction
            const transaction = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: this.publicKey,
                    toPubkey: toPublicKey,
                    lamports
                })
            );

            // Sign and send transaction
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                [this.keypair]
            );

            logger.info('SOL payment sent', { txId: signature });
            return { success: true, txId: signature };
        } catch (error) {
            logger.error('SOL payment failed', { error: error.message });
            return { success: false, error: error.message };
        }
    }
}

module.exports = SolanaHandler;
