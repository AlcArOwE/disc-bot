/**
 * S4_MiddlemanHijackPrevention.js
 * Bot ignores addresses from the opponent even if they look valid.
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S4_MiddlemanHijackPrevention',
    execute: async (harness, runner) => {
        const opponentId = 'opp-444';
        const middlemanId = config.middleman_ids[0];
        const ticketChannelId = 'tick-hijack-s4';
        const fakeAddress = 'LY7VX5yZgVbEsL3kS9F2a8B4c5D6e7F8g9';
        const realAddress = 'LXvKp1VkPvMTZE8oGeCuBJr4hUGJXAkbQp';

        harness.createUser(opponentId, 'ScammerSam');
        harness.createUser(middlemanId, 'TrustyMM');

        // Setup: Get to AWAITING_PAYMENT_ADDRESS
        harness.injectChannelCreate(ticketChannelId, 'ticket-scammersam');
        await new Promise(r => setTimeout(r, 600));
        harness.injectMessage(ticketChannelId, opponentId, '$10 dice');
        await new Promise(r => setTimeout(r, 600));
        harness.injectMessage(ticketChannelId, opponentId, 'confirm');
        await new Promise(r => setTimeout(r, 600));
        runner.assertState(ticketChannelId, STATES.AWAITING_PAYMENT_ADDRESS);

        // 1. Opponent tries to hijack by posting their own address
        harness.injectMessage(ticketChannelId, opponentId, `Send here: ${fakeAddress}`);
        await new Promise(r => setTimeout(r, 1000));

        // Assert state did NOT change
        runner.assertState(ticketChannelId, STATES.AWAITING_PAYMENT_ADDRESS);

        // Assert bot did NOT send payment
        const channel = harness.channels.cache.get(ticketChannelId);
        const payments = channel.sentMessages.filter(m => m.content.includes('Sent $'));
        runner.assert(payments.length === 0, 'Bot should have ignored opponent address');

        // 2. Real MM posts address
        harness.injectMessage(ticketChannelId, middlemanId, `LTC: ${realAddress}`);
        await new Promise(r => setTimeout(r, 1000));

        // Assert state CHANGED now
        runner.assertState(ticketChannelId, STATES.PAYMENT_SENT);
        runner.assertMessageSent(ticketChannelId, /dryrun-tx|txid/i);
    }
};
