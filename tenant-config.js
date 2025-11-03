/**
 * Multi-Tenant Configuration Manager
 * 
 * Supports:
 * 1. Single tenant mode (current setup via .env)
 * 2. Multi-tenant mode (JSON config file or future DB)
 * 
 * Migration path: .env → JSON file → Database
 */

const fs = require('fs');
const path = require('path');

class TenantConfigManager {
    constructor() {
        this.tenants = new Map();
        this.mode = process.env.TENANT_MODE || 'single'; // 'single' or 'multi'
        this.configPath = process.env.TENANT_CONFIG_PATH || path.join(__dirname, 'tenants.json');
        this.initialized = false;
    }

    /**
     * Initialize tenant configurations
     */
    initialize() {
        if (this.initialized) {
            return;
        }

        if (this.mode === 'single') {
            this._loadSingleTenantFromEnv();
        } else {
            this._loadMultiTenantFromFile();
        }

        this.initialized = true;
        console.log(`[TenantConfig] Initialized in ${this.mode} mode with ${this.tenants.size} tenant(s)`);
    }

    /**
     * Load single tenant configuration from environment variables (current setup)
     */
    _loadSingleTenantFromEnv() {
        const tenantId = process.env.DEFAULT_TENANT_ID || 'default';
        
        const config = {
            tenantId,
            name: process.env.TENANT_NAME || 'Default Tenant',
            bot: {
                appId: process.env.BOT_APP_ID,
                appPassword: process.env.BOT_APP_PASSWORD,
                tenantId: process.env.BOT_TENANT_ID
            },
            freshchat: {
                apiKey: process.env.FRESHCHAT_API_KEY,
                apiUrl: process.env.FRESHCHAT_API_URL,
                inboxId: process.env.FRESHCHAT_INBOX_ID,
                webhookPublicKey: process.env.FRESHCHAT_WEBHOOK_PUBLIC_KEY,
                webhookSignatureStrict: process.env.FRESHCHAT_WEBHOOK_SIGNATURE_STRICT !== 'false'
            },
            settings: {
                welcomeMessage: process.env.WELCOME_MESSAGE || '👋 안녕하세요! 지원팀입니다.\n궁금하신 점이나 도움이 필요하신 사항을 메시지로 보내주시면 신속하게 답변드리겠습니다.',
                publicUrl: process.env.PUBLIC_URL,
                uploadsDir: process.env.UPLOADS_DIR || 'uploads'
            },
            branding: {
                botName: process.env.BOT_NAME || 'IT 지원센터',
                botDescription: process.env.BOT_DESCRIPTION || 'IT 지원센터 헬프데스크',
                accentColor: process.env.BOT_ACCENT_COLOR || '#FFFFFF',
                iconColor: process.env.BOT_ICON_COLOR || 'color.png',
                iconOutline: process.env.BOT_ICON_OUTLINE || 'outline.png'
            },
            createdAt: new Date().toISOString(),
            active: true
        };

        this.tenants.set(tenantId, config);
        this.defaultTenantId = tenantId;
    }

    /**
     * Load multi-tenant configuration from JSON file
     */
    _loadMultiTenantFromFile() {
        try {
            if (!fs.existsSync(this.configPath)) {
                console.warn(`[TenantConfig] Config file not found: ${this.configPath}`);
                console.warn('[TenantConfig] Creating example config file...');
                this._createExampleConfig();
                return;
            }

            const configData = fs.readFileSync(this.configPath, 'utf8');
            const config = JSON.parse(configData);

            if (config.tenants && Array.isArray(config.tenants)) {
                config.tenants.forEach(tenant => {
                    if (tenant.active !== false) {
                        this.tenants.set(tenant.tenantId, tenant);
                    }
                });

                this.defaultTenantId = config.defaultTenant || config.tenants[0]?.tenantId;
            }

            console.log(`[TenantConfig] Loaded ${this.tenants.size} active tenant(s) from file`);
        } catch (error) {
            console.error('[TenantConfig] Error loading tenant config:', error.message);
            throw error;
        }
    }

