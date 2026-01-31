/**
 * TEST: Verify bot NEVER sends payments in public/monitored channels
 * Only processes payments in ticket channels
 */

const assert = require('assert');

console.log('═══════════════════════════════════════════════════════════');
console.log('TEST: Public Channel Payment Protection');
console.log('═══════════════════════════════════════════════════════════\n');

// Mock Discord message
class MockMessage {
    constructor(channelId, channelName, authorId, content) {
        this.channel = {
            id: channelId,
            name: channelName,
            type: 'GUILD_TEXT',
            send: async (msg) => console.log(`[MOCK SEND] ${msg}`),
            sendTyping: async () => { }
        };
        this.author = {
            id: authorId,
            bot: false
        };
        this.content = content;
        this.client = {
            user: { id: 'bot-id' }
        };
    }

    reply(msg) {
        console.log(`[MOCK REPLY] ${msg}`);
    }
}

async function testPublicChannelProtection() {
    // Load the handler
    const messageCreate = require('./src/bot/events/messageCreate');
    const { ticketManager } = require('./src/state/TicketManager');

    console.log('## TEST 1: Middleman posts address in PUBLIC channel\n');

    // Middleman ID from config
    const middlemanId = '1112921418930331819';

    // PUBLIC CHANNEL (monitored)
    const publicMsg = new MockMessage(
        'public-channel-123',
        'lf-players', // Public channel name
        middlemanId,  // From middleman
        'Send to LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ' // Address
    );

    // Clear any existing tickets
    ticketManager.tickets.clear();

    // Process message
    await messageCreate(publicMsg);

    // Verify NO ticket was created
    const ticket = ticketManager.getTicket('public-channel-123');
    assert(!ticket, '❌ FAILED: Ticket was created in public channel!');

    console.log('✅ PASS: No ticket created in public channel\n');

    console.log('## TEST 2: Middleman posts address in TICKET channel\n');

    // TICKET CHANNEL
    const ticketMsg = new MockMessage(
        'ticket-channel-456',
        'ticket-abc123', // Ticket channel name
        middlemanId,
        'Send to LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ'
    );

    // Process message
    await messageCreate(ticketMsg);

    // Verify ticket WAS created
    const ticketCreated = ticketManager.getTicket('ticket-channel-456');
    assert(ticketCreated, '❌ FAILED: Ticket was NOT created in ticket channel!');

    console.log('✅ PASS: Ticket correctly created in ticket channel\n');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ ALL TESTS PASSED - Public channel protection working!');
    console.log('═══════════════════════════════════════════════════════════\n');
}

testPublicChannelProtection().catch(error => {
    console.error('❌ TEST FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
});
