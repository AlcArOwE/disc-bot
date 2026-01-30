/**
 * End-to-End Ticket Flow Test
 * Tests the FULL ticket lifecycle to find where it breaks
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');

// Import all the pieces
const { ticketManager } = require('../src/state/TicketManager');
const { STATES } = require('../src/state/StateMachine');
const { isMiddleman, validatePaymentAddress } = require('../src/utils/validator');
const { extractCryptoAddress, isPaymentConfirmation, extractGameStart } = require('../src/utils/regex');
const config = require('../config.json');

describe('End-to-End Ticket Flow', () => {
    const TEST_CHANNEL_ID = 'test-ticket-channel';
    const OPPONENT_ID = 'opponent-user-123';
    const MIDDLEMAN_ID = config.middleman_ids[0]; // Use first configured middleman
    const BOT_ID = 'bot-user-id';
    const OPPONENT_BET = 20;
    const OUR_BET = 24;

    beforeEach(() => {
        // Clear any existing tickets
        ticketManager.tickets.clear();
        ticketManager.cooldowns.clear();
    });

    afterEach(() => {
        ticketManager.tickets.clear();
    });

    it('STEP 1: Ticket creation works', () => {
        const ticket = ticketManager.createTicket(TEST_CHANNEL_ID, {
            opponentId: OPPONENT_ID,
            opponentBet: OPPONENT_BET,
            ourBet: OUR_BET,
            autoDetected: true
        });

        assert.ok(ticket, 'Ticket should be created');
        assert.strictEqual(ticket.getState(), STATES.AWAITING_TICKET, 'Initial state should be AWAITING_TICKET');
        assert.strictEqual(ticket.data.opponentId, OPPONENT_ID);
        assert.strictEqual(ticket.data.opponentBet, OPPONENT_BET);
        assert.strictEqual(ticket.data.ourBet, OUR_BET);
        console.log('✅ STEP 1 PASS: Ticket created with correct data');
    });

    it('STEP 2: Transition to AWAITING_MIDDLEMAN works', () => {
        const ticket = ticketManager.createTicket(TEST_CHANNEL_ID, {
            opponentId: OPPONENT_ID,
            opponentBet: OPPONENT_BET,
            ourBet: OUR_BET
        });

        const transitioned = ticket.transition(STATES.AWAITING_MIDDLEMAN);
        assert.strictEqual(transitioned, true, 'Transition should succeed');
        assert.strictEqual(ticket.getState(), STATES.AWAITING_MIDDLEMAN);
        console.log('✅ STEP 2 PASS: Transitioned to AWAITING_MIDDLEMAN');
    });

    it('STEP 3: Middleman detection works', () => {
        // Test first middleman ID from config
        const mmId = config.middleman_ids[0];
        assert.ok(mmId, 'Should have at least one middleman configured');

        const isMM = isMiddleman(mmId);
        assert.strictEqual(isMM, true, `Middleman ${mmId} should be detected`);

        const isFake = isMiddleman('fake-id-12345');
        assert.strictEqual(isFake, false, 'Fake ID should not be middleman');

        console.log(`✅ STEP 3 PASS: isMiddleman works (${config.middleman_ids.length} configured)`);
    });

    it('STEP 4: Transition to AWAITING_PAYMENT_ADDRESS with middlemanId', () => {
        const ticket = ticketManager.createTicket(TEST_CHANNEL_ID, {
            opponentId: OPPONENT_ID,
            opponentBet: OPPONENT_BET,
            ourBet: OUR_BET
        });
        ticket.transition(STATES.AWAITING_MIDDLEMAN);

        // Now simulate middleman detection
        const mmId = MIDDLEMAN_ID;
        const transitioned = ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: mmId });

        assert.strictEqual(transitioned, true, 'Transition should succeed');
        assert.strictEqual(ticket.getState(), STATES.AWAITING_PAYMENT_ADDRESS);
        assert.strictEqual(ticket.data.middlemanId, mmId, 'Middleman ID should be stored');
        console.log('✅ STEP 4 PASS: Transitioned to AWAITING_PAYMENT_ADDRESS with middlemanId');
    });

    it('STEP 5: Address extraction from various message formats', () => {
        // Use a different address than our payout (validation blocks self-send)
        const testAddress = 'LXbD7dGqMqPHxDpLcTRB5DHLoM9JHzQdxM';
        const testMessages = [
            testAddress,
            `Send to ${testAddress} please`,
            `address: ${testAddress}`,
            `LTC: ${testAddress}`,
            `\`${testAddress}\``,
            `Here's my address ${testAddress} thanks`,
        ];

        for (const msg of testMessages) {
            const extracted = extractCryptoAddress(msg, 'LTC');
            assert.strictEqual(extracted, testAddress, `Failed to extract from: "${msg}"`);
        }
        console.log('✅ STEP 5 PASS: Address extraction works for all formats');
    });

    it('STEP 6: Address validation works', () => {
        // Use a different address than our payout (validation blocks self-send)
        const validAddress = 'LXbD7dGqMqPHxDpLcTRB5DHLoM9JHzQdxM';
        const result = validatePaymentAddress(validAddress, 'LTC');
        assert.strictEqual(result.valid, true, 'Valid address should pass validation');

        const invalidResult = validatePaymentAddress('invalid', 'LTC');
        assert.strictEqual(invalidResult.valid, false, 'Invalid address should fail validation');

        console.log('✅ STEP 6 PASS: Address validation works');
    });

    it('STEP 7: Transition to PAYMENT_SENT works', () => {
        const ticket = ticketManager.createTicket(TEST_CHANNEL_ID, {
            opponentId: OPPONENT_ID,
            opponentBet: OPPONENT_BET,
            ourBet: OUR_BET
        });
        ticket.transition(STATES.AWAITING_MIDDLEMAN);
        ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: MIDDLEMAN_ID });

        // Simulate payment
        const testTxId = 'dryrun_tx_12345';
        const transitioned = ticket.transition(STATES.PAYMENT_SENT, {
            paymentAddress: 'LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ',
            paymentTxId: testTxId
        });

        assert.strictEqual(transitioned, true, 'Transition should succeed');
        assert.strictEqual(ticket.getState(), STATES.PAYMENT_SENT);
        assert.strictEqual(ticket.data.paymentTxId, testTxId);
        console.log('✅ STEP 7 PASS: Transitioned to PAYMENT_SENT');
    });

    it('STEP 8: Payment confirmation detection works', () => {
        const confirmMessages = [
            'confirmed',
            'Received!',
            'Both paid',
            'GL',
            'good luck',
            'start the game',
            'ready to go'
        ];

        for (const msg of confirmMessages) {
            const isConfirm = isPaymentConfirmation(msg);
            assert.strictEqual(isConfirm, true, `"${msg}" should be detected as confirmation`);
        }
        console.log('✅ STEP 8 PASS: Payment confirmation detection works');
    });

    it('STEP 9: Game start detection works', () => {
        const testMessages = [
            { msg: '<@123456789012345678> goes first', user: '123456789012345678' },
            { msg: '<@987654321098765432> first', user: '987654321098765432' },
            { msg: 'first: <@111222333444555666>', user: '111222333444555666' }
        ];

        for (const { msg, user } of testMessages) {
            const result = extractGameStart(msg);
            assert.ok(result, `Should extract game start from: "${msg}"`);
            assert.strictEqual(result.userId, user);
        }
        console.log('✅ STEP 9 PASS: Game start detection works');
    });

    it('STEP 10: Full state machine flow', () => {
        // Create ticket
        const ticket = ticketManager.createTicket(TEST_CHANNEL_ID, {
            opponentId: OPPONENT_ID,
            opponentBet: OPPONENT_BET,
            ourBet: OUR_BET
        });

        // Full flow
        assert.strictEqual(ticket.transition(STATES.AWAITING_MIDDLEMAN), true, 'Step 1');
        assert.strictEqual(ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: MIDDLEMAN_ID }), true, 'Step 2');
        assert.strictEqual(ticket.transition(STATES.PAYMENT_SENT, { paymentTxId: 'tx_123' }), true, 'Step 3');
        assert.strictEqual(ticket.transition(STATES.AWAITING_GAME_START), true, 'Step 4');
        assert.strictEqual(ticket.transition(STATES.GAME_IN_PROGRESS), true, 'Step 5');
        assert.strictEqual(ticket.transition(STATES.GAME_COMPLETE, { winner: 'bot' }), true, 'Step 6');

        console.log('✅ STEP 10 PASS: Full state machine flow completes');
    });

    it('CRITICAL: Verify ticket state in handleAwaitingPaymentAddress simulation', () => {
        // This simulates exactly what handleAwaitingPaymentAddress does
        const ticket = ticketManager.createTicket(TEST_CHANNEL_ID, {
            opponentId: OPPONENT_ID,
            opponentBet: OPPONENT_BET,
            ourBet: OUR_BET
        });
        ticket.transition(STATES.AWAITING_MIDDLEMAN);
        ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: MIDDLEMAN_ID });

        // Simulate message from middleman with address (use different address than our payout)
        const messageAuthorId = MIDDLEMAN_ID;
        const messageContent = 'LXbD7dGqMqPHxDpLcTRB5DHLoM9JHzQdxM';

        // Check 1: Is author the middleman?
        const isFromMiddleman = messageAuthorId === ticket.data.middlemanId;
        assert.strictEqual(isFromMiddleman, true, 'Author should match middleman ID');

        // Check 2: Extract address
        const address = extractCryptoAddress(messageContent, config.crypto_network);
        assert.ok(address, 'Address should be extracted');

        // Check 3: Validate address
        const validation = validatePaymentAddress(address, config.crypto_network);
        assert.strictEqual(validation.valid, true, 'Address should be valid');

        console.log('✅ CRITICAL TEST PASS: handleAwaitingPaymentAddress simulation works');
        console.log('   - Author matches middleman: true');
        console.log('   - Address extracted:', address);
        console.log('   - Validation passed: true');
    });
});

console.log('\n=== RUNNING END-TO-END TICKET FLOW TESTS ===\n');
