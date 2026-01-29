/**
 * Notifier - Sends audit logs via Discord Webhook
 */

const fetch = require('node-fetch');
const config = require('../../config.json');
const { logger } = require('./logger');

/**
 * Send a rich embed to the configured webhook
 * @param {object} options
 * @param {string} options.title - Embed title
 * @param {string} options.description - Embed description
 * @param {string} options.color - Hex color (default: blue)
 * @param {object[]} options.fields - Array of {name, value, inline}
 */
async function sendWebhook({ title, description, color = 0x3498db, fields = [] }) {
    const webhookUrl = process.env.WEBHOOK_URL || config.webhook_url;

    if (!webhookUrl || webhookUrl === "YOUR_WEBHOOK_URL") {
        return; // Webhook not configured
    }

    try {
        const payload = {
            embeds: [{
                title,
                description,
                color,
                fields,
                timestamp: new Date().toISOString(),
                footer: {
                    text: "Discord Wagering Bot Audit"
                }
            }]
        };

        if (config.proxy_url) {
            // Need to handle proxy for node-fetch if using it
            // For simplicity, we assume the webhook request doesn't need the residential proxy
            // or that the environment has global proxy support if needed.
            // But typical webhooks are public endpoints, so datacenter IP is fine for logging.
        }

        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

    } catch (error) {
        logger.error('Failed to send webhook', { error: error.message });
    }
}

/**
 * Log a successful snipe
 */
function logSnipe(channelId, userId, opponentBet, ourBet) {
    sendWebhook({
        title: "🎯 Bet Sniped",
        description: `Found a new bet offer!`,
        color: 0xf1c40f, // Yellow
        fields: [
            { name: "Channel", value: `<#${channelId}>`, inline: true },
            { name: "User", value: `<@${userId}>`, inline: true },
            { name: "Offer", value: `$${opponentBet} vs $${ourBet}`, inline: false }
        ]
    });
}

/**
 * Log a game result
 */
function logGameResult(channelId, winner, netProfit) {
    const isWin = winner === 'bot';
    sendWebhook({
        title: isWin ? "🏆 Game Won" : "💀 Game Lost",
        description: isWin ? "Victory achieved!" : "Defeat suffered.",
        color: isWin ? 0x2ecc71 : 0xe74c3c, // Green or Red
        fields: [
            { name: "Channel", value: `<#${channelId}>`, inline: true },
            { name: "Result", value: isWin ? "WIN" : "LOSS", inline: true },
            { name: "Net Profit", value: `$${netProfit.toFixed(2)}`, inline: false }
        ]
    });
}

/**
 * Log a payment sent
 */
function logPayment(channelId, amount, txId, network) {
    sendWebhook({
        title: "💸 Payment Sent",
        description: `Sent crypto payment via ${network}`,
        color: 0x9b59b6, // Purple
        fields: [
            { name: "Channel", value: `<#${channelId}>`, inline: true },
            { name: "Amount", value: `${amount} (approx)`, inline: true },
            { name: "TxID", value: `\`${txId}\``, inline: false }
        ]
    });
}

module.exports = {
    sendWebhook,
    logSnipe,
    logGameResult,
    logPayment
};
