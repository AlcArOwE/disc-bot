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
        // USE SYNCHRONOUS WRITE FOR ATOMICITY (Requirement F)
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, STATE_FILE);

        logger.debug('💾 State persisted atomically', {
            tickets: managerState.tickets.length,
            pendingWagers: managerState.pendingWagers.length
        });
        return true;
    } catch (e) {
        logger.error('CRITICAL: State save failed', { error: e.message });
        return false;
    }
}

function loadState() {
    try {
        if (!fs.existsSync(STATE_FILE)) {
            logger.info('No saved state found, starting fresh');
            return true;
        }
        const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        ticketManager.fromJSON(state);
        ticketManager.clearStaleLocks();
        logger.info('📖 State loaded from disk', {
            savedAt: state.savedAt,
            tickets: state.tickets?.length || 0
        });
        return true;
    } catch (e) {
        logger.error('CRITICAL: State load failed', { error: e.message });
        return false;
    }
}

// Timer removed - we now save on EVERY change (Requirement F)
function startAutoSave() { logger.debug('Auto-save timer disabled - using event-driven saves.'); }
function stopAutoSave() { }
function shutdown() { saveState(); logger.info('Persistence shutdown'); }

function checkRecoveryNeeded() {
    const pending = ticketManager.getTicketsWithPendingPayments();
    if (pending.length > 0) {
        logger.warn('⚠️ Pending payments detected on startup!', {
            count: pending.length,
            channels: pending.map(t => t.channelId)
        });
    }
    return pending;
}

module.exports = { saveState, loadState, startAutoSave, stopAutoSave, shutdown, checkRecoveryNeeded };
