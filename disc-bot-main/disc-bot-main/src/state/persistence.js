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

function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveState() {
    try {
        ensureDataDir();
        const managerState = ticketManager.toJSON();
        const state = {
            savedAt: new Date().toISOString(),
            ...managerState
        };
        const tmp = STATE_FILE + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, STATE_FILE);
        logger.debug('State saved', {
            tickets: managerState.tickets.length,
            pendingWagers: managerState.pendingWagers.length
        });
        return true;
    } catch (e) {
        logger.error('Save failed', { error: e.message });
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
        // Pass the whole state object to fromJSON - it's smart enough to handle formats
        ticketManager.fromJSON(state);
        logger.info('State loaded', {
            savedAt: state.savedAt,
            tickets: state.tickets?.length || 0,
            pendingWagers: state.pendingWagers?.length || 0
        });
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

function shutdown() { stopAutoSave(); saveState(); logger.info('Persistence shutdown'); }

function checkRecoveryNeeded() {
    const pending = ticketManager.getTicketsWithPendingPayments();
    if (pending.length > 0) {
        logger.warn('⚠️ Pending payments need attention!', { count: pending.length, channels: pending.map(t => t.channelId) });
    }
    return pending;
}

module.exports = { saveState, loadState, startAutoSave, stopAutoSave, shutdown, checkRecoveryNeeded };
