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

    // Latching Logic: If ticket exists but has no opponent (e.g. auto-created),
    // try to latch onto the first user who speaks
    if (!ticket.data.opponentId) {
        const latched = await handleLatchOpponent(message, ticket);
        if (latched) {
            // If we just latched, we can continue processing or stop here.
            // Continuing allows them to trigger commands immediately.
            logger.info('Latched onto opponent', { channelId, userId: message.author.id });
        }
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
    if (!channelName.includes('ticket') && !channelName.includes('wager')) {
        return false;
    }

    // Create ticket with 0 bet initially (opponentId will be set by latch logic below)
    // We pass null for opponentId first to let handleLatchOpponent handle validation
    const ticket = createTicket(message.channel.id, null, 0, 0);

    // Attempt latch immediately
    return await handleLatchOpponent(message, ticket, true);
}

/**
 * Attempt to latch onto a user as the opponent
 * @param {Message} message
 * @param {TicketStateMachine} ticket
 * @param {boolean} isNew - If true, this is a fresh ticket
 */
async function handleLatchOpponent(message, ticket, isNew = false) {
    const userId = message.author.id;

    // Ignore bots and middlemen from latching
    if (message.author.bot || isMiddleman(userId)) {
        return false;
    }

    // Update ticket with opponent
    ticket.updateData({ opponentId: userId });

    // Update TicketManager index manually since we modified data directly
    // (createTicket usually handles this, but here we might be updating an existing one)
    ticketManager.userIndex.set(userId, ticket);
    ticketManager.setCooldown(userId);

    saveState();

    logger.info('Latched onto opponent in ticket channel', {
        channelId: message.channel.id,
        userId
    });

    // Notify
    if (isNew || !ticket.data.announcedLatch) {
        await humanDelay();
        await message.reply('Ticket initialized. Please state your wager (e.g. "10v10").');
        ticket.updateData({ announcedLatch: true });
        saveState();
    }

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
    let tracker = gameTrackers.get(ticket.channelId);

    // Restore tracker from state if missing (crash recovery)
    if (!tracker && ticket.data.trackerState) {
        try {
            tracker = ScoreTracker.fromJSON(ticket.data.trackerState);
            gameTrackers.set(ticket.channelId, tracker);
            logger.info('Restored score tracker from state', { channelId: ticket.channelId });
        } catch (e) {
            logger.error('Failed to restore tracker', { error: e.message });
        }
    }

    if (!tracker) {
        logger.error('No tracker for game', { channelId: ticket.channelId });
        return false;
    }

    // Option 1: Opponent rolled (or dice bot for opponent)
    // We assume any roll not from us is the opponent's,
    // unless strictly filtered by isDiceBot + mention check (TODO)
    const opponentRoll = extractDiceResult(message.content);
    if (opponentRoll && message.author.id !== message.client.user.id) {
        await gameActionDelay();
        await rollDice(message.channel, ticket, opponentRoll, tracker);
        return true;
    }

    // Option 2: Middleman forces a roll (e.g. if we stalled)
    if (message.author.id === ticket.data.middlemanId) {
        const content = message.content.toLowerCase();
        if (content.includes('roll') || content.includes('dice') || content.includes('your turn')) {
            // Only roll if we haven't already committed a roll
            if (!tracker.pendingBotRoll) {
                await gameActionDelay();
                await rollDice(message.channel, ticket, null, tracker);
            }
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
        tracker = gameTrackers.get(ticket.channelId) ||
                  (ticket.data.trackerState ? ScoreTracker.fromJSON(ticket.data.trackerState) : null);
        if (tracker) gameTrackers.set(ticket.channelId, tracker);
    }

    if (!tracker) return;

    // SCENARIO 1: We are initiating the roll (waiting for opponent)
    if (opponentRoll === null) {
        // Generate and store our roll
        const botRoll = DiceEngine.roll();
        tracker.pendingBotRoll = botRoll;

        // Persist state immediately
        ticket.updateData({
            trackerState: tracker.toJSON()
        });
        await saveState();

        // Announce our roll
        // We do NOT send the dice command to avoid confusion if we are the authority
        const rollMsg = `I rolled ${DiceEngine.formatResult(botRoll)}`;
        await channel.send(rollMsg);

        logger.info('Bot rolled (pending)', { channelId: ticket.channelId, roll: botRoll });
        return;
    }

    // SCENARIO 2: We are responding to opponent's roll
    let botRoll;
    if (tracker.pendingBotRoll) {
        // Use the committed roll
        botRoll = tracker.pendingBotRoll;
        tracker.pendingBotRoll = null; // Clear it
    } else {
        // We generate a new roll now (simultaneous or they went first)
        botRoll = DiceEngine.roll();
    }

    const result = tracker.recordRound(botRoll, opponentRoll);

    // Update ticket state with full tracker data
    ticket.updateData({
        gameScores: tracker.scores,
        trackerState: tracker.toJSON()
    });
    await saveState();

    // Announce round result
    const roundMsg = `${DiceEngine.formatResult(botRoll)} vs ${DiceEngine.formatResult(opponentRoll)} - ${result.roundWinner === 'bot' ? 'I win!' : 'You win!'} (${tracker.getFormattedScore()})`;
    await humanDelay(roundMsg);
    await channel.send(roundMsg);

    logger.info('Round complete', {
        channelId: ticket.channelId,
        botRoll,
        opponentRoll,
        winner: result.roundWinner
    });

    // Check for game completion
    if (result.gameOver) {
        await handleGameComplete(channel, ticket, tracker);
    } else {
        // Game continues - Immediately roll for next round to speed up play
        await gameActionDelay();
        // Recursive call to initiate next round (Scenario 1)
        await rollDice(channel, ticket, null, tracker);
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
 * Since the opponent already sent their bet message, we skip AWAITING_TICKET
 * and go directly to AWAITING_MIDDLEMAN state.
 */
function createTicket(channelId, opponentId, opponentBet, ourBet) {
    // Check if ticket exists (e.g. from latching) and update it
    let ticket = ticketManager.getTicket(channelId);

    if (ticket) {
        // Update existing ticket data
        ticket.updateData({
            opponentId,
            opponentBet,
            ourBet
        });
        logger.info('Updated existing ticket with bet data', { channelId, opponentBet });
    } else {
        // Create new ticket
        ticket = ticketManager.createTicket(channelId, {
            opponentId,
            opponentBet,
            ourBet
        });
    }

    // CRITICAL: Ensure we are in correct state
    // If we were just created or latched (AWAITING_TICKET), move to AWAITING_MIDDLEMAN
    if (ticket.getState() === STATES.AWAITING_TICKET) {
        ticket.transition(STATES.AWAITING_MIDDLEMAN);
    }

    saveState();

    logger.info('Ticket ready for middleman', { channelId, opponentId });
    return ticket;
}

module.exports = {
    handleMessage,
    createTicket,
    postVouch
};
