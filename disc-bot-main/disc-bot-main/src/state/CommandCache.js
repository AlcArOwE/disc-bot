/**
 * CommandCache - In-memory cache for instant DM command responses
 * 
 * Features:
 * - TTL-based expiration
 * - Single-flight locking (prevents duplicate refreshes)
 * - Global throttling for API calls
 * - Background refresh with strict timeouts
 */

const { logger } = require('../utils/logger');

const DEBUG = process.env.DEBUG === '1';

class CommandCache {
    constructor() {
        // Balance cache
        this.ltcBalance = { value: null, timestamp: 0, refreshing: false };
        this.solBalance = { value: null, timestamp: 0, refreshing: false };
        this.ltcPrice = { value: null, timestamp: 0 };

        // Stats cache (updated incrementally on match completion)
        this.statsSnapshot = {
            totalGames: 0,
            wins: 0,
            losses: 0,
            tiesWon: 0,
            currentStreak: 0,
            streakType: null, // 'W' or 'L'
            biggestWin: 0,
            biggestLoss: 0,
            totalOpponentVolume: 0,
            totalBotStaked: 0,
            avgOpponentBet: 0,
            avgBotBet: 0,
            timestamp: Date.now()
        };

        // Last match cache
        this.lastMatch = null;

        // TTL settings (milliseconds)
        this.TTL = {
            balance: 30 * 1000,      // 30 seconds
            price: 60 * 1000,        // 60 seconds
            stats: 5 * 60 * 1000     // 5 minutes (for display purposes)
        };

        // Global throttle (minimum time between API calls)
        this.lastApiCall = 0;
        this.apiThrottleMs = 10 * 1000; // 10 seconds between refreshes

        // Timeout for external calls
        this.externalTimeout = 3000; // 3 seconds
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // BALANCE CACHE
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get LTC balance instantly from cache
     * @returns {{ balance: number|null, age: number, status: string }}
     */
    getLTCBalance() {
        const now = Date.now();
        const age = now - this.ltcBalance.timestamp;

        if (this.ltcBalance.value !== null) {
            return {
                balance: this.ltcBalance.value,
                age: Math.floor(age / 1000),
                status: age > this.TTL.balance ? 'stale' : 'fresh'
            };
        }

        return { balance: null, age: 0, status: 'empty' };
    }

    /**
     * Get SOL balance instantly from cache
     */
    getSOLBalance() {
        const now = Date.now();
        const age = now - this.solBalance.timestamp;

        if (this.solBalance.value !== null) {
            return {
                balance: this.solBalance.value,
                age: Math.floor(age / 1000),
                status: age > this.TTL.balance ? 'stale' : 'fresh'
            };
        }

        return { balance: null, age: 0, status: 'empty' };
    }

    /**
     * Get LTC price instantly from cache
     */
    getLTCPrice() {
        if (this.ltcPrice.value !== null) {
            return this.ltcPrice.value;
        }
        return null;
    }

    /**
     * Trigger background refresh of LTC balance (single-flight)
     * @param {Function} fetchFn - Async function that returns { balance: number }
     */
    async triggerLTCRefresh(fetchFn) {
        // Single-flight: if already refreshing, skip
        if (this.ltcBalance.refreshing) {
            if (DEBUG) logger.debug('[CACHE] LTC refresh already in progress, skipping');
            return;
        }

        // Global throttle: don't hammer APIs
        const now = Date.now();
        if (now - this.lastApiCall < this.apiThrottleMs) {
            if (DEBUG) logger.debug('[CACHE] API throttled, skipping refresh');
            return;
        }

        this.ltcBalance.refreshing = true;
        this.lastApiCall = now;

        try {
            // Wrap in timeout
            const result = await Promise.race([
                fetchFn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')), this.externalTimeout)
                )
            ]);

            if (result && typeof result.balance === 'number') {
                this.ltcBalance.value = result.balance;
                this.ltcBalance.timestamp = Date.now();
                if (DEBUG) logger.debug('[CACHE] LTC balance refreshed', { balance: result.balance });
            }
        } catch (error) {
            logger.warn('[CACHE] LTC refresh failed', { error: error.message });
            // Keep old value on error
        } finally {
            this.ltcBalance.refreshing = false;
        }
    }

    /**
     * Trigger background refresh of SOL balance (single-flight)
     */
    async triggerSOLRefresh(fetchFn) {
        if (this.solBalance.refreshing) return;

        const now = Date.now();
        if (now - this.lastApiCall < this.apiThrottleMs) return;

        this.solBalance.refreshing = true;
        this.lastApiCall = now;

        try {
            const result = await Promise.race([
                fetchFn(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout')), this.externalTimeout)
                )
            ]);

            if (result && typeof result.balance === 'number') {
                this.solBalance.value = result.balance;
                this.solBalance.timestamp = Date.now();
            }
        } catch (error) {
            logger.warn('[CACHE] SOL refresh failed', { error: error.message });
        } finally {
            this.solBalance.refreshing = false;
        }
    }

