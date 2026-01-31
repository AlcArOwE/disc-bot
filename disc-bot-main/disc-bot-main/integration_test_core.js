/**
 * SIMPLIFIED INTEGRATION TEST
 * Tests the critical path with proper state transitions
 */

console.log('═══════════════════════════════════════════════════════════════');
console.log('    SIMPLIFIED INTEGRATION TEST - STARTING');
console.log('═══════════════════════════════════════════════════════════════\n');

async function runTest() {
    // Import core modules
    const { ticketManager } = require('./src/state/TicketManager');
    const { STATES } = require('./src/state/StateMachine');
    const ScoreTracker = require('./src/game/ScoreTracker');
    const { extractCryptoAddress } = require('./src/utils/regex');
    const { idempotencyStore } = require('./src/state/IdempotencyStore');

    console.log('## TEST 1: Ticket Creation & Wager Linking\n');

    // Step 1: Store a pending wager (simulates snipe)
    ticketManager.storePendingWager('user-123', 10, 12, 'public-channel', 'TestUser');
    const wager = ticketManager.getPendingWager('user-123');

    if (!wager || wager.opponentBet !== 10) {
        throw new Error('Pending wager storage failed');
    }
    console.log('✅ Pending wager stored correctly');

    // Step 2: Create ticket
    const ticket = ticketManager.createTicket('ticket-channel-1', {
        opponentId: 'user-123',
        opponentBet: 10,
        ourBet: 12
    });

    if (!ticket || ticket.state !== STATES.AWAITING_TICKET) {
        throw new Error('Ticket creation failed');
    }
    console.log('✅ Ticket created in correct initial state\n');

    console.log('## TEST 2: State Transitions\n');

    // Step 3: Transition to AWAITING_MIDDLEMAN
    ticket.transition(STATES.AWAITING_MIDDLEMAN);
    if (ticket.state !== STATES.AWAITING_MIDDLEMAN) {
        throw new Error('Transition to AWAITING_MIDDLEMAN failed');
    }
    console.log('✅ Transitioned to AWAITING_MIDDLEMAN');

    // Step 4: Transition to AWAITING_PAYMENT_ADDRESS
    ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: 'mm-123' });
    if (ticket.state !== STATES.AWAITING_PAYMENT_ADDRESS) {
        throw new Error('Transition to AWAITING_PAYMENT_ADDRESS failed');
    }
    console.log('✅ Transitioned to AWAITING_PAYMENT_ADDRESS');

    // Step 5: Extract and validate address (use real LTC address format from config)
    const testMessage = 'Send to LY7VX5yZgVbEsL3kS9F2a8B4c5D6e7F8g9';
    const address = extractCryptoAddress(testMessage, 'LTC');
    if (!address) {
        throw new Error('Address extraction failed');
    }
    console.log(`✅ Address extracted: ${address}`);

    // Step 6: Simulate payment sent
    ticket.transition(STATES.PAYMENT_SENT, {
        paymentLocked: true,
        recipientAddress: address
    });
    if (ticket.state !== STATES.PAYMENT_SENT || !ticket.data.paymentLocked) {
        throw new Error('Payment state transition failed');
    }
    console.log('✅ Transitioned to PAYMENT_SENT with lock\n');

    console.log('## TEST 3: Game Logic\n');

    // Step 7: Start game
    ticket.transition(STATES.AWAITING_GAME_START);
    ticket.transition(STATES.GAME_IN_PROGRESS);

    // Create score tracker
    const tracker = new ScoreTracker('ticket-channel-1', 5);
    if (tracker.scores.bot !== 0 || tracker.scores.opponent !== 0) {
        throw new Error('Score tracker initialization failed');
    }
    console.log('✅ Score tracker initialized');

    // Step 8: Simulate game rounds
    const results = [
        tracker.recordRound(6, 3),  // Bot wins
        tracker.recordRound(5, 5),  // Tie - bot wins
        tracker.recordRound(4, 2),  // Bot wins
        tracker.recordRound(6, 1),  // Bot wins
        tracker.recordRound(6, 4)   // Bot wins (5-0)
    ];

    const finalResult = results[results.length - 1];
    if (!finalResult.gameOver || !tracker.didBotWin()) {
        throw new Error(`Game completion failed. GameOver: ${finalResult.gameOver}, Score: ${tracker.scores.bot}-${tracker.scores.opponent}`);
    }
    console.log(`✅ Game completed: Bot ${tracker.scores.bot}-${tracker.scores.opponent} Opponent`);
    console.log(`✅ Bot won: ${tracker.didBotWin()}`);

    // Step 9: Complete ticket
    ticket.updateData({
        gameScores: tracker.scores,
        gameWinner: 'bot'
    });
    ticket.transition(STATES.GAME_COMPLETE);

    if (ticket.state !== STATES.GAME_COMPLETE) {
        throw new Error('Game completion transition failed');
    }
    console.log('✅ Ticket transitioned to GAME_COMPLETE\n');

    console.log('## TEST 4: Idempotency\n');

    // Step 10: Test idempotency
    const paymentId = idempotencyStore.generatePaymentId('test-ticket', 'test-address', 10);
    const recorded = idempotencyStore.recordIntent(paymentId, 'test-address', 10, 'test-ticket');
    if (!recorded) {
        throw new Error('Idempotency record intent failed');
    }
    console.log('✅ Payment intent recorded');

    // Try to record again - should fail
    const duplicate = idempotencyStore.recordIntent(paymentId, 'test-address', 10, 'test-ticket');
    if (duplicate !== false) {
        throw new Error('Idempotency failed to prevent duplicate');
    }
    console.log('✅ Duplicate payment blocked by idempotency');

    // Mark as broadcast
    idempotencyStore.recordBroadcast(paymentId, 'test-tx-123');
    const cannotSend = idempotencyStore.canSend(paymentId);
    if (cannotSend.canSend !== false) {
        throw new Error('Idempotency failed to block broadcast payment');
    }
    console.log('✅ Broadcast payment correctly blocked\n');

    console.log('## TEST 5: Cleanup\n');

    // Clean up
    ticketManager.removeTicket('ticket-channel-1');
    idempotencyStore.recordConfirmed(paymentId);

    const ticketGone = ticketManager.getTicket('ticket-channel-1');
    if (ticketGone !== null && ticketGone !== undefined) {
        throw new Error('Ticket cleanup failed');
    }
    console.log('✅ Ticket removed successfully\n');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('    ALL INTEGRATION TESTS PASSED');
    console.log('═══════════════════════════════════════════════════════════════\n');

    return true;
}

runTest()
    .then(() => {
        console.log('🏆 INTEGRATION TEST SUCCESSFUL - Core bot logic verified');
        process.exit(0);
    })
    .catch(error => {
        console.error('\n❌ INTEGRATION TEST FAILED:', error.message);
        console.error(error.stack);
        process.exit(1);
    });
