
const { describe, it, mock, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { saveState, saveStateSync } = require('../src/state/persistence');

// Mock TicketManager
const { ticketManager } = require('../src/state/TicketManager');
mock.method(ticketManager, 'toJSON', () => [{ channelId: 'test' }]);

// Mock logger
const { logger } = require('../src/utils/logger');
mock.method(logger, 'debug', () => {});
mock.method(logger, 'error', () => {});
mock.method(logger, 'info', () => {});

describe('Persistence', () => {
    const DATA_DIR = path.join(process.cwd(), 'data');
    const STATE_FILE = path.join(DATA_DIR, 'state.json');

    before(() => {
        if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    });

    it('should save state asynchronously', async () => {
        const success = await saveState();
        assert.strictEqual(success, true);

        const content = fs.readFileSync(STATE_FILE, 'utf8');
        const json = JSON.parse(content);
        assert.ok(json.tickets);
    });

    it('should save state synchronously', () => {
        const success = saveStateSync();
        assert.strictEqual(success, true);

        const content = fs.readFileSync(STATE_FILE, 'utf8');
        const json = JSON.parse(content);
        assert.ok(json.tickets);
    });
});
