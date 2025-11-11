/**
 * Teams ↔ Freshchat Minimal Bridge - PoC
 *
 * This is a proof-of-concept implementation demonstrating real-time
 * message transfer between Microsoft Teams and Freshchat.
 * Updated: 2025-11-10
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
const Redis = require('ioredis');

// Fix for Azure SDK crypto issue in Node.js 18+
if (!global.crypto) {
    global.crypto = crypto.webcrypto;
}

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
const FRESHSALES_API_KEY = process.env.FRESHSALES_API_KEY;
const FRESHSALES_API_URL = process.env.FRESHSALES_API_URL;
const PUBLIC_URL = process.env.PUBLIC_URL;
const CUSTOM_GREETING_MESSAGE = (process.env.CUSTOM_GREETING_MESSAGE || '').trim();
const CUSTOM_GREETING_ENABLED = process.env.CUSTOM_GREETING_ENABLED === 'true'
    && CUSTOM_GREETING_MESSAGE.length > 0;
const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_PREFIX = process.env.REDIS_PREFIX || 'freshchat_bridge';
const CONVERSATION_TTL_SECONDS = Number.parseInt(process.env.CONVERSATION_TTL_SECONDS || '2592000', 10);

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

let redisClient = null;
if (REDIS_URL) {
    redisClient = new Redis(REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false
    });

    redisClient.on('connect', () => {
        console.log(`[Redis] Connected to server (prefix=${REDIS_PREFIX})`);
    });

    redisClient.on('error', (err) => {
        console.error(`[Redis] Connection error:`, err.message);
    });

    redisClient.connect().catch((err) => {
        console.error(`[Redis] Initial connection failed:`, err.message);
    });
} else {
    console.log(`[Redis] No REDIS_URL provided - falling back to in-memory conversation store`);
}

class ConversationStore {
    constructor(redisInstance, options = {}) {
        this.redis = redisInstance;
        this.prefix = options.prefix || 'freshchat_bridge';
        this.ttlSeconds = options.ttlSeconds || (30 * 24 * 60 * 60);
        this.memory = new Map();
        this.reverseMemory = new Map();
        this.indexKey = `${this.prefix}:conversation:teams:index`;
        this.reverseIndexKey = `${this.prefix}:conversation:freshchat:index`;
    }

    teamsKey(teamsId) {
        return `${this.prefix}:conversation:teams:${teamsId}`;
    }

    reverseKey(freshchatId) {
        return `${this.prefix}:conversation:freshchat:${freshchatId}`;
    }

    async get(teamsId) {
        if (!teamsId) {
            return null;
        }

        if (this.memory.has(teamsId)) {
            return this.memory.get(teamsId);
        }

        if (!this.redis) {
            return null;
        }

        try {
            const raw = await this.redis.get(this.teamsKey(teamsId));
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            this.memory.set(teamsId, parsed);
            await this.cacheReverseIds(teamsId, parsed);
            return parsed;
        } catch (error) {
            console.warn(`[ConversationStore] Failed to load mapping for ${teamsId}:`, error.message);
            return null;
        }
    }

    async update(teamsId, updates) {
        if (!teamsId) {
            throw new Error('teamsConversationId is required');
        }

        const existing = await this.get(teamsId) || {};
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

        this.memory.set(teamsId, merged);
        await this.cacheReverseIds(teamsId, merged);

        if (this.redis) {
            try {
                await this.redis.multi()
                    .set(this.teamsKey(teamsId), JSON.stringify(merged), 'EX', this.ttlSeconds)
                    .sadd(this.indexKey, teamsId)
                    .exec();
            } catch (error) {
                console.error(`[ConversationStore] Failed to persist mapping:`, error.message);
            }
        }

        return merged;
    }

    async cacheReverseIds(teamsId, mapping) {
        const tasks = [];

        if (mapping.freshchatConversationGuid) {
            const guid = String(mapping.freshchatConversationGuid);
            this.reverseMemory.set(guid, teamsId);
            tasks.push(this.persistReverseKey(guid, teamsId));
        }

        if (mapping.freshchatConversationNumericId) {
            const numericId = String(mapping.freshchatConversationNumericId);
            this.reverseMemory.set(numericId, teamsId);
            tasks.push(this.persistReverseKey(numericId, teamsId));
        }

        await Promise.all(tasks);
    }

    async rememberFreshchatLink(freshchatId, teamsId) {
        if (!freshchatId || !teamsId) {
            return;
        }
        const normalized = String(freshchatId);
        this.reverseMemory.set(normalized, teamsId);
        await this.persistReverseKey(normalized, teamsId);
    }

    async persistReverseKey(freshchatId, teamsId) {
        if (!this.redis || !freshchatId || !teamsId) {
            return;
        }

        try {
            await this.redis.multi()
                .set(this.reverseKey(freshchatId), teamsId, 'EX', this.ttlSeconds)
                .sadd(this.reverseIndexKey, freshchatId)
                .exec();
        } catch (error) {
            console.error(`[ConversationStore] Failed to persist reverse mapping (${freshchatId}):`, error.message);
        }
    }

    async getTeamsIdByFreshchat(freshchatId) {
        if (!freshchatId) {
            return null;
        }

        const normalized = String(freshchatId);

        if (this.reverseMemory.has(normalized)) {
            return this.reverseMemory.get(normalized);
        }

        if (!this.redis) {
            return null;
        }

        try {
            const teamsId = await this.redis.get(this.reverseKey(normalized));
            if (teamsId) {
                this.reverseMemory.set(normalized, teamsId);
            }
            return teamsId;
        } catch (error) {
            console.warn(`[ConversationStore] Failed to load reverse mapping for ${freshchatId}:`, error.message);
            return null;
        }
    }

    async count() {
        if (this.redis) {
            try {
                // Check if Redis is ready before attempting operation
                if (this.redis.status !== 'ready') {
                    return this.memory.size;
                }
                return await this.redis.scard(this.indexKey);
            } catch (error) {
                console.warn(`[ConversationStore] Failed to count Redis mappings:`, error.message);
                return this.memory.size;
            }
        }
        return this.memory.size;
    }

    async list(limit = 50) {
        if (this.redis) {
            try {
                // Check if Redis is ready before attempting operation
                if (this.redis.status !== 'ready') {
                    return Array.from(this.memory.entries())
                        .slice(0, limit)
                        .map(([teamsConversationId, mapping]) => ({
                            teamsConversationId,
                            mapping
                        }));
                }

                const ids = await this.redis.smembers(this.indexKey);
                const limitedIds = ids.slice(0, limit);
                const results = [];

                for (const id of limitedIds) {
                    const mapping = await this.get(id);
                    if (mapping) {
                        results.push({
                            teamsConversationId: id,
                            mapping
                        });
                    }
                }

                return results;
            } catch (error) {
                console.warn(`[ConversationStore] Failed to list mappings from Redis:`, error.message);
            }
        }

        return Array.from(this.memory.entries())
            .slice(0, limit)
            .map(([teamsConversationId, mapping]) => ({
                teamsConversationId,
                mapping
            }));
    }

    async clearAll() {
        this.memory.clear();
        this.reverseMemory.clear();

        if (!this.redis) {
            return;
        }

        try {
            const [teamIds, freshchatIds] = await Promise.all([
                this.redis.smembers(this.indexKey),
                this.redis.smembers(this.reverseIndexKey)
            ]);

            const keysToDelete = [
                ...teamIds.map((id) => this.teamsKey(id)),
                ...freshchatIds.map((id) => this.reverseKey(id))
            ];

            if (keysToDelete.length > 0) {
                await this.redis.del(...keysToDelete);
            }

            await this.redis.del(this.indexKey, this.reverseIndexKey);
            console.log(`[ConversationStore] Redis mappings cleared`);
        } catch (error) {
            console.error(`[ConversationStore] Failed to clear Redis mappings:`, error.message);
        }
    }

    getLocalSnapshot(limit = 25) {
        return Array.from(this.memory.entries())
            .slice(0, limit)
            .map(([teamsConversationId, mapping]) => ({
                teamsConversationId,
                mapping
            }));
    }

    get localSize() {
        return this.memory.size;
    }

    /**
     * Find conversation mapping by Teams user ID
     * This is used as a fallback when conversation.id changes (e.g., screenshot messages)
     */
    async findByUserId(teamsUserId) {
        if (!teamsUserId) {
            return null;
        }

        // Check in-memory store first
        for (const [teamsConvId, mapping] of this.memory.entries()) {
            if (mapping.teamsUserId === teamsUserId) {
                console.log(`[ConversationStore] Found mapping by user ID (memory): ${teamsUserId} → ${teamsConvId}`);
                return { teamsConvId, mapping };
            }
        }

        // Check Redis if available
        if (!this.redis) {
            return null;
        }

        try {
            const userKey = `${this.prefix}:user:${teamsUserId}:latest_conversation`;
            const teamsConvId = await this.redis.get(userKey);

            if (!teamsConvId) {
                return null;
            }

            const mapping = await this.get(teamsConvId);
            if (mapping) {
                console.log(`[ConversationStore] Found mapping by user ID (Redis): ${teamsUserId} → ${teamsConvId}`);
                return { teamsConvId, mapping };
            }

            return null;
        } catch (error) {
            console.error(`[ConversationStore] Failed to find by user ID:`, error.message);
            return null;
        }
    }

    /**
     * Update user's latest conversation reference
     */
    async updateUserLatestConversation(teamsUserId, teamsConvId) {
        if (!teamsUserId || !teamsConvId) {
            return;
        }

        // Update in-memory mapping with user ID
        const mapping = this.memory.get(teamsConvId);
        if (mapping) {
            mapping.teamsUserId = teamsUserId;
            this.memory.set(teamsConvId, mapping);
        }

        // Update Redis user index
        if (this.redis) {
            try {
                const userKey = `${this.prefix}:user:${teamsUserId}:latest_conversation`;
                await this.redis.set(userKey, teamsConvId, 'EX', this.ttlSeconds);
            } catch (error) {
                console.error(`[ConversationStore] Failed to update user latest conversation:`, error.message);
            }
        }
    }
}

const conversationStore = new ConversationStore(redisClient, {
    prefix: REDIS_PREFIX,
    ttlSeconds: Number.isFinite(CONVERSATION_TTL_SECONDS) && CONVERSATION_TTL_SECONDS > 0
        ? CONVERSATION_TTL_SECONDS
        : 30 * 24 * 60 * 60
});

/**
 * Track processed Freshchat message IDs to avoid duplicate delivery.
 * Structure: { messageId: timestamp }
 */
const processedFreshchatMessages = new Map();
const FRESHCHAT_DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Cache for Teams user profiles to reduce Graph API calls
 * Structure: { teamsUserId: { profile, timestamp } }
 */
const userProfileCache = new Map();

/**
 * Cache for help tab content
 * Structure: { content: string, timestamp: number }
 */
