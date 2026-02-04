/**
 * DM Command Handler - INSTANT RESPONSE SYSTEM
 * 
 * All commands respond instantly (<50ms CPU time):
 * - No artificial delays
 * - No typing simulation
 * - No message queue (direct channel.send())
 * - Cache-first for data-dependent commands
 * - Rate limiting without adding latency (instant "slow down" response)
 */

const { logger } = require('../../utils/logger');
const config = require('../../../config.json');
const path = require('path');
const { execSync } = require('child_process');
const { commandCache } = require('../../state/CommandCache');

const DEBUG = process.env.DEBUG === '1';

// Heavy commands that have stricter rate limits
const HEAVY_COMMANDS = new Set(['housebal', 'balance', 'pnl']);

class DMCommandHandler {
    constructor() {
        this.commands = new Map();
        this.startTime = Date.now();
        this._initCommands();
    }

    /**
     * Initialize all commands
     */
    _initCommands() {
        // ═══════════════════════════════════════════════════════════════════════
        // HELP & INFO COMMANDS
        // ═══════════════════════════════════════════════════════════════════════
        this.register(
            ['help', 'commands', 'cmd'],
            this.handleHelp.bind(this),
            'Show all commands'
        );

        this.register(
            ['quick', 'start', 'how'],
            this.handleQuick.bind(this),
            'Quick-start guide'
        );

        this.register(
            ['limits', 'rules', 'betting'],
            this.handleLimits.bind(this),
            'Show betting limits'
        );

        // ═══════════════════════════════════════════════════════════════════════
        // STATS COMMANDS
        // ═══════════════════════════════════════════════════════════════════════
        this.register(
            ['stats', 'record'],
            this.handleStats.bind(this),
            'Show performance stats'
        );

        this.register(
            ['lastmatch', 'last', 'recent'],
            this.handleLastMatch.bind(this),
            'Show last match details'
        );

        this.register(
            ['pnl', 'profit'],
            this.handlePnL.bind(this),
            'Show PnL summary'
        );

        // ═══════════════════════════════════════════════════════════════════════
        // HOUSE/MONEY COMMANDS
        // ═══════════════════════════════════════════════════════════════════════
        this.register(
            ['housebal', 'balance', 'bal'],
            this.handleHouseBal.bind(this),
            'Show house balance'
        );

        this.register(
            ['wallet', 'wallets', 'address'],
            this.handleWallet.bind(this),
            'Show payout addresses'
        );

        // ═══════════════════════════════════════════════════════════════════════
        // SYSTEM COMMANDS
        // ═══════════════════════════════════════════════════════════════════════
        this.register(
            ['status', 'info'],
            this.handleStatus.bind(this),
            'Show bot status'
        );

        this.register(
            ['ping', 'latency'],
            this.handlePing.bind(this),
            'Check latency'
        );

        this.register(
            ['opt', 'stop', 'start'],
            this.handleOpt.bind(this),
            'Opt in/out of sniping'
        );
    }

    /**
     * Register a command
     */
    register(names, handler, description) {
        const primary = Array.isArray(names) ? names[0] : names;
        const allNames = Array.isArray(names) ? names : [names];

        const cmdDef = { handler, description, primary };

        allNames.forEach(name => {
            this.commands.set(name.toLowerCase(), cmdDef);
        });
    }

    /**
     * Handle an incoming DM - INSTANT RESPONSE
     * @param {Message} message
     * @returns {boolean} - true if handled
     */
    async handle(message) {
        const receivedAt = Date.now();

        if (!message.content) return false;
        const content = message.content.trim();
        if (!content.startsWith('!')) return false;

        const args = content.slice(1).split(/\s+/);
        const commandName = args.shift().toLowerCase();

        const cmd = this.commands.get(commandName);
        if (!cmd) {
            // Unknown command - instant response
            await this._sendInstant(message.channel, '❓ Unknown command. Type `!help` for a list.');
            return true;
        }

        // Rate limiting - instant response even when limited
        const isHeavy = HEAVY_COMMANDS.has(commandName);
        const rateCheck = commandCache.checkRateLimit(message.author.id, isHeavy);

        if (!rateCheck.allowed) {
            const waitSec = Math.ceil(rateCheck.waitMs / 1000);
            await this._sendInstant(message.channel, `⏳ Slow down! Try again in ${waitSec}s.`);
            return true;
        }

        // Log command (with timing if DEBUG)
        if (DEBUG) {
            logger.debug('📩 DM_COMMAND', {
                command: commandName,
                authorId: message.author.id,
                authorName: message.author.username,
                receivedAt
            });
        } else {
            logger.info('📩 DM_COMMAND', {
                command: commandName,
                authorId: message.author.id,
                authorName: message.author.username
            });
        }

        try {
            const handledAt = Date.now();
            await cmd.handler(message, args);

            if (DEBUG) {
                const sendCalledAt = Date.now();
                logger.debug('⏱️ DM_TIMING', {
                    command: commandName,
                    parseMs: handledAt - receivedAt,
                    totalMs: sendCalledAt - receivedAt
                });
            }

            return true;
        } catch (error) {
            logger.error('DM command failed', { command: commandName, error: error.message });
            await this._sendInstant(message.channel, '❌ An error occurred. Please try again.');
            return true;
        }
    }

