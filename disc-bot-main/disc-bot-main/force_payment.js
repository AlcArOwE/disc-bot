/**
 * Manual Force Payment Script
 * Fulfills user request: Confirm $3 vs $3.6 and send payment to LSkrNCeAC2QtJ6h6zKNAa5MFNCVvwB9n3A
 */

const { ticketManager } = require('./src/state/TicketManager');
const { loadState, saveState } = require('./src/state/persistence');
const { sendPayment } = require('./src/crypto');
const { STATES } = require('./src/state/StateMachine');
const { messageQueue } = require('./src/utils/MessageQueue');
const { logger } = require('./src/utils/logger');
const config = require('./config.json');
const { Client, Intents } = require('discord.js-selfbot-v13');
require('dotenv').config();

const channelId = '1467497304624861346';
const address = 'LSkrNCeAC2QtJ6h6zKNAa5MFNCVvwB9n3A';
const amountUsd = 3.6; // Our bet

async function execute() {
    loadState();
    const ticket = ticketManager.getTicket(channelId);

    if (!ticket) {
        console.error('Ticket not found!');
        process.exit(1);
    }

    const client = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
    await client.login(process.env.DISCORD_TOKEN);

    // messageQueue.init(client); // Removed: queue is a singleton, using channel.send directly for override

    const channel = await client.channels.fetch(channelId);
    if (!channel) {
        console.error('Channel not found!');
        process.exit(1);
    }

    console.log(`🚀 Forcing payment for ticket ${channelId}...`);

    // 1. Confirm terms
    const terms = `Confirm $3 vs $3.6 (Dice, FT5, LTC). Bot wins ties.`;
    await channel.send(terms);
    console.log('✅ Terms confirmed in channel');

    // 2. Send Payment
    try {
        console.log(`💸 Sending $${amountUsd} to ${address}...`);
        const result = await sendPayment(address, amountUsd, 'LTC');
        const txid = result.txid || result.id;
        console.log(`✅ Sent! TXID: ${txid}`);

        // 3. Transition State
        ticket.transition(STATES.PAYMENT_SENT, {
            paymentAddress: address,
            paymentTxId: txid,
            partnerBet: 3,
            ourBet: 3.6
        });
        saveState();

        await channel.send(`✅ Sent $3.6! TXID: \`${txid}\` (Elite Speed Override)`);
        await channel.send(`Ready for game? Type \`-roll\` to start!`);

        console.log('✨ All done. Bot should take over now.');
    } catch (e) {
        console.error('Payment failed:', e.message);
    }

    process.exit(0);
}

execute();
