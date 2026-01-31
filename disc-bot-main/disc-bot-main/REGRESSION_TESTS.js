/**
 * REGRESSION TESTS FOR ORIGINAL BUGS
 * ===================================
 * These tests capture the EXACT bugs that were reported:
 * 
 * BUG 1: Duplicate replies to the same message
 * BUG 2: Cooldowns/response delays ignored (8s human cooldown, 2s min response delay)
 * BUG 3: Unpredictable behavior (sometimes too fast, sometimes silent)
 * 
 * If ANY of these tests fail, the corresponding bug has returned.
 * These tests must pass before ANY deployment.
 */

const assert = require('assert');

// ═══════════════════════════════════════════════════════════════════════════
// TEST INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

const responseTracker = {
    byMessageId: new Map(),
    timings: [],

    reset() {
        this.byMessageId.clear();
        this.timings = [];
    },

    recordResponse(messageId, timestamp) {
        const count = (this.byMessageId.get(messageId) || 0) + 1;
        this.byMessageId.set(messageId, count);
        this.timings.push({ messageId, timestamp });
    },

    getResponseCount(messageId) {
        return this.byMessageId.get(messageId) || 0;
    }
};

class MockChannel {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.type = 0;
    }
    send(content) {
        return Promise.resolve({ id: `sent-${Date.now()}`, content });
    }
    sendTyping() {
        return Promise.resolve();
    }
}

class MockMessage {
    constructor(id, content, channel, author) {
        this.id = id;
        this.content = content;
        this.channel = channel;
        this.author = author;
        this.client = { user: { id: 'bot-123' } };
        this._createdAt = Date.now();
    }

