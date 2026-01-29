/**
 * State Persistence - Crash recovery system
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { logger } = require('../utils/logger');
const { ticketManager } = require('./TicketManager');

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SAVE_INTERVAL = 30 * 1000;
let saveTimer = null;

// Concurrency control
let isSaving = false;
let saveQueued = false;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Asynchronous state save with coalescing
 * Prevents blocking the event loop
 */
async function saveState() {
    // If already saving, mark that we need another save after this one
    if (isSaving) {
        saveQueued = true;
        return;
    }

    isSaving = true;

    try {
        ensureDataDir();
        const state = {
            savedAt: new Date().toISOString(),
            tickets: ticketManager.toJSON()
        };

        const tmp = STATE_FILE + '.tmp';

        // Write to temp file first (atomic write pattern)
        await fsPromises.writeFile(tmp, JSON.stringify(state, null, 2));
        await fsPromises.rename(tmp, STATE_FILE);

        if (logger.isLevelEnabled('debug')) {
            logger.debug('State saved async', { count: state.tickets.length });
        }
    } catch (e) {
        logger.error('Async save failed', { error: e.message });
    } finally {
        isSaving = false;

        // If a save was requested while we were saving, trigger it now
        if (saveQueued) {
            saveQueued = false;
            // Use setImmediate to release stack before next save
            setImmediate(() => saveState());
        }
    }
}

/**
 * Synchronous save for shutdown
 * Blocks event loop to ensure data is written
 */
function saveStateSync() {
    try {
        ensureDataDir();
        const state = {
            savedAt: new Date().toISOString(),
            tickets: ticketManager.toJSON()
        };

        const tmp = STATE_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, STATE_FILE);

        logger.info('State saved synchronously (shutdown)', { count: state.tickets.length });
        return true;
    } catch (e) {
        logger.error('Sync save failed', { error: e.message });
        return false;
    }
}

function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) {
            logger.info('No saved state, starting fresh');
            return true;
        }
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        if (state.tickets) ticketManager.fromJSON(state.tickets);
        logger.info('State loaded', { savedAt: state.savedAt, count: state.tickets?.length });
        return true;
    } catch (e) {
        logger.error('Load failed', { error: e.message });
        return false;
    }
}

function startAutoSave() {
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = setInterval(() => {
        if (ticketManager.getActiveTickets().length > 0) saveState();
    }, SAVE_INTERVAL);
    logger.info('Auto-save started');
}

function stopAutoSave() { if (saveTimer) { clearInterval(saveTimer); saveTimer = null; } }

function shutdown() {
    stopAutoSave();
    saveStateSync();
    logger.info('Persistence shutdown');
}

function checkRecoveryNeeded() {
    const pending = ticketManager.getTicketsWithPendingPayments();
    if (pending.length > 0) {
        logger.warn('⚠️ Pending payments need attention!', { count: pending.length, channels: pending.map(t => t.channelId) });
    }
    return pending;
}

module.exports = {
    saveState,
    saveStateSync,
    loadState,
    startAutoSave,
    stopAutoSave,
    shutdown,
    checkRecoveryNeeded
};
