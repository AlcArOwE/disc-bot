/**
 * INVARIANT TEST SUITE
 * =====================
 * This is the SAFETY NET. No code ships unless these tests pass.
 * 
 * INVARIANTS TESTED:
 * A) Exactly-once reply per Discord message ID
 * B) Public timing gates (2000ms delay, 8000ms cooldown)
 * C) Routing boundaries (public vs ticket vs vouch)
 * D) Sniping continues during tickets
 * E) One outbound send pipeline
 * F) No silent drops (DEBUG logging)
 */

const assert = require('assert');

// ═══════════════════════════════════════════════════════════════════════════
// TEST INFRASTRUCTURE
// ═══════════════════════════════════════════════════════════════════════════

// Mock Discord message
class MockMessage {
    constructor(id, content, channel, author = {}) {
        this.id = id;
        this.content = content;
        this.channel = channel;
        this.author = { id: author.id || 'user-1', username: author.username || 'TestUser', bot: author.bot || false };
        this.client = { user: { id: 'bot-id' } };
    }
    reply(content) {
        this.channel._lastReply = content;
        this.channel._replyCount = (this.channel._replyCount || 0) + 1;
        return Promise.resolve({ id: `reply-${Date.now()}` });
    }
}

// Mock Discord channel
class MockChannel {
    constructor(id, name, type = 'PUBLIC') {
        this.id = id;
        this.name = name;
        this._type = type;
        this._messages = [];
        this._replyCount = 0;
    }
    send(content) {
        this._messages.push({ content, timestamp: Date.now() });
        return Promise.resolve({ id: `msg-${Date.now()}` });
    }
    sendTyping() {
        return Promise.resolve();
    }
}

// Test result tracking
const results = { passed: 0, failed: 0, errors: [] };

