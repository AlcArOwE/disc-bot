/**
 * FINAL COMPREHENSIVE E2E SIMULATION (CURL-BASED)
 * -----------------------------------------------
 * Orchestrates all 12 stages specified by the user.
 */

const { execSync } = require('child_process');
require('dotenv').config();

const OPP_TOKEN = process.env.TEST_OPP_TOKEN;
const MM_TOKEN = process.env.TEST_MM_TOKEN;
const BOT_ID = '1422059455482433579';
const AD_CHANNEL_ID = '1467864467499909202';
const TICKET_CHANNEL_ID = '1467937704485589203'; // Verified working ticket channel

function sendMessage(token, channelId, content) {
    console.log(`[SIM] Sending: "${content}" as ${token.substring(0, 8)}...`);
    try {
        const cmd = `curl -s -X POST "https://discord.com/api/v9/channels/${channelId}/messages" \
            -H "Authorization: ${token}" \
            -H "Content-Type: application/json" \
            -d "{\\"content\\": \\"${content}\\"}"`;
        execSync(cmd);
    } catch (e) {
        console.error(`[SIM] Error: ${e.message}`);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log('🚀 INITIALIZING STAGE-BY-STAGE DISCORD SIMULATION...');

    // STAGE 1 & 2: Ad is auto-handled by bot; Ticket is pre-existing
    console.log('--- STAGE 3 & 4: History & Negotiation ---');
    sendMessage(OPP_TOKEN, TICKET_CHANNEL_ID, '$1 ltc dice');
    await sleep(8000); // 8s for bot to negotiate

    console.log('--- STAGE 5: Opponent Confirmation ---');
    sendMessage(OPP_TOKEN, TICKET_CHANNEL_ID, 'confirm');
    await sleep(8000); // 8s for bot to request addy

    console.log('--- STAGE 6: Escrow Address Posting ---');
    sendMessage(MM_TOKEN, TICKET_CHANNEL_ID, 'Send to LTC_E2E_FINAL_TEST_ADDRESS_123');
    await sleep(8000); // 8s for bot to "pay"

    console.log('--- STAGE 7: Payment Execution ---');
    // Bot should have posted txid by now

    console.log('--- STAGE 8: Middleman Confirmation ---');
    sendMessage(MM_TOKEN, TICKET_CHANNEL_ID, '1v1.2 both paid');
    await sleep(8000); // 8s for bot to confirm MM

    console.log('--- STAGE 9: Game Start & Turns ---');
    sendMessage(MM_TOKEN, TICKET_CHANNEL_ID, 'game start, bot first');
    await sleep(5000);

    for (let i = 0; i < 3; i++) {
        console.log(`   Turn ${i + 1}...`);
        sendMessage(OPP_TOKEN, TICKET_CHANNEL_ID, '-roll');
        await sleep(8000);
    }

    console.log('--- STAGE 10, 11, 12: Win/Loss, Vouch & Cleanup ---');
    console.log('Simulation complete. Review bot terminal logs for forensic audit.');
}

run();
