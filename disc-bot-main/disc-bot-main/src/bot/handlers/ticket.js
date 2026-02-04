/**
 * Ticket Handler - Orchestrates full ticket lifecycle
 */

const BigNumber = require('bignumber.js');
const config = require('../../../config.json');
const { ticketManager } = require('../../state/TicketManager');
const { STATES } = require('../../state/StateMachine');
const { saveState } = require('../../state/persistence');
const { extractBetAmounts, extractCryptoAddress, extractGameStart, extractDiceResult, isPaymentConfirmation, isConfirmation, isRejection, isAmbiguous, isGameStartSignal, isTurnIndicator, isInfoRequest, detectCounterOffer, isAdReference, isVouchKeyword, isCancellation } = require('../../utils/regex');
const { isMiddleman, validatePaymentAddress } = require('../../utils/validator');
const { humanDelay, fastDelay, gameActionDelay } = require('../../utils/delay');
const { logger, logGame } = require('../../utils/logger');
const { sendPayment, getPayoutAddress } = require('../../crypto');
const { priceOracle } = require('../../crypto/PriceOracle');
const { logGameResult, logPayment } = require('../../utils/notifier');
const DiceEngine = require('../../game/DiceEngine');
const { messageQueue } = require('../../utils/MessageQueue');
const { commandCache } = require('../../state/CommandCache');
const ScoreTracker = require('../../game/ScoreTracker');

// Session lock: prevents concurrent processing of messages in the same channel (P2)
const processingSessions = new Set();

const DEBUG = process.env.DEBUG === '1';

/**
 * Extract all text from a message including embeds
 * Crucial for Dyno/Ticket Tool compatibility
 */
function getFullContent(message) {
    let text = message.content || '';
    if (message.embeds && message.embeds.length > 0) {
        for (const embed of message.embeds) {
            if (embed.description) text += ' ' + embed.description;
            if (embed.title) text += ' ' + embed.title;
            if (embed.footer?.text) text += ' ' + embed.footer.text;
            if (embed.author?.name) text += ' ' + embed.author.name;
            if (embed.fields) {
                for (const field of embed.fields) {
                    text += ' ' + field.name + ' ' + field.value;
                }
            }
        }
    }
    return text.trim();
}

/**
 * Robustly find the opponent in a channel's history
 */
async function findOpponentId(channel, ticket) {
    if (ticket.data.opponentId) return ticket.data.opponentId;

    try {
        const messages = await channel.messages.fetch({ limit: 100 });
        const botId = channel.client.user.id;

        const candidates = [...messages.values()]
            .filter(m => m.author.id !== botId && !isMiddleman(m.author.id) && !m.author.bot)
            .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

        if (candidates.length > 0) {
            const opponentId = candidates[0].author.id;
            logger.info('👤 RESOLVED_OPPONENT_IDENTITY', { channelId: channel.id, opponentId });
            return opponentId;
        }
    } catch (e) {
        logger.error('Failed to resolve opponent', { error: e.message });
    }
    return null;
}

function debugLog(reason, data = {}) {
    if (DEBUG) {
        logger.debug(`[${reason}]`, data);
    }
}

// LEAK PREVENTION (P4)
ticketManager.onTicketRemoved = (channelId) => {
    if (ticketManager.gameTrackers.has(channelId)) {
        ticketManager.gameTrackers.delete(channelId);
        logger.debug('🗑️ Purged GameTracker for removed ticket', { channelId });
    }
    if (processingSessions.has(channelId)) {
        processingSessions.delete(channelId);
    }
};

/**
 * INTELLIGENT HISTORY ANALYSIS (Master Prompt REQ 1)
 */
