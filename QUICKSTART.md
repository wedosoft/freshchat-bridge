# Quick Start Guide - Teams ↔ Freshchat Bridge PoC

Get up and running in 15 minutes!

## Prerequisites

- Node.js 18+ installed
- Azure account for Bot registration
- Freshchat account with API access
- ngrok installed
- Microsoft Teams with sideloading enabled

---

## 5-Minute Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:
- `BOT_APP_ID` - From Azure Bot registration
- `BOT_APP_PASSWORD` - From Azure Bot registration
- `FRESHCHAT_API_KEY` - From Freshchat settings
- `FRESHCHAT_INBOX_ID` - From Freshchat inbox settings

### 3. Verify Setup

```bash
node verify-setup.js
```

Fix any errors or warnings before proceeding.

### 4. Start Services

**Terminal 1 - ngrok:**
```bash
ngrok http 3978
```
Copy the ngrok URL (e.g., `https://abc123.ngrok.io`)

**Terminal 2 - Bridge Server:**
```bash
npm start
```

### 5. Update Endpoints

1. **Azure Bot** → Configuration → Messaging endpoint:
   ```
   https://abc123.ngrok.io/bot/callback
   ```

2. **Freshchat** → Webhooks → Add webhook:
   ```
   https://abc123.ngrok.io/freshchat/webhook
   ```
   Subscribe to: `message:created`

### 6. Prepare Teams App

```bash
cd teams-app
```

1. Edit `manifest.json` - replace `REPLACE-WITH-YOUR-BOT-APP-ID` with your Bot App ID
2. Add `color.png` (192x192) and `outline.png` (32x32) icons
3. Create package:
   ```bash
   zip -r teams-freshchat-bot.zip manifest.json color.png outline.png
   ```

### 7. Sideload in Teams

1. Teams → Apps → Manage your apps → Upload an app
2. Select `teams-freshchat-bot.zip`
3. Add to a channel or personal chat

---

## Test It!

1. **Send message in Teams:**
   ```
   Hello from Teams!
   ```

2. **Check Freshchat:**
   - New conversation should appear

3. **Reply in Freshchat:**
   ```
   Hello from Freshchat!
   ```

4. **Check Teams:**
   - Bot should post the reply

---

## Quick Troubleshooting

**Message not forwarded to Freshchat?**
- Check console logs for errors
- Verify `.env` has correct credentials
- Ensure ngrok is running

**Agent reply not in Teams?**
- Verify Freshchat webhook is configured
- Check webhook event `message:created` is subscribed
- Review console logs

**ngrok URL changed?**
- Update Azure Bot and Freshchat webhook
- Restart bridge server

---

## Demo Preparation

See `DEMO_CHECKLIST.md` for detailed demo preparation steps.

**Quick Pre-Demo Check:**
```bash
# Health check
curl http://localhost:3978/

# View mappings
curl http://localhost:3978/debug/mappings

# Reset (if needed)
curl -X POST http://localhost:3978/debug/reset
```

---

## Need More Details?

- Full setup guide: `README.md`
- Demo checklist: `DEMO_CHECKLIST.md`
- Verify configuration: `node verify-setup.js`

---

**Happy bridging! 🚀**
