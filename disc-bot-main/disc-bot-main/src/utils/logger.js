const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `[${timestamp}] ${level}: ${message}${metaStr}`;
    })
);

// Custom format for file output
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

// Create the logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        // Console output
        new winston.transports.Console({
            format: consoleFormat
        }),
        // Combined log file
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5
        }),
        // Error log file
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5242880,
            maxFiles: 5
        })
    ]
});

const config = require('../../config.json');

// Game-specific logger for tracking bets and outcomes
const gameLogger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.File({
            filename: path.join(logsDir, 'games.log'),
            format: fileFormat,
            maxsize: 10485760, // 10MB
            maxFiles: 10
        })
    ]
});

/**
 * Send alert to Discord Webhook
 */
async function sendWebhook(message, meta = {}) {
    const url = config.webhook_url;
    if (!url || url === 'YOUR_WEBHOOK_URL') return;

    try {
        const fetch = (await import('node-fetch')).default;
        const payload = {
            content: `**🚨 BOT ALERT: ${message}**`,
            embeds: [{
                title: 'System Diagnostic Alert',
                color: 0xff0000,
                description: JSON.stringify(meta, null, 2).substring(0, 2048),
                timestamp: new Date().toISOString()
            }]
        };
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        // Fallback to console if webhook fails
        console.error('Webhook failed', e.message);
    }
}

// Override logger.error to also send webhook
const originalError = logger.error.bind(logger);
logger.error = (msg, meta) => {
    originalError(msg, meta);
    // Filter common non-critical errors if needed
    if (msg.includes('🚨') || msg.toLowerCase().includes('failed') || msg.toLowerCase().includes('error')) {
        sendWebhook(msg, meta);
    }
};

/**
 * Log a game event (bet, roll, outcome)
 * @param {string} event - Event type
 * @param {object} data - Event data
 */
function logGame(event, data) {
    gameLogger.info(event, data);
}

module.exports = { logger, logGame };
