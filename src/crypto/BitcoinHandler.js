/**
 * Bitcoin Payment Handler
 * Uses bitcoinjs-lib for transaction signing
 */

const { logger } = require('../utils/logger');

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
            if (!privateKeyWIF) {
                throw new Error('BTC_PRIVATE_KEY not set in environment');
            }

            this.keyPair = this.ecpair.fromWIF(privateKeyWIF, this.network);

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
     * Get UTXOs for our address from a block explorer API
     * @returns {Promise<Array>}
     */
    async getUTXOs() {
        const fetch = (await import('node-fetch')).default;
        const url = `https://api.blockcypher.com/v1/btc/main/addrs/${this.address}?unspentOnly=true`;

        try {
            const response = await fetch(url);
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
            const satoshis = Math.floor(amount * 100000000);
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

            // Add inputs (simplified - in production, fetch full tx hex for each input)
            for (const utxo of utxos) {
                // Note: In production, you'd need to fetch the raw transaction
                // to get the proper witnessUtxo or nonWitnessUtxo data
                psbt.addInput({
                    hash: utxo.txId,
                    index: utxo.vout,
                    // This is simplified - real implementation needs proper script
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

module.exports = BitcoinHandler;
