require('dotenv').config();
const litecore = require('bitcore-lib-ltc');

try {
    const key = process.env.LTC_PRIVATE_KEY;
    if (!key) {
        console.error('Error: LTC_PRIVATE_KEY not found in .env');
        process.exit(1);
    }
    const privateKey = litecore.PrivateKey.fromWIF(key);
    const address = privateKey.toAddress();

    console.log('\n==================================================');
    console.log('BOT OPERATING WALLET (The one that needs funds)');
    console.log('==================================================');
    console.log('Address:', address.toString());
    console.log('==================================================\n');
} catch (error) {
    console.error('Error deriving address:', error.message);
}
