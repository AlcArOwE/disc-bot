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

    /**
     * Get recent transactions for the address
     * @returns {Promise<Array>} - List of recent transactions
     */
    async getRecentTransactions() {
        if (!await this.initialize()) {
            return [];
        }

        try {
            // Get recent signatures
            const signatures = await this.connection.getSignaturesForAddress(this.publicKey, { limit: 20 });

            if (signatures.length === 0) return [];

            const transactions = [];
            const sigsToFetch = signatures.map(s => s.signature);

            // Get parsed transactions
            const parsedTxs = await this.connection.getParsedTransactions(sigsToFetch, { maxSupportedTransactionVersion: 0 });

            for (let i = 0; i < parsedTxs.length; i++) {
                const tx = parsedTxs[i];
                const signatureInfo = signatures[i];

                if (!tx) continue;

                // Calculate amount received by us
                // We need to look at preBalances vs postBalances for our account
                const accountIndex = tx.transaction.message.accountKeys.findIndex(
                    k => k.pubkey.toString() === this.publicKey.toString()
                );

                if (accountIndex === -1) continue;

                const preBalance = tx.meta.preBalances[accountIndex];
                const postBalance = tx.meta.postBalances[accountIndex];
                const amount = (postBalance - preBalance) / 1000000000; // SOL

                // Only include if we received SOL
                if (amount > 0) {
                    transactions.push({
                        txId: signatureInfo.signature,
                        amount: amount,
                        timestamp: signatureInfo.blockTime ? signatureInfo.blockTime * 1000 : Date.now(),
                        confirmations: 1 // If it's in a block, it has at least 1
                    });
                }
            }

            return transactions;
        } catch (error) {
            logger.error('Failed to get recent SOL transactions', { error: error.message });
            return [];
        }
    }
}

module.exports = SolanaHandler;
