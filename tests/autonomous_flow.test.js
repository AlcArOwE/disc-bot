const { test } = require('node:test');
const assert = require('node:assert');
const ScoreTracker = require('../src/game/ScoreTracker');
const { TicketManager } = require('../src/state/TicketManager');

test('Autonomous Flow - Game Logic', async (t) => {
    await t.test('ScoreTracker should handle Bot Goes First (Pending Roll)', () => {
        const tracker = new ScoreTracker('test-ticket');

        // Bot rolls first
        tracker.setPendingBotRoll(5);
        assert.strictEqual(tracker.hasPendingBotRoll(), true);
        assert.strictEqual(tracker.getPendingBotRoll(), 5);

        // Check serialization maintains pending roll
        const json = tracker.toJSON();
        assert.strictEqual(json.pendingBotRoll, 5);

        const restored = ScoreTracker.fromJSON(json);
        assert.strictEqual(restored.hasPendingBotRoll(), true);
        assert.strictEqual(restored.getPendingBotRoll(), 5);

        // Opponent rolls 3
        const botRoll = restored.consumePendingBotRoll();
        assert.strictEqual(botRoll, 5);
        assert.strictEqual(restored.hasPendingBotRoll(), false);

        const result = restored.recordRound(botRoll, 3);
        assert.strictEqual(result.roundWinner, 'bot');
        assert.strictEqual(restored.scores.bot, 1);
    });
});

test('TicketManager - User Index', async (t) => {
    await t.test('should index users for O(1) lookup', () => {
        const tm = new TicketManager();
        const ticket = tm.createTicket('chan1', { opponentId: 'user1' });

        assert.ok(tm.userIndex.has('user1'));
        assert.strictEqual(tm.userIndex.get('user1'), ticket);

        const retrieved = tm.getTicketByUser('user1');
        assert.strictEqual(retrieved, ticket);

        tm.removeTicket('chan1');
        assert.strictEqual(tm.userIndex.has('user1'), false);
        assert.strictEqual(tm.getTicketByUser('user1'), undefined);
    });
});
