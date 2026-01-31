/**
 * Config Validator
 * Phase 9: Configuration validation and health checks
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

// Required config keys
const REQUIRED_KEYS = [
    'discord_bot_token',
    'channels.monitored_channels',
    'crypto_network',
    'bet_min_usd',
    'bet_max_usd'
];

// Required environment variables
const REQUIRED_ENV_VARS = [
    'DISCORD_BOT_TOKEN',
    'LTC_PAYOUT_ADDRESS'
];

// Recommended environment variables
const RECOMMENDED_ENV_VARS = [
    'ENABLE_LIVE_TRANSFERS',
    'DEBUG'
];

/**
 * Validate configuration object
 * @param {Object} config - Configuration object
 * @returns {{valid: boolean, errors: string[], warnings: string[]}}
 */
function validateConfig(config) {
    const errors = [];
    const warnings = [];

    if (!config || typeof config !== 'object') {
        return { valid: false, errors: ['Config is null or not an object'], warnings: [] };
    }

    // Check required keys
    for (const key of REQUIRED_KEYS) {
        const parts = key.split('.');
        let value = config;
        for (const part of parts) {
            value = value?.[part];
        }
        if (value === undefined || value === null) {
            errors.push(`Missing required config key: ${key}`);
        }
    }

    // Validate bet limits
    if (config.bet_min_usd !== undefined && config.bet_max_usd !== undefined) {
        if (config.bet_min_usd >= config.bet_max_usd) {
            errors.push('bet_min_usd must be less than bet_max_usd');
        }
    }

    // Validate payment safety settings
    if (config.payment_safety) {
        if (config.payment_safety.max_payment_per_tx > 100) {
            warnings.push('max_payment_per_tx is very high (>$100)');
        }
        if (!config.payment_safety.require_ticket_channel_for_payment) {
            warnings.push('require_ticket_channel_for_payment is disabled - risky!');
        }
    }

    // Validate simulation mode for production
    if (config.simulation_mode === false) {
        warnings.push('simulation_mode is OFF - live payments enabled');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Validate environment variables
 * @returns {{valid: boolean, missing: string[], warnings: string[]}}
 */
function validateEnvironment() {
    const missing = [];
    const warnings = [];

    // Check required env vars
    for (const envVar of REQUIRED_ENV_VARS) {
        if (!process.env[envVar]) {
            missing.push(envVar);
        }
    }

    // Check recommended env vars
    for (const envVar of RECOMMENDED_ENV_VARS) {
        if (!process.env[envVar]) {
            warnings.push(`Recommended env var not set: ${envVar}`);
        }
    }

    // Check for dangerous settings
    if (process.env.ENABLE_LIVE_TRANSFERS === 'true') {
        warnings.push('ENABLE_LIVE_TRANSFERS is ON - real money transfers enabled');
    }

    return {
        valid: missing.length === 0,
        missing,
        warnings
    };
}

/**
 * Production readiness checklist
 * @param {Object} config - Configuration object
 * @returns {{ready: boolean, checks: Object}}
 */
function productionChecklist(config) {
    const checks = {
        configValid: false,
        envValid: false,
        payoutAddressSet: false,
        safetyEnabled: false,
        simulationOff: false,
        liveTransfersReady: false,
        monitoredChannelsSet: false
    };

    // Config validation
    const configResult = validateConfig(config);
    checks.configValid = configResult.valid;

    // Env validation
    const envResult = validateEnvironment();
    checks.envValid = envResult.valid;

    // Payout address
    checks.payoutAddressSet = !!process.env.LTC_PAYOUT_ADDRESS || !!process.env.SOL_PAYOUT_ADDRESS;

    // Safety settings
    checks.safetyEnabled = config.payment_safety?.require_ticket_channel_for_payment === true;

    // Simulation mode
    checks.simulationOff = config.simulation_mode === false;

    // Live transfers
    checks.liveTransfersReady = process.env.ENABLE_LIVE_TRANSFERS === 'true';

    // Monitored channels
    checks.monitoredChannelsSet = (config.channels?.monitored_channels?.length || 0) > 0;

    const ready = Object.values(checks).every(v => v === true);

    return { ready, checks };
}

/**
 * Health check function
 * @param {Object} config - Configuration object
 * @returns {{healthy: boolean, issues: string[]}}
 */
function healthCheck(config) {
    const issues = [];

    // Config check
    const configResult = validateConfig(config);
    if (!configResult.valid) {
        issues.push(...configResult.errors.map(e => `Config: ${e}`));
    }

    // Env check
    const envResult = validateEnvironment();
    if (!envResult.valid) {
        issues.push(...envResult.missing.map(m => `Missing env: ${m}`));
    }

    // File checks
    const requiredFiles = [
        'config.json',
        'src/index.js',
        'src/bot/events/messageCreate.js'
    ];

    for (const file of requiredFiles) {
        const filePath = path.join(process.cwd(), file);
        if (!fs.existsSync(filePath)) {
            issues.push(`Missing file: ${file}`);
        }
    }

    return {
        healthy: issues.length === 0,
        issues
    };
}

/**
 * Log full system status
 * @param {Object} config - Configuration object
 */
function logSystemStatus(config) {
    const configResult = validateConfig(config);
    const envResult = validateEnvironment();
    const prodChecklist = productionChecklist(config);

    logger.info('═══════════════════════════════════════════════');
    logger.info('SYSTEM STATUS CHECK');
    logger.info('═══════════════════════════════════════════════');
    logger.info(`Config Valid: ${configResult.valid ? '✅' : '❌'}`);
    logger.info(`Env Valid: ${envResult.valid ? '✅' : '❌'}`);
    logger.info(`Production Ready: ${prodChecklist.ready ? '✅' : '⚠️'}`);

    if (configResult.errors.length > 0) {
        logger.error('Config Errors:', configResult.errors);
    }
    if (envResult.missing.length > 0) {
        logger.error('Missing Env Vars:', envResult.missing);
    }
    if (configResult.warnings.length > 0) {
        logger.warn('Warnings:', configResult.warnings);
    }

    logger.info('═══════════════════════════════════════════════');
}

module.exports = {
    validateConfig,
    validateEnvironment,
    productionChecklist,
    healthCheck,
    logSystemStatus,
    REQUIRED_KEYS,
    REQUIRED_ENV_VARS
};
