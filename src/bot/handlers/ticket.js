/**
 * Ticket Handler - Orchestrates full ticket lifecycle
 */

const BigNumber = require('bignumber.js');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');
const { extractCryptoAddress, extractGameStart, extractDiceResult, isPaymentConfirmation, extractBetAmounts } = require('../../utils/regex');
const { isMiddleman, validatePaymentAddress } = require('../../utils/validator');
const { humanDelay, gameActionDelay } = require('../../utils/delay');
const { logger, logGame } = require('../../utils/logger');
const { sendPayment, getPayoutAddress, validateAddress } = require('../../crypto');
const { logGameResult, logPayment } = require('../../utils/notifier');
const DiceEngine = require('../../game/DiceEngine');
const ScoreTracker = require('../../game/ScoreTracker');

// Store ScoreTrackers by channel ID
const gameTrackers = new Map();

/**
 * Handle message in a ticket context
 * @param {Message} message - Discord message
 * @returns {Promise<boolean>} - True if handled
 */
async function handleMessage(message) {
    const channelId = message.channel.id;
    const ticket = ticketManager.getTicket(channelId);

    // DEBUG: Log every message that goes through ticket handler
    if (logger.isLevelEnabled('debug')) {
        logger.debug('Ticket handler processing', {
            channelId,
            hasTicket: !!ticket,
            state: ticket?.getState() || 'NO_TICKET',
            authorId: message.author.id,
            content: message.content.substring(0, 50)
        });
    }

    // If no ticket exists, check if this is a new ticket being created
    if (!ticket) {
        if (await handlePotentialNewTicket(message)) {
            // Ticket created, re-process message to allow immediate latching
            return handleMessage(message);
        }
        return false;
    }

    // Route to appropriate handler based on state
    switch (ticket.getState()) {
        case STATES.AWAITING_TICKET:
            return handleAwaitingTicket(message, ticket);
        case STATES.AWAITING_MIDDLEMAN:
            return handleAwaitingMiddleman(message, ticket);
        case STATES.AWAITING_PAYMENT_ADDRESS:
            return handleAwaitingPaymentAddress(message, ticket);
        case STATES.PAYMENT_SENT:
            return handlePaymentSent(message, ticket);
        case STATES.AWAITING_GAME_START:
            return handleAwaitingGameStart(message, ticket);
        case STATES.GAME_IN_PROGRESS:
            return handleGameInProgress(message, ticket);
        default:
            return false;
    }
}

/**
 * Check if this message represents a new ticket
 */
async function handlePotentialNewTicket(message) {
    // Check if channel name looks like a ticket
    const channelName = message.channel.name?.toLowerCase() || '';
    if (channelName.includes('ticket')) {
        // Create ticket with no opponent yet (waiting for latch)
        // We assume amounts will be detected in AWAITING_TICKET phase
        const ticket = ticketManager.createTicket(message.channel.id, {
            opponentId: null,
            opponentBet: 0,
            ourBet: 0
        });

        logger.info('Ticket channel detected, initialized tracking', { channelId: message.channel.id });
        return true;
    }
    return false;
}

/**
 * Handle awaiting ticket state
 */
