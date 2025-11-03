# Multi-Tenant Architecture Migration Plan

## 개요

Freshchat Bridge를 단일 테넌트에서 멀티 테넌트 아키텍처로 전환하는 단계별 계획입니다.

## 현재 아키텍처 (Phase 1)

```
┌─────────────┐
│   .env      │  ← 모든 설정 하드코딩
└─────────────┘
      │
      ▼
┌─────────────────────────────────┐
│   poc-bridge.js                 │
│   - 단일 Bot App ID             │
│   - 단일 Freshchat Account      │
│   - 전역 conversationMap        │
└─────────────────────────────────┘
```

**한계:**
- ❌ 하나의 고객만 지원
- ❌ 설정 변경 시 재배포 필요
- ❌ 확장성 제한

## 목표 아키텍처 (Phase 2-3)

```
┌──────────────────────────────────────────┐
│   Tenant Configuration Layer             │
│                                          │
│   ┌────────┐    ┌─────────┐    ┌──────┐│
│   │  .env  │ or │ JSON    │ or │  DB  ││
│   │(Phase1)│    │(Phase 2)│    │(P3)  ││
│   └────────┘    └─────────┘    └──────┘│
└──────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────┐
│   Tenant Router / Middleware             │
│   - Bot App ID → Tenant lookup           │
│   - Inbox ID → Tenant lookup             │
└──────────────────────────────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌─────────────┐  ┌─────────────┐
│  Tenant A   │  │  Tenant B   │
│  Context    │  │  Context    │
│             │  │             │
│  - Bot Auth │  │  - Bot Auth │
│  - FC API   │  │  - FC API   │
│  - ConvMap  │  │  - ConvMap  │
│  - Branding │  │  - Branding │
└─────────────┘  └─────────────┘
```

## Phase 2: JSON 기반 멀티 테넌트 (현재 구현)

### 목표
- ✅ 여러 고객 지원 (소규모 ~50개)
- ✅ 재배포 없이 설정 변경
- ✅ 기존 코드와의 호환성 유지

### 구현 범위

#### 1. 테넌트 설정 관리자 (`tenant-config.js`)

```javascript
// 테넌트 식별
- getTenantByBotAppId()     // Teams → Freshchat
- getTenantByFreshchatInbox() // Freshchat → Teams

// CRUD
- getTenant(tenantId)
- upsertTenant(config)
- deactivateTenant(tenantId)
```

#### 2. 데이터 격리

각 테넌트별로 격리:
- Bot 인증 정보
- Freshchat API 키/Inbox
- 대화 매핑 (`conversationMap`)
- 파일 저장소 (`uploads/{tenantId}/`)
- 브랜딩 (환영 메시지, 봇 이름, 색상)

#### 3. 마이그레이션 전략

**하위 호환성:**
```javascript
// 기존 코드 (변경 없음)
const BOT_APP_ID = process.env.BOT_APP_ID;

// 새 코드 (점진적 마이그레이션)
const tenant = tenantConfigManager.getTenant(tenantId);
const BOT_APP_ID = tenant.bot.appId;
```

**자동 감지:**
```javascript
if (TENANT_MODE === 'single') {
    // .env 사용 (기존 방식)
} else {
    // tenants.json 사용 (새 방식)
}
```

### 필요한 코드 수정

#### `poc-bridge.js` 수정 사항

1. **Import tenant config:**
```javascript
const { tenantConfigManager } = require('./tenant-config');
```

2. **Bot adapter 생성을 동적으로:**
```javascript
// Before: 전역 adapter
const adapter = new BotFrameworkAdapter({...});

// After: 테넌트별 adapter 생성 함수
function createAdapterForTenant(tenant) {
    return new BotFrameworkAdapter({
        appId: tenant.bot.appId,
        appPassword: tenant.bot.appPassword,
        channelAuthTenant: tenant.bot.tenantId
    });
}
```

3. **Freshchat client를 테넌트별로:**
```javascript
// Before: 전역 client
const freshchatClient = new FreshchatClient(...);

// After: 테넌트별 client
function getFreshchatClient(tenant) {
    return new FreshchatClient(
        tenant.freshchat.apiKey,
        tenant.freshchat.apiUrl,
        tenant.freshchat.inboxId
    );
}
```

