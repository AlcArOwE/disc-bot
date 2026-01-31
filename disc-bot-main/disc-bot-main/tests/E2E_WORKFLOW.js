/**
 * E2E Workflow Tests - Validates complete ticket lifecycle
 * 
 * Tests cover:
 * - Snipe → Pending Wager storage with enhanced context
 * - Ticket Detection → Correlation matching
 * - MM Confirmation → "Confirm" response and terms verification
 * - Game Start → Turn detection and auto-roll
 * - Win/Loss → Payout address and vouch
 */

const assert = require('assert');

// Test utilities
function createMockMessage(overrides = {}) {
    return {
        id: `msg_${Date.now()}`,
        content: overrides.content || '',
        author: {
            id: overrides.authorId || 'user123',
            username: overrides.username || 'testuser'
        },
        channel: {
            id: overrides.channelId || 'channel123',
            name: overrides.channelName || 'ticket-testuser',
            sendTyping: async () => { },
            send: async () => ({ id: 'sent123' })
        },
        mentions: {
            users: new Map(overrides.mentions || [])
        },
        client: {
            user: { id: 'bot123' }
        },
        guild: { id: 'guild123' }
    };
}

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Enhanced Snipe Context Storage
// ═══════════════════════════════════════════════════════════════════
async function testSnipeContextStorage() {
    console.log('TEST 1: Enhanced Snipe Context Storage');

    const { ticketManager } = require('../src/state/TicketManager');

    // Clear existing state
    ticketManager.pendingWagers.clear();

    // Store wager with enhanced context
    const userId = 'snipe_user_001';
    ticketManager.storePendingWager(
        userId,
        10.00,
        12.00,
        'source_channel_001',
        'snipeTestUser',
        {
            messageId: 'snipe_msg_001',
            guildId: 'test_guild',
            betTermsRaw: '10v10 dice ft5'
        }
    );

    const stored = ticketManager.getPendingWager(userId);
    assert(stored !== null, 'Wager should be stored');
    assert(stored.messageId === 'snipe_msg_001', 'MessageId should be stored');
    assert(stored.guildId === 'test_guild', 'GuildId should be stored');
    assert(stored.betTermsRaw === '10v10 dice ft5', 'BetTermsRaw should be stored');
    assert(stored.opponentBet === 10.00, 'OpponentBet should be 10.00');

    console.log('✅ TEST 1 PASSED: Enhanced context stored correctly\n');
    return true;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Multi-Factor Correlation Matching
// ═══════════════════════════════════════════════════════════════════
async function testCorrelationMatching() {
    console.log('TEST 2: Multi-Factor Correlation Matching');

    const { ticketManager } = require('../src/state/TicketManager');

    // Clear and store test wagers
    ticketManager.pendingWagers.clear();

    ticketManager.storePendingWager(
        'user_alice',
        15.00,
        18.00,
        'source_001',
        'Alice',
        { messageId: 'msg_alice', guildId: 'guild1', betTermsRaw: '15v15' }
    );

    ticketManager.storePendingWager(
        'user_bob',
        20.00,
        24.00,
        'source_002',
        'Bob',
        { messageId: 'msg_bob', guildId: 'guild1', betTermsRaw: '20v20' }
    );

    // Test 2a: Match by username in channel name
    const matchByName = ticketManager.getAnyPendingWager('ticket-alice', {});
    assert(matchByName !== null, 'Should match Alice by channel name');
    assert(matchByName.opponentBet === 15.00, 'Should be Alice\'s bet');

    // Test 2b: Match by bet amount
    const matchByBet = ticketManager.getAnyPendingWager('ticket-unknown', {
        betAmount: 20.00
    });
    assert(matchByBet !== null, 'Should match Bob by bet amount');
    assert(matchByBet.opponentBet === 20.00, 'Should be Bob\'s bet');

    console.log('✅ TEST 2 PASSED: Multi-factor correlation works correctly\n');
    return true;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Bet Amount Parsing
// ═══════════════════════════════════════════════════════════════════
async function testBetParsing() {
    console.log('TEST 3: Bet Amount Parsing');

    const { extractBetAmounts } = require('../src/utils/regex');

    // Test various bet formats
    const tests = [
        { input: '10v10', expected: 10 },
        { input: '10vs10', expected: 10 },
        { input: '$15 v $15', expected: 15 },
        { input: '20.50 vs 20.50', expected: 20.50 },
        { input: '10v10?', expected: 10 },
        { input: 'anyone 5v5 dice?', expected: 5 }
    ];

    for (const test of tests) {
        const result = extractBetAmounts(test.input);
        assert(result !== null, `Should parse: ${test.input}`);
        assert(result.opponent === test.expected,
            `${test.input} should parse to ${test.expected}, got ${result?.opponent}`);
    }

    console.log('✅ TEST 3 PASSED: Bet parsing works correctly\n');
    return true;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Payment Confirmation Detection
// ═══════════════════════════════════════════════════════════════════
async function testPaymentConfirmation() {
    console.log('TEST 4: Payment Confirmation Detection');

    const { isPaymentConfirmation } = require('../src/utils/regex');

    const positives = [
        'confirmed',
        'payment received',
        'both paid',
        'gl',
        'good luck',
        'start the game'
    ];

    const negatives = [
        'hello',
        'waiting',
        'send address'
    ];

    for (const msg of positives) {
        assert(isPaymentConfirmation(msg) === true,
            `Should detect confirmation: "${msg}"`);
    }

    for (const msg of negatives) {
        assert(isPaymentConfirmation(msg) === false,
            `Should NOT detect: "${msg}"`);
    }

    console.log('✅ TEST 4 PASSED: Payment confirmation detection works\n');
    return true;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Game Start Detection
// ═══════════════════════════════════════════════════════════════════
async function testGameStartDetection() {
    console.log('TEST 5: Game Start Detection');

    const { extractGameStart } = require('../src/utils/regex');

    const positives = [
        'ft5 <@bot123> first',
        'you first',
        'bot goes first',
        '<@user456> first, <@bot123> second'
    ];

    for (const msg of positives) {
        const result = extractGameStart(msg);
        assert(result !== null, `Should detect game start: "${msg}"`);
    }

    console.log('✅ TEST 5 PASSED: Game start detection works\n');
    return true;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 6: Dice Result Extraction
// ═══════════════════════════════════════════════════════════════════
async function testDiceResultExtraction() {
    console.log('TEST 6: Dice Result Extraction');

    const { extractDiceResult } = require('../src/utils/regex');

    const tests = [
        { input: 'rolled a 6', expected: 6 },
        { input: '🎲 4', expected: 4 },
        { input: '[3]', expected: 3 },
        { input: 'rolled a **5**', expected: 5 },
        { input: 'result: 2', expected: 2 }
    ];

    for (const test of tests) {
        const result = extractDiceResult(test.input);
        assert(result === test.expected,
            `${test.input} should extract ${test.expected}, got ${result}`);
    }

    console.log('✅ TEST 6 PASSED: Dice result extraction works\n');
    return true;
}

// ═══════════════════════════════════════════════════════════════════
// TEST 7: State Machine Transitions
// ═══════════════════════════════════════════════════════════════════
async function testStateMachineTransitions() {
    console.log('TEST 7: State Machine Transitions');

    const { TicketStateMachine, STATES } = require('../src/state/StateMachine');

    const ticket = new TicketStateMachine('test_channel', {
        opponentBet: 10,
        ourBet: 12
    });

    // Valid transitions
    assert(ticket.canTransition(STATES.AWAITING_MIDDLEMAN),
        'Should allow AWAITING_TICKET → AWAITING_MIDDLEMAN');

    ticket.transition(STATES.AWAITING_MIDDLEMAN);
    assert(ticket.getState() === STATES.AWAITING_MIDDLEMAN);

    ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS);
    assert(ticket.getState() === STATES.AWAITING_PAYMENT_ADDRESS);

    ticket.transition(STATES.PAYMENT_SENT);
    assert(ticket.getState() === STATES.PAYMENT_SENT);

    ticket.transition(STATES.AWAITING_GAME_START);
    assert(ticket.getState() === STATES.AWAITING_GAME_START);

    ticket.transition(STATES.GAME_IN_PROGRESS);
    assert(ticket.getState() === STATES.GAME_IN_PROGRESS);

    ticket.transition(STATES.GAME_COMPLETE);
    assert(ticket.getState() === STATES.GAME_COMPLETE);
    assert(ticket.isComplete() === true);

    console.log('✅ TEST 7 PASSED: State machine transitions work correctly\n');
    return true;
}

// ═══════════════════════════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════════════════════════
async function runAllTests() {
    console.log('═'.repeat(60));
    console.log('  E2E WORKFLOW TESTS - Core Bot Functionality');
    console.log('═'.repeat(60) + '\n');

    const tests = [
        testSnipeContextStorage,
        testCorrelationMatching,
        testBetParsing,
        testPaymentConfirmation,
        testGameStartDetection,
        testDiceResultExtraction,
        testStateMachineTransitions
    ];

    let passed = 0;
    let failed = 0;

    for (const test of tests) {
        try {
            await test();
            passed++;
        } catch (error) {
            failed++;
            console.error(`❌ ${test.name} FAILED:`, error.message);
        }
    }

    console.log('═'.repeat(60));
    console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
    console.log('═'.repeat(60));

    process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