async function analyzeTicketHistory(channel, ticket) {
    try {
        logger.info(`📜 ANALYZING_HISTORY for ${channel.id}...`);
        const messages = await channel.messages.fetch({ limit: 100 }); // Step 3: Scan last 100 messages
        if (messages.size === 0) return null;

        const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        const context = {
            ltcAddresses: [],
            betTerms: null,
            participants: new Set(),
            middlemanDetected: null,
            gameStarted: false,
            lastRoll: null,
            confirmedBet: false,
            adReferenceDetected: false
        };

        const network = config.crypto_network || 'LTC';
        const botId = channel.client?.user?.id || config.client_id;

        for (const msg of sorted) {
            const authorId = msg.author.id;
            const content = getFullContent(msg);

            if (authorId === botId) continue;
            context.participants.add(authorId);

            const addr = extractCryptoAddress(content, network);
            if (addr) {
                context.ltcAddresses.push({
                    address: addr,
                    senderId: authorId,
                    senderName: msg.author.username,
                    timestamp: msg.createdTimestamp,
                    isTrusted: isMiddleman(authorId) || msg.author.bot
                });
            }

            const bet = extractBetAmounts(content);
            if (bet) {
                context.betTerms = {
                    opponent: bet.opponent,
                    raw: bet.raw,
                    senderId: authorId,
                    timestamp: msg.createdTimestamp
                };
            }

            if (isMiddleman(authorId)) {
                context.middlemanDetected = authorId;
            }

            if (isGameStartSignal(content)) {
                context.gameStarted = true;
            }

            const roll = extractDiceResult(content);
            if (roll !== null) {
                context.lastRoll = { roll, authorId, timestamp: msg.createdTimestamp };
            }

            if (isAdReference(content)) {
                context.adReferenceDetected = true;
            }
        }

        ticket.updateData({ historyContext: context });
        logger.info('📜 HISTORY_ANALYZED', { channelId: channel.id, participantCount: context.participants.size });
        return context;
    } catch (e) {
        logger.error('Failed to analyze history', { channelId: channel.id, error: e.message });
        return null;
    }
}

/**
 * Handle message in a ticket context
 */
async function handleMessage(message) {
    const channelId = message.channel.id;
    const ticket = ticketManager.getTicket(channelId);
    let stateBefore = ticket ? ticket.getState() : 'NONE';

    if (processingSessions.has(channelId)) {
        debugLog('IGNORE_SESSION_LOCKED', { channelId });
        return false;
    }
    processingSessions.add(channelId);

    let result = false;
    try {
        result = await _handleMessageInternal(message, ticket);
    } catch (error) {
        logger.error('Error in ticket handler', { channelId, error: error.message, stack: error.stack });
    } finally {
        processingSessions.delete(channelId);
    }

    const finalTicket = ticketManager.getTicket(channelId);
    let stateAfter = finalTicket ? finalTicket.getState() : 'NONE';

    if (result) {
        logger.info('DECISION', { ticketId: channelId, outcome: 'PROCESSED', action: 'MESSAGE_HANDLED', stateBefore, stateAfter });
    } else if (ticket) {
        logger.info('DECISION', { ticketId: channelId, outcome: 'IGNORED', reasonCode: 'NO_ACTION_MATCHED', stateBefore, stateAfter });
    }

    return result;
}

/**
 * Internal message handler logic
 */