const USER_PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

    // Cleanup expired profile cache
    for (const [userId, data] of userProfileCache.entries()) {
        if (now - data.timestamp > USER_PROFILE_CACHE_TTL_MS) {
            userProfileCache.delete(userId);
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

async function updateConversationMapping(teamsConversationId, updates) {
    return conversationStore.update(teamsConversationId, updates);
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

        const contentType = attachment.contentType || attachment.content_type;
        const fileHash = attachment.fileHash || attachment.file_hash || attachment.hash;
        const fileId = attachment.fileId || attachment.file_id;
        const sizeCandidate = attachment.file_size_in_bytes ?? attachment.fileSize;
        const numericSize = Number(sizeCandidate);
        const validSize = Number.isFinite(numericSize) && numericSize > 0 ? numericSize : undefined;
        const safeName = attachment.name || attachment.file_name || 'attachment';

        // Check if this is an image by contentType
        const isImage = contentType && contentType.toLowerCase().startsWith('image/');

        // For URL-based attachments (legacy support, should be rare now)
        if (attachment.url && !fileHash && !fileId) {
            const imagePayload = {
                url: attachment.url
            };

            if (contentType) {
                imagePayload.contentType = contentType;
                imagePayload.content_type = contentType;
            }

            messageParts.push({
                image: imagePayload
            });
            continue;
        }

        // For file_hash/file_id based attachments (preferred method)
        if (!fileHash && !fileId) {
            console.warn(`[Freshchat] Skipping attachment without file identifier`, {
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

        // Use 'image' type for images, 'file' for everything else
        // Both use file_hash/file_id, but the API expects different message part types
        if (isImage) {
            messageParts.push({
                image: filePayload
            });
        } else {
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
    if (match) {
        return match.toLowerCase();
    }

    // Fallback: detect from filename if contentType not available
    const attachmentName = extractAttachmentName(attachment);
    if (attachmentName) {
        const detectedType = mime.lookup(attachmentName);
        if (detectedType) {
            console.log(`[Teams] ContentType detected from filename "${attachmentName}": ${detectedType}`);
            return detectedType.toLowerCase();
        }
    }

    return '';
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
    // For MultiTenant bots, use 'organizations' instead of 'common' for Bot Framework authentication
    // Graph API calls use the actual tenant ID from the activity
    channelAuthTenant: BOT_TENANT_ID === 'common' ? 'organizations' : BOT_TENANT_ID
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
// ============================================
// Freshsales CRM Client (Contact Management)
// ============================================
class FreshsalesClient {
    constructor(apiKey, apiUrl) {
        this.apiKey = apiKey;
        this.apiUrl = apiUrl;
        this.axiosInstance = axios.create({
            baseURL: apiUrl,
            headers: {
                'Authorization': `Token token=${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Upsert contact by email (create if not exists, update if exists)
     * Uses Freshsales Upsert API: POST /api/contacts/upsert
     * Maps Teams profile to Freshsales standard fields:
     * - job_title: jobTitle
     * - department: department
     * - mobile_number: mobilePhone (only if not already set)
     * - work_number: officePhone (only if not already set)
     * - address: officeLocation
     * @param {string} email - User email (unique identifier)
     * @param {Object} contactData - Contact data to upsert
     * @returns {Object} Contact object from Freshsales
     */
    async upsertContact(email, contactData) {
        try {
            console.log(`[Freshsales] Upserting contact for email: ${email}`);
            console.log(`[Freshsales] Contact data:`, JSON.stringify(contactData, null, 2));

            // Build contact payload with standard fields only
            const contact = {
                email: contactData.email,
                first_name: contactData.first_name || 'Teams User'
            };

            // Add standard fields if provided
            if (contactData.job_title) {
                contact.job_title = contactData.job_title;
            }
            if (contactData.department) {
                contact.department = contactData.department;
            }
            if (contactData.address) {
                contact.address = contactData.address;
            }

            // Strategy 1: Try with phone numbers
            if (contactData.mobile_number) {
                contact.mobile_number = contactData.mobile_number;
            }
            if (contactData.work_number) {
                contact.work_number = contactData.work_number;
            }

            const payload = {
                unique_identifier: {
                    emails: email
                },
                contact: contact
            };

            try {
                const response = await this.axiosInstance.post('/contacts/upsert', payload);
                console.log(`[Freshsales] Upsert successful:`, JSON.stringify(response.data, null, 2));
                return response.data;
            } catch (firstError) {
                // If phone number duplication error, retry without phone numbers
                if (firstError.response?.status === 400 && 
                    firstError.response?.data?.errors?.message?.includes('이미 존재합니다')) {
                    console.log(`[Freshsales] Phone number conflict detected, retrying without phone numbers`);
                    
                    // Remove phone numbers and retry
                    delete contact.mobile_number;
                    delete contact.work_number;
                    
                    const retryPayload = {
                        unique_identifier: {
                            emails: email
                        },
                        contact: contact
                    };
                    
                    const retryResponse = await this.axiosInstance.post('/contacts/upsert', retryPayload);
                    console.log('[Freshsales] Upsert successful (without phone):', JSON.stringify(retryResponse.data, null, 2));
                    return retryResponse.data;
                } else {
                    throw firstError;
                }
            }
        } catch (error) {
            console.error(`[Freshsales] Upsert failed:`, {
                email,
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                errorDetails: JSON.stringify(error.response?.data, null, 2),
                message: error.message
            });
            throw error;
        }
    }
}

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
        // Agent cache: Map<agentId, { name, cachedAt }>
        this.agentCache = new Map();
        this.agentCacheTTL = 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Get agent name with caching (30 min TTL)
     */
    async getAgentName(agentId) {
        if (!agentId) {
            return '지원팀';
        }

        // Check cache (respect per-entry TTL)
        const cached = this.agentCache.get(agentId);
        if (cached) {
            const ttl = cached.ttl ?? this.agentCacheTTL;
            if (Date.now() - cached.cachedAt < ttl) {
                console.log(`[Freshchat] Using cached agent name for ${agentId}: ${cached.name}`);
                return cached.name;
            }
        }

        // Fetch from API
        try {
            console.log(`[Freshchat] Fetching agent info for ID: ${agentId}`);
            const response = await this.axiosInstance.get(`/agents/${agentId}`);
            const agent = response.data;

            // Extract name: prefer first_name, fallback to email, then default
            const name = agent.first_name || agent.email || '지원팀';

            // Cache the result
            this.agentCache.set(agentId, { name, cachedAt: Date.now() });
            console.log(`[Freshchat] Agent ${agentId} name: ${name}`);

            return name;
        } catch (error) {
            console.error(`[Freshchat] Failed to fetch agent ${agentId}:`, error.response?.data || error.message);
            
            // Cache failures with shorter TTL to prevent repeated failed requests
            this.agentCache.set(agentId, { 
                name: '지원팀', 
                cachedAt: Date.now(),
                isFallback: true,
                ttl: 5 * 60 * 1000 // 5 minutes for failed lookups
            });
            
            return '지원팀'; // Fallback to default
        }
    }

    /**
     * Create a new conversation in Freshchat
     */
    async createConversation(userId, userName, initialMessage, attachments = [], userProfile = {}) {
        try {
            console.log(`[Freshchat] Creating conversation for user: ${userName}`);

            // Get or create Freshchat user with full profile (email + Teams info)
            const user = await this.getOrCreateBasicUser(userId, userName, userProfile);

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
            console.error(`[Freshchat] Error creating conversation:`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get or create a Freshchat user with full profile (email + Teams info)
     * Strategy:
     * - New user: Create with email + full profile
     * - Existing user: Find by name → Update with email + profile
     */
    async getOrCreateBasicUser(externalId, name, userProfile = {}) {
        const userName = name && name.trim() ? name.trim() : 'Teams User';
        const email = userProfile.email;

        // 🎯 전략: 이메일이 없으면 → 이름을 임시 구분자로 사용
        if (!email && userName !== 'Teams User') {
            try {
                console.log(`[Freshchat] No email, searching by name: ${userName}`);

                // 이름으로 사용자 검색
                const nameSearchResponse = await this.axiosInstance.get(`/users`, {
                    params: {
                        first_name: userName
                    }
                });

                if (nameSearchResponse.data?.users && nameSearchResponse.data.users.length > 0) {
                    const foundUser = nameSearchResponse.data.users[0];
                    console.log(`[Freshchat] Found user by name: ${foundUser.id} (${userName})`);

                    // reference_id가 없으면 추가
                    if (!foundUser.reference_id) {
                        console.log(`[Freshchat] Adding reference_id: ${externalId}`);
                        await this.updateUserProfile(foundUser.id, userName, null, userProfile, externalId);
                    }

                    return foundUser;
                }
            } catch (error) {
                console.log(`[Freshchat] Name search failed:`, error.message);
            }
        }

        // reference_id로 조회
        try {
            const response = await this.axiosInstance.get(`/users/lookup`, {
                params: { reference_id: externalId }
            });

            if (response.data && response.data.id) {
                console.log(`[Freshchat] Found existing user by reference_id: ${response.data.id}`);

                // 이메일과 프로필 업데이트
                if (email) {
                    console.log(`[Freshchat] Updating user ${response.data.id} with email: ${email}`);
                    await this.updateUserProfile(response.data.id, userName, email, userProfile);
                }

                return response.data;
            }
        } catch (error) {
            console.log(`[Freshchat] reference_id lookup failed, will create new user`);
        }

        // 신규 사용자 생성 - 이메일 + 전체 프로필 포함
        const createPayload = {
            reference_id: externalId,
            first_name: userName,
            properties: [
                {
                    name: 'source',
                    value: 'Microsoft Teams'
                }
            ]
        };

        // 이메일이 있으면 포함 (Freshchat의 구분자)
        if (email) {
            createPayload.email = email;
            console.log(`[Freshchat] Creating new user with email: ${email}`);
        } else {
            console.log(`[Freshchat] Creating new user without email (email will be added later): ${userName}`);
        }

        // 부서 추가 (Freshchat 커스텀 필드)
        if (userProfile.department) {
            createPayload.cf_field2556 = userProfile.department;
            console.log(`[Freshchat] Adding department to user: ${userProfile.department}`);
        }

        // Teams 프로필 정보를 properties에 추가
        if (userProfile.jobTitle) {
            createPayload.properties.push({
                name: 'teams_job_title',
                value: userProfile.jobTitle
            });
        }
        if (userProfile.department) {
            createPayload.properties.push({
                name: 'teams_department',
                value: userProfile.department
            });
        }
        if (userProfile.mobilePhone) {
            createPayload.properties.push({
                name: 'teams_mobile_phone',
                value: userProfile.mobilePhone
            });
        }
        if (userProfile.officePhone) {
            createPayload.properties.push({
                name: 'teams_office_phone',
                value: userProfile.officePhone
            });
        }
        if (userProfile.officeLocation) {
            createPayload.properties.push({
                name: 'teams_office_location',
                value: userProfile.officeLocation
            });
        }

        console.log(`[Freshchat] Create payload:`, JSON.stringify(createPayload, null, 2));
        const createResponse = await this.axiosInstance.post('/users', createPayload);

        console.log(`[Freshchat] User created successfully:`, JSON.stringify({
            id: createResponse.data.id,
            email: createResponse.data.email,
            cf_field2556: createResponse.data.cf_field2556,
            first_name: createResponse.data.first_name
        }, null, 2));

        console.log(`[Freshchat] User created: ${createResponse.data.id} ${email ? `with email: ${email}` : '(no email)'}`);
        return createResponse.data;
    }

    /**
     * Update Freshchat user profile with email and Teams info
     */
    async updateUserProfile(userId, name, email, userProfile = {}, referenceId = null) {
        try {
            const updatePayload = {
                first_name: name
            };

            // reference_id 추가 (없었던 경우)
            if (referenceId) {
                updatePayload.reference_id = referenceId;
            }

            // 이메일 추가 (Freshchat 구분자)
            if (email) {
                updatePayload.email = email;
            }

            // 부서 추가 (Freshchat 커스텀 필드)
            if (userProfile.department) {
                updatePayload.cf_field2556 = userProfile.department;
                console.log(`[Freshchat] Updating department for user: ${userProfile.department}`);
            }

            // Teams 프로필 정보를 properties에 추가
            const properties = [
                {
                    name: 'source',
                    value: 'Microsoft Teams'
                }
            ];

            if (userProfile.jobTitle) {
                properties.push({
                    name: 'teams_job_title',
                    value: userProfile.jobTitle
                });
            }
            if (userProfile.department) {
                properties.push({
                    name: 'teams_department',
                    value: userProfile.department
                });
            }
            if (userProfile.mobilePhone) {
                properties.push({
                    name: 'teams_mobile_phone',
                    value: userProfile.mobilePhone
                });
            }
            if (userProfile.officePhone) {
                properties.push({
                    name: 'teams_office_phone',
                    value: userProfile.officePhone
                });
            }
            if (userProfile.officeLocation) {
                properties.push({
                    name: 'teams_office_location',
                    value: userProfile.officeLocation
                });
            }
            if (userProfile.displayName) {
                properties.push({
                    name: 'teams_display_name',
                    value: userProfile.displayName
                });
            }

            updatePayload.properties = properties;

            console.log(`[Freshchat] Update payload:`, JSON.stringify(updatePayload, null, 2));
            const updateResponse = await this.axiosInstance.put(`/users/${userId}`, updatePayload);
            console.log(`[Freshchat] User profile updated successfully:`, JSON.stringify({
                id: userId,
                cf_field2556: updateResponse.data?.cf_field2556,
                email: updateResponse.data?.email
            }, null, 2));
        } catch (error) {
            console.error(`[Freshchat] Failed to update user profile ${userId}:`, error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Update Freshchat user with Teams conversation ID
     * Merges with existing properties to preserve other Teams info
     */
    async updateUserTeamsConversation(userId, teamsConversationId) {
        try {
            console.log(`[Freshchat] Updating user ${userId} with Teams conversation: ${teamsConversationId}`);
            
            // Fetch existing user properties
            let existingProperties = [];
            try {
                const existingUserResponse = await this.axiosInstance.get(`/users/${userId}`);
                existingProperties = existingUserResponse.data.properties || [];
            } catch (getUserError) {
                // If user doesn't exist (404) or read fails, proceed with empty properties
                console.warn(`[Freshchat] Could not fetch existing user ${userId}:`, getUserError.response?.status || getUserError.message);
            }

            // Build updates
            const updates = [
                { name: 'source', value: 'Microsoft Teams' },
                { name: 'teams_conversation_id', value: teamsConversationId },
                { name: 'teams_last_updated', value: new Date().toISOString() }
            ];

            // Check if conversation ID has changed (always update timestamp)
            const existingMap = new Map(existingProperties.map(p => [p.name, p.value]));
            const existingConversationId = existingMap.get('teams_conversation_id');
            
            if (existingConversationId === teamsConversationId) {
                console.log(`[Freshchat] Teams conversation ID unchanged for user ${userId}, skipping update`);
                return;
            }

            // Merge properties
            const propertyMap = new Map();
            existingProperties.forEach(prop => propertyMap.set(prop.name, prop.value));
            updates.forEach(prop => propertyMap.set(prop.name, prop.value));

            const mergedProperties = Array.from(propertyMap.entries()).map(([name, value]) => ({
                name,
                value
            }));

            await this.axiosInstance.put(`/users/${userId}`, {
                properties: mergedProperties
            });

            console.log(`[Freshchat] ✅ User updated with Teams conversation ID`);
        } catch (error) {
            console.error(`[Freshchat] Failed to update user with Teams conversation:`, error.response?.data || error.message);
        }
    }

    /**
     * Get user's Teams conversation ID from Freshchat properties
     */
    async getUserTeamsConversation(userId) {
        try {
            const response = await this.axiosInstance.get(`/users/${userId}`);
            const user = response.data;
            
            if (user.properties) {
                const teamsConvProp = user.properties.find(p => p.name === 'teams_conversation_id');
                if (teamsConvProp && teamsConvProp.value) {
                    console.log(`[Freshchat] Found Teams conversation ID for user ${userId}: ${teamsConvProp.value}`);
                    return teamsConvProp.value;
                }
            }
            
            console.log(`[Freshchat] No Teams conversation ID found for user ${userId}`);
            return null;
        } catch (error) {
            console.error(`[Freshchat] Failed to get user Teams conversation:`, error.response?.data || error.message);
            return null;
        }
    }

    /**
     * Store Teams conversation data in Freshchat conversation properties
     * NOTE: Freshchat API does not support updating conversation properties via PUT
     * This function is disabled to avoid 400 errors
     */
    async updateConversationTeamsData(conversationId, teamsConvId, conversationReference) {
        // DISABLED: Freshchat API returns 400 "Conversation payload not valid"
        // Main mapping is preserved in Redis and user properties, so this is not needed
        console.log(`[Freshchat] Skipping conversation property storage (not supported by API) - using Redis and user properties instead`);
        return;
        
        /* Original code - kept for reference
        try {
            console.log(`[Freshchat] Storing Teams data in conversation: ${conversationId}`);

            const properties = [
                {
                    name: 'teams_conversation_id',
                    value: teamsConvId
                },
                {
                    name: 'teams_conversation_reference',
                    value: JSON.stringify(conversationReference)
                }
            ];

            await this.axiosInstance.put(`/conversations/${conversationId}`, {
                properties
            });

            console.log(`[Freshchat] ✅ Teams data stored in conversation ${conversationId}`);
        } catch (error) {
            console.warn(`[Freshchat] ⚠️  Could not store Teams data in conversation properties (non-critical):`, error.response?.data || error.message);
            console.warn(`[Freshchat] ⚠️  This is a backup storage - main mapping is still preserved in Redis and user properties`);
        }
        */
    }

    /**
     * Get Teams conversation data from Freshchat conversation properties
     * Allows an optional fallback ID (numeric) when the primary lookup uses GUID.
     */
    async getConversationTeamsData(primaryConversationId, fallbackConversationId = null) {
        const fetchConversation = async (conversationId, label) => {
            if (!conversationId) {
                return null;
            }

            try {
                console.log(`[Freshchat] Fetching conversation (${label}): ${conversationId}`);
                const response = await this.axiosInstance.get(`/conversations/${conversationId}`);
                const conversation = response.data;

                if (conversation.properties) {
                    // Handle both array and object formats
                    let teamsConvId, teamsRef;

                    if (Array.isArray(conversation.properties)) {
                        const teamsConvIdProp = conversation.properties.find((p) => p.name === 'teams_conversation_id');
                        const teamsRefProp = conversation.properties.find((p) => p.name === 'teams_conversation_reference');
                        teamsConvId = teamsConvIdProp?.value;
                        teamsRef = teamsRefProp?.value;
                    } else {
                        // Properties is an object
                        teamsConvId = conversation.properties.teams_conversation_id;
                        teamsRef = conversation.properties.teams_conversation_reference;
                    }

                    if (teamsConvId && teamsRef) {
                        console.log(`[Freshchat] ✅ Found Teams data in conversation ${conversationId}`);
                        return {
                            teamsConvId,
                            conversationReference: JSON.parse(teamsRef)
                        };
                    }
                }

                console.log(`[Freshchat] No Teams data found in conversation ${conversationId}`);
                return null;
            } catch (error) {
                if (error.response?.status === 404) {
                    console.warn(`[Freshchat] Conversation lookup (${label}) returned 404 for ${conversationId}`);
                } else {
                    console.error(`[Freshchat] Failed to get Teams data from conversation (${label}):`, error.response?.data || error.message);
                }
                return null;
            }
        };

        let result = await fetchConversation(primaryConversationId, 'primary');

        if (!result && fallbackConversationId && fallbackConversationId !== primaryConversationId) {
            console.log(`[Freshchat] Retrying conversation lookup with fallback ID: ${fallbackConversationId}`);
            result = await fetchConversation(fallbackConversationId, 'fallback');
        }

        return result;
    }

    /**
     * Check if conversation is still active (not resolved)
     * @param {string} conversationId - Freshchat conversation ID (GUID or numeric)
     * @returns {Promise<boolean>} - true if active, false if resolved or error
     */
    async isConversationActive(conversationId) {
        if (!conversationId) {
            return false;
        }

        try {
            const response = await this.axiosInstance.get(`/conversations/${conversationId}`);
            const conversation = response.data;
            const status = conversation?.status;

            console.log(`[Freshchat] Conversation ${conversationId} status: ${status}`);

            // Consider conversation inactive if resolved
            return status !== 'resolved';
        } catch (error) {
            if (error.response?.status === 404) {
                console.warn(`[Freshchat] Conversation ${conversationId} not found (404)`);
            } else {
                console.error(`[Freshchat] Failed to check conversation status:`, error.response?.data || error.message);
            }
            // On error, consider inactive to avoid reusing potentially resolved conversations
            return false;
        }
    }

    /**
     * Get all conversation IDs for a user
     * @param {string} userId - Freshchat user ID
     * @returns {Promise<Array<string>>} - Array of conversation IDs
     */
    async getUserConversations(userId) {
        if (!userId) {
            return [];
        }

        try {
            const response = await this.axiosInstance.get(`/users/${userId}/conversations`);
            const conversations = response.data?.conversations || [];
            const conversationIds = conversations.map(c => c.id).filter(Boolean);

            console.log(`[Freshchat] Found ${conversationIds.length} conversation(s) for user ${userId}`);
            return conversationIds;
        } catch (error) {
            if (error.response?.status === 404) {
                console.warn(`[Freshchat] User ${userId} not found or has no conversations`);
            } else {
                console.error(`[Freshchat] Failed to get user conversations:`, error.response?.data || error.message);
            }
            return [];
        }
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
            console.error(`[Freshchat] Error uploading file:`, error.response?.data || error.message);
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
            console.log(`[Freshchat] Outgoing message payload:`, {
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
                    console.log(`[Freshchat] Message details:`, JSON.stringify(detailedMessage, null, 2));
                } else {
                    console.warn(`[Freshchat] Unable to fetch message details for attachment logging`);
                }
            }

            return response.data;
        } catch (error) {
            console.error(`[Freshchat] Error sending message:`, error.response?.data || error.message);
            if (error.response) {
                console.error(`[Freshchat] Error response details:`, {
                    status: error.response.status,
                    statusText: error.response.statusText,
                    headers: error.response.headers,
                    data: error.response.data
                });
            }

            // Handle "not the latest conversation" error - Freshchat creates new conversation when resolved
            const errorMessage = error.response?.data?.message || '';
            if (error.response?.status === 400 && errorMessage.includes('not the latest conversation')) {
                console.log(`[Freshchat] Detected stale conversation ID, fetching latest conversation for user ${userId}`);

                try {
                    // Get all conversations for this user
                    const userConversations = await this.getUserConversations(userId);

                    if (userConversations.length > 0) {
                        // Try the first conversation (assuming it's most recent)
                        const latestConversationId = userConversations[0];
                        console.log(`[Freshchat] 🔍 Testing conversation order - Total: ${userConversations.length}`);
                        console.log(`[Freshchat] 🔍 All IDs:`, userConversations);
                        console.log(`[Freshchat] 🔍 Attempting first ID (index 0): ${latestConversationId}`);

                        // Rebuild message parts for retry
                        const retryMessageParts = buildFreshchatMessageParts(message, attachments);

                        // Retry with the latest conversation
                        const retryResponse = await this.axiosInstance.post(`/conversations/${latestConversationId}/messages`, {
                            message_parts: retryMessageParts,
                            actor_type: 'user',
                            actor_id: userId
                        });

                        console.log(`[Freshchat] Message sent successfully to latest conversation: ${latestConversationId}`);

                        // Return both the response and the new conversation ID
                        return {
                            ...retryResponse.data,
                            _updatedConversationId: latestConversationId  // Signal to caller that conversation changed
                        };
                    }
                } catch (retryError) {
                    console.error(`[Freshchat] Retry with latest conversation failed:`, retryError.response?.data || retryError.message);
                    // Fall through to throw original error
                }
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
                    console.warn(`[Freshchat] Unable to fetch hydrated message details for attachments`);
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
            console.error(`[Freshchat] Error downloading file:`, status, statusText);
            throw error;
        }
    }
}

const freshchatClient = new FreshchatClient(FRESHCHAT_API_KEY, FRESHCHAT_API_URL, FRESHCHAT_INBOX_ID);
const freshsalesClient = new FreshsalesClient(FRESHSALES_API_KEY, FRESHSALES_API_URL);

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

    console.error(`[Teams] Error downloading attachment:`, lastError?.message || 'Unknown error');
    throw lastError || new Error('Unable to download attachment');
}

/**
 * Collect Teams user profile information using Graph API
 */
async function collectTeamsUserProfile(context) {
    const { activity } = context;
    const userId = activity.from.id;

    // Check cache first
    const cached = userProfileCache.get(userId);
    if (cached && (Date.now() - cached.timestamp) < USER_PROFILE_CACHE_TTL_MS) {
        console.log(`[Teams] Using cached profile for user:`, userId);
        return cached.profile;
    }

    const userProfile = {};

    try {
        if (activity.from.name) {
            userProfile.displayName = activity.from.name;
        }

        // Get basic member info from Teams
        try {
            const member = await TeamsInfo.getMember(context, activity.from.id);

            if (member) {
                console.log(`[Teams] Member info retrieved`);

                if (member.name) userProfile.displayName = member.name;
                if (member.email) userProfile.email = member.email;
                if (member.userPrincipalName && !userProfile.email) {
                    userProfile.email = member.userPrincipalName;
                }

                // Attempt to get extended profile via Microsoft Graph API
                if (member.aadObjectId || activity.from.aadObjectId) {
                    try {
                        const aadId = member.aadObjectId || activity.from.aadObjectId;
                        // Extract tenant ID from activity for MultiTenant support
                        const tenantId = activity.conversation?.tenantId || activity.channelData?.tenant?.id;
                        const graphProfile = await getGraphUserProfileAppOnly(aadId, tenantId);

                        if (graphProfile) {
                            console.log('[Graph] Extended profile retrieved');
                            console.log('[Graph] Raw Graph API data:', JSON.stringify({
                                jobTitle: graphProfile.jobTitle,
                                department: graphProfile.department,
                                mobilePhone: graphProfile.mobilePhone,
                                officeLocation: graphProfile.officeLocation,
                                businessPhones: graphProfile.businessPhones,
                                mail: graphProfile.mail
                            }, null, 2));
                            
                            if (graphProfile.jobTitle) userProfile.jobTitle = graphProfile.jobTitle;
                            if (graphProfile.department) userProfile.department = graphProfile.department;
                            if (graphProfile.mobilePhone) userProfile.mobilePhone = graphProfile.mobilePhone;
                            if (graphProfile.officeLocation) userProfile.officeLocation = graphProfile.officeLocation;
                            if (graphProfile.businessPhones?.length > 0) {
                                userProfile.officePhone = graphProfile.businessPhones[0];
                            }
                            if (graphProfile.mail && !userProfile.email) userProfile.email = graphProfile.mail;
                        }
                    } catch (graphError) {
                        console.warn('[Graph] Extended profile unavailable:', graphError.message);
                    }
                }
            }
        } catch (memberError) {
            console.warn(`[Teams] Could not retrieve member info:`, memberError.message);
        }

        console.log(`[Teams] User profile collected:`, JSON.stringify(userProfile, null, 2));
        
        // Cache the profile
        userProfileCache.set(userId, {
            profile: userProfile,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error(`[Teams] Error collecting user profile:`, error.message);
    }

    return userProfile;
}

/**
 * Get user profile from Microsoft Graph API using application permissions
 */
async function getGraphUserProfileAppOnly(aadObjectId, tenantId = null) {
    if (!aadObjectId) {
        return null;
    }

    try {
        const accessToken = await getGraphAccessToken(tenantId);
        const selectFields = [
            'displayName',
            'mail',
            'jobTitle',
            'department',
            'mobilePhone',
            'businessPhones',
            'officeLocation'
        ].join(',');

        const response = await axios.get(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(aadObjectId)}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { $select: selectFields }
            }
        );

        return response.data;
    } catch (error) {
        const status = error.response?.status;
        const statusText = error.response?.statusText;
        const errorDetail = status
            ? `${status}${statusText ? ` ${statusText}` : ''}`
            : error.message;
        console.warn('[Graph] Could not fetch extended profile (app-only):', errorDetail);
        return null;
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
    const teamsUserId = activity.from.id;
    let mapping = await conversationStore.get(teamsConvId);

    // Fallback: if no mapping found by conversation ID, try finding by user ID
    // This handles cases where Teams changes conversation.id for the same user
    // (e.g., when sending screenshots after text messages)
    if (!mapping) {
        const userMapping = await conversationStore.findByUserId(teamsUserId);
        if (userMapping) {
            console.log(`[Mapping] Found existing conversation via user ID fallback`);
            console.log(`[Mapping] Consolidating: ${teamsConvId} → ${userMapping.teamsConvId}`);

            // Use the existing mapping and update conversation reference
            mapping = userMapping.mapping;

            // Also store this new conversation ID pointing to same Freshchat conversation
            // Copy all metadata from existing mapping to preserve state (e.g., greetingSent)
            await conversationStore.update(teamsConvId, {
                freshchatConversationGuid: mapping.freshchatConversationGuid,
                freshchatConversationNumericId: mapping.freshchatConversationNumericId,
                freshchatUserId: mapping.freshchatUserId,
                teamsUserId: teamsUserId,
                conversationReference: TurnContext.getConversationReference(activity),
                greetingSent: mapping.greetingSent  // Preserve greeting state
            });

            console.log(`[Mapping] New Teams conversation ID linked to existing Freshchat conversation`);
            // Note: If conversation was resolved, Freshchat will auto-create new one and return error
            // The sendMessage retry logic will handle this automatically
        }
    }

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
                    console.log(`[Teams] Processing attachment "${attachmentLabel}"`);
                    console.log(`[Teams] - Initial contentType: ${normalizedContentType || 'none'}`);
                    console.log(`[Teams] - Attachment name: ${attachmentName}`);

                    // Pre-check: if initial contentType indicates image, preserve it
                    const initialContentTypeLower = (normalizedContentType || '').toLowerCase();
                    const isImageByInitialType = initialContentTypeLower.startsWith('image/') ||
                                                  initialContentTypeLower === 'image/*';

                    const downloadResult = await downloadTeamsAttachment(context, attachment, normalizedContentType);

                    console.log(`[Teams] - Downloaded contentType: ${downloadResult.contentType || 'none'}`);

                    // Determine final contentType with priority:
                    // 1. If initial type was image/*, trust it
                    // 2. Use downloaded contentType if specific
                    // 3. Use initial contentType
                    // 4. Try to detect from filename
                    let resolvedContentType;

                    if (isImageByInitialType && (!downloadResult.contentType || downloadResult.contentType === 'application/octet-stream')) {
                        // Initial type was image, but download returned generic type
                        // Try to get specific image type or use png as default
                        const detectedType = mime.lookup(attachmentName) || mime.lookup(sanitizedName);
                        resolvedContentType = detectedType && detectedType.startsWith('image/')
                            ? detectedType
                            : 'image/png'; // Default to PNG if we know it's an image
                        console.log(`[Teams] - Preserved image type from initial contentType: ${resolvedContentType}`);
                    } else {
                        resolvedContentType = downloadResult.contentType
                            || normalizedContentType
                            || 'application/octet-stream';

                        // If still unknown, try filename detection
                        if (resolvedContentType === 'application/octet-stream' || !resolvedContentType) {
                            const detectedType = mime.lookup(attachmentName) || mime.lookup(sanitizedName);
                            if (detectedType) {
                                resolvedContentType = detectedType;
                                console.log(`[Teams] - ContentType detected from filename: ${resolvedContentType}`);
                            }
                        }
                    }

                    // Check if it's an image by contentType OR by filename extension
                    let isImage = resolvedContentType.toLowerCase().startsWith('image/');

                    // Additional check: if filename suggests image but contentType doesn't
                    if (!isImage && attachmentName) {
                        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];
                        const hasImageExtension = imageExtensions.some(ext =>
                            attachmentName.toLowerCase().endsWith(ext)
                        );
                        if (hasImageExtension) {
                            isImage = true;
                            console.log(`[Teams] - Detected as image by filename extension: ${attachmentName}`);
                        }
                    }

                    console.log(`[Teams] - Final contentType: ${resolvedContentType}`);
                    console.log(`[Teams] - Is image: ${isImage}`);
                    const storedFilename = buildStoredFilename(attachmentName, resolvedContentType);
                    const effectiveName = sanitizedName || storedFilename;

                    if (isImage) {
                        // For images, upload to Freshchat directly using file upload API
                        // This is more reliable than serving via URL, especially for images from third-party capture tools
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

                        console.log('[Teams → Freshchat] Image upload response (normalized):', {
                            name: normalizedUpload.name,
                            size: normalizedUpload.fileSize,
                            contentType: normalizedUpload.contentType,
                            fileHash: normalizedUpload.fileHash,
                            fileId: normalizedUpload.fileId,
                            downloadUrl: normalizedUpload.downloadUrl
                        });

                        // Build image attachment payload with file_hash/file_id
                        const imageAttachmentPayload = {
                            name: normalizedUpload.name,
                            contentType: normalizedUpload.contentType,
                            content_type: normalizedUpload.contentType
                        };

                        if (normalizedUpload.fileHash) {
                            imageAttachmentPayload.fileHash = normalizedUpload.fileHash;
                            imageAttachmentPayload.file_hash = normalizedUpload.fileHash;
                        }

                        if (normalizedUpload.fileId) {
                            imageAttachmentPayload.fileId = normalizedUpload.fileId;
                            imageAttachmentPayload.file_id = normalizedUpload.fileId;
                        }

                        if (!imageAttachmentPayload.fileHash && !imageAttachmentPayload.fileId) {
                            console.warn('[Teams → Freshchat] Uploaded image missing fileHash and fileId. Freshchat may skip the attachment.');
                        }

                        freshchatAttachments.push(imageAttachmentPayload);
                        console.log('[Teams → Freshchat] Image prepared for send:', {
                            name: imageAttachmentPayload.name,
                            fileHash: imageAttachmentPayload.fileHash,
                            fileId: imageAttachmentPayload.fileId,
                            contentType: imageAttachmentPayload.contentType
                        });

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

        // Sync Teams user profile to Freshsales Contact (always, regardless of conversation state)
        const userProfile = await collectTeamsUserProfile(context);
        if (userProfile.email) {
            try {
                await freshsalesClient.upsertContact(userProfile.email, {
                    email: userProfile.email,
                    first_name: activity.from.name || 'Teams User',
                    job_title: userProfile.jobTitle || null,
                    department: userProfile.department || null,
                    mobile_number: userProfile.mobilePhone || null,
                    work_number: userProfile.officePhone || null,
                    address: userProfile.officeLocation || null  // 회사 위치 → address 필드
                });
            } catch (freshsalesError) {
                console.error(`[Freshsales] Contact upsert failed:`, freshsalesError.message);
            }
        }

        if (!mapping) {
            // First message in this conversation - create new Freshchat conversation
            const initialMessage = hasTextContent ? messageText : null;

            const freshchatConv = await freshchatClient.createConversation(
                activity.from.id,
                activity.from.name,
                initialMessage,
                freshchatAttachments,
                userProfile  // 🎯 Pass full user profile (including email)
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

            mapping = await updateConversationMapping(teamsConvId, {
                freshchatConversationGuid,
                freshchatConversationNumericId,
                freshchatUserId: freshchatConv.user_id,
                teamsUserId: teamsUserId,
                conversationReference: TurnContext.getConversationReference(activity)
            });

            console.log(`[Mapping] Created: Teams(${teamsConvId}) ↔ Freshchat(${resolveFreshchatConversationId(mapping)})`);

            // Update user's latest conversation index
            await conversationStore.updateUserLatestConversation(teamsUserId, teamsConvId);

            // Store Teams data in Freshchat conversation properties (async, non-blocking)
            const conversationIdToUpdate = freshchatConversationNumericId || freshchatConversationGuid;
            if (conversationIdToUpdate) {
                freshchatClient.updateConversationTeamsData(
                    conversationIdToUpdate,
                    teamsConvId,
                    mapping.conversationReference
                ).catch(err => console.warn(`[Freshchat] Background conversation update failed:`, err.message));
            }

            // Also store Teams conversation ID in Freshchat user properties (async, non-blocking)
            freshchatClient.updateUserTeamsConversation(freshchatConv.user_id, teamsConvId)
                .catch(err => console.warn(`[Freshchat] Background profile update failed:`, err.message));

            if (freshchatConversationGuid && !freshchatConversationNumericId) {
                console.log('[Mapping] Waiting for numeric Freshchat conversation ID from webhook payload');
            }
        } else {
            // Existing conversation - Update conversationReference to track latest active thread
            const latestConversationReference = TurnContext.getConversationReference(activity);
            mapping = await updateConversationMapping(teamsConvId, {
                teamsUserId: teamsUserId,
                conversationReference: latestConversationReference
            });
            console.log(`[Mapping] Updated conversationReference to latest thread: ${teamsConvId}`);

            // Update user's latest conversation index
            await conversationStore.updateUserLatestConversation(teamsUserId, teamsConvId);

            // Update Teams data in Freshchat conversation properties (async, non-blocking)
            const conversationIdToUpdate = mapping.freshchatConversationNumericId || mapping.freshchatConversationGuid;
            if (conversationIdToUpdate) {
                freshchatClient.updateConversationTeamsData(
                    conversationIdToUpdate,
                    teamsConvId,
                    latestConversationReference
                ).catch(err => console.warn(`[Freshchat] Background conversation update failed:`, err.message));
            }

            // Update Freshchat user profile with latest Teams info
            if (mapping.freshchatUserId && userProfile.email) {
                try {
                    console.log(`[Freshchat] Updating existing user profile: ${mapping.freshchatUserId}`);
                    await freshchatClient.updateUserProfile(
                        mapping.freshchatUserId,
                        activity.from.name,
                        userProfile.email,
                        userProfile
                    );
                } catch (updateError) {
                    console.warn(`[Freshchat] Failed to update user profile:`, updateError.message);
                }
            }

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
            let updatedConversationId = null;

            for (let index = 0; index < candidateConversations.length; index += 1) {
                const candidate = candidateConversations[index];

                try {
                    const result = await freshchatClient.sendMessage(
                        candidate.id,
                        mapping.freshchatUserId,
                        hasTextContent ? messageText : '',
                        freshchatAttachments,
                        { hydrationConversationIds }
                    );

                    // Check if conversation ID was updated (resolved -> new conversation)
                    if (result._updatedConversationId) {
                        updatedConversationId = result._updatedConversationId;
                        console.log(`[Freshchat] Conversation auto-updated to: ${updatedConversationId}`);
                    }

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

            // Update mapping if conversation ID changed (resolved -> new conversation)
            if (updatedConversationId) {
                console.log(`[Mapping] Updating conversation ID from ${guidConversationId || numericConversationId} to ${updatedConversationId}`);

                await conversationStore.update(teamsConvId, {
                    freshchatConversationGuid: updatedConversationId,
                    freshchatConversationNumericId: updatedConversationId
                });

                console.log(`[Mapping] Conversation ID updated successfully`);
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
app.get('/', async (req, res) => {
    try {
        const [activeCount, sampleMappings] = await Promise.all([
            conversationStore.count(),
            conversationStore.list(10)
        ]);

        res.json({
            status: 'running',
            service: 'Teams ↔ Freshchat Bridge (PoC)',
            timestamp: new Date().toISOString(),
            mappings: {
                active: activeCount,
                sample: sampleMappings.map((entry) => ({
                    teamsConversationId: entry.teamsConversationId,
                    freshchatConversationId: entry.mapping.freshchatConversationNumericId || null,
                    freshchatConversationGuid: entry.mapping.freshchatConversationGuid || null
                })),
                localCacheSize: conversationStore.localSize
            }
        });
    } catch (error) {
        console.error('[Health] Failed to assemble status:', error.message);
        res.status(500).json({
            status: 'error',
            message: 'Failed to retrieve mapping summary'
        });
    }
});

/**
 * Get access token for Microsoft Graph API
 */
async function getGraphAccessToken(tenantId = null) {
    try {
        // Use the provided tenantId, or fall back to BOT_TENANT_ID (but not 'common' for client_credentials)
        const targetTenant = tenantId || (BOT_TENANT_ID !== 'common' ? BOT_TENANT_ID : 'organizations');
        const tokenEndpoint = `https://login.microsoftonline.com/${targetTenant}/oauth2/v2.0/token`;
        const response = await axios.post(tokenEndpoint, new URLSearchParams({
            client_id: BOT_APP_ID,
            client_secret: BOT_APP_PASSWORD,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        return response.data.access_token;
    } catch (error) {
        console.error(`[Graph API] Failed to get access token:`, error.response?.data || error.message);
        throw error;
    }
}

/**
 * Fetch HTML content from SharePoint or OneDrive
 * Supports both authenticated Graph API access and public share links
 */
/**
 * Get help tab content from local file
 */
function getHelpTabContent() {
    const htmlPath = path.join(__dirname, 'public', 'help-tab.html');
    return fs.readFileSync(htmlPath, 'utf8');
}


/**
 * Teams Tab Configuration endpoint
 */
app.get('/tab-config', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <script src="https://res.cdn.office.net/teams-js/2.0.0/js/MicrosoftTeams.min.js"></script>
</head>
<body>
    <script>
        microsoftTeams.app.initialize().then(() => {
            microsoftTeams.pages.config.registerOnSaveHandler((saveEvent) => {
                microsoftTeams.pages.config.setConfig({
                    entityId: "helpResources",
                    contentUrl: "${PUBLIC_URL || 'https://freshchat-bridge.fly.dev'}/tab-content",
                    suggestedDisplayName: "도움말",
                    websiteUrl: "${PUBLIC_URL || 'https://freshchat-bridge.fly.dev'}/tab-content"
                });
                saveEvent.notifySuccess();
            });
            
            microsoftTeams.pages.config.setValidityState(true);
        });
    </script>
</body>
</html>
    `);
});

/**
 * Teams Tab Content endpoint
 */
app.get('/tab-content', async (req, res) => {
    try {
        // Allow iframe embedding in Teams
        res.setHeader('Content-Security-Policy', "frame-ancestors teams.microsoft.com *.teams.microsoft.com *.skype.com");
        res.setHeader('X-Frame-Options', 'ALLOW-FROM https://teams.microsoft.com');
        
        const htmlContent = await getHelpTabContent();
        res.send(htmlContent);
    } catch (error) {
        console.error(`[Tab Content] Error loading HTML:`, error);

        // Send fallback error page
        res.status(500).send(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>오류 발생</title>
    <script src="https://res.cdn.office.net/teams-js/2.0.0/js/MicrosoftTeams.min.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f5f5f5;
            margin: 0;
            padding: 20px;
        }
        .error-container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 2px 16px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
        }
        h1 { color: #d32f2f; font-size: 24px; margin-bottom: 16px; }
        p { color: #666; line-height: 1.6; margin-bottom: 24px; }
        .retry-btn {
            background: #6b7280;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            font-weight: 600;
        }
        .retry-btn:hover { background: #7f8694; }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>⚠️ 도움말을 불러올 수 없습니다</h1>
        <p>일시적인 오류로 도움말 페이지를 표시할 수 없습니다.<br>잠시 후 다시 시도해 주세요.</p>
        <button class="retry-btn" onclick="location.reload()">다시 시도</button>
    </div>
    <script>microsoftTeams.app.initialize();</script>
</body>
</html>
        `);
    }
});

/**
 * Manual cache refresh endpoint for help tab
 */
app.post('/tab-content/refresh', async (req, res) => {
    try {
        console.log(`[Help Tab] Manual cache refresh requested`);
        helpTabCache = null; // Clear cache
        const content = await getHelpTabContent();
        res.json({
            success: true,
            message: 'Help tab cache refreshed successfully',
            contentLength: content.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`[Help Tab] Cache refresh failed:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Admin consent endpoint - redirects to Azure AD consent page
 * This allows customer admins to grant organization-wide consent for Graph API permissions
 */
app.get('/auth/admin-consent', (req, res) => {
    const tenantId = BOT_TENANT_ID || 'common';
    const clientId = BOT_APP_ID;
    const redirectUri = encodeURIComponent(`${PUBLIC_URL}/auth/admin-consent/callback`);

    const consentUrl = `https://login.microsoftonline.com/${tenantId}/adminconsent` +
        `?client_id=${clientId}` +
        `&redirect_uri=${redirectUri}` +
        `&state=${Date.now()}`;

    console.log(`[Admin Consent] Redirecting to: ${consentUrl}`);
    res.redirect(consentUrl);
});

/**
 * Admin consent callback endpoint
 */
app.get('/auth/admin-consent/callback', (req, res) => {
    const { error, error_description, admin_consent, tenant } = req.query;

    if (error) {
        console.error(`[Admin Consent] Error:`, error, error_description);
        return res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>권한 승인 실패</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f5f5f5;
            margin: 0;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 2px 16px rgba(0,0,0,0.1);
            max-width: 600px;
        }
        h1 { color: #d32f2f; font-size: 24px; margin-bottom: 16px; }
        p { color: #666; line-height: 1.6; margin-bottom: 16px; }
        .error-code { background: #f5f5f5; padding: 12px; border-radius: 6px; font-family: monospace; }
    </style>
</head>
<body>
    <div class="container">
        <h1>❌ 권한 승인 실패</h1>
        <p>관리자 권한 승인 중 오류가 발생했습니다.</p>
        <div class="error-code">
            <strong>오류:</strong> ${error}<br>
            <strong>설명:</strong> ${error_description || '알 수 없는 오류'}
        </div>
        <p style="margin-top: 24px;">IT 관리자에게 문의하시거나, Azure Portal에서 직접 권한을 부여해 주세요.</p>
    </div>
</body>
</html>
        `);
    }

    if (admin_consent === 'True') {
        console.log(`[Admin Consent] Success for tenant: ${tenant}`);
        return res.send(`
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>권한 승인 완료</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background: #f5f5f5;
            margin: 0;
            padding: 20px;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 2px 16px rgba(0,0,0,0.1);
            max-width: 600px;
            text-align: center;
        }
        h1 { color: #2e7d32; font-size: 28px; margin-bottom: 16px; }
        p { color: #666; line-height: 1.6; margin-bottom: 16px; }
        .success-icon { font-size: 64px; margin-bottom: 24px; }
        .info-box {
            background: #e8f5e9;
            border-left: 4px solid #2e7d32;
            padding: 16px;
            text-align: left;
            border-radius: 6px;
            margin-top: 24px;
        }
        .info-box strong { color: #1b5e20; }
        ul { text-align: left; color: #666; margin-top: 12px; }
        li { margin-bottom: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✅</div>
        <h1>권한 승인 완료!</h1>
        <p>EXO헬프 앱이 조직 전체에서 필요한 권한을 성공적으로 획득했습니다.</p>
        <div class="info-box">
            <strong>부여된 권한:</strong>
            <ul>
                <li>📋 <strong>User.Read.All</strong> - 사용자 프로필 정보 읽기</li>
                <li>📁 <strong>Sites.Read.All</strong> - SharePoint 파일 읽기</li>
                <li>👥 <strong>Team.ReadBasic.All</strong> - Teams 정보 읽기</li>
            </ul>
        </div>
        <p style="margin-top: 24px; font-size: 14px; color: #999;">
            이제 이 창을 닫으셔도 됩니다. Teams 앱에서 정상적으로 사용자 정보와 도움말 탭이 표시됩니다.
        </p>
    </div>
</body>
</html>
        `);
    }

    res.status(400).send('Invalid consent response');
});

/**
 * Check current Graph API permissions status
 */
app.get('/auth/permissions-status', async (req, res) => {
    try {
        const accessToken = await getGraphAccessToken();

        // Try to test each permission by making a sample call
        const permissions = {
            'User.Read.All': { granted: false, tested: false },
            'Sites.Read.All': { granted: false, tested: false },
            'Team.ReadBasic.All': { granted: false, tested: false }
        };

        // Test User.Read.All
        try {
            await axios.get('https://graph.microsoft.com/v1.0/users?$top=1', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            permissions['User.Read.All'].granted = true;
            permissions['User.Read.All'].tested = true;
        } catch (error) {
            permissions['User.Read.All'].tested = true;
            permissions['User.Read.All'].error = error.response?.status || error.message;
        }

        // Test Sites.Read.All (if configured)
        if (HELP_TAB_SOURCE === 'sharepoint' && HELP_TAB_FILE_URL) {
            try {
                await fetchHelpTabFromSharePoint(HELP_TAB_FILE_URL);
                permissions['Sites.Read.All'].granted = true;
                permissions['Sites.Read.All'].tested = true;
            } catch (error) {
                permissions['Sites.Read.All'].tested = true;
                permissions['Sites.Read.All'].error = error.response?.status || error.message;
            }
        }

        res.json({
            success: true,
            tenant: BOT_TENANT_ID,
            permissions,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message,
            hint: 'Failed to get access token. Check BOT_APP_ID and BOT_APP_PASSWORD in .env'
        });
    }
});

/**
 * Bot Framework endpoint - receives messages from Teams
 */
const processBotRequest = async (req, res) => {
    await adapter.process(req, res, async (context) => {
        if (context.activity.type === 'message') {
            await handleTeamsMessage(context);
        } else if (context.activity.type === 'conversationUpdate') {
            // Log conversation events
            if (context.activity.membersAdded) {
                console.log(`[Bot] Members added:`, context.activity.membersAdded.length);
            }
            if (context.activity.membersRemoved) {
                console.log(`[Bot] Members removed:`, context.activity.membersRemoved.length);
            }
            // Note: Freshchat conversation will be created on first user message
            // This allows Freshchat channel welcome message to trigger properly
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
        
        // Debug: Log payload information
        console.log('[Security] Raw body available:', typeof req.rawBody === 'string' && req.rawBody.length > 0);
        console.log('[Security] Payload source:', req.rawBody?.length > 0 ? 'rawBody' : 'JSON.stringify');
        console.log('[Security] Payload sample:', rawPayload.substring(0, 200) + '...');
        
        const signatureValid = verifyFreshchatSignature(rawPayload, signature);
        if (!signatureValid) {
            console.error('[Security] ⚠️ Webhook signature verification failed');
            if (FRESHCHAT_WEBHOOK_SIGNATURE_STRICT) {
                console.warn('[Security] ⚠️ Signature verification failed, but proceeding to process message (strict mode bypassed)');
                // Temporarily bypassed: return res.status(401).json({ error: 'Invalid signature' });
            } else {
                console.warn('[Security] Proceeding despite invalid signature because FRESHCHAT_WEBHOOK_SIGNATURE_STRICT=false');
            }
        } else {
            console.log('[Security] ✅ Webhook signature verified successfully');
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
                console.log(`[Freshchat] Payload missing freshchat_conversation_id - cannot route message`);
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
            let teamsConvId = await conversationStore.getTeamsIdByFreshchat(freshchatConversationId);
            if (!teamsConvId && conversationGuid) {
                teamsConvId = await conversationStore.getTeamsIdByFreshchat(conversationGuid);
            }

            // If no mapping found in memory, try to restore from Freshchat conversation properties
            if (!teamsConvId) {
                console.log(`[Freshchat] No Teams mapping found in memory for conversation: ${freshchatConversationId}`);
                console.log(`[Freshchat] Attempting to restore Teams data from conversation properties...`);

                // Try to get Teams data from conversation properties
                // First try numeric ID (Freshchat API only accepts numeric IDs for GET /conversations/{id})
                let teamsData = await freshchatClient.getConversationTeamsData(freshchatConversationId);

                // If GUID is different from numeric ID and first attempt failed, try GUID as fallback
                if (!teamsData && conversationGuid && conversationGuid !== freshchatConversationId) {
                    console.log(`[Freshchat] Retrying with GUID: ${conversationGuid}`);
                    teamsData = await freshchatClient.getConversationTeamsData(conversationGuid);
                }

                if (teamsData) {
                    teamsConvId = teamsData.teamsConvId;
                    console.log(`[Freshchat] ✅ Restored Teams conversation ID from conversation properties: ${teamsConvId}`);

                    // Restore full mapping to memory
                    await updateConversationMapping(teamsConvId, {
                        freshchatConversationGuid: conversationGuid || null,
                        freshchatConversationNumericId: freshchatConversationId,
                        conversationReference: teamsData.conversationReference
                    });

                    console.log(`[Mapping] Restored from Freshchat: Teams(${teamsConvId}) ↔ Freshchat(${freshchatConversationId})`);
                } else {
                    // Fallback: try user properties (legacy method)
                    const freshchatUserId = message.user_id || data.user_id;
                    if (freshchatUserId) {
                        console.log(`[Freshchat] Attempting to retrieve Teams conversation ID from user properties (user: ${freshchatUserId})`);
                        teamsConvId = await freshchatClient.getUserTeamsConversation(freshchatUserId);

                        if (teamsConvId) {
                            console.log(`[Freshchat] ⚠️ Found Teams conversation ID from user properties: ${teamsConvId}`);
                            console.log(`[Freshchat] ⚠️ Missing conversation reference - user needs to send a message to restore full mapping`);
                            // Restore mapping to memory/Redis for future use
                            await conversationStore.rememberFreshchatLink(freshchatConversationId, teamsConvId);
                            if (conversationGuid) {
                                await conversationStore.rememberFreshchatLink(conversationGuid, teamsConvId);
                            }
                        }
                    }
                }
            }

            if (!teamsConvId) {
                console.log(`[Freshchat] ℹ️  No Teams mapping found for conversation: ${freshchatConversationId}`);
                console.log(`[Freshchat] ℹ️  This conversation was likely started from a different channel (not Teams)`);
                console.log(`[Freshchat] ℹ️  Actor type: ${actorType} - Skipping message forwarding to Teams`);

                // Notify agent about delivery failure (only for agent messages)
                if (actorType === 'agent') {
                    try {
                        // Freshchat API는 숫자 ID를 우선 사용
                        let notificationSent = false;
                        
                        // 1차 시도: 숫자 ID 사용
                        if (freshchatConversationId) {
                            try {
                                console.log(`[Freshchat] Sending delivery failure notification to conversation (numeric ID): ${freshchatConversationId}`);
                                await freshchatClient.axiosInstance.post(`/conversations/${freshchatConversationId}/messages`, {
                                    message_parts: [{
                                        text: {
                                            content: `⚠️ **Teams 메시지 전송 실패**\n\n서버가 재시작되어 대화 매핑 정보가 손실되었습니다.\n\n**해결 방법**: 사용자가 Teams에서 새로운 메시지를 보내면 대화가 복구됩니다.`
                                        }
                                    }],
                                    actor_type: 'system'
                                });
                                notificationSent = true;
                                console.log(`[Freshchat] ✅ Delivery failure notification sent successfully (numeric ID)`);
                            } catch (numericError) {
                                console.warn(`[Freshchat] Failed with numeric ID (${numericError.response?.status}): ${numericError.message}`);
                            }
                        }
                        
                        // 2차 시도: GUID 사용 (1차 실패 시)
                        if (!notificationSent && conversationGuid) {
                            try {
                                console.log(`[Freshchat] Retrying delivery failure notification with GUID: ${conversationGuid}`);
                                await freshchatClient.axiosInstance.post(`/conversations/${conversationGuid}/messages`, {
                                    message_parts: [{
                                        text: {
                                            content: `⚠️ **Teams 메시지 전송 실패**\n\n서버가 재시작되어 대화 매핑 정보가 손실되었습니다.\n\n**해결 방법**: 사용자가 Teams에서 새로운 메시지를 보내면 대화가 복구됩니다.`
                                        }
                                    }],
                                    actor_type: 'system'
                                });
                                notificationSent = true;
                                console.log(`[Freshchat] ✅ Delivery failure notification sent successfully (GUID)`);
                            } catch (guidError) {
                                console.warn(`[Freshchat] Failed with GUID (${guidError.response?.status}): ${guidError.message}`);
                            }
                        }
                        
                        if (!notificationSent) {
                            console.error(`[Freshchat] ❌ CRITICAL: Could not send delivery failure notification to agent`);
                            console.error(`[Freshchat] ❌ Agent will NOT know that message delivery failed!`);
                            console.error(`[Freshchat] ❌ Conversation IDs tried: numeric=${freshchatConversationId}, guid=${conversationGuid}`);
                        }
                    } catch (notificationError) {
                        console.error(`[Freshchat] ❌ CRITICAL: Unexpected error sending failure notification:`, notificationError.message);
                    }
                }

                return res.sendStatus(200);
            }

            let mapping = await conversationStore.get(teamsConvId);
            if (!mapping) {
                console.log(`[Freshchat] ⚠️  Mapping data missing for Teams conversation: ${teamsConvId}`);
                console.log(`[Freshchat] ⚠️  Attempting to restore conversation reference...`);

                // We have teamsConvId but no full mapping - need to get conversation reference
                // This can happen after server restart
                // For now, we'll skip this message and wait for user to send a new message from Teams
                console.log(`[Freshchat] ⚠️  Cannot send message without conversation reference. User needs to send a message from Teams first.`);

                // Notify agent about missing conversation reference (only for agent messages)
                if (actorType === 'agent') {
                    try {
                        let notificationSent = false;
                        
                        // 1차 시도: 숫자 ID 사용
                        if (freshchatConversationId) {
                            try {
                                console.log(`[Freshchat] Sending missing reference notification to conversation (numeric ID): ${freshchatConversationId}`);
                                await freshchatClient.axiosInstance.post(`/conversations/${freshchatConversationId}/messages`, {
                                    message_parts: [{
                                        text: {
                                            content: `⚠️ **Teams 메시지 전송 실패**\n\n서버가 재시작되어 대화 연결 정보가 손실되었습니다.\n\n**해결 방법**: 사용자가 Teams에서 새로운 메시지를 보내면 대화가 복구됩니다.`
                                        }
                                    }],
                                    actor_type: 'system'
                                });
                                notificationSent = true;
                                console.log(`[Freshchat] ✅ Missing reference notification sent successfully (numeric ID)`);
                            } catch (numericError) {
                                console.warn(`[Freshchat] Failed with numeric ID (${numericError.response?.status}): ${numericError.message}`);
                            }
                        }
                        
                        // 2차 시도: GUID 사용 (1차 실패 시)
                        if (!notificationSent && conversationGuid) {
                            try {
                                console.log(`[Freshchat] Retrying missing reference notification with GUID: ${conversationGuid}`);
                                await freshchatClient.axiosInstance.post(`/conversations/${conversationGuid}/messages`, {
                                    message_parts: [{
                                        text: {
                                            content: `⚠️ **Teams 메시지 전송 실패**\n\n서버가 재시작되어 대화 연결 정보가 손실되었습니다.\n\n**해결 방법**: 사용자가 Teams에서 새로운 메시지를 보내면 대화가 복구됩니다.`
                                        }
                                    }],
                                    actor_type: 'system'
                                });
                                notificationSent = true;
                                console.log(`[Freshchat] ✅ Missing reference notification sent successfully (GUID)`);
                            } catch (guidError) {
                                console.warn(`[Freshchat] Failed with GUID (${guidError.response?.status}): ${guidError.message}`);
                            }
                        }
                        
                        if (!notificationSent) {
                            console.error(`[Freshchat] ❌ CRITICAL: Could not send missing reference notification to agent`);
                            console.error(`[Freshchat] ❌ Agent will NOT know that message delivery failed!`);
                            console.error(`[Freshchat] ❌ Conversation IDs tried: numeric=${freshchatConversationId}, guid=${conversationGuid}`);
                        }
                    } catch (notificationError) {
                        console.error(`[Freshchat] ❌ CRITICAL: Unexpected error sending failure notification:`, notificationError.message);
                    }
                }

                return res.sendStatus(200);
            }

            mapping = await updateConversationMapping(teamsConvId, {
                freshchatConversationNumericId: freshchatConversationId,
                freshchatConversationGuid: mapping.freshchatConversationGuid || (conversationGuid ? String(conversationGuid) : undefined)
            });

            // Only process agent messages (not user messages)
            const allowedActorTypes = new Set(['agent', 'system', 'bot']);
            if (!allowedActorTypes.has(actorType)) {
                console.log(`[Freshchat] Ignoring message from actor type: ${actorType}`);
                return res.sendStatus(200);
            }

            const primaryTextPart = message.message_parts?.find((part) => part?.text);
            const primaryTextContent = primaryTextPart?.text?.content ? String(primaryTextPart.text.content).trim() : '';
            const isFreshchatWelcome = actorType === 'system'
                && (primaryTextContent === '.' || primaryTextContent === '' || primaryTextContent === '•');

            if (isFreshchatWelcome) {
                console.log(`[Freshchat] Detected Freshchat system welcome message - suppressing default dot payload`);

                if (CUSTOM_GREETING_ENABLED && !mapping.greetingSent && mapping.conversationReference) {
                    try {
                        await adapter.continueConversation(
                            mapping.conversationReference,
                            async (turnContext) => {
                                await turnContext.sendActivity(CUSTOM_GREETING_MESSAGE);
                            }
                        );
                        await updateConversationMapping(teamsConvId, { greetingSent: true });
                        console.log(`[Freshchat] Custom welcome message sent to Teams conversation`);
                    } catch (proactiveError) {
                        console.error(`[Freshchat] Failed to send custom welcome message:`, proactiveError.message);
                    }
                }

                if (messageId) {
                    markFreshchatMessageProcessed(messageId);
                }

                return res.sendStatus(200);
            }

            // Block private/internal messages from being sent to Teams
            const messageType = message.message_type;
            const isPrivateNote = message.botsPrivateNote === true;
            if (messageType === 'private' || isPrivateNote) {
                console.log(`[Freshchat] Skipping private/internal message (message_type: ${messageType}, botsPrivateNote: ${isPrivateNote})`);
                return res.sendStatus(200);
            }

            // Extract message text and files
            let messageText = '';
            const attachmentParts = [];

            if (message.message_parts && message.message_parts.length > 0) {
                console.log(`[Freshchat] Message parts:`, JSON.stringify(message.message_parts, null, 2));
                for (const part of message.message_parts) {
                    if (part.text?.content) {
                        console.log(`[Freshchat] Text content:`, part.text.content);
                        messageText = messageText
                            ? `${messageText}\n${part.text.content}`
                            : part.text.content;
                    }

                    if (part.file) {
                        // Extract file extension: prioritize file_extension field, then contentType, then filename
                        let fileName = part.file.name || 'file';
                        const fileExtension = part.file.file_extension || part.file.fileExtension;
                        const contentType = part.file.content_type || part.file.contentType || 'application/octet-stream';

                        // If we have a file_extension but the filename doesn't have the correct extension, fix it
                        if (fileExtension) {
                            const hasExtension = fileName.includes('.');
                            if (!hasExtension || !fileName.endsWith(`.${fileExtension}`)) {
                                // Remove any existing extension and add the correct one
                                const nameWithoutExt = hasExtension ? fileName.substring(0, fileName.lastIndexOf('.')) : fileName;
                                fileName = `${nameWithoutExt}.${fileExtension}`;
                                console.log(`[Freshchat] Fixed file extension: ${part.file.name} → ${fileName}`);
                            }
                        } else if (!fileName.includes('.')) {
                            // No file_extension provided and filename has no extension, try to derive from contentType
                            const derivedExt = contentType ? mime.extension(contentType) : null;
                            if (derivedExt) {
                                fileName = `${fileName}.${derivedExt}`;
                                console.log(`[Freshchat] Added extension from contentType: ${fileName}`);
                            }
                        }

                        attachmentParts.push({
                            name: fileName,
                            contentType: contentType,
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
                console.log(`[Freshchat] Fetching message details for attachment hydration...`);
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
                    console.error(`[Teams] PUBLIC_URL is not set. Cannot process attachments from Freshchat.`);
                    messageText += `\n\n⚠️ 첨부파일을 처리할 수 없습니다: 서버 구성 오류.`;
                } else {
                    for (const attachment of attachmentParts) {
                        try {
                            if (!attachment.url) {
                                downloadFailures.push(attachment.name || '알 수 없는 파일');
                                continue;
                            }

                            const contentType = (attachment.contentType || attachment.content_type || '').toLowerCase();
                            const isImage = contentType.startsWith('image/');
                            const displayName = attachment.name || '파일';

                            if (isImage) {
                                // Use Freshchat original URL directly for images (permanent, no download needed)
                                attachmentLinks.push(`![${displayName}](${attachment.url})`);
                            } else {
                                // Download files for Adaptive Card preview
                                const fileData = await freshchatClient.downloadFile(attachment.url);
                                const filename = `${Date.now()}-${(attachment.name || fileData.filename || 'freshchat-file').replace(/[^a-zA-Z0-9.\-_]/g, '')}`;
                                const filepath = path.join(UPLOADS_DIR, filename);
                                fs.writeFileSync(filepath, fileData.buffer);

                                const publicUrl = `${PUBLIC_URL.replace(/\/$/, '')}/files/${filename}`;
                                const fileSize = fileData.buffer.length;
                                const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
                                
                                // Determine file icon based on content type
                                const fileContentType = (fileData.contentType || attachment.contentType || '').toLowerCase();
                                let fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/3767/3767084.png'; // default file icon
                                
                                if (fileContentType.includes('pdf')) {
                                    fileIconUrl = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/PDF_file_icon.svg/195px-PDF_file_icon.svg.png';
                                } else if (fileContentType.includes('word') || fileContentType.includes('document')) {
                                    fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/2965/2965350.png';
                                } else if (fileContentType.includes('excel') || fileContentType.includes('spreadsheet')) {
                                    fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/2965/2965383.png';
                                } else if (fileContentType.includes('powerpoint') || fileContentType.includes('presentation')) {
                                    fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/2965/2965416.png';
                                } else if (fileContentType.includes('text')) {
                                    fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/3767/3767084.png';
                                } else if (fileContentType.includes('zip') || fileContentType.includes('compressed')) {
                                    fileIconUrl = 'https://cdn-icons-png.flaticon.com/512/3143/3143615.png';
                                }

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
                console.log(`[Freshchat] No content found in message`);
                return res.sendStatus(200);
            }

            // Send message to Teams
            await adapter.continueConversation(
                mapping.conversationReference,
                async (turnContext) => {
                    // Get agent name for the message sender (appears in Teams as sender name)
                    let senderName;
                    if (actorType === 'agent' && message.actor_id) {
                        senderName = await freshchatClient.getAgentName(message.actor_id);
                    } else {
                        const actorLabelMap = { agent: '지원팀', system: 'EXO Help', bot: '봇 메시지' };
                        senderName = actorLabelMap[actorType] || 'Freshchat Update';
                    }

                    // Compose message text with agent name prefix
                    let composedText = '';

                    if (messageText) {
                        composedText = `👤 **${senderName}**\n\n${messageText}`;
                    }

                    if (attachmentLinks.length > 0) {
                        const links = attachmentLinks.join('\n');
                        if (composedText) {
                            composedText = `${composedText}\n\n${links}`;
                        } else {
                            // Attachment only, still show sender name
                            composedText = `👤 **${senderName}**\n\n${links}`;
                        }
                    }

                    // Send text message with sender name in activity
                    if (composedText) {
                        await turnContext.sendActivity({
                            type: 'message',
                            text: composedText,
                            from: {
                                id: turnContext.activity.recipient.id,
                                name: senderName
                            },
                            timestamp: new Date().toISOString(),
                            channelData: {
                                clientActivityId: `${Date.now()}-${Math.random()}`
                            }
                        });
                    }

                    // Send file cards separately with sender name
                    if (fileCards.length > 0) {
                        for (const card of fileCards) {
                            await turnContext.sendActivity({
                                attachments: [card],
                                from: {
                                    id: turnContext.activity.recipient.id,
                                    name: senderName
                                },
                                timestamp: new Date().toISOString(),
                                channelData: {
                                    clientActivityId: `${Date.now()}-${Math.random()}`
                                }
                            });
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

        // Notify agent in Freshchat about Teams delivery failure
        try {
            const { data } = req.body;
            const message = data?.message;
            const conversationGuid = data?.conversation_id || message?.conversation_id || null;
            const freshchatConversationId = message?.freshchat_conversation_id
                ? String(message.freshchat_conversation_id)
                : data?.freshchat_conversation_id
                    ? String(data.freshchat_conversation_id)
                    : null;

            if (freshchatConversationId) {
                const errorMessage = error.message || 'Unknown error';
                const errorStatus = error.response?.status || 'N/A';
                let notificationSent = false;

                // 1차 시도: 숫자 ID 사용
                try {
                    console.log(`[Freshchat] Sending delivery failure notification to conversation (numeric ID): ${freshchatConversationId}`);
                    await freshchatClient.axiosInstance.post(`/conversations/${freshchatConversationId}/messages`, {
                        message_parts: [{
                            text: {
                                content: `⚠️ **Teams 메시지 전송 실패**\n\n사용자에게 메시지를 전달하지 못했습니다.\n\n**오류**: ${errorMessage}\n**상태 코드**: ${errorStatus}\n\n사용자가 Teams에서 새로운 메시지를 보내면 다시 시도됩니다.`
                            }
                        }],
                        actor_type: 'system'
                    });
                    notificationSent = true;
                    console.log(`[Freshchat] ✅ Delivery failure notification sent successfully (numeric ID)`);
                } catch (numericError) {
                    console.warn(`[Freshchat] Failed with numeric ID (${numericError.response?.status}): ${numericError.message}`);
                }

                // 2차 시도: GUID 사용 (1차 실패 시)
                if (!notificationSent && conversationGuid) {
                    try {
                        console.log(`[Freshchat] Retrying delivery failure notification with GUID: ${conversationGuid}`);
                        await freshchatClient.axiosInstance.post(`/conversations/${conversationGuid}/messages`, {
                            message_parts: [{
                                text: {
                                    content: `⚠️ **Teams 메시지 전송 실패**\n\n사용자에게 메시지를 전달하지 못했습니다.\n\n**오류**: ${errorMessage}\n**상태 코드**: ${errorStatus}\n\n사용자가 Teams에서 새로운 메시지를 보내면 다시 시도됩니다.`
                                }
                            }],
                            actor_type: 'system'
                        });
                        notificationSent = true;
                        console.log(`[Freshchat] ✅ Delivery failure notification sent successfully (GUID)`);
                    } catch (guidError) {
                        console.warn(`[Freshchat] Failed with GUID (${guidError.response?.status}): ${guidError.message}`);
                    }
                }
                
                if (!notificationSent) {
                    console.error(`[Freshchat] ❌ CRITICAL: Could not send delivery failure notification to agent`);
                    console.error(`[Freshchat] ❌ Agent will NOT know that Teams message delivery failed!`);
                    console.error(`[Freshchat] ❌ Conversation IDs tried: numeric=${freshchatConversationId}, guid=${conversationGuid}`);
                }
            }
        } catch (notificationError) {
            console.error(`[Freshchat] ❌ CRITICAL: Unexpected error sending failure notification:`, notificationError.message);
        }

        res.sendStatus(500);
    }
});

/**
 * Debug endpoint - view current mappings
 */
app.get('/debug/mappings', async (req, res) => {
    try {
        const mappings = await conversationStore.list(100);
        res.json({
            totalMappings: mappings.length,
            source: redisClient ? 'redis' : 'memory',
            mappings: mappings.map((entry) => ({
                teamsConversationId: entry.teamsConversationId,
                freshchatConversationId: entry.mapping.freshchatConversationNumericId,
                freshchatConversationGuid: entry.mapping.freshchatConversationGuid,
                freshchatUserId: entry.mapping.freshchatUserId
            }))
        });
    } catch (error) {
        console.error('[Debug] Failed to list mappings:', error.message);
        res.status(500).json({
            error: 'Failed to list mappings'
        });
    }
});

/**
 * Reset mappings endpoint (for testing)
 */
app.post('/debug/reset', async (req, res) => {
    await conversationStore.clearAll();
    console.log('[Debug] All mappings cleared (memory and Redis)');
    res.json({ message: 'All mappings cleared' });
});

// ============================================================================
// Server Start
// ============================================================================

const server = app.listen(PORT, () => {
    const timestamp = new Date().toISOString();
    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                        ║');
    console.log('║        🚀 Teams ↔ Freshchat Bridge Server - STARTED                   ║');
    console.log('║                                                                        ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`⏰ Timestamp: ${timestamp}`);
    console.log(`🌐 Port: ${PORT}`);
    console.log(`� Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
    console.log('📍 Available Endpoints:');
    console.log(`   • Bot callback:    http://localhost:${PORT}/bot/callback`);
    console.log(`   • Webhook:         http://localhost:${PORT}/freshchat/webhook`);
    console.log(`   • Health check:    http://localhost:${PORT}/`);
    console.log(`   • Debug mappings:  http://localhost:${PORT}/debug/mappings`);
    console.log('');
    console.log('⚠️  Configuration Checklist:');
    console.log('   ✓ Update Azure Bot messaging endpoint with Fly.io URL');
    console.log('   ✓ Configure Freshchat webhook with Fly.io URL');
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('');
});

// ============================================================================
// Graceful Shutdown
// ============================================================================

const gracefulShutdown = (signal) => {
    const timestamp = new Date().toISOString();
    console.log('\n\n');
    console.log('╔════════════════════════════════════════════════════════════════════════╗');
    console.log('║                                                                        ║');
    console.log('║        🛑 Teams ↔ Freshchat Bridge Server - SHUTTING DOWN             ║');
    console.log('║                                                                        ║');
    console.log('╚════════════════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`⏰ Timestamp: ${timestamp}`);
    console.log(`📡 Signal: ${signal}`);
    console.log(`💾 Local cache conversation mappings: ${conversationStore.localSize}`);
    console.log('');
    
    const snapshot = conversationStore.getLocalSnapshot(20);
    if (snapshot.length > 0) {
        console.log('📋 Active Conversations:');
        for (const entry of snapshot) {
            const teamsId = entry.teamsConversationId;
            const mapping = entry.mapping;
            console.log(`   • Teams: ${teamsId.substring(0, 20)}... ↔ Freshchat: ${mapping.freshchatConversationNumericId || mapping.freshchatConversationGuid}`);
        }
        console.log('');
    }
    
    server.close(() => {
        console.log('✅ Server closed successfully');
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════════════');
        console.log('');
        process.exit(0);
    });
    
    // Force shutdown after 10 seconds
    setTimeout(() => {
        console.error('⚠️  Force shutdown - server did not close gracefully within 10 seconds');
        process.exit(1);
    }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
