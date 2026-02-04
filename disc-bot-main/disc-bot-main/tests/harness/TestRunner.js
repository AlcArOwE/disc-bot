/**
 * TestRunner.js
 * Orchestrates E2E scenarios, captures logs, and asserts invariants.
 */

const { DiscordHarness } = require('./DiscordHarness');
const { logger } = require('../../src/utils/logger');
const { ticketManager } = require('../../src/state/TicketManager');
const { idempotencyStore } = require('../../src/state/IdempotencyStore');

class TestRunner {
    constructor() {
        this.harness = null;
        this.logs = [];
        this.results = {
            total: 0,
            passed: 0,
            failed: 0,
            failures: []
        };

        // Intercept logger (Preserving context for winston)
        this.originalLoggerInfo = logger.info;
        this.originalLoggerWarn = logger.warn;
        this.originalLoggerError = logger.error;
        this.originalLoggerDebug = logger.debug;

        logger.info = (...args) => { this.logs.push({ level: 'info', msg: args }); this.originalLoggerInfo.apply(logger, args); };
        logger.warn = (...args) => { this.logs.push({ level: 'warn', msg: args }); this.originalLoggerWarn.apply(logger, args); };
        logger.error = (...args) => { this.logs.push({ level: 'error', msg: args }); this.originalLoggerError.apply(logger, args); };
        logger.debug = (...args) => { this.logs.push({ level: 'debug', msg: args }); this.originalLoggerDebug.apply(logger, args); };
    }

    async setup() {
        this.harness = new DiscordHarness();
        this.logs = [];

        // --- ENVIRONMENT SETUP ---
        process.env.LTC_PRIVATE_KEY = 'LbS1vTPfS8e4K7x9yZ2a3b4c5d6e7f8g9h0j1k2l3m4n5p6q7r8s9t'; // Dummy livenet key
        process.env.ENABLE_LIVE_TRANSFERS = 'true';
        process.env.AUTO_SEND_ON_ADDRESS = 'true';
        process.env.DEBUG = '1';

        // --- ISOLATION CORE: Mock persistence and crypto before ANY handler is loaded ---
        const persistencePath = require.resolve('../../src/state/persistence');
        const readyPath = require.resolve('../../src/bot/events/ready');
        const msgCreatePath = require.resolve('../../src/bot/events/messageCreate');
        const chanCreatePath = require.resolve('../../src/bot/events/channelCreate');
        const priceOraclePath = require.resolve('../../src/crypto/PriceOracle');
        const cryptoIndexPath = require.resolve('../../src/crypto/index');

        delete require.cache[persistencePath];
        delete require.cache[readyPath];
        delete require.cache[msgCreatePath];
        delete require.cache[chanCreatePath];
        delete require.cache[priceOraclePath];
        delete require.cache[cryptoIndexPath];

        const persistence = require('../../src/state/persistence');
        persistence.loadState = () => { logger.info('MOCK: State loading skipped for test'); return true; };
        persistence.saveState = () => true;
        persistence.startAutoSave = () => { };
        persistence.shutdown = () => { };

        // Mock PriceOracle
        const { priceOracle } = require('../../src/crypto/PriceOracle');
        priceOracle.getPrice = async (coin) => 70.0;

        // Mock payment handlers (Mocking prototype before any instantiation)
        const LitecoinHandler = require('../../src/crypto/LitecoinHandler');
        const SolanaHandler = require('../../src/crypto/SolanaHandler');
        const BitcoinHandler = require('../../src/crypto/BitcoinHandler');

        [LitecoinHandler, SolanaHandler, BitcoinHandler].forEach(Handler => {
            Handler.prototype.initialize = () => true;
            Handler.prototype.validateAddress = () => true;
            Handler.prototype.getBalance = async () => ({ balance: 1000.0 });
            Handler.prototype.sendPayment = async () => ({ success: true, txId: 'dryrun-tx-' + Math.random().toString(36).substring(7) });
        });

        // Now load handlers - they will see the mock
        const handleReady = require('../../src/bot/events/ready');
        const handleMessageCreate = require('../../src/bot/events/messageCreate');
        const handleChannelCreate = require('../../src/bot/events/channelCreate');

        // Clean state singletons
        ticketManager.tickets.clear();
        ticketManager.pendingWagers.clear();
        ticketManager.processedTransactions.clear();
        ticketManager.vouchedChannels.clear();

        // Idempotency Store reset
        if (idempotencyStore._payments) {
            idempotencyStore._payments = {};
        }
        idempotencyStore._save = () => { };
        idempotencyStore._load = () => ({});

        // Reset MessageQueue
        const { messageQueue } = require('../../src/utils/MessageQueue');
        messageQueue.queue = [];
        messageQueue.processing = false;
        messageQueue.lastSendTime = 0;

        // Bind bot handlers to harness
        this.harness.on('messageCreate', async (msg) => {
            try {
                // Ensure the client in the message is our harness
                msg.client = this.harness;
                await handleMessageCreate(msg);
            } catch (err) {
                console.error('[RUNNER] Error in handleMessageCreate:', err.message);
            }
        });

        this.harness.on('channelCreate', async (chan) => {
            try {
                await handleChannelCreate(chan);
            } catch (err) {
                console.error('[RUNNER] Error in handleChannelCreate:', err.message);
            }
        });

        // Trigger ready
        await handleReady(this.harness);
    }

