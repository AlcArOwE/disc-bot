const { test } = require('node:test');
const assert = require('node:assert');
const { ticketManager } = require('../src/state/TicketManager');

test('TicketManager Performance', async (t) => {
    await t.test('should handle O(1) lookup with many tickets', () => {
        // Cleanup
        ticketManager.tickets.clear();
        ticketManager.userIndex.clear();

        // Create 1000 tickets
        const count = 1000;

        for (let i = 0; i < count; i++) {
            ticketManager.createTicket(`channel-${i}`, {
                opponentId: `user-${i}`,
                opponentBet: 10,
                ourBet: 10
            });
        }

        // Lookup specific user
        const targetUser = 'user-500';
        const startLookup = process.hrtime();

        const ticket = ticketManager.getTicketByUser(targetUser);

        const endLookup = process.hrtime(startLookup);
        const lookupTimeMs = endLookup[1] / 1000000;

        assert.ok(ticket, 'Should find ticket');
        assert.strictEqual(ticket.data.opponentId, targetUser);

        // Assert lookup is fast
        assert.ok(lookupTimeMs < 5, `Lookup took ${lookupTimeMs}ms, should be < 5ms`);

        // Cleanup test
        ticketManager.removeTicket(`channel-500`);
        const removedTicket = ticketManager.getTicketByUser(targetUser);
        assert.strictEqual(removedTicket, undefined, 'Should not find removed ticket');
    });
});
