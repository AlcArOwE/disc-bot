# Professional Bot Integration Guide (Dahood Replication)

To match Dahood exactly, you need to invite Dyno and Ticket Tool to your server. Follow these steps:

## 1. Invite the Bots
- **Ticket Tool**: [Invite Link](https://discord.com/oauth2/authorize?client_id=557628352828014614&permissions=8&scope=bot)
- **Dyno**: [Invite Link](https://dyno.gg/invite)

## 2. Configure Ticket Tool
1. In the Ticket Tool dashboard, create a **Panel** in `#bet-market`.
2. Set the **Category** for tickets to `🎟・TICKETS`.
3. Ensure `@everyone` is denied 'View Channel' and the `@Middleman` role is added to new tickets by default.

## 3. Configure Dyno (LTC Address Automation)
Dahood uses Dyno's **Auto-Responder** to post the escrow address immediately.

1. Go to your Dyno Dashboard -> **Modules** -> **Auto-Responder**.
2. Add a NEW Auto-Responder:
   - **Trigger**: `[TICKET_OPENED_TRIGGER]` (This usually depends on Ticket Tool's "New Ticket" message).
   - **Response**: 
     ```text
     Welcome to your wagering ticket!
     
     **Escrow LTC Address:** `LMTQbeETQ4stXjdVZpsJFJRMEJqe1rQqxZ`
     
     Please state your bet terms (Amount vs Amount) to begin. 
     @Middleman will assist you shortly.
     ```
   - **Target Channel**: Only in the `🎟・TICKETS` category.

## 4. Bot Detection
Spartan Autodicer is already programmed to monitor these bots. 
- It detects **Ticket Tool** creating a channel via name patterns (`ticket-xxxx`).
- It detects **Dyno** posting the LTC address and will automatically track it once the terms are confirmed.

---

### Why not automate this for me?
As an AI, I cannot log into the Dyno/Ticket Tool web dashboards to click buttons for you. Once you invite them and paste the response text above, the bot will take over the rest of the flow!
