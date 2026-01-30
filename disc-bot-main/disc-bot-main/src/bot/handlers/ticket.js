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
const { sendPayment, getPayoutAddress, validateAddress } = require('../../crypto');
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
    const ticket = ticketManager.getTicket(channelId);

    // DEBUG: Log every message that goes through ticket handler
    logger.debug('Ticket handler processing', {
        channelId,
        hasTicket: !!ticket,
        state: ticket?.getState() || 'NO_TICKET',
        authorId: message.author.id,
        content: message.content.substring(0, 50)
    });

    // If no ticket exists, check if this is a new ticket being created
    if (!ticket) {
        return handlePotentialNewTicket(message);
    }

    // CONCURRENCY LOGGING
    const activeTickets = ticketManager.getActiveTickets().length;
    if (activeTickets > 1) {
        logger.info('⚙️ Processing message in concurrent session', {
            channelId,
            activeSessionCount: activeTickets,
            ticketState: ticket.getState()
        });
    }

    // CONCURRENCY LOCK (P2)
    // Prevent multiple messages in the same channel from running handleMessage concurrently
    if (processingSessions.has(channelId)) {
        logger.debug('🔒 Session locked (concurrency)', { channelId });
        return;
    }
    processingSessions.add(channelId);

    try {
        // GLOBAL CANCELLATION CHECK (MM or User can cancel)
        const isCancel = isCancellation(message.content);
        if (isCancel && (isMiddleman(message.author.id) || message.author.id === ticket.data.opponentId)) {
            logger.warn('🚫 Cancellation keyword detected!', { channelId, authorId: message.author.id, content: message.content });
            await messageQueue.send(message.channel, '🛑 Game aborted. State cleared.');
            ticket.transition(STATES.CANCELLED);
            saveState();
            return;
        }

        // Route to appropriate handler based on state
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
    // Refined ticket patterns (starts with ticket/order or contains -ticket-)
    const channelName = message.channel.name?.toLowerCase() || '';
    const isTicketLike = channelName.startsWith('ticket') ||
        channelName.startsWith('order-') ||
        channelName.includes('-ticket-');

    if (!isTicketLike) {
        return false;
    }

    logger.info('📋 Potential ticket channel detected', {
        channelId: message.channel.id,
        channelName,
        authorId: message.author.id
    });

    // Check if message is from a middleman - if so, we definitely need to track this
    const isMM = isMiddleman(message.author.id);

    if (isMM) {
        logger.info('🎯 Middleman detected in ticket channel - auto-creating ticket', {
            channelId: message.channel.id,
            middlemanId: message.author.id
        });

        // Try to get pending wager for bet amounts
        // USE SMART NAME-MATCHING (P1)
        const pendingWager = ticketManager.getAnyPendingWager(message.channel.name);

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

        // Create the ticket
        const ticket = ticketManager.createTicket(message.channel.id, ticketData);

        // Since we already detected a middleman, transition directly to AWAITING_PAYMENT_ADDRESS
        ticket.transition(STATES.AWAITING_MIDDLEMAN);
        ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: message.author.id });
        saveState();

        // SPEED OPTIMIZATION: Warm up the price oracle cache early
        priceOracle.preFetch(config.crypto_network);

        logger.info('✅ Ticket auto-created and moved to AWAITING_PAYMENT_ADDRESS', {
            channelId: message.channel.id,
            middlemanId: message.author.id,
            state: ticket.getState()
        });

        // Now try to extract address from this very message
        const network = config.crypto_network;
        const address = extractCryptoAddress(message.content, network);
        if (address) {
            logger.info('📬 Address found in MM message', { address });
            // Process it as if we were in AWAITING_PAYMENT_ADDRESS state
            return await handleAwaitingPaymentAddress(message, ticket);
        }

        return true;
    }

    // Not a middleman - might be opponent or someone else
    // Create a basic ticket and wait for middleman
    logger.debug('Creating basic ticket for non-MM message', { channelId: message.channel.id });

    // USE SMART NAME-MATCHING (P1)
    const pendingWager = ticketManager.getAnyPendingWager(message.channel.name);
    const ticketData = pendingWager ? {
        opponentId: pendingWager.userId,
        opponentBet: pendingWager.opponentBet,
        ourBet: pendingWager.ourBet,
        autoDetected: true
    } : {
        opponentId: message.author.id,  // Assume sender is opponent
        opponentBet: 0,
        ourBet: 0,
        autoDetected: true
    };

    const ticket = ticketManager.createTicket(message.channel.id, ticketData);
    ticket.transition(STATES.AWAITING_MIDDLEMAN);
    saveState();

    // SPEED OPTIMIZATION: Warm up the price oracle cache early (R4)
    priceOracle.preFetch(config.crypto_network);

    return true;
}