4. **대화 매핑을 테넌트별로:**
```javascript
// Before: 전역 Map
const conversationMap = new Map();

// After: 테넌트별 Map
const conversationMaps = new Map(); // tenantId → Map<teamsConvId, freshchatConv>

function getConversationMap(tenantId) {
    if (!conversationMaps.has(tenantId)) {
        conversationMaps.set(tenantId, new Map());
    }
    return conversationMaps.get(tenantId);
}
```

5. **Teams 메시지 핸들러:**
```javascript
async function handleTeamsMessage(context) {
    // 1. Bot App ID로 테넌트 식별
    const botAppId = context.activity.recipient.id;
    const tenant = tenantConfigManager.getTenantByBotAppId(botAppId);
    
    if (!tenant) {
        console.error('Tenant not found for bot:', botAppId);
        return;
    }
    
    // 2. 테넌트별 설정 사용
    const freshchatClient = getFreshchatClient(tenant);
    const conversationMap = getConversationMap(tenant.tenantId);
    
    // 3. 나머지 로직은 동일...
}
```

6. **Freshchat webhook 핸들러:**
```javascript
app.post('/freshchat/webhook', async (req, res) => {
    // 1. Inbox ID로 테넌트 식별
    const inboxId = req.body.data?.inbox_id || extractInboxIdFromPayload(req.body);
    const tenant = tenantConfigManager.getTenantByFreshchatInbox(inboxId);
    
    if (!tenant) {
        console.error('Tenant not found for inbox:', inboxId);
        return res.sendStatus(404);
    }
    
    // 2. 테넌트별 signature 검증
    const signature = req.headers['x-freshchat-signature'];
    const isValid = verifyFreshchatSignature(
        req.rawBody,
        signature,
        tenant.freshchat.webhookPublicKey
    );
    
    if (!isValid && tenant.freshchat.webhookSignatureStrict) {
        return res.status(401).json({ error: 'Invalid signature' });
    }
    
    // 3. 나머지 로직...
});
```

7. **파일 업로드 경로:**
```javascript
// Before
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// After
function getUploadsDir(tenant) {
    const dir = path.join(__dirname, tenant.settings.uploadsDir);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
```

### 배포 체크리스트

- [ ] `tenant-config.js` 추가
- [ ] `tenants.json.example` 검토
- [ ] `.env`에 `TENANT_MODE` 설정
- [ ] `poc-bridge.js` 수정 (단계별)
- [ ] 기존 기능 테스트 (단일 테넌트)
- [ ] 멀티 테넌트 테스트
- [ ] 문서 업데이트
- [ ] 프로덕션 배포

## Phase 3: Database 기반 멀티 테넌트 (향후)

### 목표
- 대규모 테넌트 지원 (100+)
- 동적 테넌트 추가/삭제 (Admin API)
- 사용량 추적 및 과금
- 고가용성 및 확장성

### 추가 구성 요소

#### 1. Database Layer
```javascript
// tenant-db-repository.js
class TenantRepository {
    async getTenant(tenantId)
    async getTenantByBotAppId(botAppId)
    async getTenantByInboxId(inboxId)
    async createTenant(tenant)
    async updateTenant(tenantId, updates)
    async deleteTenant(tenantId)
}
```

#### 2. Admin API
```javascript
// admin-api.js
app.get('/admin/tenants', listTenants);
app.post('/admin/tenants', createTenant);
app.get('/admin/tenants/:id', getTenant);
app.put('/admin/tenants/:id', updateTenant);
app.delete('/admin/tenants/:id', deleteTenant);
app.get('/admin/tenants/:id/usage', getTenantUsage);
app.post('/admin/reload', reloadConfiguration);
```

#### 3. Usage Tracking
```javascript
// usage-tracker.js
class UsageTracker {
    async trackMessage(tenantId, direction)
    async trackAttachment(tenantId, size)
    async getUsage(tenantId, period)
}
```

