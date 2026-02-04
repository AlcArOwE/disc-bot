/**
 * DiscordHarness.js
 * High-fidelity Discord simulation for E2E stress testing.
 */

const EventEmitter = require('events');

/**
 * MockCollection - Emulates discord.js Collection (Map + helpers)
 */
class MockCollection extends Map {
    filter(fn) {
        const result = new MockCollection();
        for (const [k, v] of this) {
            if (fn(v)) result.set(k, v);
        }
        return result;
    }
    first() { return Array.from(this.values())[0]; }
    last() { const arr = Array.from(this.values()); return arr[arr.length - 1]; }
    map(fn) { return Array.from(this.values()).map(fn); }
}

class MockUser {
    constructor(id, username, bot = false) {
        this.id = id;
        this.username = username;
        this.bot = bot;
        this.tag = `${username}#${id.slice(-4)}`;
    }
}

class MockChannel extends EventEmitter {
    constructor(id, name, type, client) {
        super();
        this.id = id;
        this.name = name;
        this.type = type; // 'GUILD_TEXT' or 'DM'
        this.client = client;
        this.msgArray = []; // Store messages in order
        this.sentMessages = []; // Track what the bot sends

        this.messages = {
            cache: new MockCollection(),
            fetch: async (options) => {
                let msgs = [...this.msgArray];
                if (options?.before) {
                    const idx = msgs.findIndex(m => m.id === options.before);
                    if (idx !== -1) msgs = msgs.slice(0, idx);
                }
                if (options?.limit) msgs = msgs.slice(-options.limit);

                // Discord.js fetch returns newest first in some contexts, 
                // but let's just return a collection in order.
                const collection = new MockCollection(msgs.map(m => [m.id, m]));
                return collection;
            }
        };
    }

    isText() { return this.type === 'GUILD_TEXT'; }
    isDM() { return this.type === 'DM'; }

    async send(content) {
        console.log(`[HARNESS_DEBUG] Channel ${this.id} sending: ${content}`);
        const message = new MockMessage(`msg-bot-${Date.now()}-${Math.random()}`, content, this, this.client.user);
        this.sentMessages.push(message);
        this.msgArray.push(message);
        return message;
    }

    async delete() {
        this.client.channels.cache.delete(this.id);
        this.client.emit('channelDelete', this);
    }
}

class MockMessage {
    constructor(id, content, channel, author) {
        this.id = id;
        this.content = content;
        this.channel = channel;
        this.author = author;
        this.client = channel.client;
        this.createdTimestamp = Date.now();
        this.mentions = {
            users: new MockCollection(),
            has: (userOrId) => {
                const id = typeof userOrId === 'string' ? userOrId : userOrId.id;
                return this.content.includes(`<@${id}>`) || this.content.includes(`<@!${id}>`);
            }
        };
    }

    async reply(content) {
        return this.channel.send(content);
    }
}

class DiscordHarness extends EventEmitter {
    constructor() {
        super();
        this.user = new MockUser('bot-123456789', 'SpartanBot', true);

        this.channels = {
            cache: new MockCollection(),
            fetch: async (id) => {
                if (!id) return this.channels.cache;
                return this.channels.cache.get(id);
            }
        };

        this.users = {
            cache: new MockCollection(),
            fetch: async (id) => this.users.cache.get(id)
        };
    }

    createChannel(id, name, type = 'GUILD_TEXT') {
        const channel = new MockChannel(id, name, type, this);
        this.channels.cache.set(id, channel);
        return channel;
    }

    createUser(id, username, bot = false) {
        const user = new MockUser(id, username, bot);
        this.users.cache.set(id, user);
        return user;
    }

    injectMessage(channelId, authorId, content) {
        const channel = this.channels.cache.get(channelId);
        const author = this.users.cache.get(authorId);
        if (!channel || !author) throw new Error(`Channel ${channelId} or Author ${authorId} not found in harness`);

        const message = new MockMessage(`msg-in-${Date.now()}-${Math.random()}`, content, channel, author);
        channel.msgArray.push(message);
        this.emit('messageCreate', message);
        return message;
    }

    injectChannelCreate(id, name, type = 'GUILD_TEXT') {
        const channel = this.createChannel(id, name, type);
        this.emit('channelCreate', channel);
        return channel;
    }

    destroy() {
        this.removeAllListeners();
        this.channels.cache.clear();
        this.users.cache.clear();
    }
}

module.exports = { DiscordHarness, MockUser, MockChannel, MockMessage, MockCollection };
