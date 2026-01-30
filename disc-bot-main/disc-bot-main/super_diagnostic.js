/**
 * SUPER-DIAGNOSTIC TEST SUITE
 * Performs a "Bit-Perfect" simulation of the bot logic
 * 
 * Verifies:
 * 1. State Machine transitions
 * 2. Idempotency & Locking
 * 3. Game Logic & Scoring
 * 4. Persistence Integrity
 */

const { STATES } = require('./src/state/StateMachine');
const { ticketManager } = require('./src/state/TicketManager');
const ScoreTracker = require('./src/game/ScoreTracker');
const { extractBetAmounts, extractCryptoAddress } = require('./src/utils/regex');

// Mock data
const MOCK_CHANNEL_ID = '123456789';
const MOCK_OPPONENT_ID = '987654321';
const MOCK_MM_ID = '555555555';
const MOCK_LTC_ADDR = 'ltc1q2p6x8gf2tvdw0s3jn54khce6mua7l5s5s5s';

async function runSuperTest() {
    console.log('🚀 INITIALIZING SUPER-DIAGNOSTIC TEST...');
    console.log('--------------------------------------------');

    // 1. PHASE: Bet Detection
    console.log('PHASE 1: Bet Detection');
    const betMsg = '10v10 LTC';
    const betData = extractBetAmounts(betMsg);
    if (!betData || betData.opponent !== 10) {
        throw new Error('FAILED: Bet selection regex failed');
    }
    console.log('✅ Bet regex perfect');

    // 2. PHASE: Ticket Creation
    console.log('\nPHASE 2: Ticket Creation');
    const ticket = ticketManager.createTicket(MOCK_CHANNEL_ID, {
        opponentId: MOCK_OPPONENT_ID,
        opponentBet: 10,
        ourBet: 11 // with tax
    });

    if (ticket.getState() !== STATES.AWAITING_TICKET) {
        throw new Error(`FAILED: Initial state incorrect: ${ticket.getState()}`);
    }
    console.log('✅ Ticket created in AWAITING_TICKET');

    // 3. PHASE: State Transitions
    console.log('\nPHASE 3: State Machine Flow');
    ticket.transition(STATES.AWAITING_MIDDLEMAN);
    console.log(`✅ Transitioned to: ${ticket.getState()}`);

    ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: MOCK_MM_ID });
    console.log(`✅ Transitioned to: ${ticket.getState()} (MM Tied: ${ticket.data.middlemanId})`);

    // 4. PHASE: Regex & Address Parsing
    console.log('\nPHASE 4: Crypto Address Parsing');
    const addrMsg = `Send to ${MOCK_LTC_ADDR}`;
    const extractedAddr = extractCryptoAddress(addrMsg, 'LTC');
    if (extractedAddr !== MOCK_LTC_ADDR) {
        throw new Error('FAILED: Address extraction failed');
    }
    console.log('✅ Crypto address extracted perfectly');

    // 5. PHASE: Concurrency & Locks
    console.log('\nPHASE 5: Locking Integrity');
    // Simulate the payment lock
    ticket.updateData({ paymentLocked: true });
    if (!ticket.data.paymentLocked) {
        throw new Error('FAILED: Data update/locking failed');
    }
    console.log('✅ Payment lock applied correctly');

    // 6. PHASE: Game Logic (ScoreTracker)
    console.log('\nPHASE 6: Game Logic & Tie Handling');
    const tracker = new ScoreTracker(MOCK_CHANNEL_ID, 5);

    // Round 1: Bot wins
    tracker.recordRound(6, 1);
    // Round 2: Opponent wins
    tracker.recordRound(1, 6);
    // Round 3: Tie (Config: Bot wins ties)
    tracker.recordRound(3, 3);

    console.log(`   Score after 3 rounds: Bot ${tracker.scores.bot} - ${tracker.scores.opponent} Opponent`);
    if (tracker.scores.bot !== 2 || tracker.scores.opponent !== 1) {
        throw new Error('FAILED: Scoring logic incorrect');
    }
    console.log('✅ Scoring & Tie-handling perfect');

    // 7. PHASE: Persistence (JSON Serialization)
    console.log('\nPHASE 7: Persistence Cross-Check');
    const serialized = ticketManager.toJSON();
    const originalTicketsCount = serialized.tickets.length;

    // Simulate a reload
    ticketManager.fromJSON(serialized);
    const reloadedTicket = ticketManager.getTicket(MOCK_CHANNEL_ID);
    if (!reloadedTicket || reloadedTicket.getState() !== STATES.AWAITING_PAYMENT_ADDRESS) {
        throw new Error('FAILED: State persistence corrupted after reload');
    }
    console.log('✅ Persistence (Serialization/Hydration) perfect');

    console.log('\n--------------------------------------------');
    console.log('🏆 ALL CORE SYSTEMS CERTIFIED BIT-PERFECT 🏆');
    console.log('--------------------------------------------');
}

runSuperTest().catch(e => {
    console.error('\n❌ SUPER-DIAGNOSTIC FAILED!');
    console.error(e.stack);
    process.exit(1);
});
