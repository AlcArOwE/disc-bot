/**
 * COMPREHENSIVE END-TO-END INTEGRATION TEST
 * Simulates ACTUAL Discord messages flowing through the entire system
 * From: Public channel discovery → Ticket creation → Payment → Game → Vouch
 */

const { logger } = require('../src/utils/logger');
const config = require('../config.json');

console.log('═══════════════════════════════════════════════════════════════');
console.log('    COMPREHENSIVE E2E INTEGRATION TEST - STARTING');
console.log('═══════════════════════════════════════════════════════════════\n');

// Mock Discord structures
function createMockMessage(content, authorId, channelId, channelName = 'test-channel', isBot = false) {
    return {
        id: `msg-${Date.now()}-${Math.random()}`,
        content,
        author: {
            id: authorId,
            username: `User${authorId}`,
            bot: isBot
        },
        channel: {
            id: channelId,
            name: channelName,
            type: 'GUILD_TEXT',
            send: async (msg) => {
                console.log(`  📤 Bot → ${channelName}: ${msg.slice(0, 80)}`);
                return createMockMessage(msg, 'bot-id', channelId, channelName);
            },
            sendTyping: async () => { }
        },
        client: {
            user: { id: 'bot-id' }
        },
        reply: async (msg) => {
            console.log(`  📤 Bot reply: ${msg.slice(0, 80)}`);
            return createMockMessage(msg, 'bot-id', channelId, channelName);
        }
    };
}

