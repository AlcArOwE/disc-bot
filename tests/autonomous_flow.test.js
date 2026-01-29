/**
 * Autonomous Flow Test
 * Simulates the end-to-end flow of the bot
 */

const assert = require('assert');
const { test, describe, beforeEach, afterEach } = require('node:test');

// Mocks must be setup BEFORE requiring modules that use them if they destructure
const crypto = require('../src/crypto');
// Override crypto methods
crypto.sendPayment = async () => ({ success: true, txId: 'mock-tx-id' });
crypto.getPayoutAddress = () => 'mock-payout-address';
crypto.validateAddress = () => true;

// Mock notifier
const notifier = require('../src/utils/notifier');
notifier.logSnipe = () => {};
notifier.logGameResult = () => {};
notifier.logPayment = () => {};

// Mock delay
const delay = require('../src/utils/delay');
delay.humanDelay = async () => {};
delay.gameActionDelay = async () => {};

// Now require handlers
const { ticketManager } = require('../src/state/TicketManager');
const { STATES } = require('../src/state/StateMachine');
const sniperHandler = require('../src/bot/handlers/sniper');
const ticketHandler = require('../src/bot/handlers/ticket');
const persistence = require('../src/state/persistence');

// Mocks
const mockLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    isLevelEnabled: () => false
};

describe('Autonomous Game Flow', () => {
    let mockClient;
    let mockGeneralChannel;
    let mockTicketChannel;
    let mockUser;
    let mockMiddleman;

    beforeEach(() => {
        // Reset state
        ticketManager.tickets.clear();
        ticketManager.userIndex.clear();
        ticketManager.cooldowns.clear();

        // Setup mocks with NUMERIC IDs for regex compatibility
        mockClient = {
            user: { id: '999999' }, // Bot ID
            channels: {
                fetch: async () => ({ send: async () => {} })
            }
        };

        mockUser = { id: '123456', bot: false };
        mockMiddleman = { id: '111111', bot: false };

        // Ensure middleman is recognized
        const config = require('../config.json');
        if (!config.middleman_ids) config.middleman_ids = [];
        if (!config.middleman_ids.includes('111111')) config.middleman_ids.push('111111');

        mockGeneralChannel = {
            id: 'general-channel',
            type: 'GUILD_TEXT',
            name: 'general',
            sendTyping: async () => {},
            send: async () => {},
            client: mockClient
        };

        mockTicketChannel = {
            id: 'ticket-channel-1',
            name: 'ticket-user-123456',
            type: 'GUILD_TEXT',
            sendTyping: async () => {},
            send: async () => {},
            client: mockClient
        };
    });

    test('Full End-to-End Flow', async () => {
        // 1. Sniper detects offer
        const offerMessage = {
            content: '10v10',
            author: mockUser,
            channel: mockGeneralChannel,
            reply: async () => {},
            client: mockClient
        };

        const sniped = await sniperHandler.handleMessage(offerMessage);
        assert.strictEqual(sniped, true, 'Should snipe the bet');

        // Verify no ticket created by sniper
        assert.strictEqual(ticketManager.getTicket(mockGeneralChannel.id), undefined, 'Sniper should not create ticket');

        // 2. Ticket Channel Detected
        const ticketMsg1 = {
            content: 'Hello',
            author: mockUser,
            channel: mockTicketChannel,
            client: mockClient,
            reply: async () => {}
        };

        // First message detects channel AND latches/sets bet if present
        await ticketHandler.handleMessage(ticketMsg1);
        let ticket = ticketManager.getTicket(mockTicketChannel.id);
        assert.ok(ticket, 'Ticket should be created upon detection');
        assert.strictEqual(ticket.state, STATES.AWAITING_TICKET);
        assert.strictEqual(ticket.data.opponentId, '123456', 'Should latch onto opponent');

        // 3. User states bet
        const ticketMsg2 = {
            content: '10v10',
            author: mockUser,
            channel: mockTicketChannel,
            client: mockClient,
            reply: async () => {}
        };

        await ticketHandler.handleMessage(ticketMsg2);
        ticket = ticketManager.getTicket(mockTicketChannel.id);

        // It should transition to AWAITING_MIDDLEMAN now that we have opponent and bet
        assert.strictEqual(ticket.state, STATES.AWAITING_MIDDLEMAN, 'Should wait for middleman');
        assert.strictEqual(ticket.data.opponentBet, 10);

        // 4. Middleman joins
        const mmMsg = {
            content: 'I will MM',
            author: mockMiddleman,
            channel: mockTicketChannel,
            client: mockClient
        };

        await ticketHandler.handleMessage(mmMsg);
        assert.strictEqual(ticket.state, STATES.AWAITING_PAYMENT_ADDRESS, 'Should wait for address');
        assert.strictEqual(ticket.data.middlemanId, '111111');

        // 5. Address sent
        const addrMsg = {
            content: 'Laaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', // Valid-ish LTC
            author: mockMiddleman,
            channel: mockTicketChannel,
            client: mockClient,
            reply: async () => {}
        };

        await ticketHandler.handleMessage(addrMsg);
        assert.strictEqual(ticket.state, STATES.PAYMENT_SENT, 'Should have sent payment');
        assert.strictEqual(ticket.data.paymentTxId, 'mock-tx-id');

        // 6. Confirmation
        const confirmMsg = {
            content: 'received',
            author: mockMiddleman,
            channel: mockTicketChannel,
            client: mockClient
        };

        await ticketHandler.handleMessage(confirmMsg);
        assert.strictEqual(ticket.state, STATES.AWAITING_GAME_START);

        // 7. Game Start
        const startMsg = {
            content: `first <@${mockClient.user.id}>`, // Bot goes first
            author: mockMiddleman,
            channel: mockTicketChannel,
            client: mockClient,
            send: async () => {}
        };

        await ticketHandler.handleMessage(startMsg);
        assert.strictEqual(ticket.state, STATES.GAME_IN_PROGRESS);

        // 8. Opponent rolls
        const rollMsg = {
            content: '🎲 5',
            author: mockUser,
            channel: mockTicketChannel,
            client: mockClient,
            send: async () => {}
        };

        await ticketHandler.handleMessage(rollMsg);

        assert.ok(ticket.data.gameScores.bot >= 0);
        assert.ok(ticket.data.gameScores.opponent >= 0);
    });
});
