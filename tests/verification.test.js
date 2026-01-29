const { test, describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { TicketManager } = require('../src/state/TicketManager');
const ScoreTracker = require('../src/game/ScoreTracker');
const persistence = require('../src/state/persistence');

// Mock config if needed
const config = require('../config.json');

describe('Verification Tests', () => {
    describe('TicketManager', () => {
        it('should maintain userIndex for O(1) lookups', () => {
            const tm = new TicketManager();
            const channelId = '123';
            const opponentId = '456';
            const data = { opponentId, ourBet: 10, opponentBet: 10 };

            const ticket = tm.createTicket(channelId, data);

            // Check internal state (if accessible) or behavior
            // Since userIndex is public in our refactor:
            assert.ok(tm.userIndex.has(opponentId), 'userIndex should have opponentId');
            assert.strictEqual(tm.userIndex.get(opponentId), ticket, 'userIndex should point to ticket');

            // Test lookup
            const foundTicket = tm.getTicketByUser(opponentId);
            assert.strictEqual(foundTicket, ticket, 'getTicketByUser should return ticket');

            // Test update
            const newOpponentId = '789';
            tm.updateTicketOpponent(channelId, newOpponentId);
            assert.ok(!tm.userIndex.has(opponentId), 'Old opponentId should be removed');
            assert.ok(tm.userIndex.has(newOpponentId), 'New opponentId should be in index');
            assert.strictEqual(tm.getTicketByUser(newOpponentId), ticket, 'Ticket should be found by new ID');

            // Test remove
            tm.removeTicket(channelId);
            assert.ok(!tm.userIndex.has(newOpponentId), 'Index should be cleared on remove');
        });
    });

    describe('ScoreTracker', () => {
        it('should persist pendingBotRoll', () => {
            const tracker = new ScoreTracker('ticket1');
            tracker.pendingBotRoll = 6;

            const json = tracker.toJSON();
            assert.strictEqual(json.pendingBotRoll, 6, 'pendingBotRoll should be in JSON');

            const restored = ScoreTracker.fromJSON(json);
            assert.strictEqual(restored.pendingBotRoll, 6, 'pendingBotRoll should be restored');
        });
    });

    describe('Persistence', () => {
        it('should have async saveState and sync saveStateSync', async () => {
            // We can't easily test file I/O race conditions here without complex setup,
            // but we can check the function signatures and types.

            assert.strictEqual(typeof persistence.saveState, 'function');
            assert.strictEqual(typeof persistence.saveStateSync, 'function');

            // saveState should return a promise (async)
            const result = persistence.saveState();
            assert.ok(result instanceof Promise, 'saveState should return a promise');

            // Wait for it (it might fail due to missing directories in test env, so catch)
            try {
                await result;
            } catch (e) {
                // Ignore FS errors
            }
        });
    });
});
