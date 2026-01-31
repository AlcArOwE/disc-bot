/**
 * Price Oracle - Fetches real-time crypto prices
 */

const { logger } = require('../utils/logger');
const config = require('../../config.json');

let HttpsProxyAgent;
try {
    HttpsProxyAgent = require('https-proxy-agent');
} catch (e) {
    // Optional dependency
}

class PriceOracle {
    constructor() {
        this.cache = new Map();
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes cache
        this.fetch = null;
    }

    async _getFetch() {
        if (!this.fetch) {
            this.fetch = (await import('node-fetch')).default;
        }
        return this.fetch;
    }

    /**
     * Pre-fetch price to warm cache
     */
    async preFetch(network) {
        try {
            await this.getPrice(network);
            logger.debug(`Cache warmed for ${network}`);
        } catch (e) {
            // Ignore pre-fetch errors
        }
    }

    /**
     * Get current price of crypto in USD
     * @param {string} network - LTC, SOL, BTC
     * @returns {Promise<number>} - Price in USD
     */
    async getPrice(network) {
        const net = network.toUpperCase();

        // Check cache
        const cached = this.cache.get(net);
        if (cached && (Date.now() - cached.timestamp < this.cacheTTL)) {
            return cached.price;
        }

        try {
            const fetch = await this._getFetch();
            let price = await this._fetchFromCoinbase(net, fetch);

            if (!price) {
                logger.warn(`Coinbase API failed or timed out for ${net}, instant failover to CoinGecko...`);
                price = await this._fetchFromCoinGecko(net, fetch);
            }

            if (!price || isNaN(price)) {
                throw new Error(`Failed to fetch price for ${net} from all providers`);
            }

            // NUCLEAR SAFETY: Deviation Check
            if (cached && cached.price > 0) {
                const maxDeviation = config.payment_safety?.price_safety?.max_deviation_percentage || 25;
                const deviation = Math.abs((price - cached.price) / cached.price) * 100;
                if (deviation > maxDeviation) {
                    logger.error(`🚨 NUCLEAR PRICE DEVIATION DETECTED for ${net}!`, {
                        current: price,
                        cached: cached.price,
                        deviation: `${deviation.toFixed(2)}%`
                    });
                    // Fallback to cached price if it's not too old
                    if (Date.now() - cached.timestamp < 6 * 60 * 60 * 1000) {
                        logger.warn(`Returning previous cached price for safety`);
                        return cached.price;
                    }
                    throw new Error(`Price deviation too high (${deviation.toFixed(2)}%). Aborting for safety.`);
                }
            }

            // NUCLEAR SAFETY: Hard Bounds Check
            const safety = config.payment_safety?.price_safety;
            if (safety) {
                const min = safety.hard_min_price?.[net];
                const max = safety.hard_max_price?.[net];
                if (min && price < min) throw new Error(`Price for ${net} ($${price}) is below hard minimum ($${min})`);
                if (max && price > max) throw new Error(`Price for ${net} ($${price}) is above hard maximum ($${max})`);
            }

            // Update cache
            this.cache.set(net, { price, timestamp: Date.now() });
            logger.info(`Updated price for ${net}: $${price}`);

            return price;
        } catch (error) {
            logger.error(`Price fetch error for ${net}`, { error: error.message });
            // If cache exists, return it anyway as fallback (last line of defense)
            if (cached) {
                logger.warn(`Using previous price cache for ${net} as fallback`);
                return cached.price;
            }
            throw error;
        }
    }

    async _fetchFromCoinbase(net, fetch) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

        try {
            const fetchOptions = {
                signal: controller.signal
            };

            // INJECT PROXY IF CONFIGURED (R4)
            if (config.proxy_url && HttpsProxyAgent) {
                fetchOptions.agent = new HttpsProxyAgent(config.proxy_url);
                logger.debug(`Using proxy for Coinbase: ${config.proxy_url}`);
            }

            const response = await fetch(`https://api.coinbase.com/v2/prices/${net}-USD/spot`, fetchOptions);
            const data = await response.json();
            return parseFloat(data.data.amount);
        } catch (e) {
            if (e.name === 'AbortError') logger.warn(`Coinbase fetch timed out for ${net}`);
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    async _fetchFromCoinGecko(net, fetch) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

        try {
            const coinMap = { 'LTC': 'litecoin', 'SOL': 'solana', 'BTC': 'bitcoin' };
            const coinId = coinMap[net];
            if (!coinId) return null;

            const fetchOptions = {
                signal: controller.signal
            };

            // INJECT PROXY IF CONFIGURED (R4)
            if (config.proxy_url && HttpsProxyAgent) {
                fetchOptions.agent = new HttpsProxyAgent(config.proxy_url);
                logger.debug(`Using proxy for CoinGecko: ${config.proxy_url}`);
            }

            const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`, fetchOptions);
            const data = await response.json();
            return parseFloat(data[coinId].usd);
        } catch (e) {
            if (e.name === 'AbortError') logger.warn(`CoinGecko fetch timed out for ${net}`);
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    /**
     * Convert USD amount to crypto unit
     * @param {number} usdAmount - Amount in USD
     * @param {string} network - LTC, SOL, BTC
     * @returns {Promise<number>} - Amount in crypto
     */
    async convertUsdToCrypto(usdAmount, network) {
        const price = await this.getPrice(network);
        // Add 1% slippage buffer for safety when sending (though for payout it's better to be exact)
        // Actually, we should be exact or slightly over to ensure recipient is happy
        const cryptoAmount = usdAmount / price;
        return cryptoAmount; // Return raw float, handlers will use BigNumber.ROUND_CEIL
    }
}

const priceOracle = new PriceOracle();
module.exports = { priceOracle };