/**
 * Handle awaiting ticket state
 */
async function handleAwaitingTicket(message, ticket) {
    // Wait for opponent to join
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

    // DEBUG: Log middleman check
    const isMiddlemanResult = isMiddleman(userId);
    logger.debug('Middleman check', {
        channelId: ticket.channelId,
        userId,
        isMiddleman: isMiddlemanResult,
        configMiddlemen: config.middleman_ids?.length || 0
    });

    // Check if message is from a middleman
    if (isMiddlemanResult) {
        // Try to update bet amounts if they are still 0
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

        // SPEED OPTIMIZATION: Warm up the price oracle cache early
        priceOracle.preFetch(config.crypto_network);

        logger.info('🟢 Middleman detected! Awaiting address...', { channelId: ticket.channelId, middlemanId: userId });
        return true;
    }

    return false;
}

// Debug flag
const DEBUG = process.env.DEBUG === '1';

/**
 * Handle awaiting payment address state
 */
async function handleAwaitingPaymentAddress(message, ticket) {
    // DEBUG: Log all messages in this state
    if (DEBUG) {
        logger.debug('[ADDR_STATE] Message received in AWAITING_PAYMENT_ADDRESS', {
            authorId: message.author.id,
            middlemanId: ticket.data.middlemanId,
            isMiddleman: message.author.id === ticket.data.middlemanId,
            content: message.content,
            contentLength: message.content.length
        });
    }

    // Only process middleman messages
    if (message.author.id !== ticket.data.middlemanId) {
        if (DEBUG) {
            logger.debug('[ADDR_STATE] SKIP - Not from middleman', {
                authorId: message.author.id,
                expectedMiddlemanId: ticket.data.middlemanId
            });
        }
        return false;
    }

    const network = config.crypto_network;
    const address = extractCryptoAddress(message.content, network);

    // Also check for bet updates here just in case (e.g. "Send 10 to [address]")
    if (ticket.data.opponentBet === 0) {
        const betData = extractBetAmounts(message.content);
        if (betData) {
            const taxMultiplier = new BigNumber(1).plus(config.tax_percentage);
            const ourBet = new BigNumber(betData.opponent).times(taxMultiplier);
            ticket.updateData({
                opponentBet: betData.opponent,
                ourBet: parseFloat(ourBet.toFixed(2))
            });
            logger.info('💸 Updated bet amounts in address state', {
                opponentBet: ticket.data.opponentBet,
                ourBet: ticket.data.ourBet
            });
        }
    }

    // DEBUG: Log extraction result
    if (DEBUG) {
        logger.debug('[ADDR_STATE] Address extraction result', {
            network,
            extractedAddress: address,
            messageContent: message.content,
            contentWords: message.content.split(/\s+/)
        });
    }

    if (!address) {
        // If message is decently long or contains "address", but we failed to parse, warn the user
        if (message.content.length > 20 || message.content.toLowerCase().includes('address')) {
            await message.reply(`⚠️ I couldn't find a valid ${network} address. Please paste ONLY the address or check format.`);
        }
        return false;
    }

    // Validate address before sending
    const validation = validatePaymentAddress(address, network);
    if (!validation.valid) {
        logger.warn('Invalid payment address', {
            address,
            reason: validation.reason,
            channelId: ticket.channelId
        });
        return false;
    }

    logger.info('Payment address received', {
        channelId: ticket.channelId,
        address,
        network
    });

    // Check if payment already sent (crash recovery)
    if (ticket.hasPaymentBeenSent()) {
        logger.warn('Payment already sent for this ticket', {
            channelId: ticket.channelId,
            txId: ticket.data.paymentTxId
        });
        return true;
    }

    // Calculate payment amount (this would need USD to crypto conversion in production)
    // For now, we're assuming amounts are already in crypto
    // Check if payment is already being processed (Lock)
    if (ticket.data.paymentLocked) {
        logger.warn('Payment already in progress (Locked)', { channelId: ticket.channelId });
        return false;
    }

    const amountUsd = ticket.data.ourBet; // Assuming ourBet is in USD for conversion

    // Lock payment to prevent race conditions
    ticket.updateData({ paymentLocked: true });
    saveState();

    // SPEED OPTIMIZATION: Use fastDelay instead of humanDelay for payout execution
    await fastDelay();

    try {
        logGame('PAYMENT_ATTEMPT', {
            channelId: ticket.channelId,
            network,
            amountUsd
        });

        // sendPayment now handles conversion and price fetching internally
        const result = await sendPayment(address, amountUsd, network, ticket.channelId);

        if (result.success) {
            ticket.transition(STATES.PAYMENT_SENT, {
                paymentAddress: address,
                paymentTxId: result.txId
            });
            saveState();

            // Notify in channel via rate-limited queue
            const confirmMsg = config.response_templates.payment_sent
                .replace('{txid}', result.txId)
                .replace('{amount}', amountUsd.toFixed(2));
            await messageQueue.send(message.channel, confirmMsg);

            logGame('PAYMENT_SUCCESS', {
                channelId: ticket.channelId,
                txId: result.txId,
                amount: amountUsd
            });

            // Log to webhook
            logPayment(ticket.channelId, amountUsd, result.txId, network);
        } else {
            throw new Error(result.error || 'Unknown payment error');
        }
    } catch (error) {
        logger.error('Payment failed', {
            channelId: ticket.channelId,
            error: error.message
        });

        await messageQueue.send(message.channel, `Payment failed: ${error.message}`);

        // Release lock so we can try again
        ticket.updateData({ paymentLocked: false });
        saveState();
    }

    return true;
}