    /**
     * Create example multi-tenant config file
     */
    _createExampleConfig() {
        const exampleConfig = {
            defaultTenant: 'tenant1',
            tenants: [
                {
                    tenantId: 'tenant1',
                    name: 'Company A',
                    bot: {
                        appId: 'your-bot-app-id-1',
                        appPassword: 'your-bot-app-password-1',
                        tenantId: 'your-azure-tenant-id-1'
                    },
                    freshchat: {
                        apiKey: 'your-freshchat-api-key-1',
                        apiUrl: 'https://api.freshchat.com/v2',
                        inboxId: 'your-inbox-id-1',
                        webhookPublicKey: 'your-webhook-public-key-1',
                        webhookSignatureStrict: true
                    },
                    settings: {
                        welcomeMessage: '👋 Company A 지원팀입니다!',
                        publicUrl: 'https://your-domain.com',
                        uploadsDir: 'uploads/tenant1'
                    },
                    branding: {
                        botName: 'Company A Support',
                        botDescription: 'Company A 헬프데스크',
                        accentColor: '#0078D4',
                        iconColor: 'tenant1-color.png',
                        iconOutline: 'tenant1-outline.png'
                    },
                    active: true,
                    createdAt: new Date().toISOString()
                }
            ]
        };

        fs.writeFileSync(this.configPath, JSON.stringify(exampleConfig, null, 2));
        console.log(`[TenantConfig] Created example config at: ${this.configPath}`);
        console.log('[TenantConfig] Please update with your actual tenant configurations');
    }

    /**
     * Get tenant configuration by ID
     */
    getTenant(tenantId) {
        if (!this.initialized) {
            this.initialize();
        }

        if (!tenantId) {
            tenantId = this.defaultTenantId;
        }

        const config = this.tenants.get(tenantId);
        if (!config) {
            console.warn(`[TenantConfig] Tenant not found: ${tenantId}`);
            return null;
        }

        return config;
    }

    /**
     * Get tenant by Bot App ID (for incoming Teams messages)
     */
    getTenantByBotAppId(botAppId) {
        if (!this.initialized) {
            this.initialize();
        }

        for (const [tenantId, config] of this.tenants.entries()) {
            if (config.bot.appId === botAppId) {
                return config;
            }
        }

        console.warn(`[TenantConfig] No tenant found for Bot App ID: ${botAppId}`);
        return null;
    }

    /**
     * Get tenant by Freshchat API key (for incoming webhooks)
     */
    getTenantByFreshchatInbox(inboxId) {
        if (!this.initialized) {
            this.initialize();
        }

        for (const [tenantId, config] of this.tenants.entries()) {
            if (config.freshchat.inboxId === inboxId) {
                return config;
            }
        }

        console.warn(`[TenantConfig] No tenant found for Freshchat inbox: ${inboxId}`);
        return null;
    }

    /**
     * Get all active tenants
     */
    getAllTenants() {
        if (!this.initialized) {
            this.initialize();
        }

        return Array.from(this.tenants.values());
    }

    /**
     * Add or update tenant configuration (for future admin API)
     */
    upsertTenant(tenantConfig) {
        if (!tenantConfig.tenantId) {
            throw new Error('tenantId is required');
        }

        const existing = this.tenants.get(tenantConfig.tenantId);
        const config = {
            ...existing,
            ...tenantConfig,
            updatedAt: new Date().toISOString()
        };

        if (!config.createdAt) {
            config.createdAt = new Date().toISOString();
        }

        this.tenants.set(tenantConfig.tenantId, config);

        // Persist to file in multi-tenant mode
        if (this.mode === 'multi') {
            this._saveToFile();
        }

        console.log(`[TenantConfig] Tenant ${tenantConfig.tenantId} ${existing ? 'updated' : 'created'}`);
        return config;
    }

    /**
     * Save tenant configurations to file
     */
    _saveToFile() {
        try {
            const config = {
                defaultTenant: this.defaultTenantId,
                tenants: Array.from(this.tenants.values())
            };

            fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
            console.log(`[TenantConfig] Saved ${this.tenants.size} tenant(s) to file`);
        } catch (error) {
            console.error('[TenantConfig] Error saving tenant config:', error.message);
            throw error;
        }
    }

    /**
     * Deactivate a tenant
     */
    deactivateTenant(tenantId) {
        const config = this.tenants.get(tenantId);
        if (config) {
            config.active = false;
            config.deactivatedAt = new Date().toISOString();
            
            if (this.mode === 'multi') {
                this._saveToFile();
            }

            console.log(`[TenantConfig] Tenant ${tenantId} deactivated`);
        }
    }

    /**
     * Reload configuration from source
     */
    reload() {
        this.tenants.clear();
        this.initialized = false;
        this.initialize();
        console.log('[TenantConfig] Configuration reloaded');
    }
}

// Singleton instance
const tenantConfigManager = new TenantConfigManager();

module.exports = {
    TenantConfigManager,
    tenantConfigManager
};
