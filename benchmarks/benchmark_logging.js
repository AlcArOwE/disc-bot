const winston = require('winston');
const { performance } = require('perf_hooks');

// Setup logger with level 'info' so 'debug' is disabled
const logger = winston.createLogger({
    level: 'info',
    transports: [
        new winston.transports.Console({ silent: true }) // Silent to measure pure overhead
    ]
});

// Mock objects
const message = {
    channel: { id: '1234567890' },
    author: { id: '0987654321' },
    content: 'This is a very long message content that might need to be substringed for the log output to verify the performance impact of eager evaluation.'
};

const ticket = {
    getState: () => 'AWAITING_PAYMENT'
};

const channelId = message.channel.id;

// Number of iterations
const ITERATIONS = 1_000_000;

console.log(`Running benchmark with ${ITERATIONS} iterations...`);
console.log(`Logger level: ${logger.level}`);

// Baseline: Eager Evaluation
const startBaseline = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    // This represents the current code
    logger.debug('Ticket handler processing', {
        channelId,
        hasTicket: !!ticket,
        state: ticket?.getState() || 'NO_TICKET',
        authorId: message.author.id,
        content: message.content.substring(0, 50)
    });
}
const endBaseline = performance.now();
const baselineTime = endBaseline - startBaseline;
console.log(`Baseline (Eager): ${baselineTime.toFixed(2)}ms`);

// Optimization: Lazy Evaluation check
const startOptimized = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
    // This represents the optimized code
    if (logger.isLevelEnabled('debug')) {
        logger.debug('Ticket handler processing', {
            channelId,
            hasTicket: !!ticket,
            state: ticket?.getState() || 'NO_TICKET',
            authorId: message.author.id,
            content: message.content.substring(0, 50)
        });
    }
}
const endOptimized = performance.now();
const optimizedTime = endOptimized - startOptimized;
console.log(`Optimized (Check): ${optimizedTime.toFixed(2)}ms`);

// Calculate improvement
const improvement = baselineTime / optimizedTime;
console.log(`Speedup: ${improvement.toFixed(2)}x`);
