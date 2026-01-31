/**
 * Ticket Handler - Orchestrates full ticket lifecycle
 */

const BigNumber = require('bignumber.js');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');
const { extractBetAmounts, extractCryptoAddress, extractGameStart, extractDiceResult, isPaymentConfirmation } = require('../../utils/regex');
const { isMiddleman, validatePaymentAddress } = require('../../utils/validator');
const { humanDelay, fastDelay, gameActionDelay } = require('../../utils/delay');
const { logger, logGame } = require('../../utils/logger');
const { sendPayment, getPayoutAddress } = require('../../crypto');
const { priceOracle } = require('../../crypto/PriceOracle');
const { isCancellation } = require('../../utils/regex');
const { logGameResult, logPayment } = require('../../utils/notifier');
const DiceEngine = require('../../game/DiceEngine');
const ScoreTracker = require('../../game/ScoreTracker');
const { messageQueue } = require('../../utils/MessageQueue');

// Store ScoreTrackers by channel ID
const gameTrackers = new Map();

// Session lock: prevents concurrent processing of messages in the same channel (P2)
const processingSessions = new Set();

const DEBUG = process.env.DEBUG === '1';

function debugLog(reason, data = {}) {
    if (DEBUG) {
        logger.debug(`[${reason}]`, data);
    }
}

// LEAK PREVENTION (P4)
// Register a callback to clean up trackers when a ticket is removed
ticketManager.onTicketRemoved = (channelId) => {
    if (gameTrackers.has(channelId)) {
        gameTrackers.delete(channelId);
        logger.debug('🗑️ Purged GameTracker for removed ticket', { channelId });
    }
    if (processingSessions.has(channelId)) {
        processingSessions.delete(channelId);
    }
};

/**
 * Handle message in a ticket context
 * @param {Message} message - Discord message
 * @returns {Promise<boolean>} - True if handled
 */
async function handleMessage(message) {
    const channelId = message.channel.id;
    const channelName = message.channel.name?.toLowerCase() || '';

    // ═══════════════════════════════════════════════════════════════════
    // PRE-FLIGHT VALIDATION: Block ticket operations in wrong channels
    // ═══════════════════════════════════════════════════════════════════
    const monitoredChannels = config.channels?.monitored_channels || [];
    const isMonitoredPublic = monitoredChannels.length === 0 || monitoredChannels.includes(channelId);
    const ticketPatterns = config.payment_safety?.ticket_channel_patterns || ['ticket', 'order-'];
    const isTicketChannel = ticketPatterns.some(pattern => channelName.includes(pattern));

    // If this is a monitored public channel AND not a ticket channel, block all ticket actions
    if (isMonitoredPublic && !isTicketChannel) {
        debugLog('IGNORE_TICKET_ROUTED_TO_PUBLIC', {
            channelId,
            channelName
        });
        return false;
    }
    // ═══════════════════════════════════════════════════════════════════

    // CONCURRENCY LOCK (P2)
    if (processingSessions.has(channelId)) {
        debugLog('IGNORE_SESSION_LOCKED', { channelId });
        return;
    }
    processingSessions.add(channelId);

    try {
        const ticket = ticketManager.getTicket(channelId);

        // DEBUG: Log every message for diagnostics
        logger.debug('Ticket handler processing', {
            channelId,
            hasTicket: !!ticket,
            state: ticket?.getState() || 'NO_TICKET',
            authorId: message.author.id,
            content: message.content.substring(0, 50)
        });

        // 1. If no ticket exists, check if this is a new ticket being created
        if (!ticket) {
            return await handlePotentialNewTicket(message);
        }

        // 2. CONCURRENCY LOGGING
        const activeTickets = ticketManager.getActiveTickets().length;
        if (activeTickets > 1) {
            logger.info('⚙️ Processing message in concurrent session', {
                channelId,
                activeSessionCount: activeTickets,
                ticketState: ticket.getState()
            });
        }

        // 3. GLOBAL CANCELLATION CHECK (MM or User can cancel)
        const isCancel = isCancellation(message.content);
        if (isCancel && (isMiddleman(message.author.id) || message.author.id === ticket.data.opponentId)) {
            const content = message.content.toLowerCase();
            if (content.includes('reset')) {
                logger.warn('🔄 TICKET RESET BY MIDDLEMAN', { channelId, keyword: content });
                ticket.transition(STATES.AWAITING_MIDDLEMAN);
                await messageQueue.send(message.channel, 'Received. Ticket state reset to AWAITING_MIDDLEMAN.');
                saveState();
            } else {
                logger.warn('🚫 TICKET CANCELLED', { channelId, keyword: content });
                ticket.transition(STATES.CANCELLED, { cancellationReason: content });
                await messageQueue.send(message.channel, 'Received. Ticket cancelled.');
                saveState();
            }
            return;
        }

        // 4. Route to appropriate handler based on state
        switch (ticket.getState()) {
            case STATES.AWAITING_TICKET:
                await handleAwaitingTicket(message, ticket);
                break;
            case STATES.AWAITING_MIDDLEMAN:
                await handleAwaitingMiddleman(message, ticket);
                break;
            case STATES.AWAITING_PAYMENT_ADDRESS:
                await handleAwaitingPaymentAddress(message, ticket);
                break;
            case STATES.PAYMENT_SENT:
                await handlePaymentSent(message, ticket);
                break;
            case STATES.AWAITING_GAME_START:
                await handleAwaitingGameStart(message, ticket);
                break;
            case STATES.GAME_IN_PROGRESS:
                await handleGameInProgress(message, ticket);
                break;
            default:
                break;
        }
    } catch (error) {
        logger.error('Error in ticket handler', {
            channelId,
            error: error.message
        });
    } finally {
        processingSessions.delete(channelId);
    }
    return true;
}

