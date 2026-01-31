/**
 * Mock Discord Client
 * Phase 8: Test utilities for unit and integration testing
 */

/**
 * Mock Discord User
 */
class MockUser {
    constructor(id, username = 'TestUser', bot = false) {
        this.id = id;
        this.username = username;
        this.bot = bot;
        this.displayName = username;
    }
}

/**
 * Mock Discord Channel
 */
class MockChannel {
    constructor(id, name = 'test-channel', type = 'GUILD_TEXT') {
        this.id = id;
        this.name = name;
        this.type = type;
        this.messages = [];
        this.typingCount = 0;
    }

    async send(content) {
        const message = new MockMessage(
            `msg-${Date.now()}`,
            content,
            this,
            new MockUser('bot-user', 'Bot', true)
        );
        this.messages.push(message);
        return message;
    }

    async sendTyping() {
        this.typingCount++;
        return Promise.resolve();
    }
}

/**
 * Mock Discord Message
 */
class MockMessage {
    constructor(id, content, channel, author) {
        this.id = id;
        this.content = content;
        this.channel = channel;
        this.author = author;
        this.createdTimestamp = Date.now();
        this.client = {
            user: new MockUser('bot-id', 'Bot', true)
        };
    }

    async reply(content) {
        return this.channel.send(content);
    }
}

/**
 * Mock Discord Client
 */
class MockDiscordClient {
    constructor() {
        this.user = new MockUser('bot-id', 'TestBot', true);
        this.channels = new Map();
        this.users = new Map();
        this.guilds = new Map();
    }

    createChannel(id, name, type = 'GUILD_TEXT') {
        const channel = new MockChannel(id, name, type);
        this.channels.set(id, channel);
        return channel;
    }

    createUser(id, username, bot = false) {
        const user = new MockUser(id, username, bot);
        this.users.set(id, user);
        return user;
    }

    createMessage(channelId, content, userId) {
        const channel = this.channels.get(channelId);
        const user = this.users.get(userId);
        if (!channel || !user) {
            throw new Error('Channel or user not found');
        }
        return new MockMessage(`msg-${Date.now()}`, content, channel, user);
    }

    // Create common test scenarios
    createPublicChannel() {
        return this.createChannel('public-123', 'general', 'GUILD_TEXT');
    }

    createTicketChannel() {
        return this.createChannel('ticket-456', 'ticket-order-789', 'GUILD_TEXT');
    }

    createDMChannel() {
        const channel = this.createChannel('dm-789', null, 'DM');
        channel.type = 1; // Discord.js DM type
        return channel;
    }
}

/**
 * Test assertion helpers
 */
const TestHelpers = {
    /**
     * Assert a function throws
     */
    async assertThrows(fn, expectedError = null) {
        try {
            await fn();
            throw new Error('Expected function to throw');
        } catch (error) {
            if (expectedError && !error.message.includes(expectedError)) {
                throw new Error(`Expected error "${expectedError}" but got "${error.message}"`);
            }
            return error;
        }
    },

    /**
     * Create a delay
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    /**
     * Assert value is truthy
     */
    assertTrue(value, message = 'Expected truthy value') {
        if (!value) throw new Error(message);
    },

    /**
     * Assert value is falsy
     */
    assertFalse(value, message = 'Expected falsy value') {
        if (value) throw new Error(message);
    },

    /**
     * Assert values are equal
     */
    assertEqual(actual, expected, message = null) {
        if (actual !== expected) {
            throw new Error(message || `Expected ${expected} but got ${actual}`);
        }
    }
};

/**
 * Create a full test environment
 */
function createTestEnvironment() {
    const client = new MockDiscordClient();
    const publicChannel = client.createPublicChannel();
    const ticketChannel = client.createTicketChannel();
    const dmChannel = client.createDMChannel();
    const testUser = client.createUser('user-123', 'TestPlayer');
    const botUser = client.createUser('bot-id', 'Bot', true);

    return {
        client,
        publicChannel,
        ticketChannel,
        dmChannel,
        testUser,
        botUser,
        createBetMessage: (amount) => {
            return new MockMessage(
                `msg-${Date.now()}`,
                `$${amount} on me`,
                publicChannel,
                testUser
            );
        },
        createTicketMessage: (content) => {
            return new MockMessage(
                `msg-${Date.now()}`,
                content,
                ticketChannel,
                testUser
            );
        }
    };
}

module.exports = {
    MockUser,
    MockChannel,
    MockMessage,
    MockDiscordClient,
    TestHelpers,
    createTestEnvironment
};
