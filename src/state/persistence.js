/**
 * State Persistence - Crash recovery system
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const { ticketManager } = require('./TicketManager');

const DATA_DIR = path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SAVE_INTERVAL = 30 * 1000;
let saveTimer = null;
let isSaving = false;
let pendingSave = false;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function performAsyncSave() {
    try {
        ensureDataDir();
        const state = { savedAt: new Date().toISOString(), tickets: ticketManager.toJSON() };
        const tmp = STATE_FILE + '.tmp';

        await fs.promises.writeFile(tmp, JSON.stringify(state, null, 2));
        await fs.promises.rename(tmp, STATE_FILE);

        // Only log at debug level to avoid spam
        if (logger.isLevelEnabled && logger.isLevelEnabled('debug')) {
            logger.debug('State saved (async)', { count: state.tickets.length });
        }
        return true;
    } catch (e) {
        logger.error('Save failed', { error: e.message });
        throw e;
    }
}

/**
 * Async save with request coalescing
 * If a save is already in progress, mark a pending save.
 * Once the current save finishes, if pending is true, save again immediately.
 */
async function saveState() {
    if (isSaving) {
        pendingSave = true;
        return;
    }

    isSaving = true;

    try {
        // Loop until no more pending saves
        while (true) {
            pendingSave = false;
            await performAsyncSave();

            // If no new save was requested during the operation, we are done
            if (!pendingSave) break;

            // Otherwise, loop again to save the latest state
            // Small yield to allow other IO/events to process?
            // setImmediate is not awaitable directly, so we just loop.
            // But we should probably give a tiny breath to the event loop.
            await new Promise(resolve => setImmediate(resolve));
        }
    } catch (e) {
        // Error already logged in performAsyncSave
    } finally {
        isSaving = false;
        // If we exited due to error, pendingSave might still be true or false,
        // but we reset isSaving so next call can try again.
    }
}

/**
 * Synchronous save for shutdown
 */
function saveStateSync() {
    try {
        ensureDataDir();
        const state = { savedAt: new Date().toISOString(), tickets: ticketManager.toJSON() };
        const tmp = STATE_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, STATE_FILE);
        logger.info('State saved (sync)', { count: state.tickets.length });
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

function shutdown() { stopAutoSave(); saveStateSync(); logger.info('Persistence shutdown'); }

function checkRecoveryNeeded() {
    const pending = ticketManager.getTicketsWithPendingPayments();
    if (pending.length > 0) {
        logger.warn('⚠️ Pending payments need attention!', { count: pending.length, channels: pending.map(t => t.channelId) });
    }
    return pending;
}

module.exports = { saveState, saveStateSync, loadState, startAutoSave, stopAutoSave, shutdown, checkRecoveryNeeded };
