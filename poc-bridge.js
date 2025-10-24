/**
 * Teams ↔ Freshchat Minimal Bridge - PoC
 *
 * This is a proof-of-concept implementation demonstrating real-time
 * message transfer between Microsoft Teams and Freshchat.
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const NodeRSA = require('node-rsa');
const { BotFrameworkAdapter, TurnContext, TeamsInfo } = require('botbuilder');

// ============================================================================
// Configuration
// ============================================================================

const PORT = process.env.PORT || 3978;
const BOT_APP_ID = process.env.BOT_APP_ID;
const BOT_APP_PASSWORD = process.env.BOT_APP_PASSWORD;
const BOT_TENANT_ID = process.env.BOT_TENANT_ID;
const FRESHCHAT_API_KEY = process.env.FRESHCHAT_API_KEY;
const FRESHCHAT_API_URL = process.env.FRESHCHAT_API_URL || 'https://api.freshchat.com/v2';
const FRESHCHAT_INBOX_ID = process.env.FRESHCHAT_INBOX_ID;
const FRESHCHAT_WEBHOOK_PUBLIC_KEY = process.env.FRESHCHAT_WEBHOOK_PUBLIC_KEY;

// ============================================================================
// In-Memory Storage
// ============================================================================

/**
 * Maps Teams conversation IDs to Freshchat conversation IDs
 * Structure: { teamsConversationId: { freshchatConvId, conversationReference } }
 */
const conversationMap = new Map();

/**
 * Reverse map: Freshchat conversation ID to Teams conversation ID
 */
const reverseMap = new Map();

// ============================================================================
// Bot Framework Setup
// ============================================================================

const adapter = new BotFrameworkAdapter({
    appId: BOT_APP_ID,
    appPassword: BOT_APP_PASSWORD,
    channelAuthTenant: BOT_TENANT_ID
});

// Error handler
adapter.onTurnError = async (context, error) => {
    console.error(`[Bot Error] ${error.message}`);
    console.error(error.stack);

    // Send a message to the user
    await context.sendActivity('Sorry, something went wrong processing your message.');
};

// ============================================================================
// Freshchat API Client
// ============================================================================

