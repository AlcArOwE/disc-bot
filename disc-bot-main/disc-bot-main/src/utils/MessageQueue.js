/**
 * Message Queue - Global rate-limited message sender
 * Enforces 2.0-2.5 second spacing between outbound messages
 * to comply with Discord rate limits (R3)
 */

const { logger } = require('./logger');
const config = require('../../config.json');

class MessageQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastSendTime = 0;
        // Configurable cooldown (default 2.0-2.5s)
        this.minDelayMs = config.message_queue?.min_delay_ms || 2000;
        this.maxDelayMs = config.message_queue?.max_delay_ms || 2500;
    }

    /**
     * Add a message to the queue
     * @param {Object} channel - Discord channel object
     * @param {string} content - Message content
     * @param {Object} options - Optional message options (reply, etc.)
     * @returns {Promise<Message>} - Resolves when message is sent
     */
    async send(channel, content, options = {}) {
        return new Promise((resolve, reject) => {
            this.queue.push({
                channel,
                content,
                options,
                resolve,
                reject,
                addedAt: Date.now()
            });

            logger.debug('Message queued', {
                channelId: channel.id,
                queueLength: this.queue.length,
                contentPreview: content.substring(0, 50)
            });

            this._processQueue();
        });
    }

    /**
     * Add typing indicator before message
     * @param {Object} channel - Discord channel
     */
    async sendTyping(channel) {
        try {
            await channel.sendTyping();
        } catch (e) {
            // Ignore typing errors
        }
    }

    /**
     * Process the queue with rate limiting
     */
    async _processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        while (this.queue.length > 0) {
            const item = this.queue.shift();
            const now = Date.now();
            const timeSinceLastSend = now - this.lastSendTime;
            const requiredDelay = this._getRandomDelay();

            // Wait if needed to maintain rate limit
            if (timeSinceLastSend < requiredDelay) {
                const waitTime = requiredDelay - timeSinceLastSend;
                logger.debug('Rate limiting message', { waitMs: waitTime });
                await this._sleep(waitTime);
            }

            try {
                // Show typing before sending
                await this.sendTyping(item.channel);

                // Send the message
                let result;
                if (item.options.replyTo) {
                    result = await item.options.replyTo.reply(item.content);
                } else {
                    result = await item.channel.send(item.content);
                }

                this.lastSendTime = Date.now();

                logger.info('Message sent via queue', {
                    channelId: item.channel.id,
                    queueRemaining: this.queue.length
                });

                item.resolve(result);
            } catch (error) {
                logger.error('Failed to send queued message', {
                    error: error.message,
                    channelId: item.channel.id
                });
                item.reject(error);
            }
        }

        this.processing = false;
    }

    /**
     * Get random delay between min and max
     */
    _getRandomDelay() {
        return Math.floor(
            Math.random() * (this.maxDelayMs - this.minDelayMs + 1) + this.minDelayMs
        );
    }

    /**
     * Sleep helper
     */
    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Drain the queue (for graceful shutdown)
     */
    async drain() {
        if (this.queue.length === 0) {
            return;
        }

        logger.info('Draining message queue', { remaining: this.queue.length });

        // Wait for current processing to finish
        while (this.processing || this.queue.length > 0) {
            await this._sleep(100);
        }

        logger.info('Message queue drained');
    }

    /**
     * Get queue stats
     */
    getStats() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            lastSendTime: this.lastSendTime
        };
    }
}

// Singleton instance
const messageQueue = new MessageQueue();

module.exports = { MessageQueue, messageQueue };