async function _handleMessageInternal(message, ticket) {
    const channelId = message.channel.id;
    const authorId = message.author.id;
    const content = getFullContent(message);
    if (!content) return false;

    const botId = message.client.user.id;
    const isBot = authorId === botId;
    if (isBot) return true;

    if (!ticket) {
        return handlePotentialNewTicket(message);
    }

    if (!ticket.data.opponentId && !isMiddleman(authorId)) {
        ticket.updateData({ opponentId: authorId });
    } else if (!ticket.data.opponentId) {
        const resolvedId = await findOpponentId(message.channel, ticket);
        if (resolvedId) ticket.updateData({ opponentId: resolvedId });
    }

    const isMM = isMiddleman(authorId) || authorId === ticket.data?.middlemanId;
    const isOpponent = authorId === ticket.data?.opponentId;

    if (isMM && !ticket.data.middlemanId) {
        ticket.updateData({ middlemanId: authorId });
    }

    const now = Date.now();
    const lastMsgTime = ticket.data.lastMessageTimestamp || 0;
    const isGameActive = [STATES.GAME_IN_PROGRESS, STATES.WAITING_FOR_OUR_TURN, STATES.ROLL_SENT, STATES.WAITING_FOR_RESULT].includes(ticket.getState());

    if (now - lastMsgTime < (config.bet_cooldown_ms || 2500) && !isMM && !isOpponent) {
        return false;
    }
    ticket.updateData({ lastMessageTimestamp: now });

    const isCancel = isCancellation(content);
    if (isCancel) {
        const lower = content.toLowerCase();
        const isAdminKeyword = lower.includes('reset') || lower.includes('void') || lower.includes('refund');

        if (isAdminKeyword && !isMM) {
            logger.warn('🔒 UNAUTHORIZED ADMIN ACTION BLOCKED', { channelId, authorId });
            return true;
        }

        if (isMM || isOpponent) {
            if (lower.includes('reset')) {
                ticket.transition(STATES.AWAITING_MIDDLEMAN);
                await messageQueue.send(message.channel, 'Received. Ticket state reset to AWAITING_MIDDLEMAN.');
            } else {
                ticket.transition(STATES.CANCELLED, { cancellationReason: lower });
                await messageQueue.send(message.channel, 'Received. Ticket cancelled.');
            }
            saveState();
            return true;
        }
    }

    switch (ticket.getState()) {
        case STATES.AWAITING_WAGER_CLARIFICATION:
            return handleAwaitingWagerClarification(message, ticket);
        case STATES.AWAITING_TICKET:
            return handleAwaitingTicket(message, ticket);
        case STATES.AWAITING_MIDDLEMAN:
            return handleAwaitingMiddleman(message, ticket);
        case STATES.WAITING_FOR_OPPONENT_CONFIRM:
            return handleWaitingForOpponentConfirm(message, ticket);
        case STATES.AWAITING_PAYMENT_ADDRESS:
            return handleAwaitingPaymentAddress(message, ticket);
        case STATES.PAYMENT_SENT:
            return handlePaymentSent(message, ticket);
        case STATES.AWAITING_GAME_START:
        case STATES.WAITING_FOR_GAME_START:
            return handleAwaitingGameStart(message, ticket);
        case STATES.WAITING_FOR_OUR_TURN:
            return handleWaitingForOurTurn(message, ticket);
        case STATES.ROLL_SENT:
            return handleRollSent(message, ticket);
        case STATES.WAITING_FOR_RESULT:
            return handleWaitingForResult(message, ticket);
        case STATES.GAME_IN_PROGRESS:
            return handleGameInProgress(message, ticket);
        case STATES.GAME_COMPLETE:
            return handleGameCompleteState(message, ticket);
        default:
            return false;
    }
}

async function handlePotentialNewTicket(message) {
    try {
        const channelName = message.channel.name?.toLowerCase() || '';
        const channelId = message.channel.id;
        if (channelId === config.advertising?.channel_id) return false;

        const isMM = isMiddleman(message.author.id);
        const content = getFullContent(message);
        const betData = extractBetAmounts(content);

        const pendingWager = ticketManager.getAnyPendingWager(channelName, { mentions: message.mentions.users.map(u => u.id), messageContent: content, betAmount: betData?.opponent || 0 }) ||
            ticketManager.getPendingWager(message.author.id);

        if (isMM || pendingWager) {
            let ticketData;
            if (pendingWager) {
                const opponentBet = Math.min(pendingWager.opponentBet, 50);
                const ourBet = parseFloat((opponentBet * 1.20).toFixed(2));
                ticketData = { opponentId: pendingWager.userId, opponentBet, ourBet, autoDetected: true };
                const ticket = ticketManager.createTicket(channelId, ticketData);
                ticket.transition(STATES.AWAITING_MIDDLEMAN);
                await messageQueue.send(message.channel, `🤝 I'll take your $${opponentBet} vs my $${ourBet} (I win ties). Dice FT5. Add MM to start!`);
                await analyzeTicketHistory(message.channel, ticket);
            } else {
                const ticketData = { opponentId: null, opponentBet: 0, ourBet: 0, autoDetected: true, detectionMethod: 'trigger_message' };
                const ticket = ticketManager.createTicket(channelId, ticketData);
                ticket.transition(STATES.AWAITING_MIDDLEMAN, { middlemanId: message.author.id });

                // SPARTAN RULE: NEVER reply to public messages.
                const { classifyChannel, ChannelType } = require('../../utils/channelClassifier');
                const { type: channelType } = classifyChannel(message.channel);
                const isPrivate = channelType === ChannelType.TICKET || channelType === ChannelType.DM;

                if (betData) {
                    const opponentBet = Math.min(betData.opponent, 50);
                    const ourBet = parseFloat((opponentBet * 1.20).toFixed(2));
                    ticket.updateData({ opponentBet, ourBet });
                    ticket.transition(STATES.WAITING_FOR_OPPONENT_CONFIRM);
                    if (isPrivate) {
                        const offer = (config.response_templates?.bet_offer || "You: ${opponentBet} / Me: ${ourBet}. I win ties. Confirm?")
                            .replace("${opponentBet}", opponentBet)
                            .replace("${ourBet}", ourBet);
                        await messageQueue.send(message.channel, offer);
                    }
                } else {
                    if (isPrivate) {
                        await messageQueue.send(message.channel, `🤝 Middleman detected! State terms (e.g. "1 vs 1.2") so I can confirm.`);
                    }
                }
                await analyzeTicketHistory(message.channel, ticket);
            }
            saveState();
            return true;
        }
        return false;
    } catch (error) {
        logger.error('Failed to handle potential ticket', { error: error.message });
        return false;
    }
}

