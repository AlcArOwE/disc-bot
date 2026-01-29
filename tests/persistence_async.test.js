const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { saveState, saveStateSync } = require('../src/state/persistence');
const { ticketManager } = require('../src/state/TicketManager');

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

test('Persistence Async', async (t) => {
    // Clean up
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);

    await t.test('should save state asynchronously', async () => {
        // Setup
        ticketManager.tickets.clear();
        ticketManager.createTicket('async-channel', { opponentId: 'async-user' });

        // Action
        await saveState();

        // Check file
        assert.ok(fs.existsSync(STATE_FILE), 'State file should exist');
        const content = fs.readFileSync(STATE_FILE, 'utf8');
        const data = JSON.parse(content);

        assert.ok(data.tickets.some(t => t.channelId === 'async-channel'), 'File should contain ticket');
    });

    await t.test('should save state synchronously', () => {
        // Setup
        ticketManager.tickets.clear();
        ticketManager.createTicket('sync-channel', { opponentId: 'sync-user' });

        // Action
        const result = saveStateSync();

        // Assert
        assert.ok(result, 'Sync save should return true');

        const content = fs.readFileSync(STATE_FILE, 'utf8');
        const data = JSON.parse(content);

        assert.ok(data.tickets.some(t => t.channelId === 'sync-channel'), 'File should contain ticket');
    });
});
