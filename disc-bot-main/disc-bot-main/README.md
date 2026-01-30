# 🎲 Discord High-Frequency Wagering Bot

A sophisticated automated wagering self-bot for Discord with cryptocurrency payment integration.

> ⚠️ **WARNING**: This is a self-bot which violates Discord's Terms of Service. Use at your own risk. Your account may be terminated.

## Features

- **🎯 Sniper Module**: Automatically detects bet offers in `XvX` format
- **💰 Tax Calculation**: Calculates configurable edge (default 20%) using precise BigNumber math
- **🎰 State Machine**: Full ticket lifecycle management with 8 phases
- **💳 Multi-Crypto Support**: LTC, SOL, and BTC payment handlers
- **🎲 Dice Engine**: Cryptographically secure dice rolls with first-to-5 scoring
- **✅ Auto Vouch**: Posts vouch to designated channel on wins
- **🔄 Crash Recovery**: State persistence prevents double-payments

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy the example environment file:
```bash
copy .env.example .env
```

Edit `.env` with your credentials:
```env
DISCORD_TOKEN=your_discord_token_here
LTC_PRIVATE_KEY=your_ltc_private_key_here
SOL_PRIVATE_KEY=your_solana_private_key_here
BTC_PRIVATE_KEY=your_btc_private_key_here
```

### 3. Configure Credentials

The bot uses a **universal config**, so you ONLY need to set up your `.env` file.

1.  Copy `.env.example` to `.env`:
    ```bash
    copy .env.example .env
    ```

2.  **Edit `.env`** with your details:
    - `DISCORD_TOKEN`: Your self-bot token
    - `LTC_PRIVATE_KEY` etc: Your wallet keys
    (Payout addresses, middleman IDs, webhook URL are pre-configured in config.json)

3.  **That's it!** No other config needed.
    -   Middlemen are **auto-loaded**.
    -   Tax is **auto-set** to 20%.
    -   Channels are **auto-configured**.

### 4. Run the Bot

```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## How It Works

### Bet Detection
The bot monitors channels for messages matching the pattern `XvX` (e.g., "10v10", "15v15"):

1. Validates bet is within configured limits ($2-$35)
2. Checks user isn't on cooldown or in active ticket
3. Calculates our bet: `Opponent_Bet × 1.20`
4. Responds: "$17.25 vs your $15 ft5, dice ft5 I win ties, create ticket"

### Ticket Lifecycle

```
AWAITING_TICKET → AWAITING_MIDDLEMAN → AWAITING_PAYMENT_ADDRESS
                                              ↓
        GAME_COMPLETE ← GAME_IN_PROGRESS ← PAYMENT_SENT
```

### Dice Game
- First-to-5 wins
- Bot wins ties (configurable)
- Cryptographically secure rolls via `crypto.randomInt()`

## Project Structure

```
discord-bot/
├── src/
│   ├── index.js              # Entry point
│   ├── bot/
│   │   ├── client.js         # Discord client
│   │   ├── events/           # Event handlers
│   │   └── handlers/         # Sniper & ticket logic
│   ├── state/                # State machine & persistence
│   ├── game/                 # Dice engine & scoring
│   ├── crypto/               # Payment handlers
│   └── utils/                # Logging, delays, validation
├── config.json
├── .env.example
└── package.json
```

## Security Notes

1. **Never commit `.env`** - Contains private keys
2. **Use dedicated wallets** - Only load what you're willing to risk
3. **Test with small amounts** - Verify payments work before large bets
4. **State persistence** - Prevents double-payments on crash

## Logs

Logs are stored in the `logs/` directory:
- `combined.log` - All logs
- `error.log` - Errors only
- `games.log` - Game events (bets, outcomes)

## License

ISC