async function handleAwaitingWagerClarification(message, ticket) {
    const betData = extractBetAmounts(getFullContent(message));
    if (!betData) return false;
    const amount = betData.opponent;
    const match = ticketManager.getAnyPendingWager(message.channel.name, { betAmount: amount });
    if (match) {
        ticket.transition(STATES.AWAITING_MIDDLEMAN, { opponentId: match.userId, opponentBet: match.opponentBet, ourBet: match.ourBet });
        await messageQueue.send(message.channel, `Linked to $${match.opponentBet} bet. Awaiting middleman.`);
        saveState();
        return true;
    }
    return false;
}

async function handleAwaitingTicket(message, ticket) {
    if (message.author.id === ticket.data.opponentId) {
        ticket.transition(STATES.AWAITING_MIDDLEMAN);
        saveState();
    }
    return true;
}

async function handleAwaitingMiddleman(message, ticket) {
    const content = getFullContent(message);
    const isMM = isMiddleman(message.author.id);

    if (isInfoRequest(content)) {
        await messageQueue.send(message.channel, `🎲 **Dice Bot Info:** FT5, I win ties, LTC instant. Ready? Tell me amount.`);
        return true;
    }

    const counter = detectCounterOffer(content);
    if (counter) {
        const amt = Math.min(counter.amount, 50);
        const our = parseFloat((amt * 1.20).toFixed(2));
        ticket.updateData({ opponentBet: amt, ourBet: our, middlemanId: isMM ? message.author.id : ticket.data.middlemanId });
        ticket.transition(STATES.WAITING_FOR_OPPONENT_CONFIRM);
        await messageQueue.send(message.channel, `You: $${amt} / Me: $${our}. I win ties. Confirm?`);
        saveState();
        return true;
    }

    if (isMM) {
        ticket.updateData({ middlemanId: message.author.id });
        const bet = extractBetAmounts(content);
        if (bet) {
            const amt = Math.min(bet.opponent, 50);
            const our = parseFloat((amt * 1.20).toFixed(2));
            ticket.updateData({ opponentBet: amt, ourBet: our });
            ticket.transition(STATES.WAITING_FOR_OPPONENT_CONFIRM);
            await messageQueue.send(message.channel, `You: $${amt} / Me: $${our}. I win ties. Confirm?`);
            saveState();
            return true;
        }
        const addr = extractCryptoAddress(content, 'LTC');
        if (addr && ticket.data.opponentBet > 0) {
            ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS);
            saveState();
            return await handleAwaitingPaymentAddress(message, ticket);
        }
    }

    const bet = extractBetAmounts(content);
    if (bet) {
        const amt = Math.min(bet.opponent, 50);
        const our = parseFloat((amt * 1.20).toFixed(2));
        ticket.updateData({ opponentId: message.author.id, opponentBet: amt, ourBet: our });
        ticket.transition(STATES.WAITING_FOR_OPPONENT_CONFIRM);
        await messageQueue.send(message.channel, `You: $${amt} / Me: $${our}. I win ties. Confirm?`);
        saveState();
        return true;
    }
    return false;
}

