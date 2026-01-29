/**
 * Litecoin Payment Handler
 * Uses bitcore-lib-ltc for transaction signing
 */

const { logger } = require('../utils/logger');

class LitecoinHandler {
    constructor() {
        this.litecore = null;
        this.privateKey = null;
        this.address = null;
        this.network = 'livenet';
        this.initialized = false;
    }

    /**
     * Initialize with private key from environment
     */
    initialize() {
        if (this.initialized) return true;

        try {
            this.litecore = require('bitcore-lib-ltc');
            const privateKeyWIF = process.env.LTC_PRIVATE_KEY;

            if (!privateKeyWIF) {
                throw new Error('LTC_PRIVATE_KEY not set in environment');
            }

            // Parse WIF key (trim to avoid whitespace issues)
            this.privateKey = this.litecore.PrivateKey.fromWIF(privateKeyWIF.trim());
            this.address = this.privateKey.toAddress(this.network).toString();
            this.initialized = true;

            logger.info('LTC handler initialized', { address: this.address });
            return true;
        } catch (error) {
            logger.error('LTC init failed', { error: error.message });
            return false;
        }
    }

    /**
     * Validate Litecoin address format
     * @param {string} address 
     * @returns {boolean}
     */
    validateAddress(address) {
        if (!this.litecore) {
            try { this.litecore = require('bitcore-lib-ltc'); }
            catch { return false; }
        }

        try {
            // Check legacy addresses (L, M, 3 prefix)
            if (/^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(address)) {
                return this.litecore.Address.isValid(address, this.network);
            }
            // Check Bech32 addresses (ltc1 prefix)
            if (/^ltc1[a-z0-9]{39,59}$/.test(address)) {
                return true; // Basic format check for Bech32
            }
            return false;
        } catch {
            return false;
        }
    }

    /**
     * Get UTXOs for our address from a block explorer API
     * @returns {Promise<Array>}
     */
    async getUTXOs() {
        // Using BlockCypher API for Litecoin
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.blockcypher.com/v1/ltc/main/addrs/${this.address}?unspentOnly=true`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            const utxos = (data.txrefs || []).map(tx => ({
                txId: tx.tx_hash,
                outputIndex: tx.tx_output_n,
                satoshis: tx.value,
                script: this.litecore.Script.buildPublicKeyHashOut(this.address).toString()
            }));

            return utxos;
        } catch (error) {
            logger.error('Failed to get UTXOs', { error: error.message });
            return [];
        }
    }

    /**
     * Get wallet balance
     * @returns {Promise<{balance: number}>}
     */
    async getBalance() {
        if (!this.initialize()) {
            return { balance: 0, error: 'Not initialized' };
        }

        try {
            const utxos = await this.getUTXOs();
            const satoshis = utxos.reduce((sum, u) => sum + u.satoshis, 0);
            const balance = satoshis / 100000000; // Convert to LTC
            return { balance };
        } catch (error) {
            return { balance: 0, error: error.message };
        }
    }

    /**
     * Get recent transactions
     * @param {number} limit - Number of transactions to fetch
     * @returns {Promise<Array<{hash: string, value: number, time: number}>>}
     */
    async getRecentTransactions(limit = 10) {
        if (!this.initialize()) return [];

        // BlockCypher URL for full address details (includes txs)
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.blockcypher.com/v1/ltc/main/addrs/${this.address}/full?limit=${limit}`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.error) throw new Error(data.error);

            // Filter for incoming transactions
            const incoming = (data.txs || [])
                .filter(tx => {
                    // Check if any output sends to our address
                    return tx.outputs.some(out => out.addresses && out.addresses.includes(this.address));
                })
                .map(tx => {
                    // Calculate value received by us
                    let value = 0;
                    tx.outputs.forEach(out => {
                        if (out.addresses && out.addresses.includes(this.address)) {
                            value += out.value;
                        }
                    });

                    return {
                        hash: tx.hash,
                        value: value / 100000000, // Satoshis to LTC
                        time: new Date(tx.confirmed || tx.received).getTime(),
                        confirmations: tx.confirmations
                    };
                });

            return incoming;
        } catch (error) {
            logger.error('Failed to fetch transactions', { error: error.message });
            return [];
        }
    }

    /**
     * Send Litecoin payment
     * @param {string} toAddress - Recipient address
     * @param {number} amount - Amount in LTC
     * @returns {Promise<{success: boolean, txId?: string, error?: string}>}
     */
    async sendPayment(toAddress, amount) {
        if (!this.initialize()) {
            return { success: false, error: 'Handler not initialized' };
        }

        if (!this.validateAddress(toAddress)) {
            return { success: false, error: 'Invalid recipient address' };
        }

        try {
            const satoshis = Math.floor(amount * 100000000);
            const utxos = await this.getUTXOs();

            if (utxos.length === 0) {
                return { success: false, error: 'No UTXOs available' };
            }

            // Build transaction
            const tx = new this.litecore.Transaction()
                .from(utxos)
                .to(toAddress, satoshis)
                .change(this.address)
                .fee(10000) // 0.0001 LTC fee
                .sign(this.privateKey);

            // Broadcast transaction
            const txHex = tx.serialize();
            const txId = await this.broadcastTransaction(txHex);

            return { success: true, txId };
        } catch (error) {
            logger.error('LTC payment failed', { error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Broadcast signed transaction
     * @param {string} txHex - Serialized transaction
     * @returns {Promise<string>} - Transaction ID
     */
    async broadcastTransaction(txHex) {
        const fetch = (await import('node-fetch')).default;
        const url = 'https://api.blockcypher.com/v1/ltc/main/txs/push';

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx: txHex })
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error);
        }

        return data.tx.hash;
    }
}

module.exports = LitecoinHandler;