async function runIntegrationTest() {
    const { ticketManager } = require('../src/state/TicketManager');
    const { messageQueue } = require('../src/utils/MessageQueue');
    const handleMessageCreate = require('../src/bot/events/messageCreate');

    console.log('## PHASE 1: PUBLIC CHANNEL BET DISCOVERY\n');

    // User posts bet in monitored public channel
    const publicChannelId = 'public-channel-123';
    const userId = 'opponent-user-456';
    const betMessage = createMockMessage('anyone 10v10?', userId, publicChannelId, 'general');

    console.log(`📨 User posts: "${betMessage.content}"`);
    await handleMessageCreate(betMessage);

    // Verify pending wager was stored
    const pendingWager = ticketManager.peekPendingWager(userId);
    if (!pendingWager) {
        throw new Error('❌ FAIL: Pending wager not stored after discovery');
    }
    console.log(`✅ Pending wager stored: $${pendingWager.opponentBet} vs $${pendingWager.ourBet}\n`);

    console.log('## PHASE 2: MIDDLEMAN CREATES TICKET\n');

    // Middleman creates a ticket channel
    const ticketChannelId = 'ticket-789';
    const middlemanId = config.middleman_ids[0];
    const mmCreateMsg = createMockMessage('Ticket created', middlemanId, ticketChannelId, 'ticket-123');

    console.log(`📨 Middleman in ticket: "${mmCreateMsg.content}"`);
    await handleMessageCreate(mmCreateMsg);

    // Verify ticket was created
    let ticket = ticketManager.getTicket(ticketChannelId);
    if (!ticket) {
        throw new Error('❌ FAIL: Ticket not created');
    }
    console.log(`✅ Ticket created in state: ${ticket.state}`);
    console.log(`   Opponent bet: $${ticket.data.opponentBet}, Our bet: $${ticket.data.ourBet}\n`);

    console.log('## PHASE 3: MIDDLEMAN SENDS PAYMENT ADDRESS\n');

    // Verify ticket transitioned to AWAITING_PAYMENT_ADDRESS
    if (ticket.state !== 'AWAITING_PAYMENT_ADDRESS') {
        console.log(`⚠️  WARNING: Ticket in state ${ticket.state}, expected AWAITING_PAYMENT_ADDRESS`);
    }

    // Middleman sends crypto address (NOT the bot's own address)
    const addressMsg = createMockMessage(
        'Send to LTC1aaabbbcccdddeeefff123456789',  // Different address for testing
        middlemanId,
        ticketChannelId,
        'ticket-123'
    );

    console.log(`📨 Middleman sends address: "${addressMsg.content}"`);

    // Mock the payment sending (since we're in DRY-RUN)
    const { idempotencyStore } = require('../src/state/IdempotencyStore');
    const paymentId = idempotencyStore.generatePaymentId(ticketChannelId, 'LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ', 12);

    console.log(`💸 Payment intent recorded: ${paymentId}`);

    // Simulate payment success
    await handleMessageCreate(addressMsg);

    // Refresh ticket
    ticket = ticketManager.getTicket(ticketChannelId);
    console.log(`✅ Ticket state after payment: ${ticket.state}`);

    if (ticket.data.paymentLocked) {
        console.log(`✅ Payment locked to prevent double-send\n`);
    }

    console.log('## PHASE 4: GAME START & PROGRESSION\n');

    // Middleman confirms payment and starts game
    const confirmMsg = createMockMessage('Both paid, gl!', middlemanId, ticketChannelId, 'ticket-123');
    console.log(`📨 Middleman: "${confirmMsg.content}"`);
    await handleMessageCreate(confirmMsg);

    ticket = ticketManager.getTicket(ticketChannelId);
    console.log(`✅ Ticket state after game start: ${ticket.state}\n`);

    // Simulate dice rolls (FT5 game)
    console.log('🎲 Simulating FT5 dice game...');

    const diceResults = [
        { bot: 6, opp: 3 },  // Bot wins
        { bot: 5, opp: 5 },  // Tie - bot wins
        { bot: 4, opp: 2 },  // Bot wins
        { bot: 6, opp: 1 },  // Bot wins
        { bot: 6, opp: 4 }   // Bot wins (5-0)
    ];

    for (let i = 0; i < diceResults.length; i++) {
        const { bot, opp } = diceResults[i];

        // Opponent rolls
        const oppRollMsg = createMockMessage(
            `rolled a ${opp}`,
            'dice-bot',
            ticketChannelId,
            'ticket-123',
            true
        );
        await handleMessageCreate(oppRollMsg);

        // Bot rolls
        const botRollMsg = createMockMessage(
            `rolled a ${bot}`,
            'bot-id',
            ticketChannelId,
            'ticket-123'
        );
        await handleMessageCreate(botRollMsg);

        ticket = ticketManager.getTicket(ticketChannelId);
        if (ticket.data.gameScores) {
            console.log(`  Round ${i + 1}: Bot ${bot} vs Opp ${opp} → Score: ${ticket.data.gameScores.bot}-${ticket.data.gameScores.opponent}`);
        }
    }

    ticket = ticketManager.getTicket(ticketChannelId);
    console.log(`\n✅ Game complete. Final state: ${ticket.state}`);

    if (ticket.data.gameScores) {
        console.log(`   Final score: ${ticket.data.gameScores.bot}-${ticket.data.gameScores.opponent}`);
        console.log(`   Winner: ${ticket.data.gameScores.bot >= 5 ? 'BOT' : 'OPPONENT'}\n`);
    }

    console.log('## PHASE 5: VOUCH POSTING\n');

    // Bot should post vouch automatically
    // (In real scenario, this happens in ticket handler)
    if (ticket.state === 'GAME_COMPLETE') {
        console.log(`✅ Ticket reached GAME_COMPLETE state successfully`);
        console.log(`   Vouch would be posted to channel: ${config.channels?.vouch_channel_id || 'NOT_CONFIGURED'}\n`);
    } else {
        console.log(`⚠️  WARNING: Ticket in state ${ticket.state}, expected GAME_COMPLETE\n`);
    }

    console.log('## VERIFICATION CHECKS\n');

    const checks = [
        {
            name: 'Pending wager stored',
            pass: pendingWager !== null
        },
        {
            name: 'Ticket created and linked',
            pass: ticket !== null && ticket.data.opponentBet === 10
        },
        {
            name: 'Payment address detected',
            pass: ticket.data.paymentLocked === true
        },
        {
            name: 'Game progressed to completion',
            pass: ticket.state === 'GAME_COMPLETE'
        },
        {
            name: 'Final score tracked',
            pass: ticket.data.gameScores?.bot >= 5
        }
    ];

    let passed = 0;
    let failed = 0;

    checks.forEach(check => {
        if (check.pass) {
            console.log(`✅ ${check.name}`);
            passed++;
        } else {
            console.log(`❌ ${check.name}`);
            failed++;
        }
    });

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log(`    INTEGRATION TEST COMPLETE`);
    console.log(`    PASSED: ${passed} | FAILED: ${failed}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (failed === 0) {
        console.log('🏆 END-TO-END FLOW VERIFIED - ALL PHASES SUCCESSFUL');

        // Cleanup
        ticketManager.removeTicket(ticketChannelId);

        return true;
    } else {
        console.log('⚠️  INTEGRATION TEST FAILED - Review failures above');
        return false;
    }
}

// Run the test
runIntegrationTest()
    .then(success => {
        process.exit(success ? 0 : 1);
    })
    .catch(error => {
        console.error('\n❌ CRITICAL ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    });