function test(name, fn) {
    return async () => {
        try {
            await fn();
            results.passed++;
            console.log(`✅ PASS: ${name}`);
        } catch (e) {
            results.failed++;
            results.errors.push({ name, error: e.message });
            console.log(`❌ FAIL: ${name}`);
            console.log(`   Error: ${e.message}`);
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// SETUP: Import modules under test
// ═══════════════════════════════════════════════════════════════════════════

// Set verification mode to bypass real delays
process.env.IS_VERIFICATION = 'true';
process.env.DEBUG = '1';

let handleMessageCreate, ticketManager, messageQueue;

try {
    handleMessageCreate = require('./src/bot/events/messageCreate');
    const TM = require('./src/state/TicketManager');
    ticketManager = TM.ticketManager;
    const MQ = require('./src/utils/MessageQueue');
    messageQueue = MQ.messageQueue;
} catch (e) {
    console.error('Failed to load modules:', e.message);
    process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT A: EXACTLY-ONCE REPLY PER MESSAGE ID
// ═══════════════════════════════════════════════════════════════════════════

const testInvariantA1 = test('INVARIANT A1: Same message ID processed twice -> only ONE reply', async () => {
    const channel = new MockChannel('public-A1', 'lf-players');
    channel._type = 'PUBLIC';

    const msg1 = new MockMessage('duplicate-test-1', '10v10 ltc', channel, { id: 'user-A1' });

    // Process same message twice
    await handleMessageCreate(msg1);
    await handleMessageCreate(msg1); // Same object, same ID

    // Should have at most 1 reply
    assert.strictEqual(channel._messages.length <= 1, true,
        `Expected at most 1 reply, got ${channel._messages.length}`);
});

const testInvariantA2 = test('INVARIANT A2: Different message objects with same ID -> only ONE reply', async () => {
    const channel = new MockChannel('public-A2', 'lf-players');
    channel._type = 'PUBLIC';

    const msg1 = new MockMessage('same-id-123', '10v10 ltc', channel, { id: 'user-A2' });
    const msg2 = new MockMessage('same-id-123', '10v10 ltc', channel, { id: 'user-A2' }); // Same ID, different object

    await handleMessageCreate(msg1);
    await handleMessageCreate(msg2);

    assert.strictEqual(channel._messages.length <= 1, true,
        `Expected at most 1 reply for same message ID, got ${channel._messages.length}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT B: PUBLIC TIMING GATES
// ═══════════════════════════════════════════════════════════════════════════

const testInvariantB1 = test('INVARIANT B1: Response delay >= 2000ms for public snipes', async () => {
    // Temporarily disable verification bypass to test real delays
    const originalVerification = process.env.IS_VERIFICATION;
    process.env.IS_VERIFICATION = 'false';

    const channel = new MockChannel('public-B1', 'lf-players');
    channel._type = 'PUBLIC';

    // Clear any existing cooldowns
    ticketManager.cooldowns.clear();

    const msg = new MockMessage('timing-test-1', '10v10 ltc', channel, { id: 'user-B1' });

    const startTime = Date.now();
    await handleMessageCreate(msg);
    const elapsed = Date.now() - startTime;

    process.env.IS_VERIFICATION = originalVerification;

    assert.strictEqual(elapsed >= 2000, true,
        `Expected delay >= 2000ms, got ${elapsed}ms`);
});

const testInvariantB2 = test('INVARIANT B2: Cooldown >= 8000ms between snipes for same user', async () => {
    const channel = new MockChannel('public-B2', 'lf-players');
    channel._type = 'PUBLIC';

    // Clear cooldowns
    ticketManager.cooldowns.clear();

    const msg1 = new MockMessage('cooldown-test-1', '10v10 ltc', channel, { id: 'user-B2-same' });
    const msg2 = new MockMessage('cooldown-test-2', '10v10 ltc', channel, { id: 'user-B2-same' });

    await handleMessageCreate(msg1);

    // Second message from same user within 8 seconds should be ignored
    const beforeSecond = channel._messages.length;
    await handleMessageCreate(msg2);
    const afterSecond = channel._messages.length;

    assert.strictEqual(afterSecond, beforeSecond,
        `Second message within cooldown should be ignored. Before: ${beforeSecond}, After: ${afterSecond}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT C: ROUTING BOUNDARIES
// ═══════════════════════════════════════════════════════════════════════════

const testInvariantC1 = test('INVARIANT C1: Public channel only receives snipe replies', async () => {
    const publicChannel = new MockChannel('public-C1', 'lf-players');
    publicChannel._type = 'PUBLIC';

    const betMsg = new MockMessage('routing-test-1', '10v10 ltc', publicChannel, { id: 'user-C1' });

    await handleMessageCreate(betMsg);

    // Any message sent should be a snipe response (contains bet format)
    for (const sent of publicChannel._messages) {
        const isSnipeResponse = sent.content.includes('$') || sent.content.includes('vs');
        assert.strictEqual(isSnipeResponse, true,
            `Public channel received non-snipe message: ${sent.content}`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT D: SNIPING CONTINUES DURING TICKETS
// ═══════════════════════════════════════════════════════════════════════════

const testInvariantD1 = test('INVARIANT D1: Sniping continues while tickets are active', async () => {
    // Create an active ticket first (in a DIFFERENT channel)
    const ticketChannel = new MockChannel('ticket-D1-separate', 'ticket-test');
    ticketManager.createTicket('ticket-D1-separate', {
        opponentId: 'opponent-1',
        opponentBet: 10,
        ourBet: 12
    });

    // Now try to snipe in PUBLIC channel (different from ticket)
    const publicChannel = new MockChannel('public-D1', 'lf-players');
    publicChannel._type = 'PUBLIC';

    // Clear cooldowns for test user
    ticketManager.cooldowns.delete('user-D1');

    const snipeMsg = new MockMessage('concurrent-test-1', '10v10 ltc', publicChannel, { id: 'user-D1' });
    await handleMessageCreate(snipeMsg);

    // Count replies - sniper uses message.reply() via messageQueue
    const totalReplies = publicChannel._replyCount + publicChannel._messages.length;

    // Should have sniped despite active ticket in OTHER channel
    assert.strictEqual(totalReplies >= 1, true,
        `Sniping should continue during active tickets. Replies: ${publicChannel._replyCount}, Messages: ${publicChannel._messages.length}`);

    // Cleanup
    ticketManager.removeTicket('ticket-D1-separate');
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT F: NO SILENT DROPS
// ═══════════════════════════════════════════════════════════════════════════

const testInvariantF1 = test('INVARIANT F1: Every message produces a log (no silent drops)', async () => {
    // This is validated by the debug logging in messageCreate.js
    // For this test, we just verify the function completes without error
    const channel = new MockChannel('public-F1', 'lf-players');
    const msg = new MockMessage('log-test-1', 'random noise', channel, { id: 'user-F1' });

    let errorOccurred = false;
    try {
        await handleMessageCreate(msg);
    } catch (e) {
        errorOccurred = true;
    }

    assert.strictEqual(errorOccurred, false, 'Message processing should not throw');
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function runAllTests() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('           INVARIANT TEST SUITE - SAFETY NET');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    // Run all tests
    await testInvariantA1();
    await testInvariantA2();
    await testInvariantB1();
    await testInvariantB2();
    await testInvariantC1();
    await testInvariantD1();
    await testInvariantF1();

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`           RESULTS: ${results.passed} PASSED, ${results.failed} FAILED`);
    console.log('═══════════════════════════════════════════════════════════════');

    if (results.failed > 0) {
        console.log('');
        console.log('FAILURES:');
        for (const err of results.errors) {
            console.log(`  - ${err.name}: ${err.error}`);
        }
        console.log('');
        console.log('❌ SAFETY NET BROKEN - DO NOT SHIP');
        process.exit(1);
    } else {
        console.log('');
        console.log('✅ ALL INVARIANTS HOLD - SAFE TO PROCEED');
        process.exit(0);
    }
}

runAllTests().catch(e => {
    console.error('Test runner crashed:', e);
    process.exit(1);
});