/**
 * Check if this message represents a new ticket
 * If middleman sends a message in a ticket-like channel, create a ticket
 */
async function handlePotentialNewTicket(message) {
    const channelName = message.channel.name?.toLowerCase() || '';
    const isExcluded = channelName.includes('bot-commands') || channelName.includes('general');

    if (isExcluded) {
        debugLog('IGNORE_EXCLUDED_CHANNEL_TYPE', { channelName });
        return false;
    }

    const isMM = isMiddleman(message.author.id);
    const pendingWager = ticketManager.getAnyPendingWager(message.channel.name) ||
        ticketManager.getPendingWager(message.author.id);

    if (isMM || pendingWager) {
        logger.info('📋 Potential ticket channel detected', {
            channelId: message.channel.id,
            channelName,
            authorId: message.author.id,
            isMM,
            hasPendingWager: !!pendingWager
        });

        let ticketData;
        if (pendingWager) {
            ticketData = {
                opponentId: pendingWager.userId,
                opponentBet: pendingWager.opponentBet,
                ourBet: pendingWager.ourBet,
                sourceChannelId: pendingWager.sourceChannelId,
                autoDetected: true
            };
            logger.info('🔗 Linked to pending wager', {
                userId: pendingWager.userId,
                opponentBet: pendingWager.opponentBet,
                ourBet: pendingWager.ourBet
            });
        } else {
            ticketData = {
                opponentId: null,
                opponentBet: 0,
                ourBet: 0,
                autoDetected: true
            };
            logger.warn('⚠️ No pending wager found - ticket created with zero amounts');
        }

        const ticket = ticketManager.createTicket(message.channel.id, ticketData);

        if (isMM) {
            ticket.transition(STATES.AWAITING_MIDDLEMAN);
            ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: message.author.id });
            saveState();

            const address = extractCryptoAddress(message.content, config.crypto_network);
            if (address) {
                return await handleAwaitingPaymentAddress(message, ticket);
            }
        } else {
            ticket.transition(STATES.AWAITING_MIDDLEMAN);
            saveState();
        }

        priceOracle.preFetch(config.crypto_network);
        return true;
    }

    debugLog('IGNORE_NOT_TICKET_CREATION', { channelName, authorId: message.author.id });
    return false;
}

/**
 * Handle awaiting ticket state
 */
