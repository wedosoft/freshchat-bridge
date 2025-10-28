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
const fs = require('fs');
const path = require('path');
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
const FRESHCHAT_API_URL = process.env.FRESHCHAT_API_URL;
const FRESHCHAT_INBOX_ID = process.env.FRESHCHAT_INBOX_ID;
const FRESHCHAT_WEBHOOK_PUBLIC_KEY = process.env.FRESHCHAT_WEBHOOK_PUBLIC_KEY;
const FRESHCHAT_WEBHOOK_SIGNATURE_STRICT = process.env.FRESHCHAT_WEBHOOK_SIGNATURE_STRICT !== 'false';
const PUBLIC_URL = process.env.PUBLIC_URL;

// ============================================================================
// File Storage Setup
// ============================================================================

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR);
}

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

/**
 * Track processed Freshchat message IDs to avoid duplicate delivery.
 * Structure: { messageId: timestamp }
 */
const processedFreshchatMessages = new Map();
const FRESHCHAT_DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cleanupProcessedFreshchatMessages() {
    const now = Date.now();
    for (const [messageId, timestamp] of processedFreshchatMessages.entries()) {
        if (now - timestamp > FRESHCHAT_DEDUP_TTL_MS) {
            processedFreshchatMessages.delete(messageId);
        }
    }

    // Prevent unbounded growth in extreme cases
    if (processedFreshchatMessages.size > 2000) {
        const sortedEntries = Array.from(processedFreshchatMessages.entries())
            .sort((a, b) => a[1] - b[1]);
        const excess = processedFreshchatMessages.size - 2000;
        for (let i = 0; i < excess; i += 1) {
            processedFreshchatMessages.delete(sortedEntries[i][0]);
        }
    }
}

function hasProcessedFreshchatMessage(messageId) {
    if (!messageId) {
        return false;
    }

    const timestamp = processedFreshchatMessages.get(messageId);
    if (timestamp) {
        if (Date.now() - timestamp <= FRESHCHAT_DEDUP_TTL_MS) {
            return true;
        }
        processedFreshchatMessages.delete(messageId);
    }
    return false;
}

function markFreshchatMessageProcessed(messageId) {
    if (!messageId) {
        return;
    }

    processedFreshchatMessages.set(messageId, Date.now());
    cleanupProcessedFreshchatMessages();
}

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

    if (mapping.freshchatConversationGuid) {
        return String(mapping.freshchatConversationGuid);
    }

    if (mapping.freshchatConversationNumericId) {
        return String(mapping.freshchatConversationNumericId);
    }

    return null;
}

function buildFreshchatMessageParts(message, attachments = []) {
    const messageParts = [];

    if (message && String(message).trim().length > 0) {
        messageParts.push({
            text: {
                content: message
            }
        });
    }

    for (const attachment of attachments) {
        if (!attachment) {
            continue;
        }

        if (attachment.url) {
            const imagePayload = {
                url: attachment.url
            };

            const contentType = attachment.contentType || attachment.content_type;
            if (contentType) {
                imagePayload.contentType = contentType;
                imagePayload.content_type = contentType;
            }

            messageParts.push({
                image: imagePayload
            });
        } else {
            const contentType = attachment.contentType || attachment.content_type;
            const fileHash = attachment.fileHash || attachment.file_hash || attachment.hash;
            const fileId = attachment.fileId || attachment.file_id;
            const sizeCandidate = attachment.file_size_in_bytes ?? attachment.fileSize;
            const numericSize = Number(sizeCandidate);
            const validSize = Number.isFinite(numericSize) && numericSize > 0 ? numericSize : undefined;
            const safeName = attachment.name || attachment.file_name || 'attachment';

            if (!fileHash && !fileId) {
                console.warn('[Freshchat] Skipping attachment without file identifier', {
                    name: attachment.name,
                    keys: Object.keys(attachment)
                });
                continue;
            }

            const filePayload = {
                name: safeName
            };

            if (validSize) {
                filePayload.file_size_in_bytes = validSize;
            }

            if (contentType) {
                filePayload.contentType = contentType;
                filePayload.content_type = contentType;
            }

            if (fileHash) {
                filePayload.fileHash = fileHash;
                filePayload.file_hash = fileHash;
            }

            if (fileId) {
                filePayload.fileId = fileId;
                filePayload.file_id = fileId;
            }

            messageParts.push({
                file: filePayload
            });
        }
    }

    return messageParts;
}

function sanitizeFilename(name) {
    if (!name || typeof name !== 'string') {
        return '';
    }

    return name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9.\-_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
}

function extractAttachmentName(attachment) {
    if (!attachment) {
        return '';
    }

    const candidates = [
        attachment.name,
        attachment.filename,
        attachment.fileName,
        attachment.content?.fileName,
        attachment.content?.file_name,
        attachment.content?.filename,
        attachment.content?.displayName
    ];

    return candidates.find((value) => typeof value === 'string' && value.trim().length > 0) || '';
}

function extractAttachmentContentType(attachment) {
    if (!attachment) {
        return '';
    }

    const candidates = [
        attachment.contentType,
        attachment.content?.contentType,
        attachment.content?.fileType,
        attachment.content?.mimeType
    ];

    const match = candidates.find((value) => typeof value === 'string' && value.trim().length > 0);
    return match ? match.toLowerCase() : '';
}

function buildStoredFilename(preferredName, contentType) {
    const timestamp = Date.now();
    let sanitized = sanitizeFilename(preferredName);
    let extension = '';

    if (sanitized) {
        const detectedExt = path.extname(sanitized);
        if (detectedExt) {
            extension = detectedExt;
            sanitized = sanitized.slice(0, -detectedExt.length);
        }
    }

    if (!sanitized) {
        sanitized = 'attachment';
    }

    if (!extension) {
        const derivedExt = contentType ? mime.extension(contentType) : null;
        if (derivedExt) {
            extension = `.${derivedExt}`;
        }
    }

    return `${timestamp}-${sanitized}${extension}`;
}