async function handleWaitingForOpponentConfirm(message, ticket) {
    const content = getFullContent(message);
    const isMM = isMiddleman(message.author.id);

    if (isConfirmation(content)) {
        logger.info(`OPPONENT_CONFIRMED {channelId: "${ticket.channelId}"}`);
        const bet = extractBetAmounts(content);
        if (bet && Math.abs(bet.opponent - ticket.data.opponentBet) > 0.01) return true;

        ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS);
        saveState();
        await messageQueue.send(message.channel, 'ready when you are. send ltc addy');

        const history = ticket.data.historyContext;
        if (history && history.ltcAddresses.length > 0) {
            const best = history.ltcAddresses.find(a => a.isTrusted) || history.ltcAddresses[history.ltcAddresses.length - 1];
            if (best) {
                logger.info('🚀 INSTANT_PAY_FROM_HISTORY', { channelId: ticket.channelId, address: best.address });
                const fakeMsg = { ...message, content: best.address, author: { id: best.senderId, bot: best.isTrusted && !isMiddleman(best.senderId), username: best.senderName } };
                return await handleAwaitingPaymentAddress(fakeMsg, ticket);
            }
        }
        return true;
    }

    if (isRejection(content)) {
        ticket.transition(STATES.CANCELLED, { cancellationReason: 'REJECTED' });
        await messageQueue.send(message.channel, 'bet cancelled. gg');
        saveState();
        return true;
    }

    const addr = extractCryptoAddress(content, 'LTC');
    if (addr && (isMM || message.author.bot)) {
        ticket.transition(STATES.AWAITING_PAYMENT_ADDRESS);
        saveState();
        return await handleAwaitingPaymentAddress(message, ticket);
    }
    return false;
}

async function handleAwaitingPaymentAddress(message, ticket) {
    const content = getFullContent(message);
    const address = extractCryptoAddress(content, 'LTC');
    const isMM = isMiddleman(message.author.id) || message.author.id === ticket.data.middlemanId;
    const isTrustedBot = (config.payment_safety?.ticket_bot_ids || []).includes(message.author.id);

    if (!address) return false;

    if (!isMM && !isTrustedBot) {
        logger.warn('🔒 UNTRUSTED SENDER BLOCKED', { channelId: ticket.channelId, author: message.author.id });
        return false;
    }

    if (ticket.data.paymentLocked || ticket.hasPaymentBeenSent()) return true;

    const amount = ticket.data.ourBet;
    if (amount < (config.betting_limits?.min || 1) || amount > (config.payment_safety?.max_payment_per_tx || 50)) {
        logger.error('🚨 LIMIT_VIOLATION', { amount });
        return false;
    }

    ticket.updateData({ paymentLocked: true });
    saveState();

    try {
        let result;
        if (process.env.ENABLE_LIVE_TRANSFERS === 'true') {
            result = await sendPayment(address, amount, 'LTC', ticket.channelId);
            if (!result.success) throw new Error(result.error);
            await messageQueue.send(message.channel, config.response_templates.payment_sent.replace('${amount}', amount).replace('{txid}', result.txId));
        } else {
            result = { txId: `dry-${Date.now()}` };
            await messageQueue.send(message.channel, `Sent $${amount}! TXID: ${result.txId}`);
        }

        ticket.transition(STATES.PAYMENT_SENT, { paymentAddress: address, paymentTxId: result.txId, paymentTimestamp: Date.now() });
        logPayment({ channelId: ticket.channelId, amount, txId: result.txId, network: 'LTC' });
        saveState();
        return true;
    } catch (e) {
        logger.error('Payment failed', { error: e.message });
        ticket.updateData({ paymentLocked: false });
        saveState();
        return false;
    }
}

