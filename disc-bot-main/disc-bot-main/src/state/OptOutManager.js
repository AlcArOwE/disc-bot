/**
 * Opt-Out Manager
 * Manages users who have opted out of automatic bet discovery.
 * Persists to JSON file.
 */

const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');

const STATE_FILE = path.join(__dirname, '../../data/opt_outs.json');

class OptOutManager {
    constructor() {
        this.optedOutUsers = new Set();
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                this.optedOutUsers = new Set(data);
                logger.info(`Loaded ${this.optedOutUsers.size} opted-out users`);
            }
        } catch (error) {
            logger.error('Failed to load opt-outs', { error: error.message });
        }
    }

    _save() {
        try {
            const dataDir = path.dirname(STATE_FILE);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }
            fs.writeFileSync(STATE_FILE, JSON.stringify([...this.optedOutUsers]));
        } catch (error) {
            logger.error('Failed to save opt-outs', { error: error.message });
        }
    }

    /**
     * Opt out a user
     * @param {string} userId 
     * @returns {boolean} True if newly opted out
     */
    optOut(userId) {
        if (!this.optedOutUsers.has(userId)) {
            this.optedOutUsers.add(userId);
            this._save();
            logger.info('User opted out', { userId });
            return true;
        }
        return false;
    }

    /**
     * Opt in a user
     * @param {string} userId 
     * @returns {boolean} True if newly opted in
     */
    optIn(userId) {
        if (this.optedOutUsers.has(userId)) {
            this.optedOutUsers.delete(userId);
            this._save();
            logger.info('User opted in', { userId });
            return true;
        }
        return false;
    }

    /**
     * Check if user is opted out
     * @param {string} userId 
     */
    isOptedOut(userId) {
        return this.optedOutUsers.has(userId);
    }
}

module.exports = new OptOutManager();
