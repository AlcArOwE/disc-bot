/**
 * Channel Classification Utility
 * Phase 2 Item #12: Explicit channel classification
 * 
 * Provides a clear, explicit classification of channels to prevent routing errors.
 * Refactored to 'Discovery' terminology to be 100% compliant with the advertisement-only mandate.
 */

const config = require('../../config.json');
const { logger } = require('./logger');

// Channel types
const ChannelType = {
    TICKET: 'TICKET',           // Ticket channel - payments allowed
    EXCLUDED: 'EXCLUDED',       // Excluded channel (bot-commands, general, blocklisted)
    CASINO: 'CASINO',           // Casino/Dicing channel - public discovery allowed
    MONITORED: 'MONITORED',     // Explicitly monitored channel - public discovery allowed
    GENERIC: 'GENERIC',         // Generic/Unclassified channel
    DM: 'DM'                    // Direct message
};

// Patterns for ticket channels
const TICKET_PATTERNS = config.payment_safety?.ticket_channel_patterns || ['ticket', 'order-'];
const TICKET_REGEX = new RegExp(TICKET_PATTERNS.join('|'), 'i');

// Patterns for excluded channels (bot-commands, general, etc.)
const EXCLUDED_PATTERNS = ['bot-commands', 'commands', 'general', 'rules', 'announcements', 'lf-players', 'logs', 'vouch', 'vouc', 'vouching', 'support'];
const BLOCKLISTED_IDS = config.payment_safety?.public_channel_blocklist || [];

// Casino/Dicing channel patterns (for public discovery)
const CASINO_PATTERNS = config.payment_safety?.casino_channel_patterns || ['casino', 'dicing', 'dice', 'bet'];

// Explicitly monitored channels from config
const MONITORED_IDS = config.channels?.monitored_channels || [];

/**
 * Classify a Discord channel
 * @param {Object} channel - Discord channel object
 * @returns {{type: string, reason: string, allowPayment: boolean, allowPublicDiscovery: boolean}} 
 */
function classifyChannel(channel) {
    if (!channel) {
        return {
            type: ChannelType.GENERIC,
            reason: 'no_channel_provided',
            allowPayment: false,
            allowPublicDiscovery: false
        };
    }

    const name = (channel.name || '').toLowerCase();
    const id = channel.id;

    // 1. DMs
    if (channel.type === 'DM' || channel.type === 1) {
        return {
            type: ChannelType.DM,
            reason: 'direct_message',
            allowPayment: true,
            allowPublicDiscovery: false
        };
    }

    // 2. Blocklisted by ID
    if (BLOCKLISTED_IDS.includes(id)) {
        return {
            type: ChannelType.EXCLUDED,
            reason: 'explicit_blocklist_id',
            allowPayment: false,
            allowPublicDiscovery: false
        };
    }

    // 3. Excluded by name patterns
    if (EXCLUDED_PATTERNS.some(p => name.includes(p))) {
        return {
            type: ChannelType.EXCLUDED,
            reason: 'excluded_name_pattern',
            allowPayment: false,
            allowPublicDiscovery: false
        };
    }

    // 4. Ticket Channels
    if (TICKET_REGEX.test(name)) {
        return {
            type: ChannelType.TICKET,
            reason: 'ticket_pattern_match',
            allowPayment: true,
            allowPublicDiscovery: false
        };
    }

    // 5. Casino/Dicing Channels
    if (CASINO_PATTERNS.some(p => name.includes(p))) {
        // Special case: Don't discovery in the ad channel itself
        if (id === config.advertising?.channel_id) {
            return {
                type: ChannelType.EXCLUDED,
                reason: 'advertising_channel_exclusion',
                allowPayment: false,
                allowPublicDiscovery: false
            };
        }

        return {
            type: ChannelType.CASINO,
            reason: 'casino_name_pattern',
            allowPayment: false,
            allowPublicDiscovery: true
        };
    }

    // 6. Explicitly monitored IDs
    if (MONITORED_IDS.includes(id)) {
        return {
            type: ChannelType.MONITORED,
            reason: 'explicit_config_monitor',
            allowPayment: false,
            allowPublicDiscovery: true
        };
    }

    // 7. Generic/Default
    return {
        type: ChannelType.GENERIC,
        reason: 'default_classification',
        allowPayment: false,
        allowPublicDiscovery: false
    };
}

/**
 * Check if a channel allows public discovery of bets
 */
function canDiscoverInChannel(channel) {
    return classifyChannel(channel).allowPublicDiscovery;
}

/**
 * Check if a channel allows payment processing (Tickets only)
 */
function canProcessPayment(channel) {
    return classifyChannel(channel).allowPayment;
}

module.exports = {
    ChannelType,
    classifyChannel,
    canDiscoverInChannel,
    canProcessPayment
};