async function handlePaymentSent(message, ticket) {
    const content = getFullContent(message);
    const isMM = isMiddleman(message.author.id) || message.author.id === ticket.data.middlemanId;
    if (!isMM) return false;

    if (isPaymentConfirmation(content) || extractGameStart(content)) {
        const bet = extractBetAmounts(content);
        if (bet) {
            const expectedOpponent = ticket.data.opponentBet;
            const expectedOur = ticket.data.ourBet;
            const match = Math.abs(bet.opponent - expectedOpponent) < 0.01 &&
                (bet.raw?.amount2 ? Math.abs(bet.raw.amount2 - expectedOur) < 0.01 : true);

            if (!match) {
                await messageQueue.send(message.channel, `❌ Mismatch! Expected ${expectedOpponent}v${expectedOur}, got ${bet.opponent}v${bet.raw?.amount2 || '?'}`);
                return true;
            }
        }

        ticket.transition(STATES.AWAITING_GAME_START);
        saveState();
        await messageQueue.send(message.channel, `Confirm`);

        if (extractGameStart(content)) return await handleAwaitingGameStart(message, ticket);
        return true;
    }
    return false;
}

async function handleAwaitingGameStart(message, ticket) {
    const isMM = isMiddleman(message.author.id) || message.author.id === ticket.data.middlemanId;
    if (!isMM) return false;

    const start = extractGameStart(getFullContent(message));
    if (!start) return false;

    const botFirst = start.botFirst || start.userId === message.client.user.id;
    let tracker = ticketManager.gameTrackers.get(ticket.channelId);
    if (!tracker) {
        tracker = new ScoreTracker(ticket.channelId);
        ticketManager.gameTrackers.set(ticket.channelId, tracker);
    }

    logger.info('🎲 GAME_STARTED', { channelId: ticket.channelId, botFirst });
    ticket.transition(botFirst ? STATES.WAITING_FOR_OUR_TURN : STATES.GAME_IN_PROGRESS, {
        botGoesFirst: botFirst,
        isOurTurn: botFirst
    });

    saveState();
    await messageQueue.send(message.channel, 'Confirm');

    if (botFirst) {
        return await handleWaitingForOurTurn(message, ticket);
    }
    return true;
}

async function handleWaitingForOurTurn(message, ticket) {
    logger.info('🎲 PREPARING_OUR_ROLL', { channelId: ticket.channelId });
    ticket.transition(STATES.ROLL_SENT);
    await rollDice(message.channel, ticket);
    return true;
}

async function processDiceRoll(message, ticket) {
    const roll = extractDiceResult(getFullContent(message));
    if (roll === null) return false;

    let tracker = ticketManager.gameTrackers.get(ticket.channelId);
    if (!tracker) {
        tracker = new ScoreTracker(ticket.channelId);
        ticketManager.gameTrackers.set(ticket.channelId, tracker);
    }

    const botId = message.client.user.id;
    const content = getFullContent(message).toLowerCase();
    const botPatterns = [botId, message.client.user.username.toLowerCase(), 'you'];
    const isBot = message.author.id === botId || botPatterns.some(p => content.includes(p));

    if (isBot) {
        tracker.lastBotRoll = roll;
        logger.info('🎲 BOT_ROLL_RECORDED', { channelId: ticket.channelId, roll });
    } else {
        tracker.lastOpponentRoll = roll;
        logger.info('🎲 OPPONENT_ROLL_RECORDED', { channelId: ticket.channelId, roll, authorId: message.author.id });
    }

    if (tracker.lastBotRoll && tracker.lastOpponentRoll) {
        return await processRound(message.channel, ticket, tracker);
    }

    if (tracker.lastOpponentRoll && !tracker.lastBotRoll) {
        ticket.transition(STATES.ROLL_SENT);
        await rollDice(message.channel, ticket);
    } else if (tracker.lastBotRoll && !tracker.lastOpponentRoll) {
        ticket.transition(STATES.WAITING_FOR_RESULT);
    }

    saveState();
    return true;
}

async function handleRollSent(message, ticket) {
    return await processDiceRoll(message, ticket);
}

async function handleWaitingForResult(message, ticket) {
    return await processDiceRoll(message, ticket);
}