    /**
     * Set LTC price (called by price updater)
     */
    setLTCPrice(price) {
        this.ltcPrice.value = price;
        this.ltcPrice.timestamp = Date.now();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATS CACHE (O(1) updates)
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Get stats snapshot instantly
     */
    getStats() {
        return { ...this.statsSnapshot };
    }

    /**
     * Record a match completion (O(1) update)
     * @param {Object} match - { winner: 'bot'|'opponent', opponentBet, botBet, tiesWon, opponentName, opponentId, score, timestamp }
     */
    recordMatch(match) {
        const stats = this.statsSnapshot;
        stats.totalGames++;

        const isWin = match.winner === 'bot';

        if (isWin) {
            stats.wins++;
            // Track streak
            if (stats.streakType === 'W') {
                stats.currentStreak++;
            } else {
                stats.currentStreak = 1;
                stats.streakType = 'W';
            }
            // Biggest win
            if (match.opponentBet > stats.biggestWin) {
                stats.biggestWin = match.opponentBet;
            }
        } else {
            stats.losses++;
            if (stats.streakType === 'L') {
                stats.currentStreak++;
            } else {
                stats.currentStreak = 1;
                stats.streakType = 'L';
            }
            if (match.botBet > stats.biggestLoss) {
                stats.biggestLoss = match.botBet;
            }
        }

        // Ties won tracking
        if (match.tiesWon) {
            stats.tiesWon += match.tiesWon;
        }

        // Volume tracking
        stats.totalOpponentVolume += match.opponentBet || 0;
        stats.totalBotStaked += match.botBet || 0;

        // Update averages
        if (stats.totalGames > 0) {
            stats.avgOpponentBet = stats.totalOpponentVolume / stats.totalGames;
            stats.avgBotBet = stats.totalBotStaked / stats.totalGames;
        }

        stats.timestamp = Date.now();

        // Update last match
        this.lastMatch = {
            opponentName: match.opponentName || 'Unknown',
            opponentId: match.opponentId || 'N/A',
            opponentBet: match.opponentBet || 0,
            botBet: match.botBet || 0,
            winner: match.winner,
            score: match.score || 'N/A',
            tiesWon: match.tiesWon || 0,
            timestamp: match.timestamp || Date.now()
        };

        if (DEBUG) {
            logger.debug('[CACHE] Match recorded', {
                totalGames: stats.totalGames,
                wins: stats.wins,
                losses: stats.losses
            });
        }
    }

    /**
     * Get last match instantly
     */
    getLastMatch() {
        return this.lastMatch ? { ...this.lastMatch } : null;
    }

    /**
     * Load stats from persistence (on startup)
     */
    loadStats(data) {
        if (data && typeof data === 'object') {
            Object.assign(this.statsSnapshot, data);
            if (DEBUG) logger.debug('[CACHE] Stats loaded', { totalGames: this.statsSnapshot.totalGames });
        }
    }

    /**
     * Get stats for persistence
     */
    exportStats() {
        return { ...this.statsSnapshot };
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // RATE LIMITING
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * User rate limit tracking
     */
    userCooldowns = new Map(); // userId -> { lastCommand: timestamp, lastHeavy: timestamp }

    /**
     * Check if user is rate limited
     * @param {string} userId
     * @param {boolean} isHeavyCommand - true for !housebal, !pnl
     * @returns {{ allowed: boolean, waitMs: number }}
     */
    checkRateLimit(userId, isHeavyCommand = false) {
        const now = Date.now();
        const cooldown = this.userCooldowns.get(userId) || { lastCommand: 0, lastHeavy: 0 };

        const generalCooldown = 1000;  // 1 second for general commands
        const heavyCooldown = 5000;    // 5 seconds for heavy commands

        if (isHeavyCommand) {
            const elapsed = now - cooldown.lastHeavy;
            if (elapsed < heavyCooldown) {
                return { allowed: false, waitMs: heavyCooldown - elapsed };
            }
            cooldown.lastHeavy = now;
        } else {
            const elapsed = now - cooldown.lastCommand;
            if (elapsed < generalCooldown) {
                return { allowed: false, waitMs: generalCooldown - elapsed };
            }
        }

        cooldown.lastCommand = now;
        this.userCooldowns.set(userId, cooldown);

        // Cleanup old entries periodically (simple LRU)
        if (this.userCooldowns.size > 1000) {
            const oldestKey = this.userCooldowns.keys().next().value;
            this.userCooldowns.delete(oldestKey);
        }

        return { allowed: true, waitMs: 0 };
    }
}

// Singleton
const commandCache = new CommandCache();

module.exports = { CommandCache, commandCache };
