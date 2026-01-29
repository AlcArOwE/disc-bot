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
let isSaving = false;
let pendingSave = false;

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
        logger.debug('State saved (SYNC)', { count: state.tickets.length });
        return true;
    } catch (e) {
        logger.error('Save failed (SYNC)', { error: e.message });
        return false;
    }
}

/**
 * Asynchronous save with coalescing
 */
async function saveState() {
    if (isSaving) {
        pendingSave = true;
        return;
    }

    isSaving = true;

    try {
        ensureDataDir();
        const state = { savedAt: new Date().toISOString(), tickets: ticketManager.toJSON() };
        const tmp = STATE_FILE + '.tmp';

        await fsPromises.writeFile(tmp, JSON.stringify(state, null, 2));
        await fsPromises.rename(tmp, STATE_FILE);

        logger.debug('State saved (ASYNC)', { count: state.tickets.length });
    } catch (e) {
        logger.error('Save failed (ASYNC)', { error: e.message });
    } finally {
        isSaving = false;
        if (pendingSave) {
            pendingSave = false;
            // logic to ensure we don't recurse infinitely if save fails instantly,
            // but here we just call saveState again on next tick
            setImmediate(saveState);
        }
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