async function handleAwaitingTicket(message, ticket) {
    const userId = message.author.id;

    // Ignore bots and known middlemen for latching
    if (message.author.bot || isMiddleman(userId)) {
        return false;
    }

    // Opponent Latching
    if (!ticket.data.opponentId) {
        ticketManager.updateOpponentId(ticket.channelId, userId);
        logger.info('Latched onto opponent', { channelId: ticket.channelId, opponentId: userId });
        saveState();
    }

    // Bet Amount Detection (if not already set)
    if (!ticket.data.opponentBet) {
        const betData = extractBetAmounts(message.content);
        if (betData) {
            const opponentBet = betData.opponent;

            // Calculate our bet
            const taxMultiplier = new BigNumber(1).plus(config.tax_percentage);
            const ourBet = new BigNumber(opponentBet).times(taxMultiplier).toNumber(); // approximated for storage

            ticket.updateData({
                opponentBet: opponentBet,
                ourBet: ourBet
            });
            saveState();

            logger.info('Bet amounts detected in ticket', {
                channelId: ticket.channelId,
                opponentBet,
                ourBet
            });
        }
    }

    // Wait for opponent confirmation (latch successful) and valid bet
    if (ticket.data.opponentId === userId && ticket.data.opponentBet > 0) {
        ticket.transition(STATES.AWAITING_MIDDLEMAN);
        saveState();

        logger.info('Opponent confirmed and bet set, waiting for middleman', { channelId: ticket.channelId });

        // Announce status
        await humanDelay();
        await message.channel.send(`Ticket initialized. Waiting for middleman... (Bet: ${ticket.data.opponentBet} vs ${ticket.data.ourBet.toFixed(2)})`);
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
    if (logger.isLevelEnabled('debug')) {
        logger.debug('Middleman check', {
            channelId: ticket.channelId,
            userId,
            isMiddleman: isMiddlemanResult,
            configMiddlemen: config.middleman_ids?.length || 0
        });
    }

    // Check if message is from a middleman
    if (isMiddlemanResult) {
        ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: userId });
        saveState();
        logger.info('🟢 Middleman detected! Awaiting address...', { channelId: ticket.channelId, middlemanId: userId });
        return true;
    }

    return false;
}

/**
 * Handle awaiting payment address state
 */