async function handleAwaitingTicket(message, ticket) {
    if (message.author.id === ticket.data.opponentId) {
        ticket.transition(STATES.AWAITING_MIDDLEMAN);
        saveState();
        logger.info('Opponent joined ticket', { channelId: ticket.channelId });
    }
    return true;
}

/**
 * Handle awaiting middleman state
 */
async function handleAwaitingMiddleman(message, ticket) {
    const userId = message.author.id;
    const isMiddlemanResult = isMiddleman(userId);

    if (isMiddlemanResult) {
        if (ticket.data.opponentBet === 0) {
            const betData = extractBetAmounts(message.content);
            if (betData) {
                const taxMultiplier = new BigNumber(1).plus(config.tax_percentage);
                const ourBet = new BigNumber(betData.opponent).times(taxMultiplier);
                ticket.updateData({
                    opponentBet: betData.opponent,
                    ourBet: parseFloat(ourBet.toFixed(2))
                });
                logger.info('💸 Updated bet amounts from middleman message', {
                    opponentBet: ticket.data.opponentBet,
                    ourBet: ticket.data.ourBet
                });
            }
        }

        ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: userId });
        saveState();
        priceOracle.preFetch(config.crypto_network);
        logger.info('🟢 Middleman detected! Awaiting address...', { channelId: ticket.channelId, middlemanId: userId });
        return true;
    }

    debugLog('IGNORE_NOT_MIDDLEMAN', { authorId: userId });
    return false;
}

/**
 * Handle awaiting payment address state
 */
async function handleAwaitingPaymentAddress(message, ticket) {
    const channelId = message.channel.id;
    const channelName = message.channel.name?.toLowerCase() || '';

    const ticketPatterns = config.payment_safety?.ticket_channel_patterns || ['ticket', 'order-'];
    const isTicketChannel = ticketPatterns.some(pattern => channelName.includes(pattern));

    if (!isTicketChannel) {
        logger.error('🚨 PAYMENT BLOCKED: Channel does not match ticket patterns!', { channelId, channelName });
        return false;
    }

    if (message.author.id !== ticket.data.middlemanId) {
        debugLog('IGNORE_NOT_MM_PAYMENT_ADDR', { authorId: message.author.id });
        return false;
    }

    const network = config.crypto_network;
    const address = extractCryptoAddress(message.content, network);

    if (ticket.data.opponentBet === 0) {
        const betData = extractBetAmounts(message.content);
        if (betData) {
            const taxMultiplier = new BigNumber(1).plus(config.tax_percentage);
            const ourBet = new BigNumber(betData.opponent).times(taxMultiplier);
            ticket.updateData({
                opponentBet: betData.opponent,
                ourBet: parseFloat(ourBet.toFixed(2))
            });
        }
    }

    if (!address) {
        if (message.content.length > 20 || message.content.toLowerCase().includes('address')) {
            await message.reply(`⚠️ I couldn't find a valid ${network} address.`);
        }
        return false;
    }

    const validation = validatePaymentAddress(address, network);
    if (!validation.valid) {
        logger.warn('Invalid payment address', { address, reason: validation.reason });
        return false;
    }

    if (ticket.hasPaymentBeenSent()) {
        logger.warn('Payment already sent for this ticket', { channelId: ticket.channelId });
        return true;
    }

    if (ticket.data.paymentLocked) {
        debugLog('IGNORE_PAYMENT_LOCKED', { channelId: ticket.channelId });
        return false;
    }

    const amountUsd = ticket.data.ourBet;
    const minAmount = config.betting_limits?.min || 1;
    if (amountUsd < minAmount) {
        logger.error('🚨 PAYMENT REJECTED: Amount below minimum', { amountUsd, minAmount });
        await messageQueue.send(message.channel, `Payment rejected: Amount $${amountUsd} is below $${minAmount}.`);
        return false;
    }

    ticket.updateData({ paymentLocked: true });
    saveState();
    await fastDelay();

    try {
        const result = await sendPayment(address, amountUsd, network, ticket.channelId);
        if (result.success) {
            ticket.transition(STATES.PAYMENT_SENT, {
                paymentAddress: address,
                paymentTxId: result.txId
            });
            saveState();
            const confirmMsg = config.response_templates.payment_sent
                .replace('{txid}', result.txId)
                .replace('{amount}', amountUsd.toFixed(2));
            await messageQueue.send(message.channel, confirmMsg);
            logPayment(ticket.channelId, amountUsd, result.txId, network);
        } else {
            throw new Error(result.error || 'Unknown payment error');
        }
    } catch (error) {
        logger.error('Payment failed', { error: error.message });
        await messageQueue.send(message.channel, `Payment failed: ${error.message}`);
        ticket.updateData({ paymentLocked: false });
        saveState();
    }

    return true;
}

