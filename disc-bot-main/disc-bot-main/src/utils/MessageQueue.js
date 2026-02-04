/**
 * Message Queue - Global rate-limited message sender
 * Optimized for high performance / Zero-Latency (0ms delay)
 */

const { logger } = require('./logger');
const config = require('../../config.json');

class MessageQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
        this.lastSendTime = 0;
        // Instant performance (No delays)
        this.minDelayMs = 0;
        this.maxDelayMs = 0;
        this.maxQueueSize = 100; // Circuit breaker for memory
    }

    /**
     * Send a message via the queue
     * @param {Object} channel - Discord channel object
     * @param {string} content - Message content
     * @param {Object} options - Optional message options (replyTo, priority)
     * @returns {Promise<Message>} - Resolves when message is sent
     */
    send(channel, content, options = {}) {
        return new Promise((resolve, reject) => {
            if (this.queue.length >= this.maxQueueSize) {
                logger.warn('⚠️ Message queue full! Dropping message.', { contentPreview: content.substring(0, 30) });
                return reject(new Error('Queue full'));
            }

            const item = {
                channel,
                content,
                options,
                resolve,
                reject,
                addedAt: Date.now()
            };

            // PRIORITY ROUTING (R5)
            if (options.priority) {
                this.queue.unshift(item); // Jump to front
            } else {
                this.queue.push(item);
            }

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
        // Disabled for speed optimization
        return;
    }

    /**
     * Process the queue (Optimized for instant delivery)
     */
    async _processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;

        try {
            while (this.queue.length > 0) {
                const item = this.queue.shift();

                try {
                    // Send the message instantly
                    let result;
                    if (item.options.replyTo) {
                        result = await item.options.replyTo.reply(item.content);
                    } else {
                        result = await item.channel.send(item.content);
                    }

                    this.lastSendTime = Date.now();
                    this.errorCount = 0; // Reset consecutive errors

                    logger.info('Message sent via queue', {
                        channelId: item.channel.id,
                        queueRemaining: this.queue.length
                    });

                    item.resolve(result);
                } catch (error) {
                    this.errorCount = (this.errorCount || 0) + 1;
                    logger.error('Failed to send queued message', {
                        error: error.message,
                        channelId: item.channel.id,
                        consecutiveErrors: this.errorCount
                    });

                    // If rate limited, wait extra time
                    if (error.message.includes('rate limit') || error.code === 429) {
                        const backoff = Math.min(5000 * this.errorCount, 30000);
                        logger.warn(`🛑 Rate limit backoff: ${backoff}ms`);
                        await new Promise(r => setTimeout(r, backoff));
                    } else if (error.code === 50013 || error.message.includes('Missing Permissions')) {
                        // PERMISSION ERROR: Do not retry, it won't fix itself
                        logger.warn(`🚫 Missing permissions for channel ${item.channel.id}. Dropping message.`);
                        item.reject(error);
                        continue;
                    }

                    item.reject(error);
                }
            }
        } catch (fatalError) {
            logger.error('FATAL: MessageQueue loop crashed!', { error: fatalError.message });
        } finally {
            this.processing = false;
        }
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