#### 4. Caching Layer
```javascript
// tenant-cache.js
class TenantCache {
    // Redis 기반 캐싱
    async get(tenantId)
    async set(tenantId, tenant, ttl)
    async invalidate(tenantId)
}
```

### Database 스키마

```sql
-- PostgreSQL

CREATE TABLE tenants (
    tenant_id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    bot_app_id VARCHAR(255) NOT NULL UNIQUE,
    bot_app_password_encrypted TEXT NOT NULL,
    bot_tenant_id VARCHAR(255) NOT NULL,
    freshchat_api_key_encrypted TEXT NOT NULL,
    freshchat_api_url VARCHAR(255) NOT NULL,
    freshchat_inbox_id VARCHAR(100) NOT NULL UNIQUE,
    freshchat_webhook_public_key TEXT,
    settings JSONB DEFAULT '{}',
    branding JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    deactivated_at TIMESTAMP
);

CREATE INDEX idx_tenants_bot_app_id ON tenants(bot_app_id);
CREATE INDEX idx_tenants_inbox_id ON tenants(freshchat_inbox_id);
CREATE INDEX idx_tenants_active ON tenants(active);

CREATE TABLE conversation_mappings (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(100) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    teams_conversation_id VARCHAR(255) NOT NULL,
    freshchat_conversation_guid VARCHAR(255),
    freshchat_conversation_numeric_id VARCHAR(255),
    freshchat_user_id VARCHAR(255),
    conversation_reference JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, teams_conversation_id)
);

CREATE INDEX idx_conv_tenant_teams ON conversation_mappings(tenant_id, teams_conversation_id);
CREATE INDEX idx_conv_freshchat_guid ON conversation_mappings(freshchat_conversation_guid);
CREATE INDEX idx_conv_freshchat_numeric ON conversation_mappings(freshchat_conversation_numeric_id);

CREATE TABLE tenant_usage (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(100) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    date DATE NOT NULL,
    messages_sent INTEGER DEFAULT 0,
    messages_received INTEGER DEFAULT 0,
    attachments_sent INTEGER DEFAULT 0,
    attachments_received INTEGER DEFAULT 0,
    storage_bytes BIGINT DEFAULT 0,
    UNIQUE(tenant_id, date)
);

CREATE INDEX idx_usage_tenant_date ON tenant_usage(tenant_id, date DESC);
```

### 마이그레이션 경로

```
Phase 1 (.env)
    ↓
Phase 2 (JSON)
    ↓
Phase 3 (Database)

각 단계는 이전 단계와 호환 가능
```

### 예상 타임라인

- **Phase 2** (현재): 즉시 사용 가능
  - 소규모 테넌트 (<50)
  - 수동 설정 관리
  
- **Phase 3** (3-6개월):
  - 테넌트 수 증가 시
  - Admin UI/API 필요 시
  - 사용량 추적 및 과금 필요 시

## 비용 및 리소스 고려사항

### Phase 2 (JSON)
- **추가 비용**: $0
- **개발 시간**: 1-2일
- **유지보수**: 낮음
- **확장성**: ~50 테넌트

### Phase 3 (Database)
- **추가 비용**: 
  - Database: $20-100/월 (Managed PostgreSQL)
  - Redis Cache (선택): $10-50/월
- **개발 시간**: 1-2주
- **유지보수**: 중간
- **확장성**: 1000+ 테넌트

## 의사결정 가이드

### JSON 방식을 선택하는 경우:
- ✅ 테넌트 수 < 50
- ✅ 설정 변경 빈도 낮음
- ✅ 빠른 구현 필요
- ✅ 낮은 복잡도 선호

### Database 방식으로 전환하는 경우:
- ✅ 테넌트 수 > 50
- ✅ 동적 테넌트 관리 필요
- ✅ 사용량 추적/과금 필요
- ✅ Admin UI 필요
- ✅ 고가용성 요구사항

## 다음 단계

1. **즉시**: Phase 2 구현 (JSON 기반)
2. **모니터링**: 테넌트 수 및 사용 패턴 관찰
3. **평가**: 3개월 후 Phase 3 필요성 재평가
4. **계획**: Phase 3 전환 시 마이그레이션 스크립트 준비
