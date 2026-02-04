const { Client } = require('discord.js-selfbot-v13');
require('dotenv').config();

const client = new Client();
const ticketIds = ['1467494236319383688', '1467495049964032063'];

client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    for (const id of ticketIds) {
        try {
            const channel = await client.channels.fetch(id);
            if (!channel) {
                console.log(`[${id}] Channel not found or no permission.`);
            } else {
                console.log(`[${id}] Found channel: ${channel.name}`);
                const messages = await channel.messages.fetch({ limit: 5 });
                console.log(`[${id}] Fetched ${messages.size} messages.`);
                messages.forEach(m => console.log(`- [${id}][${m.author.username}]: ${m.content.slice(0, 30)}`));
            }
        } catch (e) {
            console.error(`[${id}] Error: ${e.message}`);
        }
    }
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