/**
 * Handle payment sent state - waiting for confirmation
 */
async function handlePaymentSent(message, ticket) {
    if (message.author.id === ticket.data.middlemanId || isMiddleman(message.author.id)) {
        const isConfirm = isPaymentConfirmation(message.content);
        const gameStart = extractGameStart(message.content);

        if (isConfirm || gameStart) {
            const betData = extractBetAmounts(message.content);
            if (betData) {
                const termsMatch = Math.abs(betData.opponent - ticket.data.opponentBet) < 0.01;
                if (!termsMatch) {
                    await messageQueue.send(message.channel, `⚠️ Wait. Terms mismatch. I have $${ticket.data.opponentBet} vs $${ticket.data.ourBet}. Please correct.`);
                    return false;
                }
            }

            await messageQueue.send(message.channel, 'Confirm');
            ticket.transition(STATES.AWAITING_GAME_START);
            saveState();

            if (gameStart) {
                return await handleAwaitingGameStart(message, ticket);
            }
            return true;
        }
    }
    return false;
}

/**
 * Handle awaiting game start state
 */
async function handleAwaitingGameStart(message, ticket) {
    if (message.author.id !== ticket.data.middlemanId && !isMiddleman(message.author.id)) {
        return false;
    }

    const gameStart = extractGameStart(message.content);
    if (!gameStart) return false;

    await messageQueue.send(message.channel, 'Confirm');
    const botId = message.client.user.id;
    const botGoesFirst = gameStart.botFirst || gameStart.userId === botId;

    const tracker = new ScoreTracker(ticket.channelId);
    gameTrackers.set(ticket.channelId, tracker);

    ticket.transition(STATES.GAME_IN_PROGRESS, { botGoesFirst });
    saveState();

    if (botGoesFirst) {
        await gameActionDelay();
        await rollDice(message.channel, ticket);
    }
    return true;
}

/**
 * Handle game in progress state
 */
async function handleGameInProgress(message, ticket) {
    let tracker = gameTrackers.get(ticket.channelId);

    if (!tracker && ticket.data.gameScores) {
        tracker = ScoreTracker.fromJSON({
            ticketId: ticket.channelId,
            winsNeeded: config.game_settings.wins_to_complete,
            botWinsTies: config.game_settings.bot_wins_ties,
            scores: ticket.data.gameScores,
            rounds: ticket.data.gameHistory || [],
            startedAt: ticket.createdAt,
            completedAt: null,
            winner: null
        });
        gameTrackers.set(ticket.channelId, tracker);
    }

    if (!tracker) return false;

    const roll = extractDiceResult(message.content);
    if (roll) {
        if (message.author.id === message.client.user.id) {
            tracker.lastBotRoll = roll;
        } else {
            tracker.lastOpponentRoll = roll;
        }

        if (tracker.lastBotRoll && tracker.lastOpponentRoll) {
            const botRoll = tracker.lastBotRoll;
            const opponentRoll = tracker.lastOpponentRoll;
            tracker.lastBotRoll = null;
            tracker.lastOpponentRoll = null;

            const result = tracker.recordRound(botRoll, opponentRoll);
            ticket.updateData({ gameScores: tracker.scores, gameHistory: tracker.rounds });
            saveState();

            const roundMsg = `${DiceEngine.formatResult(botRoll)} vs ${DiceEngine.formatResult(opponentRoll)} - ${result.roundWinner === 'bot' ? 'I win!' : 'You win!'} (${tracker.getFormattedScore()})`;
            await messageQueue.send(message.channel, roundMsg);

            if (result.gameOver) {
                await handleGameComplete(message.channel, ticket, tracker);
            }
        }
        return true;
    }

    const content = message.content.toLowerCase();
    const isMM = message.author.id === ticket.data.middlemanId || isMiddleman(message.author.id);
    const isOpponent = message.author.id === ticket.data.opponentId;

    if (isMM || isOpponent || content.includes('bot roll')) {
        const isRollTrigger = content.includes('roll') || content.includes('go') || content.includes('turn') || content.includes('next');
        if (isRollTrigger && !tracker.lastBotRoll) {
            await rollDice(message.channel, ticket);
            return true;
        }
    }

    if (tracker.lastOpponentRoll && !tracker.lastBotRoll) {
        await rollDice(message.channel, ticket);
        return true;
    }

    return false;
}

