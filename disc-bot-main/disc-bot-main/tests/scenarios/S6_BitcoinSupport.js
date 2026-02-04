/**
 * S6_BitcoinSupport.js
 * 
 * Verifies that the bot can detect a Bitcoin (BTC) wager and 
 * correctly execute a payment on the Bitcoin network.
 */

const { STATES } = require('../../src/state/StateMachine');
const config = require('../../config.json');

module.exports = {
    name: 'S6_BitcoinSupport',
    description: 'Verify BTC wagering and payment',
    async execute(harness, runner) {
        const opponentId = 'opp-666';
        const middlemanId = config.middleman_ids[0];
        const ticketChannelId = 'tick-btc-s6';
        const btcAddress = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';

        harness.createUser(opponentId, 'BitcoinBaron');
        harness.createUser(middlemanId, 'TrustyMM');

        // 1. Create ticket and propose BTC wager
        harness.injectChannelCreate(ticketChannelId, 'ticket-bitcoinbaron');

        // Wait for bot to auto-create
        await new Promise(r => setTimeout(r, 1000));

        // Propose BTC wager
        harness.injectMessage(ticketChannelId, opponentId, '$10 BTC dice');
        await new Promise(r => setTimeout(r, 1000));

        // Assert bot accepted
        runner.assertState(ticketChannelId, STATES.WAITING_FOR_OPPONENT_CONFIRM);

        // 2. Opponent confirms
        harness.injectMessage(ticketChannelId, opponentId, 'confirm');
        await new Promise(r => setTimeout(r, 1000));
        runner.assertState(ticketChannelId, STATES.AWAITING_PAYMENT_ADDRESS);

        // 3. MM provides BTC address
        harness.injectMessage(ticketChannelId, middlemanId, `BTC: ${btcAddress}`);
        await new Promise(r => setTimeout(r, 1500));

        // 4. Assert payment sent (should use BitcoinHandler)
        runner.assertState(ticketChannelId, STATES.PAYMENT_SENT);

        // Verify response
        runner.assertMessageSent(ticketChannelId, /Sent \$12.*TXID: dryrun-tx/i);

        console.log('✅ S6: Bitcoin detection and payment verified.');
    }
};
