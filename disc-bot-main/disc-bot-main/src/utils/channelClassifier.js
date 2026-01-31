/**
 * Channel Classification Utility
 * Phase 2 Item #12: Explicit channel classification
 * 
 * Provides a clear, explicit classification of channels to prevent routing errors.
 */

const config = require('../../config.json');
const { logger } = require('./logger');

// Channel types
const ChannelType = {
    PUBLIC: 'PUBLIC',           // Monitored public channel - ONLY sniping allowed
    TICKET: 'TICKET',           // Ticket channel - payments allowed
    DM: 'DM',                   // Direct message
    UNKNOWN: 'UNKNOWN',         // Unknown channel type
    EXCLUDED: 'EXCLUDED'        // Excluded channel (bot-commands, general)
};

// Patterns for ticket channels
const TICKET_PATTERNS = config.payment_safety?.ticket_channel_patterns || ['ticket', 'order-'];

// Patterns for excluded channels  
const EXCLUDED_PATTERNS = ['bot-commands', 'commands', 'general', 'rules', 'announcements'];

// Blocklisted channel IDs
const BLOCKLISTED_CHANNELS = config.payment_safety?.public_channel_blocklist || [];

/**
 * Classify a Discord channel
 * @param {Object} channel - Discord channel object
 * @returns {{type: string, reason: string, allowPayment: boolean, allowSnipe: boolean}} 
 */
function classifyChannel(channel) {
    if (!channel) {
        return {
            type: ChannelType.UNKNOWN,
            reason: 'No channel provided',
            allowPayment: false,
            allowSnipe: false
        };
    }

    const channelId = channel.id;
    const channelName = channel.name?.toLowerCase() || '';
    const channelType = channel.type;

    // Check if DM
    if (channelType === 'DM' || channelType === 1) {
        return {
            type: ChannelType.DM,
            reason: 'Direct message channel',
            allowPayment: false,
            allowSnipe: false
        };
    }

    // Check if blocklisted
    if (BLOCKLISTED_CHANNELS.includes(channelId)) {
        return {
            type: ChannelType.EXCLUDED,
            reason: 'Channel is blocklisted',
            allowPayment: false,
            allowSnipe: false
        };
    }

    // Check if excluded channel
    const isExcluded = EXCLUDED_PATTERNS.some(pattern => channelName.includes(pattern));
    if (isExcluded) {
        return {
            type: ChannelType.EXCLUDED,
            reason: `Channel matches excluded pattern`,
            allowPayment: false,
            allowSnipe: false
        };
    }

    // Check if ticket channel
    const isTicket = TICKET_PATTERNS.some(pattern => channelName.includes(pattern));
    if (isTicket) {
        return {
            type: ChannelType.TICKET,
            reason: 'Channel name matches ticket pattern',
            allowPayment: true,  // Payments ONLY allowed here
            allowSnipe: false
        };
    }

    // Check if monitored public channel
    const monitoredChannels = config.channels?.monitored_channels || [];
    const isMonitored = monitoredChannels.length === 0 || monitoredChannels.includes(channelId);

    if (isMonitored) {
        return {
            type: ChannelType.PUBLIC,
            reason: 'Monitored public channel',
            allowPayment: false,  // No payments in public!
            allowSnipe: true      // Only sniping allowed
        };
    }

    // Default: unknown channel, be safe
    return {
        type: ChannelType.UNKNOWN,
        reason: 'Not monitored or ticket channel',
        allowPayment: false,
        allowSnipe: false
    };
}

/**
 * Check if payments are allowed in a channel
 * @param {Object} channel - Discord channel object
 * @returns {boolean}
 */
function canProcessPayment(channel) {
    // Emergency stop check
    if (process.env.EMERGENCY_STOP === 'true') {
        logger.error('🚨 EMERGENCY STOP: Payment blocked by environment flag');
        return false;
    }

    const classification = classifyChannel(channel);

    if (!classification.allowPayment) {
        logger.warn('⛔ Payment blocked by channel classification', {
            channelId: channel.id,
            channelName: channel.name,
            type: classification.type,
            reason: classification.reason
        });
    }

    return classification.allowPayment;
}

/**
 * Check if sniping is allowed in a channel
 * @param {Object} channel - Discord channel object
 * @returns {boolean}
 */
function canSnipeInChannel(channel) {
    const classification = classifyChannel(channel);
    return classification.allowSnipe;
}

/**
 * Log channel classification for debugging
 * @param {Object} channel - Discord channel object
 */
function debugClassification(channel) {
    const classification = classifyChannel(channel);
    logger.debug('🔍 Channel Classification', {
        channelId: channel?.id,
        channelName: channel?.name,
        ...classification
    });
    return classification;
}

module.exports = {
    ChannelType,
    classifyChannel,
    canProcessPayment,
    canSnipeInChannel,
    debugClassification,
    TICKET_PATTERNS,
    EXCLUDED_PATTERNS
};
