const { Client } = require('discord.js-selfbot-v13');
require('dotenv').config();

const CHANNEL_ID = '1467865427458785350';

async function check() {
    const tokens = [
        { name: 'Bot', token: process.env.DISCORD_TOKEN },
        { name: 'MM', token: process.env.TEST_MM_TOKEN },
        { name: 'Opp', token: process.env.TEST_OPP_TOKEN }
    ];

    for (const t of tokens) {
        const client = new Client();
        try {
            await client.login(t.token);
            const channel = await client.channels.fetch(CHANNEL_ID);
            console.log(`✅ ${t.name} has access to ${channel.name}`);
            await client.destroy();
        } catch (e) {
            console.log(`❌ ${t.name} FAIL: ${e.message}`);
        }
    }
    process.exit(0);
}

check();
