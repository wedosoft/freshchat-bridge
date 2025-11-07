# Multi-Tenant Setup Guide

이 가이드는 Freshchat Bridge를 단일 테넌트에서 멀티 테넌트로 전환하는 방법을 설명합니다.

## 📋 목차

1. [현재 상태 (Single Tenant)](#현재-상태-single-tenant)
2. [멀티 테넌트 모드 활성화](#멀티-테넌트-모드-활성화)
3. [테넌트 구성 관리](#테넌트-구성-관리)
4. [마이그레이션 단계](#마이그레이션-단계)
5. [향후 확장 (Database)](#향후-확장-database)

## 현재 상태 (Single Tenant)

현재는 `.env` 파일을 통해 단일 고객의 설정을 관리합니다:

```env
# Single Tenant Mode (기본값)
TENANT_MODE=single
DEFAULT_TENANT_ID=default

BOT_APP_ID=your-bot-app-id
BOT_APP_PASSWORD=your-bot-app-password
FRESHCHAT_API_KEY=your-api-key
# ... 기타 설정
```

**특징:**
- ✅ 간단한 설정
- ✅ 기존 방식과 완벽 호환
- ❌ 하나의 고객만 지원
- ❌ 설정 변경 시 재배포 필요

## 멀티 테넌트 모드 활성화

### 1단계: 환경변수 변경

`.env` 파일에서 모드를 변경:

```env
# Multi-Tenant Mode
TENANT_MODE=multi
TENANT_CONFIG_PATH=./tenants.json

# 기본 테넌트 (옵션)
DEFAULT_TENANT_ID=wedosoft
```

### 2단계: 테넌트 설정 파일 생성

`tenants.json` 파일 생성 (예시는 `tenants.json.example` 참고):

```json
{
  "defaultTenant": "wedosoft",
  "tenants": [
    {
      "tenantId": "wedosoft",
      "name": "We Do Soft Inc.",
      "bot": {
        "appId": "bot-app-id-1",
        "appPassword": "bot-password-1",
        "tenantId": "azure-tenant-id-1"
      },
      "freshchat": {
        "apiKey": "freshchat-key-1",
        "apiUrl": "https://api.freshchat.com/v2",
        "inboxId": "inbox-id-1",
        "webhookPublicKey": "public-key-1",
        "webhookSignatureStrict": true
      },
      "settings": {
        "welcomeMessage": "환영합니다!",
        "publicUrl": "https://your-domain.com",
        "uploadsDir": "uploads/wedosoft"
      },
      "branding": {
        "botName": "IT 지원센터",
        "botDescription": "헬프데스크",
        "accentColor": "#FFFFFF"
      },
      "active": true
    }
  ]
}
```

### 3단계: 서비스 재시작

```bash
npm start
```

## 테넌트 구성 관리

### 새 테넌트 추가

`tenants.json`에 새 테넌트 객체 추가:

```json
{
  "tenantId": "client-b",
  "name": "Client Company B",
  "bot": {
    "appId": "client-b-bot-id",
    "appPassword": "client-b-password",
    "tenantId": "client-b-azure-tenant"
  },
  "freshchat": {
    "apiKey": "client-b-freshchat-key",
    "apiUrl": "https://api.freshchat.com/v2",
    "inboxId": "client-b-inbox-id",
    "webhookPublicKey": "client-b-public-key",
    "webhookSignatureStrict": true
  },
  "settings": {
    "welcomeMessage": "👋 Company B 지원팀입니다!",
    "publicUrl": "https://your-domain.com",
    "uploadsDir": "uploads/client-b"
  },
  "branding": {
    "botName": "Company B Support",
    "botDescription": "Company B 고객지원",
    "accentColor": "#FF5722"
  },
  "active": true,
  "createdAt": "2025-01-03T00:00:00.000Z"
}
```

### 테넌트 식별 방법

시스템은 다음 방법으로 자동으로 테넌트를 식별합니다:

1. **Teams → Freshchat**: Bot App ID로 테넌트 식별
2. **Freshchat → Teams**: Freshchat Inbox ID로 테넌트 식별

### 테넌트 비활성화

특정 테넌트를 임시로 비활성화:

```json
{
  "tenantId": "client-b",
  "active": false,
  "deactivatedAt": "2025-01-05T00:00:00.000Z"
}
```

## 마이그레이션 단계

### Phase 1: 현재 (Single Tenant via .env)
- ✅ 구현 완료
- 하나의 고객만 지원
- 모든 설정이 환경변수에 하드코딩

### Phase 2: Multi-Tenant via JSON (현재 단계)
- ✅ 구현 완료
- 여러 고객 지원 가능
- JSON 파일로 테넌트 관리
- 재배포 없이 설정 변경 가능
- 적은 수의 테넌트에 적합 (< 50개)

### Phase 3: Multi-Tenant via Database (향후)
- 📋 계획 단계
- 대규모 테넌트 지원
- 동적 테넌트 추가/삭제
- Admin API/UI
- 테넌트별 사용량 추적
- 데이터베이스: PostgreSQL, MongoDB, etc.

## 테넌트별 격리

각 테넌트는 다음이 격리됩니다:

1. **Bot 인증 정보**: 각 테넌트가 자체 Bot App ID/Password 사용
2. **Freshchat 계정**: 각 테넌트가 자체 Freshchat API Key/Inbox 사용
3. **파일 저장소**: `uploads/{tenantId}/` 디렉토리로 분리
4. **대화 매핑**: 테넌트 ID로 네임스페이스 분리
5. **브랜딩**: 테넌트별 환영 메시지, 봇 이름, 색상 등

## 향후 확장 (Database)

### 데이터베이스 스키마 예시

```sql
-- Tenants table
CREATE TABLE tenants (
    tenant_id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    bot_app_id VARCHAR(255) NOT NULL UNIQUE,
    bot_app_password VARCHAR(255) NOT NULL,
    bot_tenant_id VARCHAR(255) NOT NULL,
    freshchat_api_key VARCHAR(255) NOT NULL,
    freshchat_api_url VARCHAR(255) NOT NULL,
    freshchat_inbox_id VARCHAR(100) NOT NULL UNIQUE,
    freshchat_webhook_public_key TEXT,
    settings JSONB,
    branding JSONB,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Conversation mappings table
CREATE TABLE conversation_mappings (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(100) REFERENCES tenants(tenant_id),
    teams_conversation_id VARCHAR(255) NOT NULL,
    freshchat_conversation_guid VARCHAR(255),
    freshchat_conversation_numeric_id VARCHAR(255),
    freshchat_user_id VARCHAR(255),
    conversation_reference JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(tenant_id, teams_conversation_id)
);

-- Usage tracking (optional)
CREATE TABLE tenant_usage (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(100) REFERENCES tenants(tenant_id),
    date DATE NOT NULL,
    messages_sent INTEGER DEFAULT 0,
    messages_received INTEGER DEFAULT 0,
    attachments_sent INTEGER DEFAULT 0,
    attachments_received INTEGER DEFAULT 0,
    UNIQUE(tenant_id, date)
);
```

### Admin API 예시 (향후)

```javascript
// GET /admin/tenants - 모든 테넌트 조회
// POST /admin/tenants - 새 테넌트 생성
// GET /admin/tenants/:tenantId - 특정 테넌트 조회
// PUT /admin/tenants/:tenantId - 테넌트 업데이트
// DELETE /admin/tenants/:tenantId - 테넌트 삭제
// GET /admin/tenants/:tenantId/usage - 사용량 통계
```

## 모범 사례

### 보안
- ✅ 테넌트 설정에 민감한 정보 포함 (API 키, 비밀번호)
- ✅ `tenants.json` 파일을 `.gitignore`에 추가
- ✅ 프로덕션 환경에서는 암호화된 저장소 사용 권장
- ✅ 정기적인 키 로테이션

### 운영
- ✅ 테넌트 추가 전 설정 검증
- ✅ 테넌트별 로그 분리
- ✅ 모니터링 및 알림 설정
- ✅ 백업 전략 수립

### 확장성
- JSON 방식: ~50개 테넌트까지 권장
- 50개 이상: Database 마이그레이션 고려
- 100개 이상: 분산 아키텍처 고려

## 문제 해결

### 테넌트를 찾을 수 없음
- Bot App ID 또는 Freshchat Inbox ID 확인
- `tenants.json` 파일 경로 확인
- `active: true` 설정 확인

### 설정이 반영되지 않음
- 서비스 재시작 필요
- 또는 reload 엔드포인트 호출: `POST /admin/reload`

### 파일 업로드 실패
- 테넌트별 `uploadsDir` 디렉토리 생성 확인
- 파일 권한 확인

## 지원

추가 질문이나 문제가 있으시면:
- GitHub Issues 생성
- 문서 참고: README.md, AGENTS.md