async function processRound(channel, ticket, tracker) {
    const res = tracker.recordRound(tracker.lastBotRoll, tracker.lastOpponentRoll);
    tracker.lastBotRoll = tracker.lastOpponentRoll = null;

    await messageQueue.send(channel, `Round: ${tracker.getFormattedScore()}`);

    if (res.gameOver) {
        await handleGameComplete(channel, ticket, tracker);
    } else {
        ticket.transition(STATES.WAITING_FOR_OUR_TURN);
        await handleWaitingForOurTurn({ channel }, ticket);
    }
    saveState();
    return true;
}

async function handleGameInProgress(message, ticket) {
    const roll = extractDiceResult(getFullContent(message));
    if (!roll) return false;

    let tracker = ticketManager.gameTrackers.get(ticket.channelId);
    if (!tracker) {
        tracker = new ScoreTracker(ticket.channelId);
        ticketManager.gameTrackers.set(ticket.channelId, tracker);
    }

    const isBot = message.author.id === message.client.user.id || getFullContent(message).includes(message.client.user.id);

    if (isBot) tracker.lastBotRoll = roll;
    else tracker.lastOpponentRoll = roll;

    if (tracker.lastBotRoll && tracker.lastOpponentRoll) {
        return await processRound(message.channel, ticket, tracker);
    } else if (tracker.lastOpponentRoll) {
        ticket.transition(STATES.WAITING_FOR_OUR_TURN);
        await handleWaitingForOurTurn(message, ticket);
    }
    saveState();
    return true;
}

async function rollDice(channel, ticket) {
    await messageQueue.send(channel, config.game_settings.dice_command || '-roll');
}

async function handleGameComplete(channel, ticket, tracker) {
    ticket.transition(STATES.GAME_COMPLETE, { winner: tracker.winner, finalScore: tracker.getScoreString() });
    saveState();
    if (tracker.winner === 'bot') {
        const humbleWin = config.response_templates.humble_win.replace('{amount}', ticket.data.opponentBet).replace('{network}', 'LTC').replace('{address}', config.payout_addresses.LTC);
        await messageQueue.send(channel, humbleWin);
        setTimeout(() => postVouch(channel.client, ticket), 10);
    } else {
        await messageQueue.send(channel, config.response_templates.humble_loss);
    }
    ticketManager.gameTrackers.delete(ticket.channelId);
}

async function handleGameCompleteState(message, ticket) {
    if (isVouchKeyword(getFullContent(message)) && !ticket.data.vouchPosted) {
        await postVouch(message.client, ticket);
        return true;
    }
    return false;
}

async function postVouch(client, ticket) {
    const vcId = config.channels.vouch_channel_id;
    if (!vcId || ticket.data.vouchPosted) return;
    try {
        const chan = await client.channels.fetch(vcId);
        const middlemanTag = ticket.data.middlemanId ? `<@${ticket.data.middlemanId}>` : 'None';
        const vouchMsg = config.response_templates.vouch_win
            .replace('{amount}', ticket.data.opponentBet)
            .replace('{opponent}', `<@${ticket.data.opponentId}>`)
            .replace('{middleman}', middlemanTag);

        await messageQueue.send(chan, vouchMsg);
        ticket.updateData({ vouchPosted: true });
        ticketManager.recordVouch(ticket.channelId);
        saveState();
    } catch (e) {
        logger.error('Vouch failed', { channelId: ticket.channelId, error: e.message });
    }
}

async function handleMessageUpdate(oldMsg, newMsg) {
    if (!oldMsg.content || !newMsg.content) return;
    if (extractCryptoAddress(oldMsg.content, 'LTC') !== extractCryptoAddress(newMsg.content, 'LTC')) {
        await messageQueue.send(oldMsg.channel, '⚠️ Address modification detected.');
    }
}

async function handleChannelDelete(channel) {
    if (ticketManager.getTicket(channel.id)) {
        ticketManager.removeTicket(channel.id);
        saveState();
    }
}

module.exports = { handleMessage, handleChannelDelete, handleMessageUpdate, postVouch, handlePotentialNewTicket, getFullContent };