/**
 * Handle payment sent state - waiting for confirmation
 */
async function handlePaymentSent(message, ticket) {
    // Check for middleman confirmation
    if (message.author.id === ticket.data.middlemanId || isMiddleman(message.author.id)) {
        const isConfirm = isPaymentConfirmation(message.content);
        const gameStart = extractGameStart(message.content);

        if (isConfirm || gameStart) {
            // Bot says "Confirm" to acknowledge via queue
            await messageQueue.send(message.channel, 'Confirm');

            ticket.transition(STATES.AWAITING_GAME_START);
            saveState();

            logger.info('✅ Payment confirmed (or game started), bot acknowledged', {
                channelId: ticket.channelId,
                trigger: isConfirm ? 'PAYMENT_CONFIRM' : 'GAME_START'
            });

            // If it was a game start, we need to process it immediately in the next state
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
    // Check for game start from middleman
    if (message.author.id !== ticket.data.middlemanId && !isMiddleman(message.author.id)) {
        return false;
    }

    const gameStart = extractGameStart(message.content);
    if (!gameStart) {
        return false;
    }

    // Acknowledge the middleman immediately
    await messageQueue.send(message.channel, 'Confirm');

    // Determine if we go first
    const botId = message.client.user.id;
    const botGoesFirst = gameStart.botFirst || gameStart.userId === botId;

    // Initialize score tracker
    const tracker = new ScoreTracker(ticket.channelId);
    gameTrackers.set(ticket.channelId, tracker);

    ticket.transition(STATES.GAME_IN_PROGRESS, { botGoesFirst });
    saveState();

    logger.info('Game started with middleman setup', {
        channelId: ticket.channelId,
        botGoesFirst,
        content: message.content
    });

    // If we go first, roll dice automatically
    if (botGoesFirst) {
        logger.info('🎲 Bot goes first - auto-rolling...', { channelId: ticket.channelId });
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

    // GAME STATE RECOVERY (P3)
    // If tracker is missing (e.g. after restart), reconstruct it from ticket data
    if (!tracker && ticket.data.gameScores) {
        logger.info('🔄 Reconstructing ScoreTracker from persisted state', { channelId: ticket.channelId });
        tracker = ScoreTracker.fromJSON({
            ticketId: ticket.channelId,
            winsNeeded: config.game_settings.wins_to_complete,
            botWinsTies: config.game_settings.bot_wins_ties,
            scores: ticket.data.gameScores,
            rounds: ticket.data.gameHistory || [], // We'll start tracking history if we weren't
            startedAt: ticket.createdAt,
            completedAt: null,
            winner: null
        });
        gameTrackers.set(ticket.channelId, tracker);
    }

    if (!tracker) {
        logger.error('No tracker for game and no recovery data', { channelId: ticket.channelId });
        return false;
    }

    // Check if it's our turn to respond to a dice roll
    // This depends on the specific dice bot being used

    // DISCORD-FIRST TRUTH (P4)
    // Instead of faking rolls locally, we record results from the actual dice bot output

    // 1. Check if this is a dice result from the dice bot
    const roll = extractDiceResult(message.content);
    if (roll) {
        // If it's the bot's own roll
        if (message.author.id === message.client.user.id) {
            tracker.lastBotRoll = roll;
            logger.debug('🤖 Recorded bot roll from Discord', { roll });
        } else {
            // Assume any other roll in this channel is the opponent
            tracker.lastOpponentRoll = roll;
            logger.debug('👤 Recorded opponent roll from Discord', { roll });
        }

        // If we have both rolls, record the round
        if (tracker.lastBotRoll && tracker.lastOpponentRoll) {
            const botRoll = tracker.lastBotRoll;
            const opponentRoll = tracker.lastOpponentRoll;

            // Clear for next round
            tracker.lastBotRoll = null;
            tracker.lastOpponentRoll = null;

            const result = tracker.recordRound(botRoll, opponentRoll);
            ticket.updateData({ gameScores: tracker.scores, gameHistory: tracker.rounds });
            saveState();

            const roundMsg = `${DiceEngine.formatResult(botRoll)} vs ${DiceEngine.formatResult(opponentRoll)} - ${result.roundWinner === 'bot' ? 'I win!' : 'You win!'} (${tracker.getFormattedScore()})`;
            await messageQueue.send(message.channel, roundMsg);

            if (result.gameOver) {
                await handleGameComplete(message.channel, ticket, tracker);
            } else {
                // If it's our turn to go first next round, roll now
                // (Depends on who won the last round in some rules, but usually alternating)
                // For now, let the middleman call it or respond to opponent roll
            }
        }
        return true;
    }

    // 2. Respond to middleman "roll" commands
    if (message.author.id === ticket.data.middlemanId) {
        const content = message.content.toLowerCase();
        if (content.includes('roll') || content.includes('your turn') || content.includes(message.client.user.username.toLowerCase())) {
            await rollDice(message.channel, ticket);
            return true;
        }
    }

    // 3. Auto-respond to opponent roll if we haven't rolled yet
    if (tracker.lastOpponentRoll && !tracker.lastBotRoll) {
        await rollDice(message.channel, ticket);
        return true;
    }

    return false;
}

/**
 * Roll dice and handle result
 */
async function rollDice(channel, ticket) {
    await gameActionDelay();

    // DISCORD-FIRST TRUTH (P4)
    // We send the command but we DO NOT record it yet.
    // The handleGameInProgress function will see the bot's own message (result)
    // and record it then. This ensures 100% sync with the server dice bot.

    const diceCmd = config.game_settings.dice_command || '-roll';
    await messageQueue.send(channel, diceCmd);
    logger.info('🎲 Sent dice command, awaiting Discord result...', { channelId: ticket.channelId });
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

    logGame('GAME_RESULT', {
        channelId: ticket.channelId,
        winner: tracker.winner,
        finalScore: tracker.scores,
        didWin
    });

    // Log to webhook (calculate net profit roughly)
    const profit = didWin ? ticket.data.opponentBet : -ticket.data.ourBet;
    logGameResult(ticket.channelId, tracker.winner, profit);

    if (didWin) {
        // Post payout address with amount owed
        const payoutAddr = getPayoutAddress();
        const amountOwed = ticket.data.opponentBet;
        const network = config.crypto_network || 'LTC';

        await humanDelay();
        await messageQueue.send(channel, `GG! 🎉 Send $${amountOwed.toFixed(2)} (${network}) to:`);
        await humanDelay();
        await messageQueue.send(channel, `\`${payoutAddr}\``);

        // Post vouch after a delay
        logger.info('🏆 Bot won! Posting vouch in 5 seconds...', { channelId: ticket.channelId });
        setTimeout(async () => {
            try {
                await postVouch(channel.client, ticket);
            } catch (e) {
                logger.error('Failed to post vouch', { error: e.message });
            }
        }, 5000);
    } else {
        await humanDelay();
        await messageQueue.send(channel, 'GG, well played!');
    }

    // Clean up
    gameTrackers.delete(ticket.channelId);
    ticketManager.removeTicket(ticket.channelId);
}

/**
 * Post vouch to vouch channel
 */
async function postVouch(client, ticket) {
    const vouchChannelId = process.env.VOUCH_CHANNEL_ID || config.channels.vouch_channel_id;

    if (!vouchChannelId || vouchChannelId === 'YOUR_VOUCH_CHANNEL_ID') {
        logger.warn('Vouch channel not configured');
        return;
    }

    try {
        const vouchChannel = await client.channels.fetch(vouchChannelId);
        if (!vouchChannel) {
            logger.error('Could not find vouch channel', { channelId: vouchChannelId });
            return;
        }

        const opponentId = ticket.data.opponentId;
        const middlemanId = ticket.data.middlemanId;
        const amount = ticket.data.opponentBet || 0;

        // Guard against missing data (can happen with auto-detected tickets)
        if (!opponentId) {
            logger.warn('Cannot post vouch: no opponent ID', { channelId: ticket.channelId });
            return;
        }

        const vouchMsg = config.response_templates.vouch_win
            .replace('{amount}', amount.toFixed(2))
            .replace('{opponent}', `<@${opponentId}>`)
            .replace('{middleman}', middlemanId ? `<@${middlemanId}>` : 'MM');

        await messageQueue.send(vouchChannel, vouchMsg);

        logger.info('Vouch posted', {
            channelId: vouchChannelId,
            opponent: opponentId,
            amount
        });
    } catch (error) {
        logger.error('Failed to post vouch', { error: error.message });
    }
}

/**
 * Handle message updates (Ninja-Edit detection)
 */
async function handleMessageUpdate(oldMessage, newMessage) {
    const channelId = oldMessage.channel.id;
    const ticket = ticketManager.getTicket(channelId);
    if (!ticket) return;

    logger.warn('🕵️ Ninja-Edit detected!', {
        channelId,
        author: oldMessage.author.tag,
        oldContent: oldMessage.content,
        newContent: newMessage.content
    });

    // Check for critical fraud (editing addresses or rolls)
    const network = config.crypto_network;
    const oldAddr = extractCryptoAddress(oldMessage.content, network);
    const newAddr = extractCryptoAddress(newMessage.content, network);

    if (oldAddr && newAddr && oldAddr !== newAddr) {
        logger.error('🚨 FRAUD ALERT: Crypto address edited in ticket!', { channelId, oldAddr, newAddr });
        await messageQueue.send(oldMessage.channel, '⚠️ CRITICAL: Crypto address modification detected. Flow halted for safety.');
    }

    const oldRoll = extractDiceResult(oldMessage.content);
    const newRoll = extractDiceResult(newMessage.content);
    if (oldRoll !== null && newRoll !== null && oldRoll !== newRoll) {
        logger.error('🚨 FRAUD ALERT: Dice roll edited in ticket!', { channelId, oldRoll, newRoll });
        await messageQueue.send(oldMessage.channel, '⚠️ CRITICAL: Dice roll modification detected.');
    }
}

/**
 * Handle channel deletion (P4)
 */
async function handleChannelDelete(channel) {
    const channelId = channel.id;
    if (ticketManager.getTicket(channelId)) {
        logger.warn('🗑️ Ticket channel deleted manually - purging state', { channelId });
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
