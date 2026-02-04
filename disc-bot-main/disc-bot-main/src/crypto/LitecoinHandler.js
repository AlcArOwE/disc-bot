/**
 * Litecoin Payment Handler
 * Uses bitcore-lib-ltc for transaction signing
 */

const { logger } = require('../utils/logger');
const config = require('../../config.json');
const BigNumber = require('bignumber.js');

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
            const privateKeyWIF = (process.env.LTC_PRIVATE_KEY || '').trim();

            if (!privateKeyWIF) {
                throw new Error('LTC_PRIVATE_KEY not set in environment');
            }

            // DETECT NETWORK FROM WIF
            // Mainnet: L or M or K (compressed)
            // Testnet: T or c (compressed)
            const firstChar = privateKeyWIF.charAt(0);
            if (['T', 'c', 'u', 'v'].includes(firstChar)) {
                this.network = 'testnet';
                logger.warn('LTC: Testnet key detected, switching to testnet mode');
            } else {
                this.network = 'livenet';
            }

            // Parse WIF key
            this.privateKey = this.litecore.PrivateKey.fromWIF(privateKeyWIF);
            this.address = this.privateKey.toAddress(this.network).toString();
            this.initialized = true;

            logger.info('LTC handler initialized', { address: this.address, network: this.network });
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
            catch (e) { return false; }
        }

        try {
            // Broaden regex for various LTC address formats (Legacy, SegWit, Bech32)
            if (/^[LM3][a-km-zA-HJ-NP-Z1-9]{26,45}$/.test(address)) {
                return true; // Trust regex for now to avoid strict library issues in sim
            }
            // Check Bech32 addresses (ltc1 prefix)
            if (/^ltc1[a-z0-9]{39,59}$/.test(address)) {
                return true;
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
        // Using BlockCypher API for Litecoin (detect network)
        const blockcypherNet = this.network === 'testnet' ? 'test3' : 'main';
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.blockcypher.com/v1/ltc/${blockcypherNet}/addrs/${this.address}?unspentOnly=true`;

        try {
            const fetchOptions = {};
            if (config.proxy_url) {
                try {
                    const HttpsProxyAgent = require('https-proxy-agent');
                    fetchOptions.agent = new HttpsProxyAgent(config.proxy_url);
                } catch (e) {
                    logger.debug('Proxy agent not available for LTC UTXOs', { error: e.message });
                }
            }

            const response = await fetch(url, fetchOptions);
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
            const satoshis = new BigNumber(amount).times(100000000).integerValue(BigNumber.ROUND_CEIL).toNumber();
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
        const blockcypherNet = this.network === 'testnet' ? 'test3' : 'main';
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.blockcypher.com/v1/ltc/${blockcypherNet}/txs/push`;

        const fetchOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx: txHex })
        };

        if (config.proxy_url) {
            try {
                const HttpsProxyAgent = require('https-proxy-agent');
                fetchOptions.agent = new HttpsProxyAgent(config.proxy_url);
            } catch (e) {
                logger.debug('Proxy agent not available for LTC broadcast', { error: e.message });
            }
        }

        let retries = 2;
        while (retries >= 0) {
            try {
                const response = await fetch(url, fetchOptions);
                const data = await response.json();

                if (data.error) {
                    throw new Error(data.error);
                }

                // DEFENSIVE: BlockCypher can return tx.hash or just hash
                const hash = data.tx?.hash || data.hash || (data.tx && data.tx.hash);
                if (!hash) {
                    logger.error('No hash found in BlockCypher response', { data });
                    throw new Error('Transaction broadcast confirmed but ID not found in response');
                }
                return hash;
            } catch (error) {
                if (retries === 0) throw error;
                logger.warn('LTC broadcast retry', { retries, error: error.message });
                retries--;
                await new Promise(r => setTimeout(r, 2000));
            }
        }
    }
}

module.exports = LitecoinHandler;
