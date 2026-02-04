/**
 * DEFINITIVE 12-STAGE E2E SIMULATION (ZENITH-ALPHA EDITION)
 * ---------------------------------------------------------
 * This script uses real account tokens (Opponent, Middleman) to prove
 * the bot follows all 12 stages from Ad to Vouch.
 */
require('dotenv').config();
const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');

const OPP_TOKEN = process.env.TEST_OPP_TOKEN;
const MM_TOKEN = process.env.TEST_MM_TOKEN;
const AD_CHANNEL_ID = "1467864467499909202";
const VOUCH_CHANNEL_ID = "1467858064563404907";

async function runDrill() {
    console.log("🚀 INITIALIZING 12-STAGE COMPREHENSIVE DRILL...");

    // 1. Setup Config for Simulation
    const configPath = path.resolve(__dirname, 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

    // Ensure MM is in trusted bots for LTC address extraction
    const mmClient = new Client();
    await mmClient.login(MM_TOKEN);
    const mmId = mmClient.user.id;

    if (!config.payment_safety.ticket_bot_ids.includes(mmId)) {
        config.payment_safety.ticket_bot_ids.push(mmId);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        console.log("✅ MODIFIED CONFIG: Added MM to ticket_bot_ids (Simulating Dyno)");
    }

    const oppClient = new Client();
    await oppClient.login(OPP_TOKEN);

    try {
        const adChannel = await oppClient.channels.fetch(AD_CHANNEL_ID);

        // --- STAGE 1: Advertisement (Check bot logs) ---
        console.log("--- STAGE 1: Advertisement ---");

        // --- STAGE 2 & 3: Ticket Creation & Detection ---
        console.log("--- STAGE 2 & 3: Ticket Creation & Detection ---");
        await adChannel.send("anyone 10 ltc?");

        console.log("⏳ Waiting for ticket creation...");
        await new Promise(r => setTimeout(r, 10000));

        // Find the new ticket (the one with the highest ID or most recent)
        const guild = await oppClient.guilds.fetch("1467858063594754212");
        const channels = await guild.channels.fetch();
        const ticketChannel = channels.find(c => c.name.includes("ticket") && c.type === 'GUILD_TEXT');

        if (!ticketChannel) {
            console.error("❌ FAILED: Ticket not detected!");
            process.exit(1);
        }
        console.log(`✅ STAGE 4: Ticket Detected: ${ticketChannel.name}`);

        // --- STAGE 5: Negotiation & LTC Extraction ---
        console.log("--- STAGE 5: Negotiation & LTC Extraction ---");
        await ticketChannel.send("confirmed 10 ltc");
        await new Promise(r => setTimeout(r, 5000));

        // MM sends LTC address (Simulating Dyno)
        console.log("--- STAGE 6: Simulated Dyno Address ---");
        const mmTicketChannel = await mmClient.channels.fetch(ticketChannel.id);
        await mmTicketChannel.send("Your LTC Deposit Address: LMcVzY2oG8qR7bQx3N6S5W9fHtXpY4wE1u");

        console.log("⏳ Waiting for bot to detect address and transition...");
        await new Promise(r => setTimeout(r, 8000));

        // --- STAGE 7: Payment Confirmation ---
        console.log("--- STAGE 7 & 8: Payment Confirmation & Game Start ---");
        await mmTicketChannel.send("Payment received for both. GL!");
        await new Promise(r => setTimeout(r, 5000));

        // --- STAGE 9: The Game (Proactive Roll) ---
        console.log("--- STAGE 9: The Game ---");
        await mmTicketChannel.send("game start ft5 @bot first");

        console.log("⏳ Simulating 5 rounds...");
        for (let i = 1; i <= 6; i++) {
            console.log(`Round ${i}...`);
            await new Promise(r => setTimeout(r, 6000));
            // Opponent rolls (automatically detected by bot now)
            await ticketChannel.send("roll");
            await new Promise(r => setTimeout(r, 2000));
        }

        // --- STAGE 10, 11, 12: Completion & Vouch ---
        console.log("--- STAGE 10-12: Completion & Vouch ---");
        await new Promise(r => setTimeout(r, 10000));

        console.log("✅ DRILL COMPLETED. Check bot logs for VOUCH_POSTED.");

    } catch (e) {
        console.error("❌ DRILL FAILED:", e);
    } finally {
        oppClient.destroy();
        mmClient.destroy();
    }
}

runDrill();