class FreshchatClient {
    constructor(apiKey, apiUrl, inboxId) {
        this.apiKey = apiKey;
        this.apiUrl = apiUrl;
        this.inboxId = inboxId;
        this.axiosInstance = axios.create({
            baseURL: apiUrl,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Create a new conversation in Freshchat
     */
    async createConversation(userId, userName, initialMessage) {
        try {
            console.log(`[Freshchat] Creating conversation for user: ${userName}`);

            // First, create or get user
            const user = await this.createOrGetUser(userId, userName);

            // Create conversation
            const conversationResponse = await this.axiosInstance.post('/conversations', {
                channel_id: this.inboxId,
                messages: [
                    {
                        message_parts: [
                            {
                                text: {
                                    content: initialMessage
                                }
                            }
                        ],
                        actor_type: 'user',
                        actor_id: user.id
                    }
                ],
                users: [
                    {
                        id: user.id
                    }
                ]
            });

            console.log(`[Freshchat] Conversation created: ${conversationResponse.data.conversation_id}`);
            return conversationResponse.data;
        } catch (error) {
            console.error('[Freshchat] Error creating conversation:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Create or get a Freshchat user
     */
    async createOrGetUser(externalId, name) {
        try {
            // Try to get existing user
            const response = await this.axiosInstance.get(`/users/lookup`, {
                params: { reference_id: externalId }
            });

            if (response.data && response.data.id) {
                console.log(`[Freshchat] Found existing user: ${response.data.id}`);
                return response.data;
            }
        } catch (error) {
            // User doesn't exist, create new one
            console.log(`[Freshchat] Creating new user: ${name || 'Teams User'}`);
        }

        // Use fallback name if name is empty or undefined
        const userName = name && name.trim() ? name.trim() : 'Teams User';

        // Create new user
        const createResponse = await this.axiosInstance.post('/users', {
            reference_id: externalId,
            first_name: userName,
            properties: [
                {
                    name: 'source',
                    value: 'Microsoft Teams'
                }
            ]
        });

        console.log(`[Freshchat] User created: ${createResponse.data.id}`);
        return createResponse.data;
    }

    /**
     * Send a message to an existing Freshchat conversation
     */
    async sendMessage(conversationId, userId, message) {
        try {
            console.log(`[Freshchat] Sending message to conversation: ${conversationId}`);

            const response = await this.axiosInstance.post(`/conversations/${conversationId}/messages`, {
                message_parts: [
                    {
                        text: {
                            content: message
                        }
                    }
                ],
                actor_type: 'user',
                actor_id: userId
            });

            console.log(`[Freshchat] Message sent successfully`);
            return response.data;
        } catch (error) {
            console.error('[Freshchat] Error sending message:', error.response?.data || error.message);
            throw error;
        }
    }
}

const freshchatClient = new FreshchatClient(FRESHCHAT_API_KEY, FRESHCHAT_API_URL, FRESHCHAT_INBOX_ID);

// ============================================================================
// Webhook Signature Verification
// ============================================================================

/**
 * Verify Freshchat webhook signature
 */
function verifyFreshchatSignature(payload, signature) {
    if (!FRESHCHAT_WEBHOOK_PUBLIC_KEY) {
        console.warn('[Security] FRESHCHAT_WEBHOOK_PUBLIC_KEY not configured - skipping verification');
        return true;
    }

    if (!signature) {
        console.warn('[Security] No signature provided in webhook request');
        return false;
    }

    try {
        // Replace literal \n with actual newlines
        const publicKey = FRESHCHAT_WEBHOOK_PUBLIC_KEY.replace(/\\n/g, '\n');

        console.log('[Security] Public Key Length:', publicKey.length);
        console.log('[Security] Public Key:\n', publicKey);
        console.log('[Security] Signature:', signature);
        console.log('[Security] Payload Length:', payload.length);

        const key = new NodeRSA();

        // Try different import formats
        try {
            key.importKey(publicKey, 'pkcs1-public-pem');
            console.log('[Security] Successfully imported key as pkcs1-public-pem');
        } catch (e1) {
            console.log('[Security] Failed pkcs1-public-pem, trying pkcs8-public-pem');
            try {
                key.importKey(publicKey, 'pkcs8-public-pem');
                console.log('[Security] Successfully imported key as pkcs8-public-pem');
            } catch (e2) {
                console.log('[Security] Failed pkcs8-public-pem, trying public format');
                key.importKey(publicKey, 'public');
                console.log('[Security] Successfully imported key as public');
            }
        }

        const isValid = key.verify(
            Buffer.from(payload),
            signature,
            'buffer',
            'base64'
        );

        if (!isValid) {
            console.warn('[Security] Webhook signature verification failed');
        } else {
            console.log('[Security] ✅ Signature verified successfully');
        }

        return isValid;
    } catch (error) {
        console.error('[Security] Error verifying webhook signature:', error.message);
        console.error('[Security] Error stack:', error.stack);
        return false;
    }
}

// ============================================================================
// Bot Logic
// ============================================================================

/**
 * Main bot logic - handles incoming messages from Teams
 */
async function handleTeamsMessage(context) {
    const { activity } = context;

    // Log incoming message
    console.log('\n========================================');
    console.log('[Teams → Freshchat]');
    console.log(`From: ${activity.from.name} (${activity.from.id})`);
    console.log(`Message: ${activity.text}`);
    console.log(`Conversation ID: ${activity.conversation.id}`);
    console.log('========================================\n');

    // Check if we already have a Freshchat conversation for this Teams conversation
    const teamsConvId = activity.conversation.id;
    let mapping = conversationMap.get(teamsConvId);

    try {
        if (!mapping) {
            // First message in this conversation - create new Freshchat conversation
            const freshchatConv = await freshchatClient.createConversation(
                activity.from.id,
                activity.from.name,
                activity.text
            );

            // Store the mapping
            mapping = {
                freshchatConvId: freshchatConv.conversation_id,
                freshchatUserId: freshchatConv.user_id,
                conversationReference: TurnContext.getConversationReference(activity)
            };

            conversationMap.set(teamsConvId, mapping);
            reverseMap.set(freshchatConv.conversation_id, teamsConvId);

            console.log(`[Mapping] Created: Teams(${teamsConvId}) ↔ Freshchat(${freshchatConv.conversation_id})`);
        } else {
            // Existing conversation - send message to Freshchat
            await freshchatClient.sendMessage(
                mapping.freshchatConvId,
                mapping.freshchatUserId,
                activity.text
            );
        }

        // Acknowledge receipt
        await context.sendActivity('✓ Message forwarded to Freshchat');
    } catch (error) {
        console.error('[Error] Failed to forward message to Freshchat:', error);
        await context.sendActivity('❌ Failed to forward message to Freshchat. Please check logs.');
    }
}

// ============================================================================
// Express Server Setup
// ============================================================================

const app = express();
app.use(express.json());

/**
 * Health check endpoint
 */
app.get('/', (req, res) => {
    res.json({
        status: 'running',
        service: 'Teams ↔ Freshchat Bridge (PoC)',
        timestamp: new Date().toISOString(),
        mappings: {
            active: conversationMap.size,
            teams_to_freshchat: Array.from(conversationMap.keys()),
            freshchat_to_teams: Array.from(reverseMap.keys())
        }
    });
});

/**
 * Bot Framework endpoint - receives messages from Teams
 */
app.post('/bot/callback', async (req, res) => {
    await adapter.process(req, res, async (context) => {
        // Handle different activity types
        if (context.activity.type === 'message') {
            await handleTeamsMessage(context);
        } else if (context.activity.type === 'conversationUpdate') {
            // Bot added to conversation
            if (context.activity.membersAdded) {
                for (const member of context.activity.membersAdded) {
                    if (member.id !== context.activity.recipient.id) {
                        await context.sendActivity(
                            '👋 Hello! I\'m the Teams-Freshchat bridge bot. ' +
                            'Send me a message and I\'ll forward it to Freshchat!'
                        );
                    }
                }
            }
        }
    });
});

/**
 * Freshchat webhook endpoint - receives messages from Freshchat agents
 */
app.post('/freshchat/webhook', async (req, res) => {
    try {
        console.log('\n========================================');
        console.log('[Freshchat → Teams Webhook]');
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        console.log('Payload:', JSON.stringify(req.body, null, 2));
        console.log('========================================\n');

        // Verify webhook signature
        const signature = req.headers['x-freshchat-signature'];
        const rawPayload = JSON.stringify(req.body);
        
        if (!verifyFreshchatSignature(rawPayload, signature)) {
            console.error('[Security] Webhook signature verification failed');
            return res.status(401).json({ error: 'Invalid signature' });
        }

        console.log('[Security] Webhook signature verified ✓');

        const { data, action } = req.body;

        // Handle message_create event
        if (action === 'message_create' && data?.message) {
            const message = data.message;
            const conversationId = data.conversation_id || message.conversation_id;
            const actorType = message.actor_type;

            console.log(`[Freshchat] Processing message_create event`);
            console.log(`[Freshchat] Actor type: ${actorType}`);
            console.log(`[Freshchat] Conversation ID: ${conversationId}`);

            // Only process agent messages (not user messages)
            if (actorType !== 'agent') {
                console.log('[Freshchat] Ignoring non-agent message');
                return res.sendStatus(200);
            }

            // Find corresponding Teams conversation
            const teamsConvId = reverseMap.get(conversationId);
            if (!teamsConvId) {
                console.log(`[Freshchat] No Teams mapping found for conversation: ${conversationId}`);
                return res.sendStatus(200);
            }

            const mapping = conversationMap.get(teamsConvId);
            if (!mapping) {
                console.log(`[Freshchat] Mapping data missing for: ${teamsConvId}`);
                return res.sendStatus(200);
            }

            // Extract message text
            let messageText = '';
            if (message.message_parts && message.message_parts.length > 0) {
                const textPart = message.message_parts.find(part => part.text);
                if (textPart && textPart.text.content) {
                    messageText = textPart.text.content;
                }
            }

            if (!messageText) {
                console.log('[Freshchat] No text content found in message');
                return res.sendStatus(200);
            }

            console.log(`[Freshchat → Teams] Forwarding message: "${messageText}"`);

            // Send message to Teams
            await adapter.continueConversation(
                mapping.conversationReference,
                async (turnContext) => {
                    await turnContext.sendActivity(`**Agent Reply:**\n${messageText}`);
                }
            );

            console.log('[Freshchat → Teams] Message forwarded successfully');
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('[Webhook Error]', error);
        res.sendStatus(500);
    }
});

/**
 * Debug endpoint - view current mappings
 */
app.get('/debug/mappings', (req, res) => {
    const mappings = [];
    conversationMap.forEach((value, key) => {
        mappings.push({
            teamsConversationId: key,
            freshchatConversationId: value.freshchatConvId,
            freshchatUserId: value.freshchatUserId
        });
    });

    res.json({
        totalMappings: mappings.length,
        mappings: mappings
    });
});

/**
 * Reset mappings endpoint (for testing)
 */
app.post('/debug/reset', (req, res) => {
    conversationMap.clear();
    reverseMap.clear();
    console.log('[Debug] All mappings cleared');
    res.json({ message: 'All mappings cleared' });
});

// ============================================================================
// Server Start
// ============================================================================

app.listen(PORT, () => {
    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  Teams ↔ Freshchat Bridge (PoC) - Server Started          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
    console.log(`🚀 Server listening on port ${PORT}`);
    console.log(`📍 Bot endpoint: http://localhost:${PORT}/bot/callback`);
    console.log(`📍 Webhook endpoint: http://localhost:${PORT}/freshchat/webhook`);
    console.log(`📍 Health check: http://localhost:${PORT}/`);
    console.log(`📍 Debug mappings: http://localhost:${PORT}/debug/mappings`);
    console.log('\n⚠️  Remember to:');
    console.log('   1. Start ngrok: ngrok http 3978');
    console.log('   2. Update Azure Bot messaging endpoint with ngrok URL');
    console.log('   3. Configure Freshchat webhook with ngrok URL');
    console.log('\n═══════════════════════════════════════════════════════════\n');
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

process.on('SIGINT', () => {
    console.log('\n\n[Shutdown] Received SIGINT, shutting down gracefully...');
    console.log(`[Shutdown] Active mappings at shutdown: ${conversationMap.size}`);
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n\n[Shutdown] Received SIGTERM, shutting down gracefully...');
    console.log(`[Shutdown] Active mappings at shutdown: ${conversationMap.size}`);
    process.exit(0);
});
