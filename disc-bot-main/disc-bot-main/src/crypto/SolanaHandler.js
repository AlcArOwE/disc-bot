/**
 * Solana Payment Handler
 * Uses @solana/web3.js for transaction signing
 */

const { logger } = require('../utils/logger');
const config = require('../../config.json');
const BigNumber = require('bignumber.js');

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

            // Connect to mainnet with proxy support (R4)
            const connectionOptions = { commitment: 'confirmed' };
            if (config.proxy_url) {
                try {
                    const HttpsProxyAgent = require('https-proxy-agent');
                    const fetch = (await import('node-fetch')).default;
                    const agent = new HttpsProxyAgent(config.proxy_url);
                    connectionOptions.fetch = (url, options) => fetch(url, { ...options, agent });
                    logger.debug('Using proxy for Solana Connection');
                } catch (e) {
                    logger.warn('Failed to wire proxy to Solana Connection', { error: e.message });
                }
            }

            this.connection = new Connection(clusterApiUrl('mainnet-beta'), connectionOptions);

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

        const maxRetries = 3;
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = 2000 * attempt;
                    logger.info(`Retrying SOL payment (attempt ${attempt}/${maxRetries}) in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                const {
                    PublicKey,
                    Transaction,
                    SystemProgram,
                    ComputeBudgetProgram,
                    sendAndConfirmTransaction
                } = require('@solana/web3.js');

                const lamports = new BigNumber(amount).times(1000000000).integerValue(BigNumber.ROUND_CEIL).toNumber();
                const toPublicKey = new PublicKey(toAddress);

                // Create transfer with priority fee
                const transaction = new Transaction()
                    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 15000 })) // Increased priority
                    .add(
                        SystemProgram.transfer({
                            fromPubkey: this.publicKey,
                            toPubkey: toPublicKey,
                            lamports
                        })
                    );

                const signature = await sendAndConfirmTransaction(
                    this.connection,
                    transaction,
                    [this.keypair],
                    { commitment: 'confirmed' }
                );

                logger.info('SOL payment sent', { txId: signature });
                return { success: true, txId: signature };
            } catch (error) {
                lastError = error;
                logger.warn(`SOL payment attempt ${attempt} failed`, { error: error.message });
                // If it's a balance error, don't retry
                if (error.message.includes('0x1')) break;
            }
        }

        return { success: false, error: `SOL payment failed after ${maxRetries} retries: ${lastError.message}` };
    }
}

module.exports = SolanaHandler;
