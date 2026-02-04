const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new Client();

const TICKETS_CATEGORY_ID = "1467864469701922900";

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    try {
        const category = await client.channels.fetch(TICKETS_CATEGORY_ID);
        if (!category) {
            console.error("Category not found");
            process.exit(1);
        }

        const channels = category.children.cache || category.children;
        console.log(`Found ${channels.size} channels in category`);

        let deleted = 0;
        for (const [id, channel] of channels) {
            if (channel.name.startsWith('ticket-') || channel.name.startsWith('order-') || channel.name.includes('mnnw0i')) {
                console.log(`Deleting channel: ${channel.name} (${id})`);
                await channel.delete();
                deleted++;
                await new Promise(r => setTimeout(r, 500)); // Sleep to avoid rate limits
            }
        }
        console.log(`Deleted ${deleted} channels`);
    } catch (error) {
        console.error("Error during cleanup:", error);
    }
    process.exit(0);
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
    console.error("No DISCORD_TOKEN found in .env");
    process.exit(1);
}

client.login(token);
