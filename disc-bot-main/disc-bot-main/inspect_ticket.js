const { ticketManager } = require('./src/state/TicketManager');
const { logger } = require('./src/utils/logger');

async function checkTicket() {
    const targetChannelId = '1467136842087534643';
    console.log(`--- TICKET INSPECTION: ${targetChannelId} ---`);

    const activeTickets = ticketManager.getActiveTickets();
    console.log(`Total Active Tickets: ${activeTickets.length}`);

    const ticket = ticketManager.getTicket(targetChannelId);
    if (ticket) {
        console.log('✅ Ticket FOUND in memory:');
        console.log(JSON.stringify(ticket.data, null, 2));
        console.log(`State: ${ticket.state}`);
    } else {
        console.log('❌ Ticket NOT FOUND in memory.');
        console.log('Active Channel IDs:', activeTickets.map(t => t.channelId).join(', '));
    }

    const pendingWagers = Array.from(ticketManager.pendingWagers.entries());
    console.log(`Pending Wagers (${pendingWagers.length}):`);
    pendingWagers.forEach(([userId, data]) => {
        console.log(` - User ${userId}: ${data.opponentBet}v${data.ourBet}`);
    });
}

checkTicket().catch(console.error);