    async runScenario(scenario) {
        this.results.total++;
        console.log(`\n--- RUNNING SCENARIO: ${scenario.name} ---`);

        await this.setup();

        try {
            await scenario.execute(this.harness, this);
            this.results.passed++;
            console.log(`✅ SCENARIO PASSED: ${scenario.name}`);
        } catch (err) {
            this.results.failed++;
            const failure = {
                scenario: scenario.name,
                error: err.message,
                stack: err.stack,
                logs: [...this.logs]
            };
            this.results.failures.push(failure);
            console.error(`❌ SCENARIO FAILED: ${scenario.name}`);
            console.error(`Reason: ${err.message}`);
        }
    }

    // Assertion Helpers
    assert(condition, message) {
        if (!condition) throw new Error(message);
    }

    assertMessageSent(channelId, pattern, count = 1) {
        const channel = this.harness.channels.cache.get(channelId);
        if (!channel) throw new Error(`Channel ${channelId} not found`);

        const matches = channel.sentMessages.filter(m => {
            const matchesPattern = typeof pattern === 'string'
                ? m.content.includes(pattern)
                : pattern.test(m.content);
            return matchesPattern;
        });

        if (matches.length < count) {
            console.log(`[HARNESS_DEBUG] Checked ${channelId}. Found ${matches.length}/${count} matches.`);
            console.log(`[HARNESS_DEBUG] Messages: ${channel.sentMessages.map(m => m.content).join(' | ')}`);
            throw new Error(`Expected at least ${count} messages matching ${pattern} in ${channelId}, but found ${matches.length}`);
        }
    }

    assertState(channelId, state) {
        const ticket = ticketManager.getTicket(channelId);
        if (!ticket) throw new Error(`Ticket not found for channel ${channelId}`);
        if (ticket.state !== state) {
            throw new Error(`Expected ticket state ${state}, but got ${ticket.state}`);
        }
    }

    assertPublicSilence() {
        for (const [id, channel] of this.harness.channels.cache.entries()) {
            if (channel.name === 'general' || channel.name === 'bet-market') {
                const unauthorized = channel.sentMessages.filter(m => !m.content.includes('**DICE BATTLES**'));
                if (unauthorized.length > 0) {
                    throw new Error(`Bot broke public silence in ${channel.name}: "${unauthorized[0].content}"`);
                }
            }
        }
    }
}

module.exports = { TestRunner };
