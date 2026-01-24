/**
 * Ticket Handler - Orchestrates full ticket lifecycle
 */

const BigNumber = require('bignumber.js');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');
const { extractCryptoAddress, extractGameStart, extractDiceResult, isPaymentConfirmation } = require('../../utils/regex');
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

    // If no ticket exists, check if this is a new ticket being created
    if (!ticket) {
        return handlePotentialNewTicket(message);
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
    if (!channelName.includes('ticket')) {
        return false;
    }

    // This could be a ticket - check if we need to track it
    // We'll create a ticket when we detect our opponent in the channel
    logger.debug('Potential ticket channel detected', { channelId: message.channel.id, name: channelName });
    return false;
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

    // Check if message is from a middleman
    if (isMiddleman(userId)) {
        ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS, { middlemanId: userId });
        saveState();
        logger.info('Middleman detected', { channelId: ticket.channelId, middlemanId: userId });
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

    // Roll our dice
    const botRoll = DiceEngine.roll();

    // Send dice command/result
    const diceCmd = config.game_settings.dice_command;
    await channel.send(diceCmd);

    // If we have opponent's roll, record the round
    if (opponentRoll !== null && tracker) {
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
    const vouchChannelId = config.channels.vouch_channel_id;

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
        const amount = ticket.data.opponentBet; // We won their bet amount

        const vouchMsg = config.response_templates.vouch_win
            .replace('{amount}', amount.toFixed(2))
            .replace('{opponent}', `<@${opponentId}>`)
            .replace('{middleman}', `<@${ticket.data.middlemanId}>`);

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
 */
function createTicket(channelId, opponentId, opponentBet, ourBet) {
    return ticketManager.createTicket(channelId, {
        opponentId,
        opponentBet,
        ourBet
    });
}

module.exports = {
    handleMessage,
    createTicket,
    postVouch
};