    /**
     * Send message instantly (bypass queue)
     */
    async _sendInstant(channel, content) {
        try {
            return await channel.send(content);
        } catch (error) {
            logger.error('Failed to send DM', { error: error.message });
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // COMMAND HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════

    async handleHelp(message) {
        const help = [
            '```md',
            '# 🤖 SPARTAN AUTODICER COMMANDS',
            '',
            '## Play & Info',
            '!quick      - How to play (step-by-step)',
            '!limits     - Betting limits & rules',
            '!wallet     - Payout addresses',
            '',
            '## Stats',
            '!stats      - Performance record',
            '!lastmatch  - Last game details',
            '!pnl        - Profit/loss summary',
            '',
            '## House',
            '!housebal   - House balance (cached)',
            '',
            '## System',
            '!status     - Bot status & uptime',
            '!ping       - Check latency',
            '!opt        - Opt in/out of sniping',
            '',
            '[DMs only • Spartan Autodicer]',
            '```'
        ].join('\n');

        await this._sendInstant(message.channel, help);
    }

    async handleQuick(message) {
        const guide = [
            '```md',
            '# 🎲 HOW TO PLAY',
            '',
            '1. I post ads in server every 10 minutes',
            '2. You create a ticket with a middleman',
            '3. State your bet ($1-$50)',
            '4. I match with +20% (e.g., you bet $10, I bet $12)',
            '5. You confirm the terms',
            '6. Middleman posts escrow LTC address',
            '7. I send my stake to escrow',
            '8. Middleman confirms, game starts',
            '9. We roll dice - first to 5 wins',
            '10. **I win all ties**',
            '11. Winner gets paid by middleman',
            '',
            '> Type !limits for betting rules',
            '[DMs only • Spartan Autodicer]',
            '```'
        ].join('\n');

        await this._sendInstant(message.channel, guide);
    }

    async handleLimits(message) {
        const limits = config.betting_limits || { min: 1, max: 50 };
        const bonus = config.bot_bet_bonus_percent || 20;

        const examples = [
            { opp: 10, bot: 10 * (1 + bonus / 100) },
            { opp: 25, bot: 25 * (1 + bonus / 100) },
            { opp: 50, bot: 50 * (1 + bonus / 100) }
        ];

        const text = [
            '```yaml',
            '--- BETTING LIMITS ---',
            `Min Bet: $${limits.min}`,
            `Max Bet: $${limits.max}`,
            `Bot Bonus: +${bonus}% (I pay more than you)`,
            '',
            '--- TIE RULE ---',
            'I WIN ALL TIES ✅',
            '',
            '--- EXAMPLES ---',
            ...examples.map(e => `You bet $${e.opp} → I bet $${e.bot}`),
            '```',
            '*DMs only • Spartan Autodicer*'
        ].join('\n');

        await this._sendInstant(message.channel, text);
    }

    async handleStats(message) {
        const stats = commandCache.getStats();

        if (stats.totalGames === 0) {
            await this._sendInstant(message.channel, '📊 No matches recorded yet. Play a game first!');
            return;
        }

        const winRate = ((stats.wins / stats.totalGames) * 100).toFixed(1);
        const streakSign = stats.streakType === 'W' ? '🔥' : '❄️';

        const text = [
            '```prolog',
            '--- 📊 PERFORMANCE STATS ---',
            `Total Games   : ${stats.totalGames}`,
            `Wins          : ${stats.wins}`,
            `Losses        : ${stats.losses}`,
            `Win Rate      : ${winRate}%`,
            `Ties Won      : ${stats.tiesWon}`,
            `Streak        : ${streakSign} ${stats.currentStreak}${stats.streakType || ''}`,
            '',
            `Biggest Win   : $${stats.biggestWin.toFixed(2)}`,
            `Biggest Loss  : $${stats.biggestLoss.toFixed(2)}`,
            '',
            `Avg Opp Bet   : $${stats.avgOpponentBet.toFixed(2)}`,
            `Avg Bot Bet   : $${stats.avgBotBet.toFixed(2)}`,
            `Total Volume  : $${stats.totalOpponentVolume.toFixed(2)}`,
            '```',
            '*Use `!lastmatch` for recent game • DMs only*'
        ].join('\n');

        await this._sendInstant(message.channel, text);
    }

    async handleLastMatch(message) {
        const match = commandCache.getLastMatch();

        if (!match) {
            await this._sendInstant(message.channel, '🎮 No matches recorded yet.');
            return;
        }

        const outcome = match.winner === 'bot' ? '✅ WIN' : '❌ LOSS';
        const timeAgo = this._formatTimeAgo(match.timestamp);

        const text = [
            '```yaml',
            '--- 🎮 LAST MATCH ---',
            `Opponent   : ${match.opponentName}`,
            `Their Bet  : $${match.opponentBet.toFixed(2)}`,
            `My Bet     : $${match.botBet.toFixed(2)}`,
            `Outcome    : ${outcome}`,
            `Score      : ${match.score}`,
            `Ties Won   : ${match.tiesWon}`,
            `When       : ${timeAgo}`,
            '```'
        ].join('\n');

        await this._sendInstant(message.channel, text);
    }

    async handlePnL(message) {
        const stats = commandCache.getStats();

        if (stats.totalGames === 0) {
            await this._sendInstant(message.channel, '💰 No PnL data yet. Play a game first!');
            return;
        }

        // Calculate realized PnL estimate
        // Win: we receive opponentBet
        // Loss: we lose botBet
        const estimatedPnL = (stats.wins * stats.avgOpponentBet) - (stats.losses * stats.avgBotBet);

        const text = [
            '```prolog',
            '--- 💰 PnL SUMMARY ---',
            `Realized PnL (est) : $${estimatedPnL.toFixed(2)}`,
            `Total Games        : ${stats.totalGames}`,
            `Wins               : ${stats.wins}`,
            `Losses             : ${stats.losses}`,
            '',
            `Total Staked       : $${stats.totalBotStaked.toFixed(2)}`,
            `Opponent Volume    : $${stats.totalOpponentVolume.toFixed(2)}`,
            '```',
            '> *PnL computed from game outcomes.*',
            '> *Check !housebal for on-chain balance.*',
            '*DMs only • Spartan Autodicer*'
        ].join('\n');

        await this._sendInstant(message.channel, text);
    }

    async handleHouseBal(message) {
        // Get cached balance instantly
        let ltc = commandCache.getLTCBalance();
        const sol = commandCache.getSOLBalance();
        const ltcPrice = commandCache.getLTCPrice();

        // If cache is empty, fetch synchronously (with timeout)
        if (ltc.status === 'empty') {
            await this._sendInstant(message.channel, '⏳ Fetching balance...');

            try {
                const { getHandler } = require('../../crypto');
                const ltcHandler = getHandler('LTC');

                if (ltcHandler && ltcHandler.getBalance) {
                    // Fetch with 5 second timeout
                    const result = await Promise.race([
                        ltcHandler.getBalance(),
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('Timeout')), 5000)
                        )
                    ]);

                    if (result && typeof result.balance === 'number') {
                        // Store in cache for future calls
                        commandCache.ltcBalance.value = result.balance;
                        commandCache.ltcBalance.timestamp = Date.now();
                        ltc = { balance: result.balance, age: 0, status: 'fresh' };
                    } else {
                        await this._sendInstant(message.channel, '❌ Could not fetch balance. Try again later.');
                        return;
                    }
                } else {
                    await this._sendInstant(message.channel, '❌ LTC handler not available.');
                    return;
                }
            } catch (error) {
                logger.warn('Failed to fetch balance', { error: error.message });
                await this._sendInstant(message.channel, `❌ Balance fetch failed: ${error.message}`);
                return;
            }
        }

