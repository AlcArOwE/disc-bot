
---

## 🏗️ Role & Persona
**Act as:** A Senior Node.js Automation Architect with deep expertise in Discord User-Bots (Self-Bots) and Cryptocurrency integration.
**Objective:** Architect and program a highly sophisticated, automated wagering bot that operates on a standard Discord User Account (not a Bot Application).

## 📝 Project Overview
I require a "Smart Sniper" wagering bot that monitors Discord channels for specific bet offers, calculates a mathematical edge (17.25 vs 15), and autonomously handles the entire lifecycle of the wager: from negotiation -> payment -> dicing -> vouching.

**Critical Constraint:** This must use `discord.js-selfbot-v13` to function as a user (real account).

## ⚙️ Core Functional Requirements

### 1. The Sniper Module (Regex & Calculation)
*   **Trigger:** Monitor text messages for the pattern `[Amount]v[Amount]` (e.g., "10v10", "15v15").
*   **Filter:**
    1.  **Limits:** Only respond if the base bet is between **$2.00 USD** and **$50.00 USD**.
    2.  **Cooldown:** Ignore users we are currently active with.
*   **Logic:**
    *   **Equation:** `My_Bet = Opponent_Bet + (Opponent_Bet * 0.15)`. (I pay 15% tax).
    *   *Example:* User says "15v15". Bot calculates $15 + 15% = $17.25.
*   **Action:** If filters pass, immediately reply:
    > "[Calculated_Amount] vs your [Base_Amount] ft5, dice ft5 I win ties, create ticket"

### 2. The Ticket Orchestration (State Machine)
The bot must manage state per-channel (ticket).
*   **Phase 1: Middleman Detection**
    *   Wait for a user with the **Middleman Role** (configured in config.json) or specific **User IDs** to interact in the ticket.
*   **Phase 2: Payment Execution**
    *   **Trigger:** Middleman posts a recognizable crypto address (LTC/SOL/BTC).
    *   **Action:** The bot must **automatically transfer funds**.
    *   *Technical Note:* Since desktop wallets like Exodus have no API, the bot must sign transactions directly using a private key (stored in `.env`) and a library like `bitcore-lib` (LTC) or `@solana/web3.js` (SOL).
*   **Phase 3: Confirmation Wait**
    *   Wait for the Middleman to start the round: `"@Bot first, @Opponent second, ..."`
*   **Phase 4: The Game (First-to-5)**
    *   **Engine:** Reply with `dice` logic (simulating a dice roll or using a server dice command if available).
    *   **Algorithm:** Track scores locally. First to 5 wins. **Bot wins on ties** implies if 4-4 and bot rolls matching tie-breaker or similar custom rule (adhere effectively to "I win ties").
*   **Phase 5: Victory & Vouch**
    *   **If Won:** Immediately post the bot's payout address (from config).
    *   **After Payout:** Navigate to channel `#vouchs` and post: `+vouch won [Amount] vs @Opponent`.

## 💻 Tech Stack & Configuration Structure

### Required Libraries
1.  `discord.js-selfbot-v13`: Core framework.
2.  `bignumber.js`: For precise float math (money).
3.  `dotenv`: For security.
4.  Crypto Lib (Select one based on chain): `litecore-lib` or `@solana/web3.js`.

### Configuration (`config.json`)
Allows easy editing without touching code:
```json
{
  "betting_limits": { "min": 2, "max": 50 },
  "tax_percentage": 0.15,
  "middleman_ids": ["123456789...", "987654321..."],
  "channels": {
    "vouch_channel_id": "..."
  },
  "payout_address": "MY_WALLET_ADDRESS",
  "crypto_network": "LTC"
}
```

## 🛡️ Reliability & Security
1.  **Anti-Ban:** Implement random delays (500ms - 1500ms) between typing to mimic human behavior.
2.  **State Recovery:** If the bot crashes, it should be able to resume active tickets or at least not double-pay.
3.  **Validation:** Ensure the address posted by the Middleman is valid regex before sending money.

## 🚀 Execution Instructions for the AI
Please generate:
1.  `package.json` with all dependencies.
2.  `.env` template (TOKEN, PRIVATE_KEY).
3.  `config.json` template.
4.  `index.js` (Main logic with clear comments handling the State Machine).
5.  `utils/cryptoHandler.js` (Modular file for the blockchain transaction logic).