async function handleAwaitingPaymentAddress(message, ticket) {
    // Only process middleman messages
    if (message.author.id !== ticket.data.middlemanId) {
        return false;
    }

    const network = config.crypto_network;
    const address = extractCryptoAddress(message.content, network);

    if (!address) {
        // If message is decently long or contains "address", but we failed to parse, warn the user
        if (message.content.length > 20 || message.content.toLowerCase().includes('address')) {
            await humanDelay();
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

    // Calculate payment amount
    // Check if payment is already being processed (Lock)
    if (ticket.data.paymentLocked) {
        logger.warn('Payment already in progress (Locked)', { channelId: ticket.channelId });
        return false;
    }

    // Safety guard for zero bet
    if (!ticket.data.ourBet || ticket.data.ourBet <= 0) {
        logger.error('Attempted payment with zero/invalid amount', { channelId: ticket.channelId, amount: ticket.data.ourBet });
        await humanDelay();
        await message.channel.send("⚠️ Error: Bet amount invalid. Cannot proceed with payment.");
        return false;
    }

    const amount = ticket.data.ourBet;

    // Lock payment to prevent race conditions
    ticket.updateData({ paymentLocked: true });
    saveState();

    // Send payment
    await humanDelay();

    logGame('PAYMENT_ATTEMPT', {
        channelId: ticket.channelId,
        address,
        amount,
        network
    });

    const result = await sendPayment(address, amount);

    if (result.success) {
        ticket.transition(STATES.PAYMENT_SENT, {
            paymentAddress: address,
            paymentTxId: result.txId
        });
        saveState();

        // Notify in channel
        const confirmMsg = config.response_templates.payment_sent.replace('{txid}', result.txId);
        await humanDelay(confirmMsg);
        await message.channel.send(confirmMsg);

        logGame('PAYMENT_SUCCESS', {
            channelId: ticket.channelId,
            txId: result.txId,
            amount
        });

        // Log to webhook
        logPayment(ticket.channelId, amount, result.txId, network);
    } else {
        logger.error('Payment failed', {
            channelId: ticket.channelId,
            error: result.error
        });

        await humanDelay();
        await message.channel.send(`Payment failed: ${result.error}`);

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
    if (message.author.id === ticket.data.middlemanId) {
        if (isPaymentConfirmation(message.content)) {
            ticket.transition(STATES.AWAITING_GAME_START);
            saveState();
            logger.info('Payment confirmed, awaiting game start', { channelId: ticket.channelId });
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
    if (message.author.id !== ticket.data.middlemanId) {
        return false;
    }

    const gameStart = extractGameStart(message.content);
    if (!gameStart) {
        return false;
    }

    // Determine if we go first
    const botId = message.client.user.id;
    const botGoesFirst = gameStart.userId === botId;

    // Initialize score tracker
    const tracker = new ScoreTracker(ticket.channelId);
    gameTrackers.set(ticket.channelId, tracker);

    ticket.transition(STATES.GAME_IN_PROGRESS, { botGoesFirst });
    saveState();

    logger.info('Game started', {
        channelId: ticket.channelId,
        botGoesFirst
    });

    // If we go first, roll dice
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
    const tracker = gameTrackers.get(ticket.channelId);
    if (!tracker) {
        logger.error('No tracker for game', { channelId: ticket.channelId });
        return false;
    }

    // Check if it's our turn to respond to a dice roll
    // This depends on the specific dice bot being used

    // Option 1: If opponent just rolled, we see their result and roll ours
    const opponentRoll = extractDiceResult(message.content);
    if (opponentRoll && message.author.id !== message.client.user.id) {
        // Record their roll and do our roll
        await gameActionDelay();
        await rollDice(message.channel, ticket, opponentRoll, tracker);
        return true;
    }

    // Option 2: If middleman asks us to roll
    if (message.author.id === ticket.data.middlemanId) {
        const content = message.content.toLowerCase();
        if (content.includes('roll') || content.includes('dice') || content.includes('your turn')) {
            await gameActionDelay();
            await rollDice(message.channel, ticket, null, tracker);
            return true;
        }
    }

    return false;
}

/**
 * Roll dice and handle result
 */
async function rollDice(channel, ticket, opponentRoll = null, tracker = null) {
    if (!tracker) {
        tracker = gameTrackers.get(ticket.channelId);
    }

    // Check for pending bot roll first
    let botRoll;
    if (tracker.pendingBotRoll) {
        botRoll = tracker.pendingBotRoll;
    } else {
        botRoll = DiceEngine.roll();
    }

    // If we are rolling first (no opponent roll yet), store it and wait
    if (opponentRoll === null) {
        tracker.pendingBotRoll = botRoll;
        saveState();

        // Send dice command
        const diceCmd = config.game_settings.dice_command;
        await channel.send(diceCmd);

        logger.info('Rolled first, waiting for opponent', { channelId: ticket.channelId, botRoll });
        return;
    }

    // If we have opponent's roll, we can proceed to record the round
    // Send dice command/result
    const diceCmd = config.game_settings.dice_command;
    await channel.send(diceCmd);

    await humanDelay();

    const result = tracker.recordRound(botRoll, opponentRoll);

    // Update ticket with current scores
    ticket.updateData({ gameScores: tracker.scores });
    saveState();

    // Announce round result
    const roundMsg = `${DiceEngine.formatResult(botRoll)} vs ${DiceEngine.formatResult(opponentRoll)} - ${result.roundWinner === 'bot' ? 'I win!' : 'You win!'} (${tracker.getFormattedScore()})`;
    await humanDelay(roundMsg);
    await channel.send(roundMsg);

    // Check for game completion
    if (result.gameOver) {
        await handleGameComplete(channel, ticket, tracker);
    }
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
        // Post payout address
        const payoutAddr = getPayoutAddress();
        await humanDelay();
        await channel.send(`GG! Send payout to: ${payoutAddr}`);

        // Post vouch after a delay
        await new Promise(r => setTimeout(r, 5000));
        await postVouch(channel.client, ticket);
    } else {
        await humanDelay();
        await channel.send('GG, well played!');
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

        await humanDelay(vouchMsg);
        await vouchChannel.send(vouchMsg);

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
 * Create a new ticket for a channel
 * NOTE: This is kept for backward compatibility or explicit calls,
 * but most tickets start via channel detection now.
 */
function createTicket(channelId, opponentId, opponentBet, ourBet) {
    const ticket = ticketManager.createTicket(channelId, {
        opponentId,
        opponentBet,
        ourBet
    });

    // If we have full info, we can go to AWAITING_MIDDLEMAN
    ticket.transition(STATES.AWAITING_MIDDLEMAN);
    saveState();

    logger.info('Ticket created explicitly', { channelId, opponentId });
    return ticket;
}

module.exports = {
    handleMessage,
    createTicket,
    postVouch
};