        // Build response with cached data
        let ltcLine = `LTC: ${ltc.balance.toFixed(8)} LTC`;
        if (ltcPrice) {
            const usdValue = ltc.balance * ltcPrice;
            ltcLine += ` (~$${usdValue.toFixed(2)})`;
        }

        const solLine = sol.balance !== null
            ? `SOL: ${sol.balance.toFixed(6)} SOL`
            : 'SOL: N/A';

        const statusEmoji = ltc.status === 'fresh' ? '🟢' : '🟡';

        const text = [
            '```yaml',
            '--- 🏦 HOUSE BALANCE ---',
            ltcLine,
            solLine,
            '',
            `Status: ${statusEmoji} ${ltc.status} (${ltc.age}s ago)`,
            '```',
            '*Cached for speed • DMs only*'
        ].join('\n');

        await this._sendInstant(message.channel, text);

        // Trigger background refresh if stale
        if (ltc.status === 'stale') {
            this._triggerBalanceRefresh();
        }
    }

    /**
     * Trigger background balance refresh (non-blocking)
     */
    _triggerBalanceRefresh() {
        // Lazy load to prevent circular deps and only when needed
        try {
            const { getHandler } = require('../../crypto');
            const ltcHandler = getHandler('LTC');

            if (ltcHandler && ltcHandler.getBalance) {
                commandCache.triggerLTCRefresh(() => ltcHandler.getBalance());
            }
        } catch (error) {
            logger.warn('Failed to trigger balance refresh', { error: error.message });
        }
    }

    async handleWallet(message) {
        const ltc = process.env.LTC_PAYOUT_ADDRESS || config.payout_addresses?.LTC || 'Not configured';
        const sol = process.env.SOL_PAYOUT_ADDRESS || config.payout_addresses?.SOL || 'N/A';

        const text = [
            '```yaml',
            '--- 💰 PAYOUT ADDRESSES ---',
            `LTC: ${ltc}`,
            `SOL: ${sol}`,
            '```',
            '> *These are my RECEIVE addresses if I win.*',
            '> *Escrow address is provided by middleman.*',
            '*DMs only • Spartan Autodicer*'
        ].join('\n');

        await this._sendInstant(message.channel, text);
    }

    async handleStatus(message) {
        let gitHash = 'unknown';
        try {
            gitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
        } catch (e) { }

        const uptime = this._formatUptime(process.uptime());
        const liveMode = process.env.ENABLE_LIVE_TRANSFERS === 'true';
        const stats = commandCache.getStats();

        const text = [
            '```prolog',
            '--- ⚡ SYSTEM STATUS ---',
            `Status     : 🟢 ONLINE`,
            `Version    : Zenith-Alpha (${gitHash})`,
            `Uptime     : ${uptime}`,
            `Memory     : ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`,
            '',
            '--- MODE ---',
            `Live TX    : ${liveMode ? '✅ ENABLED' : '❌ DISABLED'}`,
            `Ad Interval: Every 10 minutes`,
            '',
            '--- ACTIVITY ---',
            `Total Games: ${stats.totalGames}`,
            '```',
            '*DMs only • Spartan Autodicer*'
        ].join('\n');

        await this._sendInstant(message.channel, text);
    }

    async handlePing(message) {
        const start = Date.now();
        const msg = await this._sendInstant(message.channel, '🏓 Pinging...');
        const latency = Date.now() - start;

        try {
            await msg.edit(`🏓 Pong! Latency: \`${latency}ms\``);
        } catch (e) {
            // Edit failed, send new message
            await this._sendInstant(message.channel, `🏓 Pong! Latency: \`${latency}ms\``);
        }
    }

    async handleOpt(message, args) {
        const subCmd = args[0]?.toLowerCase();
        const optOutManager = require('../../state/OptOutManager');

        if (subCmd === 'out' || subCmd === 'stop') {
            if (optOutManager.optOut(message.author.id)) {
                await this._sendInstant(message.channel, "✅ **Opted out**: I won't respond to your bets in public.");
            } else {
                await this._sendInstant(message.channel, "ℹ️ You're already opted out.");
            }
        } else if (subCmd === 'in' || subCmd === 'start') {
            if (optOutManager.optIn(message.author.id)) {
                await this._sendInstant(message.channel, "✅ **Opted in**: I'll respond to your bets again!");
            } else {
                await this._sendInstant(message.channel, "ℹ️ You're already opted in.");
            }
        } else {
            await this._sendInstant(message.channel, "⚠️ Usage: `!opt out` or `!opt in`");
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════════════════

    _formatUptime(seconds) {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor(seconds % (3600 * 24) / 3600);
        const m = Math.floor(seconds % 3600 / 60);
        return `${d}d ${h}h ${m}m`;
    }

    _formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return `${seconds}s ago`;
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }
}

module.exports = new DMCommandHandler();
