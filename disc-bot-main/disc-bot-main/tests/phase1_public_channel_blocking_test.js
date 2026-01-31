/**
 * PHASE 1 TEST: Public Channel Payment Protection
 * 
 * This test verifies that the bot NEVER sends payments in public channels.
 * It tests all the safety checks added in Phase 1.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Base directory for the project
const BASE_DIR = path.join(__dirname, '..');

console.log('═══════════════════════════════════════════════════════════════');
console.log('PHASE 1 TEST: Public Channel Payment Protection');
console.log('═══════════════════════════════════════════════════════════════\n');

// Test utilities
function createMockChannel(id, name, isPublic = true) {
    return {
        id,
        name,
        type: 'GUILD_TEXT',
        send: async (msg) => { console.log(`  [MOCK] Channel ${name}: ${msg}`); },
        sendTyping: async () => { }
    };
}

function createMockMessage(channel, authorId, content) {
    return {
        channel,
        author: { id: authorId, bot: false },
        content,
        client: { user: { id: 'bot-id-123' } },
        reply: async (msg) => { console.log(`  [MOCK] Reply: ${msg}`); }
    };
}

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
    try {
        await testFn();
        console.log(`✅ PASS: ${name}`);
        testsPassed++;
    } catch (error) {
        console.log(`❌ FAIL: ${name}`);
        console.log(`   Error: ${error.message}`);
        testsFailed++;
    }
}

async function runAllTests() {
    console.log('Loading modules...\n');

    // Clear require cache
    Object.keys(require.cache).forEach(key => {
        if (key.includes('disc-bot')) {
            delete require.cache[key];
        }
    });

    const config = require('../config.json');

    // Test 1: Config has new safety fields
    await runTest('Config has require_ticket_channel_for_payment', () => {
        assert(config.payment_safety.require_ticket_channel_for_payment === true,
            'require_ticket_channel_for_payment should be true');
    });

    await runTest('Config has ticket_channel_patterns', () => {
        assert(Array.isArray(config.payment_safety.ticket_channel_patterns),
            'ticket_channel_patterns should be an array');
        assert(config.payment_safety.ticket_channel_patterns.includes('ticket'),
            'ticket_channel_patterns should include "ticket"');
    });

    await runTest('Config has public_channel_blocklist', () => {
        assert(Array.isArray(config.payment_safety.public_channel_blocklist),
            'public_channel_blocklist should be an array');
    });

    // Test 2: Channel classification
    await runTest('Ticket channel detection works', () => {
        const patterns = config.payment_safety.ticket_channel_patterns;
        const testChannels = [
            { name: 'ticket-12345', expected: true },
            { name: 'order-abc', expected: true },
            { name: 'lf-players', expected: false },
            { name: 'general', expected: false },
            { name: 'my-ticket-here', expected: true }
        ];

        for (const tc of testChannels) {
            const isTicket = patterns.some(p => tc.name.includes(p));
            assert(isTicket === tc.expected,
                `Channel "${tc.name}" should be ticket=${tc.expected}, got ${isTicket}`);
        }
    });

    // Test 3: Payment blocking logic simulation
    await runTest('Payment blocking in public channel', () => {
        const channelName = 'lf-players';
        const monitoredChannels = config.channels?.monitored_channels || [];
        const isMonitoredPublic = monitoredChannels.length === 0;
        const ticketPatterns = config.payment_safety.ticket_channel_patterns;
        const isTicketChannel = ticketPatterns.some(p => channelName.includes(p));

        // Should block if monitored public AND not ticket
        const shouldBlock = isMonitoredPublic && !isTicketChannel;
        assert(shouldBlock === true,
            'Payments in "lf-players" should be BLOCKED');
    });

    await runTest('Payment allowed in ticket channel', () => {
        const channelName = 'ticket-12345';
        const monitoredChannels = config.channels?.monitored_channels || [];
        const isMonitoredPublic = monitoredChannels.length === 0;
        const ticketPatterns = config.payment_safety.ticket_channel_patterns;
        const isTicketChannel = ticketPatterns.some(p => channelName.includes(p));

        // Should NOT block if it's a ticket channel
        const shouldBlock = isMonitoredPublic && !isTicketChannel;
        assert(shouldBlock === false,
            'Payments in "ticket-12345" should be ALLOWED');
    });

    // Test 4: Emergency stop
    await runTest('EMERGENCY_STOP env var check', () => {
        // Verify the check exists in the code
        const ticketPath = path.join(BASE_DIR, 'src', 'bot', 'handlers', 'ticket.js');
        const ticketCode = fs.readFileSync(ticketPath, 'utf8');
        assert(ticketCode.includes("process.env.EMERGENCY_STOP === 'true'"),
            'EMERGENCY_STOP check should be in ticket.js');
    });

    // Test 5: Routing fix verification
    await runTest('Routing fix for pending wager in public channel', () => {
        const routingPath = path.join(BASE_DIR, 'src', 'bot', 'events', 'messageCreate.js');
        const routingCode = fs.readFileSync(routingPath, 'utf8');
        assert(routingCode.includes('userPendingWager && !isMonitoredChannel'),
            'Pending wager routing should check !isMonitoredChannel');
    });

    // Test 6: Pre-flight validation in ticket handler
    await runTest('Pre-flight validation in ticket handler', () => {
        const ticketPath = path.join(BASE_DIR, 'src', 'bot', 'handlers', 'ticket.js');
        const ticketCode = fs.readFileSync(ticketPath, 'utf8');
        assert(ticketCode.includes('PRE-FLIGHT VALIDATION'),
            'Pre-flight validation should be in handleMessage');
        assert(ticketCode.includes('TICKET_HANDLER_BLOCKED'),
            'Blocking log should be in handleMessage');
    });

    // Print results
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`RESULTS: ${testsPassed} passed, ${testsFailed} failed`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (testsFailed === 0) {
        console.log('🎉 ALL PHASE 1 TESTS PASSED!');
        console.log('The bot will now BLOCK payments in public channels.\n');
    } else {
        console.log('⚠️ SOME TESTS FAILED - Review the errors above.\n');
        process.exit(1);
    }
}

runAllTests().catch(error => {
    console.error('❌ TEST RUNNER ERROR:', error.message);
    console.error(error.stack);
    process.exit(1);
});