    reply(content) {
        responseTracker.recordResponse(this.id, Date.now());
        return Promise.resolve({ id: `reply-${Date.now()}`, content });
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════════════════════════════════════

process.env.IS_VERIFICATION = 'false'; // Use real delays for timing tests
process.env.DEBUG = '1';

let handleMessageCreate, ticketManager;

const results = { passed: 0, failed: 0, errors: [] };

async function test(name, fn) {
    try {
        await fn();
        results.passed++;
        console.log(`✅ PASS: ${name}`);
    } catch (e) {
        results.failed++;
        results.errors.push({ name, error: e.message });
        console.log(`❌ FAIL: ${name}`);
        console.log(`   └─ ${e.message}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUG 1 REGRESSION TESTS: DUPLICATE REPLIES
// ═══════════════════════════════════════════════════════════════════════════

async function testBug1_DuplicateReplies() {
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║  BUG 1: DUPLICATE REPLIES TO SAME MESSAGE                         ║');
    console.log('║  Original symptom: Bot replied twice to the same bet message      ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

    // Test 1.1: Same message object processed twice
    await test('BUG1.1: Same message object → exactly 1 reply', async () => {
        responseTracker.reset();
        ticketManager.cooldowns.clear();

        const channel = new MockChannel('pub-bug1-1', 'bets');
        const msg = new MockMessage('bug1-msg-1', '10v10 ltc', channel, { id: 'user-bug1', username: 'Tester' });

        // Process same message multiple times (simulates event double-fire)
        await handleMessageCreate(msg);
        await handleMessageCreate(msg);
        await handleMessageCreate(msg);

        const count = responseTracker.getResponseCount(msg.id);
        assert.strictEqual(count, 1, `Expected exactly 1 reply, got ${count} replies`);
    });

    // Test 1.2: Different message objects with same ID (Discord duplicate event)
    await test('BUG1.2: Same message ID, different objects → exactly 1 reply', async () => {
        responseTracker.reset();
        ticketManager.cooldowns.clear();

        const channel = new MockChannel('pub-bug1-2', 'bets');
        const messageId = 'duplicate-event-123';

        const msg1 = new MockMessage(messageId, '15v15', channel, { id: 'user-bug1-2', username: 'Tester' });
        const msg2 = new MockMessage(messageId, '15v15', channel, { id: 'user-bug1-2', username: 'Tester' });
        const msg3 = new MockMessage(messageId, '15v15', channel, { id: 'user-bug1-2', username: 'Tester' });

        await handleMessageCreate(msg1);
        await handleMessageCreate(msg2);
        await handleMessageCreate(msg3);

        const count = responseTracker.getResponseCount(messageId);
        assert.strictEqual(count, 1, `Expected exactly 1 reply, got ${count} replies`);
    });

    // Test 1.3: Race condition - 5 concurrent processes of same message ID
    await test('BUG1.3: Concurrent race condition → exactly 1 reply', async () => {
        responseTracker.reset();
        ticketManager.cooldowns.clear();

        const channel = new MockChannel('pub-bug1-3', 'bets');
        const messageId = 'race-condition-456';

        // Fire 5 events simultaneously (simulates race condition)
        const promises = [];
        for (let i = 0; i < 5; i++) {
            const msg = new MockMessage(messageId, '20v20', channel, { id: 'user-bug1-3', username: 'Racer' });
            promises.push(handleMessageCreate(msg));
        }
        await Promise.all(promises);

        const count = responseTracker.getResponseCount(messageId);
        assert.strictEqual(count, 1, `Race condition produced ${count} replies (expected 1)`);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// BUG 2 REGRESSION TESTS: COOLDOWN/DELAY VIOLATIONS
// ═══════════════════════════════════════════════════════════════════════════

async function testBug2_CooldownViolations() {
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║  BUG 2: COOLDOWNS/DELAYS IGNORED                                  ║');
    console.log('║  Original symptom: 8s cooldown violated, 2s delay not enforced   ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

    // Test 2.1: 2000ms minimum response delay
    await test('BUG2.1: Response delay >= 2000ms', async () => {
        responseTracker.reset();
        ticketManager.cooldowns.clear();

        const channel = new MockChannel('pub-bug2-1', 'bets');
        const msg = new MockMessage('delay-test-1', '10v10', channel, { id: 'user-bug2-1', username: 'Timer' });

        const startTime = Date.now();
        await handleMessageCreate(msg);
        const elapsed = Date.now() - startTime;

        assert.strictEqual(elapsed >= 2000, true,
            `Response delay was ${elapsed}ms, must be >= 2000ms`);
    });

    // Test 2.2: Same user blocked within 8000ms cooldown
    await test('BUG2.2: Same user blocked within 8000ms cooldown', async () => {
        responseTracker.reset();
        ticketManager.cooldowns.clear();

        const channel = new MockChannel('pub-bug2-2', 'bets');
        const userId = 'cooldown-user';

        // First message should succeed
        const msg1 = new MockMessage('cooldown-1', '10v10', channel, { id: userId, username: 'Spammer' });
        await handleMessageCreate(msg1);
        const firstCount = responseTracker.byMessageId.size;

        // Rapid-fire 5 more messages immediately - should all be blocked
        for (let i = 0; i < 5; i++) {
            const msg = new MockMessage(`cooldown-rapid-${i}`, '10v10', channel, { id: userId, username: 'Spammer' });
            await handleMessageCreate(msg);
        }

        const totalResponses = [...responseTracker.byMessageId.values()].reduce((a, b) => a + b, 0);
        assert.strictEqual(totalResponses, 1,
            `Cooldown violated: ${totalResponses} responses instead of 1`);
    });

    // Test 2.3: Different users NOT affected by each other's cooldowns
    await test('BUG2.3: Different users have independent cooldowns', async () => {
        responseTracker.reset();
        ticketManager.cooldowns.clear();

        const channel = new MockChannel('pub-bug2-3', 'bets');

        // User A sends message
        const msgA = new MockMessage('userA-1', '10v10', channel, { id: 'userA', username: 'Alice' });
        await handleMessageCreate(msgA);

        // User B sends message immediately after - should NOT be blocked
        const msgB = new MockMessage('userB-1', '15v15', channel, { id: 'userB', username: 'Bob' });
        await handleMessageCreate(msgB);

        const countA = responseTracker.getResponseCount('userA-1');
        const countB = responseTracker.getResponseCount('userB-1');

        assert.strictEqual(countA, 1, `User A should get 1 response, got ${countA}`);
        assert.strictEqual(countB, 1, `User B should get 1 response, got ${countB}`);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// BUG 3 REGRESSION TESTS: UNPREDICTABLE BEHAVIOR
// ═══════════════════════════════════════════════════════════════════════════

async function testBug3_UnpredictableBehavior() {
    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║  BUG 3: UNPREDICTABLE BEHAVIOR                                    ║');
    console.log('║  Original symptom: Sometimes fast, sometimes silent, random       ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

    // Test 3.1: Valid bet ALWAYS gets a response
    await test('BUG3.1: Valid bet always gets response (no silent drops)', async () => {
        responseTracker.reset();
        ticketManager.cooldowns.clear();

        const bets = ['10v10', '15v15 ltc', '20 vs 20', '$25v25'];
        let successCount = 0;

        for (let i = 0; i < bets.length; i++) {
            const channel = new MockChannel(`pub-bug3-${i}`, 'bets');
            const msg = new MockMessage(`bet-${i}`, bets[i], channel, { id: `user-bet-${i}`, username: 'Better' });
            await handleMessageCreate(msg);
            if (responseTracker.getResponseCount(msg.id) === 1) successCount++;
        }

        assert.strictEqual(successCount, bets.length,
            `Only ${successCount}/${bets.length} bets got responses`);
    });

    // Test 3.2: Invalid content NEVER gets a bet response
    await test('BUG3.2: Invalid content never triggers bet response', async () => {
        responseTracker.reset();
        ticketManager.cooldowns.clear();

        const invalidMessages = ['hello', 'how are you', 'gg', 'nice game', ''];

        for (let i = 0; i < invalidMessages.length; i++) {
            const channel = new MockChannel(`pub-invalid-${i}`, 'bets');
            const msg = new MockMessage(`invalid-${i}`, invalidMessages[i], channel, { id: `user-invalid-${i}`, username: 'Chatter' });
            await handleMessageCreate(msg);
        }

        const totalResponses = [...responseTracker.byMessageId.values()].reduce((a, b) => a + b, 0);
        assert.strictEqual(totalResponses, 0,
            `Invalid messages triggered ${totalResponses} responses (expected 0)`);
    });

    // Test 3.3: Consistency over 20 iterations
    await test('BUG3.3: Consistent behavior over 20 iterations', async () => {
        responseTracker.reset();

        let successCount = 0;
        for (let i = 0; i < 20; i++) {
            responseTracker.reset();
            ticketManager.cooldowns.clear();

            const channel = new MockChannel(`pub-consistent-${i}`, 'bets');
            const msg = new MockMessage(`consist-${i}`, '10v10', channel, { id: `user-consist-${i}`, username: `Tester${i}` });
            await handleMessageCreate(msg);

            if (responseTracker.getResponseCount(msg.id) === 1) successCount++;
        }

        assert.strictEqual(successCount, 20,
            `Only ${successCount}/20 iterations succeeded (must be 20/20)`);
    });
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║            REGRESSION TESTS FOR ORIGINAL BUGS                     ║');
    console.log('║            These MUST pass before any deployment                  ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('Testing the EXACT bugs that were reported:');
    console.log('  - BUG 1: Duplicate replies to same message');
    console.log('  - BUG 2: Cooldowns/delays ignored');
    console.log('  - BUG 3: Unpredictable behavior');
    console.log('');

    // Load modules
    try {
        handleMessageCreate = require('./src/bot/events/messageCreate');
        const TM = require('./src/state/TicketManager');
        ticketManager = TM.ticketManager;
    } catch (e) {
        console.error('❌ FATAL: Failed to load modules:', e.message);
        process.exit(1);
    }

    await testBug1_DuplicateReplies();
    await testBug2_CooldownViolations();
    await testBug3_UnpredictableBehavior();

    console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║                      REGRESSION TEST RESULTS                      ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`Total: ${results.passed} PASSED, ${results.failed} FAILED`);

    if (results.failed > 0) {
        console.log('');
        console.log('REGRESSIONS DETECTED:');
        for (const err of results.errors) {
            console.log(`  ❌ ${err.name}: ${err.error}`);
        }
        console.log('');
        console.log('╔═══════════════════════════════════════════════════════════════════╗');
        console.log('║       ❌ ORIGINAL BUGS HAVE RETURNED - DO NOT DEPLOY ❌           ║');
        console.log('╚═══════════════════════════════════════════════════════════════════╝');
        process.exit(1);
    } else {
        console.log('');
        console.log('╔═══════════════════════════════════════════════════════════════════╗');
        console.log('║       ✅ ALL ORIGINAL BUGS REMAIN FIXED ✅                        ║');
        console.log('╚═══════════════════════════════════════════════════════════════════╝');
        process.exit(0);
    }
}

main().catch(e => {
    console.error('Test runner crashed:', e);
    process.exit(1);
});