/**
 * Roll dice
 */
async function rollDice(channel, ticket) {
    await gameActionDelay();
    const diceCmd = config.game_settings.dice_command || '-roll';
    await messageQueue.send(channel, diceCmd);
}

/**
 * Handle game completion
 */
async function handleGameComplete(channel, ticket, tracker) {
    ticket.transition(STATES.GAME_COMPLETE, {
        winner: tracker.winner,
        gameScores: tracker.scores
    });
    saveState();

    const didWin = tracker.didBotWin();
    logGameResult(ticket.channelId, tracker.winner, didWin ? ticket.data.opponentBet : -ticket.data.ourBet);

    if (didWin) {
        const payoutAddr = getPayoutAddress();
        const network = config.crypto_network || 'LTC';
        const humbleWin = config.response_templates.humble_win
            .replace('{amount}', ticket.data.opponentBet.toFixed(2))
            .replace('{network}', network)
            .replace('{address}', payoutAddr);

        await humanDelay();
        await messageQueue.send(channel, humbleWin);

        setTimeout(async () => {
            try { await postVouch(channel.client, ticket); } catch (e) { logger.error('Vouch failed', { error: e.message }); }
        }, 5000);
    } else {
        await humanDelay();
        await messageQueue.send(channel, config.response_templates.humble_loss || 'GG, well played! 🤝');
    }

    gameTrackers.delete(ticket.channelId);
    ticketManager.removeTicket(ticket.channelId);
}

/**
 * Post vouch
 */
async function postVouch(client, ticket) {
    const vouchChannelId = process.env.VOUCH_CHANNEL_ID || config.channels.vouch_channel_id;
    if (!vouchChannelId || ticket.data.vouchPosted) return;

    try {
        const channel = client.channels.cache.get(vouchChannelId) || await client.channels.fetch(vouchChannelId);
        if (!channel) return;

        ticket.updateData({ vouchPosted: true });
        saveState();

        const vouchMsg = config.response_templates.vouch_win
            .replace('{amount}', ticket.data.opponentBet.toFixed(2))
            .replace('{opponent}', `<@${ticket.data.opponentId}>`)
            .replace('{middleman}', ticket.data.middlemanId ? `<@${ticket.data.middlemanId}>` : 'MM');

        await messageQueue.send(channel, vouchMsg);
    } catch (error) {
        logger.error('Vouch error', { error: error.message });
    }
}

/**
 * Handle message updates
 */
async function handleMessageUpdate(oldMessage, newMessage) {
    const channelId = oldMessage.channel.id;
    const ticket = ticketManager.getTicket(channelId);
    if (!ticket) return;

    const network = config.crypto_network;
    const oldAddr = extractCryptoAddress(oldMessage.content, network);
    const newAddr = extractCryptoAddress(newMessage.content, network);

    if (oldAddr && newAddr && oldAddr !== newAddr) {
        await messageQueue.send(oldMessage.channel, '⚠️ CRITICAL: Crypto address modification detected.');
    }
}

/**
 * Handle channel deletion
 */
async function handleChannelDelete(channel) {
    const channelId = channel.id;
    if (ticketManager.getTicket(channelId)) {
        ticketManager.removeTicket(channelId);
        saveState();
    }
}

module.exports = {
    handleMessage,
    handleChannelDelete,
    handleMessageUpdate,
    postVouch
};
