/**
 * Persistence Tests
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { saveState, saveStateSync, loadState, startAutoSave, stopAutoSave } = require('../src/state/persistence');
const { ticketManager } = require('../src/state/TicketManager');

const TEST_DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(TEST_DATA_DIR, 'state.json');

describe('Persistence', () => {
    // Helper to clear data
    function clearData() {
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
        if (fs.existsSync(STATE_FILE + '.tmp')) fs.unlinkSync(STATE_FILE + '.tmp');
        ticketManager.tickets.clear();
        ticketManager.userIndex.clear();
    }

    beforeEach(() => {
        clearData();
    });

    afterEach(() => {
        stopAutoSave();
        clearData();
    });

    it('should save and load state (sync)', () => {
        // Setup state
        ticketManager.createTicket('ch-1', { opponentId: 'user-1' });

        // Save
        const result = saveStateSync();
        assert.strictEqual(result, true);
        assert.ok(fs.existsSync(STATE_FILE));

        // Clear manager
        ticketManager.tickets.clear();
        ticketManager.userIndex.clear();
        assert.strictEqual(ticketManager.getTicket('ch-1'), undefined);

        // Load
        loadState();
        const ticket = ticketManager.getTicket('ch-1');
        assert.ok(ticket);
        assert.strictEqual(ticket.data.opponentId, 'user-1');
    });

    it('should save and load state (async)', async () => {
        // Setup state
        ticketManager.createTicket('ch-2', { opponentId: 'user-2' });

        // Save async
        await saveState();

        // Wait a bit for async file IO (since saveState doesn't return promise of completion,
        // we rely on internal implementation or wait)
        // Actually saveState() IS async now, so awaiting it should be enough for the *initiation*
        // but checking the file requires ensuring it's done.
        // My implementation awaits internal writes.

        assert.ok(fs.existsSync(STATE_FILE));

        // Clear
        ticketManager.tickets.clear();
        ticketManager.userIndex.clear();

        // Load
        loadState();
        const ticket = ticketManager.getTicket('ch-2');
        assert.ok(ticket);
        assert.strictEqual(ticket.data.opponentId, 'user-2');
    });

    it('should handle coalescing (multiple saves)', async () => {
        ticketManager.createTicket('ch-start', { opponentId: 'start' });

        // Trigger multiple saves
        const p1 = saveState();
        ticketManager.createTicket('ch-mid', { opponentId: 'mid' });
        const p2 = saveState();
        const p3 = saveState();

        await Promise.all([p1, p2, p3]);

        // Wait for eventual consistency (recursive calls in finally block)
        await new Promise(r => setTimeout(r, 100));

        // Load to check if final state was captured
        ticketManager.tickets.clear();
        loadState();

        assert.ok(ticketManager.getTicket('ch-start'));
        // 'ch-mid' might be missed by p1, but should be caught by queued save
        assert.ok(ticketManager.getTicket('ch-mid'), 'Should have saved the middle update due to coalescing');
    });
});
