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
const FormData = require('form-data');
const mime = require('mime-types');
const { URL } = require('url');
const { BotFrameworkAdapter, TurnContext, TeamsInfo, CardFactory, AttachmentLayoutTypes } = require('botbuilder');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

function updateConversationMapping(teamsConversationId, updates) {
    const existing = conversationMap.get(teamsConversationId) || {};
    const merged = { ...existing };

    Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            if (key === 'freshchatConversationGuid' || key === 'freshchatConversationNumericId') {
                merged[key] = String(value);
            } else {
                merged[key] = value;
            }
        }
    });

    conversationMap.set(teamsConversationId, merged);

    if (merged.freshchatConversationGuid) {
        reverseMap.set(merged.freshchatConversationGuid, teamsConversationId);
    }

    if (merged.freshchatConversationNumericId) {
        reverseMap.set(String(merged.freshchatConversationNumericId), teamsConversationId);
    }

    return merged;
}

function resolveFreshchatConversationId(mapping) {
    if (!mapping) {
        return null;
    }

    return mapping.freshchatConversationNumericId
        ? String(mapping.freshchatConversationNumericId)
        : mapping.freshchatConversationGuid
            ? String(mapping.freshchatConversationGuid)
            : null;
}

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
     * Build message parts from text and attachments
     */
    buildMessageParts(message, attachments = []) {
        const messageParts = [];

        // Add text if provided
        if (message) {
            messageParts.push({
                text: {
                    content: message
                }
            });
        }

        // Add file attachments
        for (const attachment of attachments) {
            const filePart = {
                file: {
                    name: attachment.name,
                    content_type: attachment.content_type,
                    file_size_in_bytes: attachment.file_size_in_bytes
                }
            };

            // Use file_hash or url
            if (attachment.file_hash) {
                filePart.file.file_hash = attachment.file_hash;
            } else if (attachment.url) {
                filePart.file.url = attachment.url;
            }

            messageParts.push(filePart);
        }

        return messageParts;
    }

    /**
     * Create a new conversation in Freshchat
     */
    async createConversation(userId, userName, initialMessage, attachments = []) {
        try {
            console.log(`[Freshchat] Creating conversation for user: ${userName}`);

            // First, create or get user
            const user = await this.createOrGetUser(userId, userName);

            // Build message parts
            const messageParts = this.buildMessageParts(initialMessage, attachments);

            // Create conversation
            const conversationResponse = await this.axiosInstance.post('/conversations', {
                channel_id: this.inboxId,
                messages: [
                    {
                        message_parts: messageParts,
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
            if (conversationResponse.data?.freshchat_conversation_id) {
                console.log(`[Freshchat] Freshchat conversation ID: ${conversationResponse.data.freshchat_conversation_id}`);
            }
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
     * Upload a file to Freshchat
     */
    async uploadFile(fileBuffer, filename, contentType) {
        try {
            console.log(`[Freshchat] Uploading file: ${filename} (${contentType})`);

            const formData = new FormData();
            formData.append('file', fileBuffer, {
                filename: filename,
                contentType: contentType
            });

            const response = await axios.post(`${this.apiUrl}/files/upload`, formData, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    ...formData.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            console.log(`[Freshchat] File uploaded successfully:`, response.data);
            return response.data;
        } catch (error) {
            console.error('[Freshchat] Error uploading file:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Fetch a specific message from a Freshchat conversation
     */
    async getMessageFromConversation(conversationId, messageId, options = {}) {
        const params = {
            items_per_page: options.itemsPerPage || 30
        };

        if (options.fromTime) {
            params.from_time = options.fromTime;
        }

        const response = await this.axiosInstance.get(`/conversations/${conversationId}/messages`, {
            params
        });

        const messages = response.data?.messages || [];
        return messages.find((msg) => msg.id === messageId) || null;
    }

    /**
     * Retry fetching message details so Freshchat has time to attach download URLs
     */
    async getMessageWithRetry(conversationId, messageId, createdTime, maxAttempts = 3) {
        let attempt = 0;
        let lastError = null;
        let fallbackMessage = null;

        while (attempt < maxAttempts) {
            attempt += 1;

            try {
                const message = await this.getMessageFromConversation(conversationId, messageId, {
                    fromTime: attempt === 1 ? createdTime : undefined
                });

                if (message) {
                    if (message.message_parts?.some((part) => part.file?.url)) {
                        return message;
                    }
                    fallbackMessage = message;
                }
            } catch (error) {
                lastError = error;
            }

            if (attempt < maxAttempts) {
                await delay(700 * attempt);
            }
        }

        if (lastError) {
            console.error(`[Freshchat] Failed to hydrate message ${messageId}:`, lastError.response?.data || lastError.message);
        }

        return fallbackMessage;
    }

    /**
     * Send a message to an existing Freshchat conversation
     */
    async sendMessage(conversationId, userId, message, attachments = []) {
        try {
            if (!conversationId) {
                throw new Error('Freshchat conversation ID is required to send a message');
            }

            console.log(`[Freshchat] Sending message to conversation: ${conversationId}`);

            // Build message parts using shared helper
            const messageParts = this.buildMessageParts(message, attachments);

            const response = await this.axiosInstance.post(`/conversations/${conversationId}/messages`, {
                message_parts: messageParts,
                actor_type: 'user',
                actor_id: userId
            });

            console.log(`[Freshchat] Message sent successfully, Message ID: ${response.data.id}`);

            // Fetch message details to get actual file URLs after upload
            if (attachments.length > 0 && /^[0-9]+$/.test(String(conversationId))) {
                const detailedMessage = await this.getMessageWithRetry(conversationId, response.data.id, response.data.created_time);
                if (detailedMessage) {
                    console.log('[Freshchat] Message details:', JSON.stringify(detailedMessage, null, 2));
                } else {
                    console.warn('[Freshchat] Unable to fetch message details for attachment logging');
                }
            } else if (attachments.length > 0) {
                console.log('[Freshchat] Skipping attachment hydration until numeric conversation ID is available');
            }

            return response.data;
        } catch (error) {
            console.error('[Freshchat] Error sending message:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Download a file from Freshchat using an authenticated request
     */
    async downloadFile(fileUrl) {
        if (!fileUrl) {
            throw new Error('Freshchat file URL is required for download');
        }

        try {
            const maskedUrl = (() => {
                try {
                    const parsed = new URL(fileUrl);
                    parsed.search = '';
                    return parsed.toString();
                } catch (urlError) {
                    return fileUrl;
                }
            })();

            console.log(`[Freshchat] Download request (auth): ${maskedUrl}`);
            const primaryResponse = await axios.get(fileUrl, {
                responseType: 'arraybuffer',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`
                },
                validateStatus: () => true
            });

            let response = primaryResponse;

            console.log(`[Freshchat] Download response (auth): status=${response.status}`);

            if (response.status >= 400) {
                console.warn(`[Freshchat] Authenticated download returned status ${response.status}. Retrying without Authorization header.`);
                console.log(`[Freshchat] Download request (anon): ${maskedUrl}`);
                response = await axios.get(fileUrl, {
                    responseType: 'arraybuffer',
                    validateStatus: () => true
                });
                console.log(`[Freshchat] Download response (anon): status=${response.status}`);
            }

            if (response.status >= 400) {
                throw new Error(`HTTP ${response.status}`);
            }

            const contentDisposition = response.headers['content-disposition'] || '';
            let filename = null;

            const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
            if (utf8Match && utf8Match[1]) {
                filename = decodeURIComponent(utf8Match[1]);
            } else {
                const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
                if (asciiMatch && asciiMatch[1]) {
                    filename = asciiMatch[1];
                } else {
                    console.warn('[Freshchat] Unable to fetch hydrated message details for attachments');
                }
            }

            return {
                buffer: Buffer.from(response.data),
                contentType: response.headers['content-type'],
                contentLength: Number(response.headers['content-length']) || undefined,
                filename
            };
        } catch (error) {
            const status = error.response?.status;
            const statusText = error.response?.statusText || error.message;
            console.error('[Freshchat] Error downloading file:', status, statusText);
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
            console.log('[Security] pkcs1-public-pem import failed (expected for PKCS#8 keys). Retrying with pkcs8-public-pem.');
            try {
                key.importKey(publicKey, 'pkcs8-public-pem');
                console.log('[Security] Successfully imported key as pkcs8-public-pem');
            } catch (e2) {
                console.log('[Security] pkcs8-public-pem import failed, falling back to generic public format.');
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
 * Download file from Teams
 */
async function downloadTeamsAttachment(context, attachment) {
    try {
        // Bot Framework Connector를 사용하여 올바른 토큰 얻기
        const token = await context.adapter.credentials.getToken();

        const response = await axios.get(attachment.contentUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            responseType: 'arraybuffer'
        });

        return Buffer.from(response.data);
    } catch (error) {
        console.error('[Teams] Error downloading attachment:', error.message);
        throw error;
    }
}

/**
 * Main bot logic - handles incoming messages from Teams
 */
async function handleTeamsMessage(context) {
    const { activity } = context;

    // Log incoming message
    console.log('\n========================================');
    console.log('[Teams → Freshchat]');
    console.log(`From: ${activity.from.name} (${activity.from.id})`);
    console.log(`Message: ${activity.text || '[No text]'}`);
    console.log(`Attachments: ${activity.attachments?.length || 0}`);
    console.log(`Conversation ID: ${activity.conversation.id}`);
    console.log('========================================\n');

    // Check if we already have a Freshchat conversation for this Teams conversation
    const teamsConvId = activity.conversation.id;
    let mapping = conversationMap.get(teamsConvId);

    try {
        // Process attachments
        const freshchatAttachments = [];
        if (activity.attachments && activity.attachments.length > 0) {
            console.log(`[Teams] Processing ${activity.attachments.length} attachment(s)...`);

            for (const attachment of activity.attachments) {
                try {
                    console.log(`[Teams] Attachment: ${attachment.name} (${attachment.contentType})`);

                    // Download file from Teams
                    const fileBuffer = await downloadTeamsAttachment(context, attachment);

                    // Upload to Freshchat
                    const uploadedFile = await freshchatClient.uploadFile(
                        fileBuffer,
                        attachment.name,
                        attachment.contentType
                    );

                    // Freshchat API returns: file_name, file_size, file_content_type, file_extension_type, file_hash
                    freshchatAttachments.push({
                        name: uploadedFile.file_name || attachment.name,
                        file_size_in_bytes: uploadedFile.file_size || fileBuffer.length,
                        content_type: uploadedFile.file_content_type || attachment.contentType,
                        file_hash: uploadedFile.file_hash
                    });

                    console.log(`[Teams → Freshchat] File uploaded: ${attachment.name}, hash: ${uploadedFile.file_hash}`);
                } catch (error) {
                    console.error(`[Teams] Failed to process attachment ${attachment.name}:`, error.message);
                }
            }
        }

        if (!mapping) {
            // First message in this conversation - create new Freshchat conversation
            // Include attachments in the initial message for proper embedding
            const freshchatConv = await freshchatClient.createConversation(
                activity.from.id,
                activity.from.name,
                activity.text || (freshchatAttachments.length > 0 ? '[File attachment]' : ''),
                freshchatAttachments
            );

            const freshchatConversationGuid = freshchatConv?.conversation_id
                ? String(freshchatConv.conversation_id)
                : null;

            const freshchatConversationNumericId = freshchatConv?.freshchat_conversation_id
                ? String(freshchatConv.freshchat_conversation_id)
                : null;

            if (!freshchatConversationGuid && !freshchatConversationNumericId) {
                throw new Error('Freshchat API response is missing conversation identifiers');
            }

            mapping = updateConversationMapping(teamsConvId, {
                freshchatConversationGuid,
                freshchatConversationNumericId,
                freshchatUserId: freshchatConv.user_id,
                conversationReference: TurnContext.getConversationReference(activity)
            });

            console.log(`[Mapping] Created: Teams(${teamsConvId}) ↔ Freshchat(${resolveFreshchatConversationId(mapping)})`);

            if (freshchatConversationGuid && !freshchatConversationNumericId) {
                console.log('[Mapping] Waiting for numeric Freshchat conversation ID from webhook payload');
            }
        } else {
            const targetConversationId = resolveFreshchatConversationId(mapping);

            if (!targetConversationId) {
                throw new Error('Freshchat conversation ID unavailable for message transfer');
            }

            // Existing conversation - send message to Freshchat
            await freshchatClient.sendMessage(
                targetConversationId,
                mapping.freshchatUserId,
                activity.text,
                freshchatAttachments
            );
        }

        // Acknowledge receipt
        const attachmentText = freshchatAttachments.length > 0
            ? ` (${freshchatAttachments.length} file(s))`
            : '';
        await context.sendActivity(`✓ Message forwarded to Freshchat${attachmentText}`);
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
            const freshchatConversationId = message.freshchat_conversation_id
                ? String(message.freshchat_conversation_id)
                : data?.freshchat_conversation_id
                    ? String(data.freshchat_conversation_id)
                    : null;
            const conversationGuid = data?.conversation_id || message.conversation_id || null;
            const actorTypeRaw = message.actor_type;
            const actorType = actorTypeRaw ? String(actorTypeRaw).toLowerCase() : 'unknown';

            console.log(`[Freshchat] Processing message_create event`);
            console.log(`[Freshchat] Actor type: ${actorType}`);

            if (!freshchatConversationId) {
                console.log('[Freshchat] Payload missing freshchat_conversation_id - cannot route message');
                return res.sendStatus(200);
            }

            console.log(`[Freshchat] Conversation ID: ${freshchatConversationId}`);
            if (conversationGuid && conversationGuid !== freshchatConversationId) {
                console.log(`[Freshchat] Conversation GUID: ${conversationGuid}`);
            }

            // Find corresponding Teams conversation
            let teamsConvId = reverseMap.get(freshchatConversationId);
            if (!teamsConvId && conversationGuid) {
                teamsConvId = reverseMap.get(conversationGuid);
            }

            if (!teamsConvId) {
                console.log(`[Freshchat] No Teams mapping found for conversation: ${freshchatConversationId}`);
                if (actorType !== 'agent' && actorType !== 'system' && actorType !== 'bot') {
                    console.log('[Freshchat] Ignoring non-agent message without mapping');
                    return res.sendStatus(200);
                }
                return res.sendStatus(200);
            }

            let mapping = conversationMap.get(teamsConvId);
            if (!mapping) {
                console.log(`[Freshchat] Mapping data missing for: ${teamsConvId}`);
                if (actorType !== 'agent' && actorType !== 'system' && actorType !== 'bot') {
                    return res.sendStatus(200);
                }
                return res.sendStatus(200);
            }

            mapping = updateConversationMapping(teamsConvId, {
                freshchatConversationNumericId: freshchatConversationId,
                freshchatConversationGuid: mapping.freshchatConversationGuid || (conversationGuid ? String(conversationGuid) : undefined)
            });

            // Only process agent messages (not user messages)
            const allowedActorTypes = new Set(['agent', 'system', 'bot']);
            if (!allowedActorTypes.has(actorType)) {
                console.log(`[Freshchat] Ignoring message from actor type: ${actorType}`);
                return res.sendStatus(200);
            }

            // Extract message text and files
            let messageText = '';
            const attachmentParts = [];

            if (message.message_parts && message.message_parts.length > 0) {
                for (const part of message.message_parts) {
                    if (part.text?.content) {
                        messageText = messageText
                            ? `${messageText}\n${part.text.content}`
                            : part.text.content;
                    }

                    if (part.file) {
                        attachmentParts.push({
                            name: part.file.name,
                            contentType: part.file.content_type || 'application/octet-stream',
                            url: part.file.url,
                            fileHash: part.file.file_hash
                        });
                    }

                    if (part.image?.url) {
                        const derivedName = (() => {
                            if (part.image.name) {
                                return part.image.name;
                            }
                            try {
                                const parsedUrl = new URL(part.image.url);
                                const pathname = parsedUrl.pathname || '';
                                const candidate = pathname.split('/').pop();
                                return candidate || 'freshchat-image';
                            } catch (urlError) {
                                return 'freshchat-image';
                            }
                        })();

                        attachmentParts.push({
                            name: derivedName,
                            contentType: part.image.content_type || part.image.contentType || 'image/png',
                            url: part.image.url,
                            fileHash: part.image.file_hash
                        });
                    }

                    if (part.video?.url) {
                        attachmentParts.push({
                            name: part.video.name || 'freshchat-video',
                            contentType: part.video.content_type || 'video/mp4',
                            url: part.video.url,
                            fileHash: part.video.file_hash
                        });
                    }
                }
            }

            // Always hydrate attachment details to obtain signed URLs
            if (attachmentParts.length > 0) {
                console.log('[Freshchat] Fetching message details for attachment hydration...');
                const detailedMessage = await freshchatClient.getMessageWithRetry(
                    freshchatConversationId,
                    message.id,
                    message.created_time
                );

                if (detailedMessage?.message_parts) {
                    const detailIndex = new Map();
                    for (const part of detailedMessage.message_parts) {
                        if (part.file) {
                            const key = part.file.file_hash || part.file.name;
                            detailIndex.set(key, {
                                url: part.file.download_url || part.file.url,
                                contentType: part.file.content_type,
                                name: part.file.name
                            });
                        }

                        if (part.image) {
                            const key = part.image.file_hash || part.image.name || part.image.url;
                            detailIndex.set(key, {
                                url: part.image.download_url || part.image.url,
                                contentType: part.image.content_type,
                                name: part.image.name
                            });
                        }

                        if (part.video) {
                            const key = part.video.file_hash || part.video.name || part.video.url;
                            detailIndex.set(key, {
                                url: part.video.download_url || part.video.url,
                                contentType: part.video.content_type,
                                name: part.video.name
                            });
                        }
                    }

                    for (const attachment of attachmentParts) {
                        const match = detailIndex.get(attachment.fileHash)
                            || detailIndex.get(attachment.name)
                            || detailIndex.get(attachment.url);
                        if (match) {
                            attachment.url = match.url || attachment.url;
                            attachment.contentType = match.contentType || attachment.contentType;
                            attachment.name = attachment.name || match.name;
                        }
                    }
                }
            }

            const missingUrls = attachmentParts
                .filter((attachment) => !attachment.url)
                .map((attachment) => attachment.name)
                .filter(Boolean);

            const downloadableAttachments = attachmentParts.filter((attachment) => !!attachment.url);
            const teamsAttachmentPayloads = [];
            const downloadFailures = [];

            for (const attachment of downloadableAttachments) {
                try {
                    const fileData = await freshchatClient.downloadFile(attachment.url);
                    const resolvedContentType = attachment.contentType
                        || fileData.contentType
                        || mime.lookup(attachment.name || fileData.filename || '')
                        || 'application/octet-stream';

                    teamsAttachmentPayloads.push({
                        buffer: fileData.buffer,
                        contentType: resolvedContentType,
                        name: attachment.name || fileData.filename || 'freshchat-file'
                    });
                } catch (downloadError) {
                    const referenceName = attachment.name || attachment.url;
                    downloadFailures.push(referenceName);
                    console.error(`[Freshchat] Failed to prepare attachment for Teams (${referenceName}):`, downloadError.message);
                }
            }

            if (missingUrls.length > 0) {
                const warningLine = `⚠️ 첨부파일을 가져오지 못했습니다: ${missingUrls.join(', ')}. Freshchat에서 직접 확인해주세요.`;
                if (messageText) {
                    messageText = `${messageText}\n\n${warningLine}`;
                } else {
                    messageText = warningLine;
                }
            }

            if (downloadFailures.length > 0) {
                const downloadWarning = `⚠️ 첨부파일 다운로드 실패: ${downloadFailures.join(', ')}. Freshchat에서 직접 확인해주세요.`;
                messageText = messageText
                    ? `${messageText}\n\n${downloadWarning}`
                    : downloadWarning;
            }

            if (!messageText && teamsAttachmentPayloads.length === 0 && downloadFailures.length === 0 && missingUrls.length === 0) {
                console.log('[Freshchat] No content found in message');
                return res.sendStatus(200);
            }

            console.log(`[Freshchat → Teams] Forwarding message: "${messageText || '[File only]'}"`);
            console.log(`[Freshchat → Teams] Attachments prepared for Teams: ${teamsAttachmentPayloads.length}`);

            // Send message to Teams
            await adapter.continueConversation(
                mapping.conversationReference,
                async (turnContext) => {
                    const actorLabelMap = {
                        agent: 'Agent Reply',
                        system: 'System Message',
                        bot: 'Bot Message'
                    };
                    const actorLabel = actorLabelMap[actorType] || 'Freshchat Update';
                    const textPrefix = `**${actorLabel}:**`;

                    const uploadedAttachments = [];
                    const uploadFailures = [];

                    if (teamsAttachmentPayloads.length > 0) {
                        const serviceUrl = (turnContext.activity.serviceUrl || mapping.conversationReference.serviceUrl || '').replace(/\/$/, '');
                        const conversationId = turnContext.activity.conversation?.id || mapping.conversationReference.conversation?.id;

                        if (!serviceUrl || !conversationId) {
                            console.error('[Teams] Missing service URL or conversation ID for attachment upload');
                            uploadFailures.push(...teamsAttachmentPayloads.map((attachment) => attachment.name));
                        } else {
                            const connectorClient = turnContext.adapter.createConnectorClient(serviceUrl);

                            for (const attachment of teamsAttachmentPayloads) {
                                try {
                                    const base64Payload = attachment.buffer.toString('base64');
                                    const attachmentResponse = await connectorClient.conversations.uploadAttachment(conversationId, {
                                        name: attachment.name,
                                        originalBase64: base64Payload,
                                        type: attachment.contentType
                                    });

                                    const attachmentId = attachmentResponse?.id;
                                    if (!attachmentId) {
                                        throw new Error('Attachment upload response missing ID');
                                    }

                                    const attachmentUrl = `${serviceUrl}/v3/attachments/${attachmentId}/views/original`;
                                    uploadedAttachments.push({
                                        contentType: attachment.contentType,
                                        contentUrl: attachmentUrl,
                                        name: attachment.name
                                    });
                                } catch (uploadError) {
                                    uploadFailures.push(attachment.name);
                                    console.error(`[Teams] Failed to upload attachment to Teams (${attachment.name}):`, uploadError.message);
                                }
                            }
                        }
                    }

                    let composedText = textPrefix;
                    if (messageText) {
                        composedText = `${textPrefix}\n${messageText}`;
                    }

                    const messageActivity = {
                        type: 'message',
                        text: composedText,
                        attachments: uploadedAttachments.length > 0 ? uploadedAttachments : undefined
                    };

                    const imageMarkdowns = uploadedAttachments
                        .filter((attachment) => typeof attachment.contentType === 'string' && attachment.contentType.startsWith('image/'))
                        .map((attachment) => {
                            const altText = attachment.name || 'image';
                            return `![${altText}](${attachment.contentUrl})`;
                        });

                    if (imageMarkdowns.length > 0) {
                        if (messageText) {
                            messageActivity.text = `${messageActivity.text}\n\n${imageMarkdowns.join('\n')}`;
                        } else {
                            messageActivity.text = `${textPrefix}\n${imageMarkdowns.join('\n')}`;
                        }
                    } else if (!messageText && teamsAttachmentPayloads.length > 0) {
                        messageActivity.text = `${textPrefix} (첨부파일 전달)`;
                    }

                    if (uploadFailures.length > 0) {
                        const uploadWarning = `⚠️ 첨부파일 업로드 실패: ${uploadFailures.join(', ')}. Freshchat에서 직접 확인해주세요.`;
                        messageActivity.text = messageActivity.text
                            ? `${messageActivity.text}\n\n${uploadWarning}`
                            : uploadWarning;
                    }

                    await turnContext.sendActivity(messageActivity);
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
            freshchatConversationId: value.freshchatConversationNumericId,
            freshchatConversationGuid: value.freshchatConversationGuid,
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