/**
 * Normalize the varying Freshchat upload API response into a stable shape.
 */
function normalizeFreshchatUploadResponse(uploadedFile, fallback = {}) {
    if (!uploadedFile || typeof uploadedFile !== 'object') {
        throw new Error('Freshchat upload response is empty or invalid');
    }

    const payload = (() => {
        if (uploadedFile.file && typeof uploadedFile.file === 'object') {
            return uploadedFile.file;
        }
        if (uploadedFile.data && typeof uploadedFile.data === 'object') {
            return uploadedFile.data;
        }
        return uploadedFile;
    })();

    const fallbackName = fallback.name || 'attachment';
    const fallbackContentType = fallback.contentType || 'application/octet-stream';
    const fallbackSize = typeof fallback.fileSize === 'number' ? fallback.fileSize : Number(fallback.fileSize);

    const firstNonEmptyString = (...candidates) => candidates.find((value) => typeof value === 'string' && value.trim().length > 0);

    const normalized = {
        fileHash: firstNonEmptyString(
            payload.fileHash,
            payload.file_hash,
            payload.hash,
            uploadedFile.fileHash,
            uploadedFile.file_hash,
            uploadedFile.hash
        ) || null,
        fileId: firstNonEmptyString(
            payload.fileId,
            payload.file_id,
            uploadedFile.fileId,
            uploadedFile.file_id
        ) || null,
        contentType: firstNonEmptyString(
            payload.file_content_type,
            payload.content_type,
            payload.contentType,
            uploadedFile.file_content_type,
            uploadedFile.content_type,
            uploadedFile.contentType
        ) || fallbackContentType,
        name: firstNonEmptyString(
            payload.file_name,
            payload.filename,
            payload.name,
            uploadedFile.file_name,
            uploadedFile.filename,
            uploadedFile.name
        ) || fallbackName,
        downloadUrl: firstNonEmptyString(
            payload.download_url,
            payload.file_url,
            payload.url,
            uploadedFile.download_url,
            uploadedFile.file_url,
            uploadedFile.url
        )
    };

    const sizeCandidate = payload.file_size
        ?? payload.fileSize
        ?? uploadedFile.file_size
        ?? uploadedFile.fileSize
        ?? fallbackSize;
    const numericSize = Number(sizeCandidate);
    if (Number.isFinite(numericSize) && numericSize > 0) {
        normalized.fileSize = numericSize;
    } else if (Number.isFinite(fallbackSize) && fallbackSize > 0) {
        normalized.fileSize = fallbackSize;
    }

    if (!normalized.name) {
        normalized.name = fallbackName;
    }

    if (!normalized.contentType) {
        normalized.contentType = fallbackContentType;
    }

    return normalized;
}

class SkippableAttachmentError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SkippableAttachmentError';
    }
}

