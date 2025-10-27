# Demo Checklist - Teams ↔ Freshchat Bridge PoC

Use this checklist to prepare for your demonstration.

## 🔧 Pre-Demo Setup (30 minutes before)

### Infrastructure
- [ ] ngrok is installed and accessible
- [ ] Node.js dependencies are installed (`npm install`)
- [ ] `.env` file is configured with all credentials

### Azure Bot
- [ ] Azure Bot is created and configured
- [ ] Bot App ID and Password are saved in `.env`
- [ ] Teams channel is enabled for the bot

### Freshchat
- [ ] API key is generated and saved in `.env`
- [ ] Inbox ID is identified and saved in `.env`
- [ ] Webhook endpoint is configured (will update with ngrok URL)

### Teams App
- [ ] Manifest.json has correct Bot App ID
- [ ] Icon files (color.png, outline.png) are created
- [ ] teams-freshchat-bot.zip package is created

---

## 🚀 Demo Day Setup (15 minutes before)

### 1. Start ngrok
```bash
ngrok http 3978
```
- [ ] ngrok tunnel is running
- [ ] Copy ngrok URL (e.g., `https://abc123.ngrok.io`)

### 2. Update Endpoints
- [ ] Azure Bot messaging endpoint: `https://abc123.ngrok.io/bot/callback`
- [ ] Freshchat webhook URL: `https://abc123.ngrok.io/freshchat/webhook`
- [ ] `.env` NGROK_URL value updated

### 3. Start Bridge Server
```bash
npm start
```
- [ ] Server started successfully on port 3978
- [ ] No error messages in console
- [ ] Health check accessible: `curl http://localhost:3978/`

### 4. Sideload Teams App
- [ ] Teams app uploaded in Microsoft Teams
- [ ] Bot added to target channel or chat
- [ ] Bot sends welcome message when added

### 5. Test Run
- [ ] Send test message in Teams: "Hello"
- [ ] Verify conversation appears in Freshchat
- [ ] Reply in Freshchat: "Hi there!"
- [ ] Verify reply appears in Teams
- [ ] Check console logs show proper flow

### 6. Reset for Demo
```bash
curl -X POST http://localhost:3978/debug/reset
```
- [ ] Mappings cleared
- [ ] Ready for fresh demo

---

## 🎬 During Demo

### Demo Windows to Have Open
1. **Terminal 1:** Bridge server console (showing logs)
2. **Terminal 2:** ngrok dashboard or spare terminal
3. **Browser 1:** Microsoft Teams with bot conversation
4. **Browser 2:** Freshchat agent dashboard
5. **Browser 3 (optional):** ngrok web interface (http://localhost:4040)

### Demo Script

#### Part 1: Teams → Freshchat (5 minutes)

**Say:** "Let me show you how a customer message in Teams gets forwarded to Freshchat."

1. **In Teams:**
   - [ ] Show the channel with bot
   - [ ] Type: "환불 문의합니다"
   - [ ] Send message

2. **Switch to Console:**
   - [ ] Point out incoming message log
   - [ ] Highlight Freshchat conversation creation
   - [ ] Show conversation mapping creation

3. **Switch to Freshchat:**
   - [ ] Show new conversation appeared
   - [ ] Point out message content
   - [ ] Highlight user name and source

**Say:** "As you can see, the message went from Teams to Freshchat in real-time, and a conversation was automatically created."

---

#### Part 2: Freshchat → Teams (5 minutes)

**Say:** "Now let's see how an agent reply in Freshchat gets sent back to Teams."

1. **In Freshchat:**
   - [ ] Open the conversation
   - [ ] Type agent reply: "도와드리겠습니다. 어떤 제품의 환불을 원하시나요?"
   - [ ] Send message

2. **Switch to Console:**
   - [ ] Show webhook received log
   - [ ] Highlight message forwarding to Teams

3. **Switch to Teams:**
   - [ ] Show agent reply appeared
   - [ ] Point out "Agent Reply:" prefix

**Say:** "The agent's response is instantly delivered back to the Teams user, creating a seamless conversation experience."

---

#### Part 3: Continued Conversation (3 minutes)

**Say:** "Let's verify the conversation context is maintained across multiple messages."

1. **In Teams:**
   - [ ] Send: "노트북을 구매했는데 불량이 있어요"

2. **In Freshchat:**
   - [ ] Show message appeared in SAME conversation (not new)
   - [ ] Reply: "죄송합니다. 환불 절차를 도와드리겠습니다."

3. **In Teams:**
   - [ ] Show reply appeared

**Say:** "Notice how all messages are threaded in the same Freshchat conversation - the bridge maintains context automatically."

---

#### Part 4: Show Architecture & Limitations (3 minutes)

1. **Show Console Logs:**
   - [ ] Point out detailed logging for observability
   - [ ] Show mapping information

2. **Show Health Check:**
   ```bash
   curl http://localhost:3978/debug/mappings
   ```
   - [ ] Display active conversation mappings

3. **Discuss Limitations:**
   - [ ] Text only (no attachments in PoC)
   - [ ] In-memory storage (restarts clear state)
   - [ ] No queueing or retry logic
   - [ ] Local development setup (not production)

**Say:** "This is a minimal PoC to validate the approach. For production, we'll add persistence, queuing, attachments, and enterprise-grade reliability."

---

## 📊 Key Talking Points

### What Works Well
- ✅ Real-time bidirectional message flow
- ✅ Automatic conversation mapping
- ✅ Context preservation across messages
- ✅ Simple setup for demonstration
- ✅ Clear observability through logging

### Known Limitations (By Design)
- ⚠️ Text messages only
- ⚠️ In-memory storage (ephemeral)
- ⚠️ No attachment support
- ⚠️ No message queuing
- ⚠️ Ngrok tunnel (not production URL)

### Next Steps for MVP
- 🔄 Production hosting (Azure/AWS)
- 🔄 Persistent storage (database)
- 🔄 Message queueing and retry logic
- 🔄 Attachment support with AV scanning
- 🔄 Advanced routing and IntelliAssign
- 🔄 Monitoring and alerting
- 🔄 Security hardening

---

## 🆘 Troubleshooting During Demo

### If message doesn't appear in Freshchat:
1. Check console logs for errors
2. Verify ngrok is still running: `curl http://localhost:4040/status`
3. Check Freshchat API key is valid
4. Use backup: send another message

### If agent reply doesn't appear in Teams:
1. Check console logs for webhook receipt
2. Verify webhook is configured correctly
3. Check conversation mapping exists: `GET /debug/mappings`
4. Use backup: restart flow with new message

### If ngrok disconnects:
1. Restart ngrok: `ngrok http 3978`
2. Update Azure Bot and Freshchat with new URL
3. Restart bridge server
4. Continue demo from last successful point

### Emergency Reset:
```bash
# Kill and restart everything
pkill -f ngrok
pkill -f node
ngrok http 3978 &
npm start
```

---

## 📝 Post-Demo Notes

After the demo, document:
- [ ] Stakeholder feedback
- [ ] Questions asked
- [ ] Feature requests mentioned
- [ ] Concerns raised
- [ ] Decision on proceeding to MVP
- [ ] Timeline expectations

---

## ✅ Demo Complete!

- [ ] Thank stakeholders for their time
- [ ] Provide summary of what was demonstrated
- [ ] Share next steps and timeline
- [ ] Offer to provide demo video/recording
- [ ] Schedule follow-up meeting if needed

---

**Good luck with your demo! 🚀**
