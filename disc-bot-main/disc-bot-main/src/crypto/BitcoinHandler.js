/**
 * Bitcoin Payment Handler
 * Uses bitcoinjs-lib for transaction signing
 */

const { logger } = require('../utils/logger');
const config = require('../../config.json');
const BigNumber = require('bignumber.js');

class BitcoinHandler {
    constructor() {
        this.bitcoin = null;
        this.ecpair = null;
        this.keyPair = null;
        this.address = null;
        this.network = null;
        this.initialized = false;
    }

    /**
     * Initialize with private key from environment
     */
    initialize() {
        if (this.initialized) return true;

        try {
            this.bitcoin = require('bitcoinjs-lib');
            const ecc = require('tiny-secp256k1');
            const { ECPairFactory } = require('ecpair');

            this.ecpair = ECPairFactory(ecc);
            this.network = this.bitcoin.networks.bitcoin;

            const privateKeyWIF = process.env.BTC_PRIVATE_KEY;
            if (!privateKeyWIF || privateKeyWIF.trim().length < 10) {
                logger.warn('BTC_PRIVATE_KEY not set or invalid - BTC handler disabled');
                return false;
            }

            // Parse WIF key (trim to avoid whitespace issues)
            this.keyPair = this.ecpair.fromWIF(privateKeyWIF.trim(), this.network);

            // Generate address from public key
            const { address } = this.bitcoin.payments.p2pkh({
                pubkey: this.keyPair.publicKey,
                network: this.network
            });
            this.address = address;

            this.initialized = true;
            logger.info('BTC handler initialized', { address: this.address });
            return true;
        } catch (error) {
            logger.error('BTC init failed', { error: error.message });
            return false;
        }
    }

    /**
     * Validate Bitcoin address format
     * @param {string} address 
     * @returns {boolean}
     */
    validateAddress(address) {
        // Check legacy addresses (1 or 3 prefix)
        if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) {
            return true;
        }
        // Check Bech32 addresses (bc1 prefix)
        if (/^bc1[a-z0-9]{39,59}$/.test(address)) {
            return true;
        }
        return false;
    }

    /**
     * Get raw transaction hex from BlockCypher
     * @param {string} txId 
     * @returns {Promise<string>}
     */
    async getRawTransaction(txId) {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.blockcypher.com/v1/btc/main/txs/${txId}?includeHex=true`;

        try {
            const fetchOptions = {};
            if (config.proxy_url) {
                try {
                    const HttpsProxyAgent = require('https-proxy-agent');
                    fetchOptions.agent = new HttpsProxyAgent(config.proxy_url);
                } catch (e) { }
            }

            const response = await fetch(url, fetchOptions);
            const data = await response.json();
            return data.hex;
        } catch (error) {
            logger.error('Failed to get raw BTC tx', { txId, error: error.message });
            return null;
        }
    }

    /**
     * Get UTXOs for our address from a block explorer API
     * @returns {Promise<Array>}
     */
    async getUTXOs() {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.blockcypher.com/v1/btc/main/addrs/${this.address}?unspentOnly=true`;

        try {
            const fetchOptions = {};
            if (config.proxy_url) {
                try {
                    const HttpsProxyAgent = require('https-proxy-agent');
                    fetchOptions.agent = new HttpsProxyAgent(config.proxy_url);
                } catch (e) {
                    logger.debug('Proxy agent not available for BTC UTXOs', { error: e.message });
                }
            }

            const response = await fetch(url, fetchOptions);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            return (data.txrefs || []).map(tx => ({
                txId: tx.tx_hash,
                vout: tx.tx_output_n,
                value: tx.value
            }));
        } catch (error) {
            logger.error('Failed to get BTC UTXOs', { error: error.message });
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
            const satoshis = utxos.reduce((sum, u) => sum + u.value, 0);
            const balance = satoshis / 100000000; // Convert to BTC
            return { balance };
        } catch (error) {
            return { balance: 0, error: error.message };
        }
    }

    /**
     * Send Bitcoin payment
     * @param {string} toAddress - Recipient address
     * @param {number} amount - Amount in BTC
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

            // Calculate total available
            const totalAvailable = utxos.reduce((sum, u) => sum + u.value, 0);
            const fee = 5000; // ~5000 satoshis fee

            if (totalAvailable < satoshis + fee) {
                return { success: false, error: 'Insufficient balance' };
            }

            // Build transaction using PSBT
            const psbt = new this.bitcoin.Psbt({ network: this.network });

            // Add inputs with proper nonWitnessUtxo or witnessUtxo
            for (const utxo of utxos) {
                const hex = await this.getRawTransaction(utxo.txId);
                if (!hex) throw new Error(`Could not fetch raw hex for input ${utxo.txId}`);

                psbt.addInput({
                    hash: utxo.txId,
                    index: utxo.vout,
                    nonWitnessUtxo: Buffer.from(hex, 'hex'),
                });
            }

            // Add output to recipient
            psbt.addOutput({
                address: toAddress,
                value: satoshis
            });

            // Add change output
            const change = totalAvailable - satoshis - fee;
            if (change > 546) { // Only add change if above dust threshold
                psbt.addOutput({
                    address: this.address,
                    value: change
                });
            }

            // Sign all inputs
            psbt.signAllInputs(this.keyPair);
            psbt.finalizeAllInputs();

            // Get transaction hex
            const txHex = psbt.extractTransaction().toHex();
            const txId = await this.broadcastTransaction(txHex);

            return { success: true, txId };
        } catch (error) {
            logger.error('BTC payment failed', { error: error.message });
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
        const url = 'https://api.blockcypher.com/v1/btc/main/txs/push';
        const maxRetries = 3;
        let lastError;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    const delay = Math.pow(2, attempt) * 1000;
                    logger.info(`Retrying BTC broadcast (attempt ${attempt}/${maxRetries}) in ${delay}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }

                const fetchOptions = {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tx: txHex })
                };

                if (config.proxy_url) {
                    try {
                        const HttpsProxyAgent = require('https-proxy-agent');
                        fetchOptions.agent = new HttpsProxyAgent(config.proxy_url);
                    } catch (e) { }
                }

                const response = await fetch(url, fetchOptions);
                const data = await response.json();

                if (data.error) {
                    throw new Error(data.error);
                }

                return data.tx.hash;
            } catch (error) {
                lastError = error;
                logger.warn(`BTC broadcast attempt ${attempt} failed`, { error: error.message });
            }
        }

        throw new Error(`BTC broadcast failed after ${maxRetries} retries: ${lastError.message}`);
    }
}

module.exports = BitcoinHandler;