function isSkippableTeamsAttachment(contentType) {
    if (!contentType) {
        return false;
    }

    const normalized = contentType.toLowerCase();
    if (normalized === 'text/html' || normalized === 'text/plain') {
        return true;
    }

    if (normalized.startsWith('application/vnd.microsoft.card')) {
        return true;
    }

    const explicitSkips = new Set([
        'application/vnd.microsoft.teams.card.o365connector',
        'application/vnd.microsoft.teams.card.o365connectorfilepreview'
    ]);

    return explicitSkips.has(normalized);
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
     * Create a new conversation in Freshchat
     */
    async createConversation(userId, userName, initialMessage, attachments = []) {
        try {
            console.log(`[Freshchat] Creating conversation for user: ${userName}`);

            // First, create or get user
            const user = await this.createOrGetUser(userId, userName);

            const messageParts = buildFreshchatMessageParts(initialMessage, attachments);
            if (messageParts.length === 0) {
                messageParts.push({
                    text: {
                        content: '[Attachment]'
                    }
                });
            }

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
    async getMessageWithRetry(conversationIds, messageId, createdTime, maxAttempts = 3) {
        const candidateIds = Array.isArray(conversationIds)
            ? conversationIds
            : [conversationIds];

        const identifiers = Array.from(new Set(
            candidateIds
                .map((id) => (id === null || id === undefined ? '' : String(id).trim()))
                .filter((id) => id.length > 0)
        ));

        if (identifiers.length === 0) {
            return null;
        }

        let attempt = 0;
        let lastError = null;
        let fallbackMessage = null;

        while (attempt < maxAttempts) {
            attempt += 1;

            for (const conversationId of identifiers) {
                try {
                    const message = await this.getMessageFromConversation(conversationId, messageId, {
                        fromTime: attempt === 1 ? createdTime : undefined
                    });

                    if (!message) {
                        continue;
                    }

                    const hasDownloadablePart = message.message_parts?.some((part) => {
                        return Boolean(
                            part?.file?.url
                            || part?.file?.download_url
                            || part?.image?.url
                            || part?.image?.download_url
                            || part?.video?.url
                            || part?.video?.download_url
                        );
                    });

                    if (hasDownloadablePart) {
                        return message;
                    }

                    fallbackMessage = message;
                } catch (error) {
                    lastError = error;
                    const status = error.response?.status;
                    if (status === 400 || status === 404) {
                        continue;
                    }
                    throw error;
                }
            }

            if (fallbackMessage) {
                break;
            }

            if (attempt < maxAttempts) {
                await delay(700 * attempt);
            }
        }

        if (lastError) {
            console.error(
                `[Freshchat] Failed to hydrate message ${messageId} using identifiers [${identifiers.join(', ')}]:`,
                lastError.response?.data || lastError.message
            );
        } else if (!fallbackMessage) {
            console.warn(`[Freshchat] Unable to hydrate message ${messageId} using identifiers [${identifiers.join(', ')}]`);
        }

        return fallbackMessage;
    }

    /**
     * Send a message to an existing Freshchat conversation
     */
    async sendMessage(conversationId, userId, message, attachments = [], options = {}) {
        try {
            if (!conversationId) {
                throw new Error('Freshchat conversation ID is required to send a message');
            }

            console.log(`[Freshchat] Sending message to conversation: ${conversationId}`);
            console.log('[Freshchat] Outgoing message payload:', {
                conversationId,
                actorId: userId,
                hasText: Boolean(message),
                attachmentsCount: attachments.length,
                attachmentsSummary: attachments.map((part) => ({
                    keys: Object.keys(part),
                    contentType: part.contentType || part.content_type,
                    fileHash: part.fileHash || part.file_hash,
                    fileId: part.fileId || part.file_id,
                    url: part.url
                }))
            });

            const messageParts = buildFreshchatMessageParts(message, attachments);
            if (messageParts.length === 0) {
                throw new Error('No content to send to Freshchat. Provide text or attachments.');
            }

            const response = await this.axiosInstance.post(`/conversations/${conversationId}/messages`, {
                message_parts: messageParts,
                actor_type: 'user',
                actor_id: userId
            });

            console.log(`[Freshchat] Message sent successfully, Message ID: ${response.data.id}`);

            // 메시지 전송 후 실제 파일 URL을 얻기 위해 메시지 조회
            const hydrationCandidates = (() => {
                if (Array.isArray(options?.hydrationConversationIds)) {
                    return options.hydrationConversationIds;
                }
                if (options?.hydrationConversationId) {
                    return [options.hydrationConversationId];
                }
                return [conversationId];
            })();

            if (attachments.length > 0) {
                const detailedMessage = await this.getMessageWithRetry(
                    hydrationCandidates,
                    response.data.id,
                    response.data.created_time
                );

                if (detailedMessage) {
                    console.log('[Freshchat] Message details:', JSON.stringify(detailedMessage, null, 2));
                } else {
                    console.warn('[Freshchat] Unable to fetch message details for attachment logging');
                }
            }

            return response.data;
        } catch (error) {
            console.error('[Freshchat] Error sending message:', error.response?.data || error.message);
            if (error.response) {
                console.error('[Freshchat] Error response details:', {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    headers: error.response.headers,
                    data: error.response.data
                });
            }
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
            const parsedUrl = new URL(fileUrl);
            const apiUrl = new URL(this.apiUrl);

            const maskedUrl = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`;

            const isApiUrl = parsedUrl.hostname === apiUrl.hostname;

            const headers = {};
            if (isApiUrl) {
                headers['Authorization'] = `Bearer ${this.apiKey}`;
                console.log(`[Freshchat] Download request (auth): ${maskedUrl}`);
            } else {
                console.log(`[Freshchat] Download request (public): ${maskedUrl}`);
            }

            const response = await axios.get(fileUrl, {
                responseType: 'arraybuffer',
                headers,
                validateStatus: () => true
            });

            console.log(`[Freshchat] Download response: status=${response.status}`);

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
        // Normalize public key: handle common single-line / escaped formats and ensure
        // base64 content is chunked into 64-char lines between PEM headers.
        let publicKey = FRESHCHAT_WEBHOOK_PUBLIC_KEY || '';

        // Replace literal "\\n" sequences (common when storing PEM in env vars)
        publicKey = publicKey.replace(/\\n/g, '\n').trim();

        // If the PEM content appears to be one long line (Fly.io sometimes stores
        // PEM blocks without newlines), reformat the base64 body into 64-char lines.
        const ensurePemFormatting = (pem) => {
            if (!pem || !pem.includes('-----BEGIN') || !pem.includes('-----END')) {
                return pem;
            }

            // Identify header/footer and body
            const headerMatch = pem.match(/-----BEGIN[^-]+-----/i);
            const footerMatch = pem.match(/-----END[^-]+-----/i);
            if (!headerMatch || !footerMatch) return pem;

            const header = headerMatch[0];
            const footer = footerMatch[0];

            // Extract what's between header and footer
            const between = pem.substring(pem.indexOf(header) + header.length, pem.indexOf(footer)).replace(/[^A-Za-z0-9+/=]/g, '');
            if (!between) return pem;

            // Chunk into 64-char lines
            const chunks = between.match(/.{1,64}/g) || [];
            return `${header}\n${chunks.join('\n')}\n${footer}`;
        };

        publicKey = ensurePemFormatting(publicKey);

        const extractDerBuffer = (pem) => {
            const match = pem.match(/-----BEGIN [^-]+-----([\s\S]+?)-----END [^-]+-----/);
            if (!match) {
                return null;
            }
            const base64 = match[1].replace(/[^A-Za-z0-9+/=]/g, '');
            if (!base64) {
                return null;
            }
            try {
                return Buffer.from(base64, 'base64');
            } catch (error) {
                console.warn('[Security] Failed to decode PEM body:', error.message);
                return null;
            }
        };

        const detectDerStructure = (pem) => {
            const der = extractDerBuffer(pem);
            if (!der || der.length < 4) {
                return null;
            }

            let offset = 2;
            if (der[1] & 0x80) {
                const lenBytes = der[1] & 0x7f;
                if (lenBytes === 0 || lenBytes > 4 || 2 + lenBytes >= der.length) {
                    return null;
                }
                offset = 2 + lenBytes;
            }

            const tag = der[offset];
            if (tag === 0x02) {
                return 'pkcs1';
            }

            if (tag === 0x30) {
                const rsaOid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
                if (der.indexOf(rsaOid, offset) !== -1) {
                    return 'spki';
                }
            }

            return null;
        };

        const relabelPem = (pem, newLabel) => pem
            .replace(/-----BEGIN [^-]+-----/i, `-----BEGIN ${newLabel}-----`)
            .replace(/-----END [^-]+-----/i, `-----END ${newLabel}-----`);

        const headerMatch = publicKey.match(/-----BEGIN\s+([^-]+?)-----/i);
        let headerLabel = headerMatch ? headerMatch[1].trim().toUpperCase() : null;
        const detectedStructure = detectDerStructure(publicKey);

        if (detectedStructure === 'spki' && headerLabel === 'RSA PUBLIC KEY') {
            publicKey = relabelPem(publicKey, 'PUBLIC KEY');
            headerLabel = 'PUBLIC KEY';
            console.log('[Security] Adjusted PEM header from RSA PUBLIC KEY → PUBLIC KEY (detected SPKI structure)');
        } else if (detectedStructure === 'pkcs1' && headerLabel === 'PUBLIC KEY') {
            publicKey = relabelPem(publicKey, 'RSA PUBLIC KEY');
            headerLabel = 'RSA PUBLIC KEY';
            console.log('[Security] Adjusted PEM header from PUBLIC KEY → RSA PUBLIC KEY (detected PKCS#1 structure)');
        }

        // Try converting PKCS#1 (BEGIN RSA PUBLIC KEY) -> PKCS#8 using native crypto
        // for best compatibility. Fall back to NodeRSA only if native conversion fails.
        let pkcs8PublicKey = publicKey;
        if (/-----BEGIN RSA PUBLIC KEY-----/i.test(publicKey)) {
            let converted = null;
            try {
                const keyObject = crypto.createPublicKey({
                    key: publicKey,
                    format: 'pem',
                    type: 'pkcs1'
                });
                converted = keyObject.export({
                    format: 'pem',
                    type: 'spki'
                });
                pkcs8PublicKey = converted;
                console.log('[Security] Converted PKCS#1 to PKCS#8 using native crypto');
            } catch (nativeConversionError) {
                console.warn('[Security] Native conversion failed, trying NodeRSA:', nativeConversionError.message);
                try {
                    const rsaKey = new NodeRSA();
                    rsaKey.importKey(publicKey, 'pkcs1-public-pem');
                    converted = rsaKey.exportKey('pkcs8-public-pem');
                    pkcs8PublicKey = converted;
                    console.log('[Security] Converted PKCS#1 to PKCS#8 using NodeRSA fallback');
                } catch (nodeRsaConversionError) {
                    console.warn('[Security] NodeRSA conversion also failed:', nodeRsaConversionError.message);
                    pkcs8PublicKey = publicKey; // fallback to formatted original publicKey
                }
            }
        }

        console.log('[Security] PEM header label:', headerLabel || 'unknown');
        console.log('[Security] Detected DER structure:', detectedStructure || 'unknown');
        console.log('[Security] Public Key Length:', pkcs8PublicKey.length);
        console.log('[Security] Public Key:\n', pkcs8PublicKey);
        console.log('[Security] Signature:', signature);
        const payloadBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
        console.log('[Security] Payload Length:', payloadBuffer.length);

        let isValid = false;
        let verificationMethod = null;

        try {
            const verifier = crypto.createVerify('RSA-SHA256');
            verifier.update(payloadBuffer);
            verifier.end();

            const signatureBuffer = Buffer.from(signature, 'base64');
            // Try verifying with PKCS#8 formatted key first (most likely to succeed)
            isValid = verifier.verify(pkcs8PublicKey, signatureBuffer);
            if (isValid) {
                verificationMethod = 'native';
            }
        } catch (nativeError) {
            console.warn('[Security] Native crypto verification threw an error:', nativeError.message);
        }

        if (!isValid) {
            try {
                const key = new NodeRSA();
                // Try importing as PKCS#8 first, then PKCS#1 as fallback
                try {
                    key.importKey(pkcs8PublicKey, 'pkcs8-public-pem');
                } catch (e1) {
                    try {
                        key.importKey(publicKey, 'pkcs1-public-pem');
                    } catch (e2) {
                        throw e2 || e1;
                    }
                }
                key.setOptions({ signingScheme: 'pkcs1-sha256' });
                isValid = key.verify(payloadBuffer, signature, 'buffer', 'base64');
                if (isValid) {
                    verificationMethod = 'node-rsa';
                }
            } catch (rsaError) {
                console.warn('[Security] NodeRSA verification failed:', rsaError.message);
            }
        }

        if (isValid) {
            const methodLabel = verificationMethod === 'native' ? 'native crypto' : 'NodeRSA fallback';
            console.log(`[Security] ✅ Signature verified successfully (${methodLabel})`);
        } else {
            console.warn('[Security] Webhook signature verification failed');
        }

        return isValid;
    } catch (error) {
        console.error('[Security] Error verifying webhook signature:', error.message);
        if (error.stack) {
            console.error('[Security] Error stack:', error.stack);
        }
        return false;
    }
}

// ============================================================================
// Bot Logic
// ============================================================================

/**
 * Download file from Teams
 */
async function downloadTeamsAttachment(context, attachment, normalizedContentType) {
    const candidates = [];
    const effectiveContentType = (normalizedContentType || extractAttachmentContentType(attachment) || '').toLowerCase();

    if (attachment?.contentUrl && typeof attachment.contentUrl === 'string') {
        candidates.push({
            url: attachment.contentUrl,
            label: 'contentUrl',
            requiresAuth: true
        });
    }

    const content = attachment?.content || {};
    const alternativeUrls = [
        { key: 'downloadUrl', value: content.downloadUrl },
        { key: 'download-url', value: content['download-url'] },
        { key: 'fileUrl', value: content.fileUrl },
        { key: 'file-url', value: content['file-url'] },
        { key: 'contentUrl', value: content.contentUrl },
        { key: 'content-url', value: content['content-url'] }
    ];

    for (const alt of alternativeUrls) {
        if (typeof alt.value === 'string' && alt.value.startsWith('http')) {
            candidates.push({
                url: alt.value,
                label: alt.key,
                requiresAuth: false
            });
        }
    }

    if (candidates.length === 0) {
        if (isSkippableTeamsAttachment(effectiveContentType)) {
            throw new SkippableAttachmentError('Attachment does not expose downloadable content');
        }
        throw new Error('Attachment does not include a downloadable URL');
    }

    let token = null;
    let lastError = null;

    for (const candidate of candidates) {
        try {
            const headers = {};

            if (candidate.requiresAuth) {
                if (!token) {
                    // Try to obtain a usable token from a few possible sources.
                    try {
                        token = await context.adapter.credentials.getToken();
                    } catch (e) {
                        // ignore - try fallback
                    }

                    // token might be an object with different property names depending on library/version
                    if (token && typeof token === 'object') {
                        token = token.token || token.accessToken || token.access_token || token.value || token;
                    }

                    // Fallback: try to create a connector client and use its credentials
                    if (!token) {
                        try {
                            const connectorClient = await context.adapter.createConnectorClient(context.activity.serviceUrl);
                            if (connectorClient && connectorClient.credentials && typeof connectorClient.credentials.getToken === 'function') {
                                let ctoken = await connectorClient.credentials.getToken();
                                if (ctoken && typeof ctoken === 'object') {
                                    ctoken = ctoken.token || ctoken.accessToken || ctoken.access_token || ctoken.value || ctoken;
                                }
                                token = token || ctoken;
                            }
                        } catch (e) {
                            // ignore fallback failure
                        }
                    }
                }

                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
                // Helpful headers that some Teams endpoints expect
                headers['User-Agent'] = headers['User-Agent'] || 'Microsoft-BotFramework/3.0 (Node)';
                headers['Accept'] = headers['Accept'] || '*/*';
            }

            const response = await axios.get(candidate.url, {
                headers,
                responseType: 'arraybuffer'
            });

            return {
                buffer: Buffer.from(response.data),
                contentType: response.headers['content-type'] || null,
                contentLength: Number(response.headers['content-length']) || null,
                source: candidate.label
            };
        } catch (error) {
            lastError = error;
            const status = error.response?.status;
            console.warn(`[Teams] Download attempt failed (${candidate.label || candidate.url}): ${status || error.message}`);
        }
    }

    console.error('[Teams] Error downloading attachment:', lastError?.message || 'Unknown error');
    throw lastError || new Error('Unable to download attachment');
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
        const trimmedMessageText = typeof activity.text === 'string' ? activity.text.trim() : '';
        let messageText = trimmedMessageText;

        // Process attachments
        const freshchatAttachments = [];
        const failedAttachmentNames = [];
        if (activity.attachments && activity.attachments.length > 0) {
            console.log(`[Teams] Processing ${activity.attachments.length} attachment(s)...`);

            for (const attachment of activity.attachments) {
                const attachmentName = extractAttachmentName(attachment);
                const sanitizedName = sanitizeFilename(attachmentName);
                const normalizedContentType = extractAttachmentContentType(attachment);
                const attachmentLabel = sanitizedName || attachmentName || 'unnamed-attachment';

                try {
                    console.log(`[Teams] Attachment: ${attachmentLabel} (${normalizedContentType || 'unknown'})`);

                    const downloadResult = await downloadTeamsAttachment(context, attachment, normalizedContentType);
                    const resolvedContentType = downloadResult.contentType
                        || normalizedContentType
                        || 'application/octet-stream';
                    const isImage = resolvedContentType.toLowerCase().startsWith('image/');
                    const storedFilename = buildStoredFilename(attachmentName, resolvedContentType);
                    const storagePath = path.join(UPLOADS_DIR, storedFilename);
                    const effectiveName = sanitizedName || storedFilename;

                    if (isImage) {
                        // For images, save locally and create a public URL
                        if (!PUBLIC_URL) {
                            throw new Error('PUBLIC_URL environment variable is not set. Cannot serve images.');
                        }
                        fs.writeFileSync(storagePath, downloadResult.buffer);

                        const publicUrl = `${PUBLIC_URL.replace(/\/$/, '')}/files/${storedFilename}`;
                        freshchatAttachments.push({
                            url: publicUrl,
                            contentType: resolvedContentType,
                            content_type: resolvedContentType,
                            name: effectiveName
                        });
                        console.log(`[Teams → Freshchat] Image served at: ${publicUrl}`);

                    } else {
                        // For other files, upload to Freshchat and use file_hash
                        const uploadedFile = await freshchatClient.uploadFile(
                            downloadResult.buffer,
                            effectiveName,
                            resolvedContentType
                        );

                        const fallbackSize = downloadResult.contentLength || downloadResult.buffer.length;
                        const normalizedUpload = normalizeFreshchatUploadResponse(uploadedFile, {
                            name: effectiveName,
                            contentType: resolvedContentType,
                            fileSize: fallbackSize
                        });

                        console.log('[Teams → Freshchat] File upload response (normalized):', {
                            name: normalizedUpload.name,
                            size: normalizedUpload.fileSize,
                            contentType: normalizedUpload.contentType,
                            fileHash: normalizedUpload.fileHash,
                            fileId: normalizedUpload.fileId,
                            downloadUrl: normalizedUpload.downloadUrl
                        });

                        const fileAttachmentPayload = {
                            name: normalizedUpload.name,
                            file_size_in_bytes: normalizedUpload.fileSize || fallbackSize,
                            contentType: normalizedUpload.contentType,
                            content_type: normalizedUpload.contentType
                        };

                        if (normalizedUpload.fileHash) {
                            fileAttachmentPayload.fileHash = normalizedUpload.fileHash;
                            fileAttachmentPayload.file_hash = normalizedUpload.fileHash;
                        }

                        if (normalizedUpload.fileId) {
                            fileAttachmentPayload.fileId = normalizedUpload.fileId;
                            fileAttachmentPayload.file_id = normalizedUpload.fileId;
                        }

                        if (!fileAttachmentPayload.fileHash && !fileAttachmentPayload.fileId) {
                            console.warn('[Teams → Freshchat] Uploaded file missing fileHash and fileId. Freshchat may skip the attachment.');
                        }

                        freshchatAttachments.push(fileAttachmentPayload);
                        console.log('[Teams → Freshchat] File prepared for send:', {
                            name: fileAttachmentPayload.name,
                            fileHash: fileAttachmentPayload.fileHash,
                            fileId: fileAttachmentPayload.fileId,
                            contentType: fileAttachmentPayload.contentType
                        });
                    }
                } catch (error) {
                    if (error instanceof SkippableAttachmentError) {
                        console.log(`[Teams] Skipping non-downloadable attachment ${attachmentLabel}: ${error.message}`);
                        continue;
                    }

                    console.error(`[Teams] Failed to process attachment ${attachmentLabel}:`, error.message);
                    const failedName = attachmentLabel || sanitizeFilename(attachmentLabel) || 'unknown';
                    failedAttachmentNames.push(failedName);
                }
            }
        }

        const hasAttachmentContent = freshchatAttachments.length > 0;

        // 첨부파일은 Freshchat의 file part로 전달되므로 텍스트 요약 불필요
        const hasTextContent = messageText.length > 0;

        if (!hasTextContent && !hasAttachmentContent) {
            const failureNotice = failedAttachmentNames.length > 0
                ? `⚠️ 전송할 수 있는 첨부파일이 없어 Freshchat으로 전달하지 못했습니다: ${failedAttachmentNames.join(', ')}`
                : '⚠️ 전달할 수 있는 내용이 없어 Freshchat으로 전송하지 않았습니다.';

            await context.sendActivity(failureNotice);
            return;
        }

        if (!mapping) {
            // First message in this conversation - create new Freshchat conversation
            const initialMessage = hasTextContent ? messageText : null;

            const freshchatConv = await freshchatClient.createConversation(
                activity.from.id,
                activity.from.name,
                initialMessage,
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
            const candidateConversations = [];
            const guidConversationId = mapping.freshchatConversationGuid
                ? String(mapping.freshchatConversationGuid)
                : null;
            const numericConversationId = mapping.freshchatConversationNumericId
                ? String(mapping.freshchatConversationNumericId)
                : null;
            const hydrationConversationIds = Array.from(new Set(
                [numericConversationId, guidConversationId]
                    .filter(Boolean)
            ));

            if (guidConversationId) {
                candidateConversations.push({
                    id: guidConversationId,
                    label: 'guid'
                });
            }

            if (numericConversationId && !candidateConversations.some((candidate) => candidate.id === numericConversationId)) {
                candidateConversations.push({
                    id: numericConversationId,
                    label: 'numeric'
                });
            }

            if (candidateConversations.length === 0) {
                throw new Error('Freshchat conversation ID unavailable for message transfer');
            }

            let sendSucceeded = false;
            let lastError = null;

            for (let index = 0; index < candidateConversations.length; index += 1) {
                const candidate = candidateConversations[index];

                try {
                    await freshchatClient.sendMessage(
                        candidate.id,
                        mapping.freshchatUserId,
                        hasTextContent ? messageText : '',
                        freshchatAttachments,
                        { hydrationConversationIds }
                    );

                    if (index > 0) {
                        console.log(`[Freshchat] Message sent using fallback conversation identifier (${candidate.label}): ${candidate.id}`);
                    }

                    sendSucceeded = true;
                    break;
                } catch (error) {
                    lastError = error;
                    const status = error.response?.status;

                    if (status === 404 && index < candidateConversations.length - 1) {
                        console.warn(`[Freshchat] Conversation ${candidate.id} returned 404. Trying alternate identifier.`);
                        continue;
                    }

                    throw error;
                }
            }

            if (!sendSucceeded) {
                throw lastError || new Error('Failed to send message to Freshchat');
            }
        }

        // Acknowledge only when attachments failed to send
        if (failedAttachmentNames.length > 0) {
            await context.sendActivity(`⚠️ 전송하지 못한 첨부파일: ${failedAttachmentNames.join(', ')}`);
        }
    } catch (error) {
        console.error('[Error] Failed to forward message to Freshchat:', error);
        await context.sendActivity('❌ Failed to forward message to Freshchat. Please check logs.');
    }
}

// ============================================================================
// Express Server Setup
// ============================================================================

const app = express();
app.use(express.json({
    verify: (req, res, buf, encoding) => {
        const encodingType = encoding || 'utf8';
        req.rawBody = buf?.length ? buf.toString(encodingType) : '';
    }
}));
app.use('/files', express.static(UPLOADS_DIR));

// Allow Azure portal and Bot Framework service to access bot endpoints during testing
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    const requestedHeaders = req.headers['access-control-request-headers'];
    if (requestedHeaders) {
        res.header('Access-Control-Allow-Headers', requestedHeaders);
    } else {
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }

    return next();
});

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
const processBotRequest = async (req, res) => {
    await adapter.process(req, res, async (context) => {
        if (context.activity.type === 'message') {
            await handleTeamsMessage(context);
        } else if (context.activity.type === 'conversationUpdate') {
            if (context.activity.membersAdded) {
                for (const member of context.activity.membersAdded) {
                    if (member.id !== context.activity.recipient.id) {
                        await context.sendActivity(
                            '👋 안녕하세요! 고객지원팀입니다.\n' +
                            '궁금하신 점이나 도움이 필요하신 사항을 메시지로 보내주시면 신속하게 답변드리겠습니다.'
                        );
                    }
                }
            }
        }
    });
};

app.post('/bot/callback', processBotRequest);
app.post('/api/messages', processBotRequest);

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
        const rawPayload = typeof req.rawBody === 'string' && req.rawBody.length > 0
            ? req.rawBody
            : JSON.stringify(req.body);
        
        const signatureValid = verifyFreshchatSignature(rawPayload, signature);
        if (!signatureValid) {
            console.error('[Security] Webhook signature verification failed');
            if (FRESHCHAT_WEBHOOK_SIGNATURE_STRICT) {
                return res.status(401).json({ error: 'Invalid signature' });
            }
            console.warn('[Security] Proceeding despite invalid signature because FRESHCHAT_WEBHOOK_SIGNATURE_STRICT=false');
        } else {
            console.log('[Security] Webhook signature verified ✓');
        }

        const { data, action } = req.body;

        // Handle message_create event
        if (action === 'message_create' && data?.message) {
            const message = data.message;
            const messageId = message?.id ? String(message.id) : null;
            const freshchatConversationId = message.freshchat_conversation_id
                ? String(message.freshchat_conversation_id)
                : data?.freshchat_conversation_id
                    ? String(data.freshchat_conversation_id)
                    : null;
            const conversationGuid = data?.conversation_id || message.conversation_id || null;
            const actorTypeRaw = message.actor_type;
            const actorType = actorTypeRaw ? String(actorTypeRaw).toLowerCase() : 'unknown';

            console.log(`[Freshchat] Processing message_create event`);
            if (messageId) {
                console.log(`[Freshchat] Message ID: ${messageId}`);
            }
            console.log(`[Freshchat] Actor type: ${actorType}`);

            if (!freshchatConversationId) {
                console.log('[Freshchat] Payload missing freshchat_conversation_id - cannot route message');
                return res.sendStatus(200);
            }

            if (messageId && hasProcessedFreshchatMessage(messageId)) {
                console.log(`[Freshchat] Duplicate webhook detected for message ${messageId} - skipping`);
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
                            contentType: part.file.content_type || part.file.contentType || 'application/octet-stream',
                            url: part.file.url || part.file.download_url || part.file.downloadUrl,
                            fileHash: part.file.file_hash || part.file.fileHash,
                            fileId: part.file.file_id || part.file.fileId
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
                            url: part.image.url || part.image.download_url || part.image.downloadUrl,
                            fileHash: part.image.file_hash || part.image.fileHash
                        });
                    }

                    if (part.video?.url) {
                        attachmentParts.push({
                            name: part.video.name || 'freshchat-video',
                            contentType: part.video.content_type || part.video.contentType || 'video/mp4',
                            url: part.video.url || part.video.download_url || part.video.downloadUrl,
                            fileHash: part.video.file_hash || part.video.fileHash
                        });
                    }
                }
            }

            // Always hydrate attachment details to obtain signed URLs
            if (attachmentParts.length > 0) {
                console.log('[Freshchat] Fetching message details for attachment hydration...');
                const detailedMessage = await freshchatClient.getMessageWithRetry(
                    [freshchatConversationId, conversationGuid],
                    message.id,
                    message.created_time
                );

                if (detailedMessage?.message_parts) {
                    const detailIndex = new Map();
                    for (const part of detailedMessage.message_parts) {
                        if (part.file) {
                            const payload = {
                                url: part.file.download_url
                                    || part.file.downloadUrl
                                    || part.file.file_url
                                    || part.file.url,
                                contentType: part.file.content_type || part.file.contentType,
                                name: part.file.name
                            };

                            const fileKeys = [
                                part.file.file_hash,
                                part.file.fileHash,
                                part.file.file_id,
                                part.file.fileId,
                                part.file.name
                            ].filter((value) => typeof value === 'string' && value.length > 0);

                            for (const key of fileKeys) {
                                detailIndex.set(key, payload);
                            }
                        }

                        if (part.image) {
                            const payload = {
                                url: part.image.download_url
                                    || part.image.downloadUrl
                                    || part.image.url,
                                contentType: part.image.content_type || part.image.contentType,
                                name: part.image.name
                            };

                            const imageKeys = [
                                part.image.file_hash,
                                part.image.fileHash,
                                part.image.name,
                                part.image.url
                            ].filter((value) => typeof value === 'string' && value.length > 0);

                            for (const key of imageKeys) {
                                detailIndex.set(key, payload);
                            }
                        }

                        if (part.video) {
                            const payload = {
                                url: part.video.download_url
                                    || part.video.downloadUrl
                                    || part.video.url,
                                contentType: part.video.content_type || part.video.contentType,
                                name: part.video.name
                            };

                            const videoKeys = [
                                part.video.file_hash,
                                part.video.fileHash,
                                part.video.name,
                                part.video.url
                            ].filter((value) => typeof value === 'string' && value.length > 0);

                            for (const key of videoKeys) {
                                detailIndex.set(key, payload);
                            }
                        }
                    }

                    for (const attachment of attachmentParts) {
                        const match = detailIndex.get(attachment.fileHash)
                            || detailIndex.get(attachment.fileId)
                            || detailIndex.get(attachment.name)
                            || detailIndex.get(attachment.url);
                        if (match) {
                            attachment.url = match.url || attachment.url;
                            attachment.contentType = match.contentType || attachment.contentType;
                            attachment.name = match.name || attachment.name;
                        }
                    }
                }
            }

            const missingUrls = attachmentParts
                .filter((attachment) => !attachment.url)
                .map((attachment) => attachment.name)
                .filter(Boolean);

            const attachmentLinks = [];
            const fileCards = [];
            const downloadFailures = [];

            if (attachmentParts.length > 0) {
                if (!PUBLIC_URL) {
                    console.error('[Teams] PUBLIC_URL is not set. Cannot process attachments from Freshchat.');
                    messageText += `\n\n⚠️ 첨부파일을 처리할 수 없습니다: 서버 구성 오류.`;
                } else {
                    for (const attachment of attachmentParts) {
                        try {
                            if (!attachment.url) {
                                downloadFailures.push(attachment.name || '알 수 없는 파일');
                                continue;
                            }

                            const fileData = await freshchatClient.downloadFile(attachment.url);
                            const filename = `${Date.now()}-${(attachment.name || fileData.filename || 'freshchat-file').replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
                            const filepath = path.join(UPLOADS_DIR, filename);
                            fs.writeFileSync(filepath, fileData.buffer);

                            const publicUrl = `${PUBLIC_URL.replace(/\/$/, '')}/files/${filename}`;

                            const isImage = (fileData.contentType || attachment.contentType || '').startsWith('image/');
                            const displayName = attachment.name || fileData.filename || '파일';
                            const fileSize = fileData.buffer.length;
                            const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
                            
                            // Determine file icon based on content type
                            const contentType = (fileData.contentType || attachment.contentType || '').toLowerCase();
                            let fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/3767/3767084.png'; // default file icon
                            
                            if (contentType.includes('pdf')) {
                                fileIconUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/PDF_file_icon.svg/195px-PDF_file_icon.svg.png';
                            } else if (contentType.includes('word') || contentType.includes('document')) {
                                fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/2965/2965350.png';
                            } else if (contentType.includes('excel') || contentType.includes('spreadsheet')) {
                                fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/2965/2965383.png';
                            } else if (contentType.includes('powerpoint') || contentType.includes('presentation')) {
                                fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/2965/2965416.png';
                            } else if (contentType.includes('text')) {
                                fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/3767/3767084.png';
                            } else if (contentType.includes('zip') || contentType.includes('compressed')) {
                                fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/3143/3143615.png';
                            }

                            if (isImage) {
                                // Embed images using Markdown
                                attachmentLinks.push(`![${displayName}](${publicUrl})`);
                            } else {
                                // Create Adaptive Card for file attachment
                                const card = CardFactory.adaptiveCard({
                                    type: 'AdaptiveCard',
                                    version: '1.4',
                                    body: [
                                        {
                                            type: 'ColumnSet',
                                            columns: [
                                                {
                                                    type: 'Column',
                                                    width: 'auto',
                                                    items: [
                                                        {
                                                            type: 'Image',
                                                            url: fileIconUrl,
                                                            size: 'Small',
                                                            width: '40px'
                                                        }
                                                    ]
                                                },
                                                {
                                                    type: 'Column',
                                                    width: 'stretch',
                                                    items: [
                                                        {
                                                            type: 'TextBlock',
                                                            text: displayName,
                                                            weight: 'Bolder',
                                                            size: 'Medium',
                                                            wrap: true
                                                        },
                                                        {
                                                            type: 'TextBlock',
                                                            text: `${fileSizeMB} MB | [다운로드](${publicUrl})`,
                                                            isSubtle: true,
                                                            spacing: 'None'
                                                        }
                                                    ]
                                                }
                                            ]
                                        }
                                    ]
                                });
                                fileCards.push(card);
                            }
                        } catch (downloadError) {
                            downloadFailures.push(attachment.name || '알 수 없는 파일');
                            console.error(`[Freshchat] Failed to process attachment for Teams (${attachment.name}):`, downloadError.message);
                        }
                    }
                }
            }

            if (downloadFailures.length > 0) {
                const downloadWarning = `⚠️ 다음 첨부파일을 처리하지 못했습니다: ${downloadFailures.join(', ')}. Freshchat에서 직접 확인해주세요.`;
                messageText = messageText ? `${messageText}\n\n${downloadWarning}` : downloadWarning;
            }

            if (!messageText && attachmentLinks.length === 0 && fileCards.length === 0) {
                console.log('[Freshchat] No content found in message');
                return res.sendStatus(200);
            }

            // Send message to Teams
            await adapter.continueConversation(
                mapping.conversationReference,
                async (turnContext) => {
                    const actorLabelMap = { agent: '지원팀', system: 'System Message', bot: 'Bot Message' };
                    const actorLabel = actorLabelMap[actorType] || 'Freshchat Update';
                    let composedText = `**${actorLabel}:**`;

                    if (messageText) {
                        composedText += `\n${messageText}`;
                    }

                    if (attachmentLinks.length > 0) {
                        composedText += `\n\n${attachmentLinks.join('\n')}`;
                    }

                    // Send text message first
                    if (composedText !== `**${actorLabel}:**`) {
                        await turnContext.sendActivity(composedText);
                    }

                    // Send file cards separately
                    if (fileCards.length > 0) {
                        for (const card of fileCards) {
                            await turnContext.sendActivity({ attachments: [card] });
                        }
                    }
                }
            );

            if (messageId) {
                const canMarkProcessed = missingUrls.length === 0 && downloadFailures.length === 0;
                if (canMarkProcessed) {
                    markFreshchatMessageProcessed(messageId);
                    console.log(`[Freshchat] Marked message ${messageId} as processed`);
                } else {
                    console.log(`[Freshchat] Message ${messageId} not marked as processed (missingUrls=${missingUrls.length}, downloadFailures=${downloadFailures.length})`);
                }
            }

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
    console.log('   1. Update Azure Bot messaging endpoint with your Fly.io URL');
    console.log('   2. Configure Freshchat webhook with your Fly.io URL');
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
