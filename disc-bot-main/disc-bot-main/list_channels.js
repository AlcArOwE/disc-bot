const { Client } = require('discord.js-selfbot-v13');
require('dotenv').config();

async function list() {
    const client = new Client();
    await client.login(process.env.DISCORD_TOKEN);
    console.log(`Bot: ${client.user.tag}`);

    const guilds = client.guilds.cache;
    for (const [id, guild] of guilds) {
        console.log(`Guild: ${guild.name} (${id})`);
        const channels = guild.channels.cache.filter(c => c.type === 'GUILD_TEXT');
        for (const [cid, channel] of channels) {
            console.log(`  Channel: ${channel.name} (${cid})`);
        }
    }
    process.exit(0);
}

list();
