# Freshchat Bridge

A production-ready bidirectional message bridge between Microsoft Teams and Freshchat.

## Purpose

- Demonstrate real-time message relay from Teams to Freshchat and back
- Provide a tangible demo for stakeholder evaluation before committing to full MVP
- Validate the technical feasibility of the integration approach

## Features

✅ Side-loaded Teams bot with Bot Framework integration
✅ Bidirectional message flow (Teams ↔ Freshchat)
✅ In-memory conversation mapping
✅ Ngrok tunnel support for local development
✅ Console logging for demo observability
✅ Health check and debug endpoints

## Limitations (By Design)

❌ Text messages only (no attachments)
❌ In-memory storage (restarting clears all mappings)
❌ No message queuing or retry logic
❌ No production-grade security or monitoring
❌ Single-instance only (no clustering)

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** (v18 or higher) - [Download](https://nodejs.org/)
- **npm** (comes with Node.js)
- **ngrok** - [Download](https://ngrok.com/download)
- **Azure Account** - For Bot Framework registration
- **Freshchat Account** - With API access
- **Microsoft Teams** - Admin access for sideloading

---

## Setup Instructions

### Step 1: Clone and Install Dependencies

```bash
# Navigate to project directory
cd freshchat-bridge

# Install Node.js dependencies
npm install
```

### Step 2: Azure Bot Registration

1. **Go to Azure Portal** → [Azure Bot Service](https://portal.azure.com/#blade/HubsExtension/BrowseResource/resourceType/Microsoft.BotService%2FbotServices)

2. **Create New Bot:**
   - Click "Create"
   - Select "Azure Bot"
   - Fill in required fields:
     - **Bot handle:** `teams-freshchat-poc` (or your preferred name)
     - **Subscription:** Your Azure subscription
     - **Resource group:** Create new or use existing
     - **Pricing tier:** F0 (Free)
     - **Microsoft App ID:** Create new

3. **Create Microsoft App ID & Password:**
   - Click "Create new Microsoft App ID"
   - In the new window, click "Create New"
   - Copy the **App ID** (you'll need this)
   - Click "Create new client secret"
   - Copy the **client secret value** immediately (can't view again)

4. **Configure Bot:**
   - Go to your bot resource → **Configuration**
   - Set **Messaging endpoint:** `https://your-ngrok-url.ngrok.io/bot/callback`
   - (You'll update this after starting ngrok)

5. **Enable Teams Channel:**
   - Go to **Channels** → Click **Teams** icon
   - Accept terms and save

### Step 3: Freshchat Configuration

1. **Get API Key:**
   - Log in to Freshchat
   - Go to **Settings** → **API Tokens**
   - Create new token or copy existing one
   - Copy the **API Key**

2. **Get Inbox ID:**
   - Go to **Settings** → **Inboxes**
   - Open your target inbox
   - Copy the **Inbox ID** from URL (e.g., `/inboxes/12345`)

3. **Configure Webhook:**
   - Go to **Settings** → **Webhooks**
   - Click "Add Webhook"
   - **Webhook URL:** `https://your-ngrok-url.ngrok.io/freshchat/webhook`
   - **Events to subscribe:** `message:created`
   - Save webhook

### Step 4: Environment Configuration

1. **Copy environment template:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` file:**
   ```env
   PORT=3978

   # From Azure Bot registration
   BOT_APP_ID=your-bot-app-id-here
   BOT_APP_PASSWORD=your-bot-app-password-here

   # From Freshchat
   FRESHCHAT_API_KEY=your-freshchat-api-key-here
   FRESHCHAT_API_URL=https://api.freshchat.com/v2
   FRESHCHAT_INBOX_ID=your-inbox-id-here

   # Will update after starting ngrok
   NGROK_URL=https://your-ngrok-url.ngrok.io

   LOG_LEVEL=info
   ```

### Step 5: Start ngrok

```bash
# In a separate terminal window
ngrok http 3978
```

**Copy the ngrok URL** (e.g., `https://abc123.ngrok.io`) and update:
1. Azure Bot messaging endpoint: `https://abc123.ngrok.io/bot/callback`
2. Freshchat webhook URL: `https://abc123.ngrok.io/freshchat/webhook`
3. `.env` file `NGROK_URL` value

### Step 6: Prepare Teams App

1. **Update Teams manifest:**
   ```bash
   cd teams-app
   ```

2. **Edit `manifest.json`:**
   - Replace `REPLACE-WITH-YOUR-BOT-APP-ID` with your Azure Bot App ID (2 places)
   - Update developer information

3. **Add icon files:**
   - Create `color.png` (192x192 pixels)
   - Create `outline.png` (32x32 pixels)
   - See `teams-app/README.md` for icon creation guide

4. **Create app package:**
   ```bash
   zip -r teams-freshchat-bot.zip manifest.json color.png outline.png
   ```

### Step 7: Start the Bridge Server

```bash
# In project root directory
npm start
```

You should see:
```
╔════════════════════════════════════════════════════════════╗
║  Teams ↔ Freshchat Bridge (PoC) - Server Started          ║
╚════════════════════════════════════════════════════════════╝

🚀 Server listening on port 3978
📍 Bot endpoint: http://localhost:3978/bot/callback
📍 Webhook endpoint: http://localhost:3978/freshchat/webhook
```

### Step 8: Sideload Teams App

1. **Open Microsoft Teams**
2. **Go to Apps** → **Manage your apps** → **Upload an app**
3. **Select:** "Upload a custom app"
4. **Choose:** `teams-freshchat-bot.zip`
5. **Add to team or personal chat**

---

## Demo Script

### Pre-Demo Checklist

- [ ] ngrok tunnel is running and URL is configured
- [ ] `.env` file has all correct values
- [ ] Bridge server is running (`npm start`)
- [ ] Teams app is sideloaded and added to a channel/chat
- [ ] Freshchat dashboard is open and ready
- [ ] Test message flow once before demo

### Demo Flow

#### Part 1: Teams → Freshchat

1. **Open Teams** and navigate to channel/chat with bot

2. **Send message from Teams:**
   ```
   환불 문의합니다
   ```

3. **Show console output:**
   ```
   ========================================
   [Teams → Freshchat]
   From: John Doe (29:xxx)
   Message: 환불 문의합니다
   Conversation ID: 19:xxx
   ========================================

   [Freshchat] Creating conversation for user: John Doe
   [Freshchat] User created: user123
   [Freshchat] Conversation created: conv456
   [Mapping] Created: Teams(19:xxx) ↔ Freshchat(conv456)
   ```

4. **Show Freshchat dashboard:**
   - New conversation appears in inbox
   - Message content: "환불 문의합니다"
   - User name: "John Doe"
   - Source: "Microsoft Teams"

#### Part 2: Freshchat → Teams

1. **Open conversation in Freshchat**

2. **Agent replies in Freshchat:**
   ```
   도와드리겠습니다. 어떤 제품의 환불을 원하시나요?
   ```

3. **Show console output:**
   ```
   ========================================
   [Freshchat → Teams Webhook]
   ========================================

   [Freshchat → Teams] Forwarding message: "도와드리겠습니다. 어떤 제품의 환불을 원하시나요?"
   [Freshchat → Teams] Message forwarded successfully
   ```

4. **Show Teams channel:**
   - Bot posts agent reply:
   ```
   Agent Reply:
   도와드리겠습니다. 어떤 제품의 환불을 원하시나요?
   ```

#### Part 3: Continued Conversation

1. **User replies in Teams:**
   ```
   노트북을 구매했는데 불량이 있어요
   ```

2. **Message appears in Freshchat** (same conversation)

3. **Agent replies in Freshchat:**
   ```
   죄송합니다. 환불 절차를 도와드리겠습니다.
   ```

4. **Reply appears in Teams**

#### Highlight Key Points

- ✅ **Real-time bidirectional message flow**
- ✅ **Conversation context maintained** (same Freshchat thread)
- ✅ **No manual mapping required** (automatic association)
- ⚠️ **Text only** (as per PoC scope)
- ⚠️ **In-memory storage** (restart clears state)

---

## API Endpoints

### Health Check
```bash
GET http://localhost:3978/
```

Response:
```json
{
  "status": "running",
  "service": "Teams ↔ Freshchat Bridge (PoC)",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "mappings": {
    "active": 3,
    "teams_to_freshchat": ["19:xxx", "19:yyy"],
    "freshchat_to_teams": ["conv123", "conv456"]
  }
}
```

### Debug: View Mappings
```bash
GET http://localhost:3978/debug/mappings
```

### Debug: Reset Mappings
```bash
POST http://localhost:3978/debug/reset
```

---

## Troubleshooting

### Bot Not Receiving Messages

**Issue:** Messages sent in Teams don't trigger webhook

**Solutions:**
1. Check ngrok is running: `curl http://localhost:4040/status`
2. Verify Azure Bot messaging endpoint matches ngrok URL
3. Check bot is properly added to channel/chat
4. Review console logs for errors

### Freshchat Conversation Not Created

**Issue:** Message forwarded but no conversation in Freshchat

**Solutions:**
1. Verify `FRESHCHAT_API_KEY` is correct
2. Check `FRESHCHAT_INBOX_ID` exists and is accessible
3. Review console logs for Freshchat API errors
4. Test API key with direct API call:
   ```bash
   curl -H "Authorization: Bearer YOUR_API_KEY" \
        https://api.freshchat.com/v2/users
   ```

### Agent Replies Not Appearing in Teams

**Issue:** Agent sends message in Freshchat but nothing shows in Teams

**Solutions:**
1. Verify Freshchat webhook is configured correctly
2. Check ngrok URL in webhook matches current session
3. Ensure webhook event `message:created` is subscribed
4. Review console logs for webhook payload
5. Check conversation mapping exists: `GET /debug/mappings`

### ngrok URL Changed

**Issue:** Restarted ngrok and URLs are different

**Solutions:**
1. Copy new ngrok URL
2. Update Azure Bot messaging endpoint
3. Update Freshchat webhook URL
4. Update `.env` file `NGROK_URL`
5. Restart bridge server: `npm start`

### "Mapping Data Missing" Error

**Issue:** Server restarted and lost conversation state

**Solutions:**
- This is expected behavior (in-memory storage)
- Have user send a new message to create fresh mapping
- For production, implement persistent storage (database)

---

## Architecture Overview

```
┌─────────────────┐         ┌──────────────────┐         ┌─────────────────┐
│                 │         │                  │         │                 │
│  Microsoft      │  HTTP   │   Node.js        │  HTTP   │   Freshchat     │
│  Teams          ├────────▶│   Bridge         ├────────▶│   API           │
│                 │         │   Server         │         │                 │
│  (Bot           │◀────────┤                  │◀────────┤   (Webhook)     │
│   Framework)    │         │   In-Memory      │         │                 │
│                 │         │   Mapping        │         │                 │
└─────────────────┘         └──────────────────┘         └─────────────────┘
        │                            │                            │
        │                            │                            │
    Bot sends                   Maintains                  Agent sends
    message                     conversation                message
                                mapping
```

### Data Flow

1. **Teams → Freshchat:**
   - User sends message in Teams
   - Bot Framework forwards to `/bot/callback`
   - Server creates/updates Freshchat conversation
   - Stores conversation mapping in memory

2. **Freshchat → Teams:**
   - Agent replies in Freshchat
   - Freshchat webhook posts to `/freshchat/webhook`
   - Server looks up Teams conversation from mapping
   - Bot posts message to Teams using stored conversation reference

---

## Next Steps After Approval

If this PoC is approved, the following enhancements are recommended for MVP:

### Infrastructure
- [ ] Deploy to production environment (Azure App Service / AWS)
- [ ] Set up persistent storage (PostgreSQL / MongoDB)
- [ ] Implement message queueing (Azure Service Bus / RabbitMQ)
- [ ] Add retry logic and dead-letter queue handling

### Features
- [ ] Attachment support (images, documents)
- [ ] Message mentions and formatting
- [ ] Routing logic / IntelliAssign integration
- [ ] Conversation assignment and handoff
- [ ] Typing indicators
- [ ] Read receipts

### Security
- [ ] Implement authentication/authorization
- [ ] Add request validation and sanitization
- [ ] Set up antivirus scanning for attachments
- [ ] Enable audit logging

### Monitoring
- [ ] Application Insights / CloudWatch integration
- [ ] Error tracking (Sentry / Rollbar)
- [ ] Performance monitoring
- [ ] Alert configuration

### Deployment
- [ ] CI/CD pipeline setup
- [ ] Automated testing (unit, integration, e2e)
- [ ] Blue-green deployment strategy
- [ ] Proper Teams app submission (beyond sideloading)

---

## Known Limitations & Risks

### Ngrok Downtime
- **Risk:** Ngrok tunnel may disconnect during demo
- **Mitigation:** Keep backup tunnel ready, restart quickly if needed

### In-Memory Mapping Loss
- **Risk:** Server restart clears all conversation mappings
- **Mitigation:** Rehearse demo flow shortly before presentation

### API Rate Limits
- **Risk:** Freshchat/Teams API rate limits
- **Mitigation:** Low demo volume keeps usage minimal

### Network Latency
- **Risk:** Delayed message delivery
- **Mitigation:** Acknowledge this is PoC, production will optimize

---

## Support & Contact

For issues or questions:

1. Check console logs for detailed error messages
2. Review this README's troubleshooting section
3. Check ngrok dashboard: http://localhost:4040
4. Verify all endpoints are accessible
5. Test with curl/Postman before live demo

---

## License

This is a proof-of-concept implementation for evaluation purposes.

---

**Last Updated:** 2024-01-15
**Version:** 0.1.0
**Status:** PoC - Not for production use
