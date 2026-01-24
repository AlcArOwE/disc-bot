/**
 * Discord Bot Client - Selfbot initialization and event registration
 */

const { Client } = require('discord.js-selfbot-v13');
const { logger } = require('../utils/logger');
const config = require('../../config.json');

let client = null;

/**
 * Create and configure the Discord client
 * @returns {Client}
 */
function createClient() {
    if (client) return client;

    const clientOptions = {
        checkUpdate: false,
        // Reduce memory usage
        messageCacheMaxSize: 100,
        messageCacheLifetime: 240,
        messageSweepInterval: 300
    };

    // Add proxy support if configured
    if (config.proxy_url && config.proxy_url.length > 0) {
        logger.info('Using proxy for connection');
        clientOptions.proxy = config.proxy_url;
    }

    client = new Client(clientOptions);

    return client;
}

/**
 * Get the current client instance
 * @returns {Client | null}
 */
function getClient() {
    return client;
}

/**
 * Login to Discord
 * @param {string} token - Discord token
 * @returns {Promise<Client>}
 */
async function login(token) {
    if (!client) createClient();

    try {
        await client.login(token);
        logger.info('Client login initiated');
        return client;
    } catch (error) {
        logger.error('Login failed', { error: error.message });
        throw error;
    }
}

/**
 * Logout and destroy client
 */
async function destroy() {
    if (client) {
        client.destroy();
        client = null;
        logger.info('Client destroyed');
    }
}

module.exports = {
    createClient,
    getClient,
    login,
    destroy
};
