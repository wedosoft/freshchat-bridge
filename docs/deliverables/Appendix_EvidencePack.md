# Evidence Pack (부록)

**문서번호:** FCBRIDGE-2024-EVID-001  
**작성일:** 2025-12-23  
**작성자:** 위두소프트

---

## 1. Evidence 수집 일시

- **수집 일시**: 2025-12-23
- **수집 방법**: Azure CLI (`az`), Fly.io CLI (`flyctl`)
- **수집자**: 위두소프트

---

## 2. Azure 정보

### 2.1 Azure Account

```json
{
  "environmentName": "AzureCloud",
  "name": "Azure Subscription - We Do Soft",
  "state": "Enabled",
  "tenantDefaultDomain": "wedosoft.net",
  "tenantDisplayName": "wedosoft.net",
  "tenantId": "65e1f49c-c509-471a-9910-6ee6250fe2f6",
  "user": {
    "name": "alan@wedosoft.net",
    "type": "user"
  }
}
```

### 2.2 App Registration (Production)

```json
{
  "appId": "6a46afe9-3109-4af6-a0f9-275f6fddf929",
  "displayName": "freshchat-bridge",
  "publisherDomain": "wedosoft.net",
  "signInAudience": "AzureADMultipleOrgs",
  "createdDateTime": "2025-10-25T06:05:26Z",
  "passwordCredentials": [
    {
      "displayName": "Bot Runtime - 20251026-1055",
      "endDateTime": "2026-04-24T01:55:25.193Z",
      "hint": "qAR",
      "secretText": "[REDACTED]"
    },
    {
      "displayName": "GitHub Action - 20251026-1046",
      "endDateTime": "2026-04-24T01:45:23.333Z",
      "hint": "am5",
      "secretText": "[REDACTED]"
    }
  ],
  "requiredResourceAccess": [
    {
      "resourceAppId": "00000003-0000-0000-c000-000000000000",
      "resourceAccess": [
        { "id": "dc149144-f292-421e-b185-5953f2e98d7f", "type": "Role" },
        { "id": "7ab1d382-f21e-4acd-a863-ba3e13f7da61", "type": "Role" },
        { "id": "332a536c-c7ef-4017-ab91-336970924f0d", "type": "Role" },
        { "id": "2280dda6-0bfd-44ee-a2f4-cb867cfc4c1e", "type": "Role" },
        { "id": "df021288-bdef-4463-88db-98f22de89214", "type": "Role" }
      ]
    }
  ],
  "web": {
    "redirectUris": [
      "https://token.botframework.com/.auth/web/redirect"
    ]
  }
}
```

### 2.3 App Registration (Staging)

```json
{
  "appId": "ff8e490d-2cf9-424c-a431-84974a803474",
  "displayName": "freshchat-bridge-staging",
  "identifierUris": [
    "api://freshchat-bridge-staging.fly.dev/ff8e490d-2cf9-424c-a431-84974a803474"
  ],
  "createdDateTime": "2025-11-09T04:39:36Z"
}
```

### 2.4 Azure Bot Service 리소스 목록

```json
[
  {
    "name": "freshchat-bridge",
    "resourceGroup": "my-vm-rg",
    "location": "global",
    "sku": { "name": "F0" },
    "kind": "azurebot",
    "provisioningState": "Succeeded",
    "createdTime": "2025-10-25T06:55:29.653057+00:00"
  },
  {
    "name": "freshchat-bridge-staging",
    "resourceGroup": "my-vm-rg",
    "location": "global",
    "sku": { "name": "F0" },
    "kind": "azurebot",
    "provisioningState": "Succeeded",
    "createdTime": "2025-11-09T04:39:42.838622+00:00"
  }
]
```

### 2.5 Azure Bot Service (Production) 상세

```json
{
  "name": "freshchat-bridge",
  "properties": {
    "displayName": "Freshchat Bridge",
    "endpoint": "https://freshchat-bridge.fly.dev/bot/callback",
    "endpointVersion": "3.0",
    "msaAppId": "6a46afe9-3109-4af6-a0f9-275f6fddf929",
    "msaAppTenantId": "65e1f49c-c509-471a-9910-6ee6250fe2f6",
    "msaAppType": "SingleTenant",
    "configuredChannels": ["webchat", "directline", "msteams"],
    "enabledChannels": ["webchat", "directline", "msteams"]
  },
  "sku": { "name": "F0" }
}
```

---

## 3. Fly.io 정보

### 3.1 Production App Status

```
App
  Name     = freshchat-bridge
  Owner    = we-do-soft-inc
  Hostname = freshchat-bridge.fly.dev
  Image    = freshchat-bridge:deployment-01KCN08AAKP9QN75DCKP67QZD9

Machines
PROCESS ID              VERSION REGION  STATE   CHECKS              LAST UPDATED
app     148e774b203328  227     nrt     started 1 total, 1 passing  2025-12-17T01:56:13Z
app     5683772a562798  227     nrt     started 1 total, 1 passing  2025-12-17T01:55:56Z
```

### 3.2 Production App Configuration

```json
{
  "app": "freshchat-bridge",
  "primary_region": "nrt",
  "http_service": {
    "internal_port": 3978,
    "force_https": true,
    "auto_stop_machines": true,
    "auto_start_machines": true,
    "min_machines_running": 2,
    "concurrency": {
      "type": "connections",
      "hard_limit": 50,
      "soft_limit": 25
    },
    "checks": [
      {
        "interval": "15s",
        "timeout": "10s",
        "grace_period": "5s",
        "method": "GET",
        "path": "/"
      }
    ]
  },
  "vm": [
    {
      "cpu_kind": "shared",
      "cpus": 1,
      "memory_mb": 2048
    }
  ]
}
```

### 3.3 Production Secrets (이름만)

| Secret Name | Digest (마스킹) |
|-------------|-----------------|
| BOT_APP_ID | fef52c4...*** |
| BOT_APP_PASSWORD | 2fcc032...*** |
| BOT_TENANT_ID | 023d0fe...*** |
| FRESHCHAT_API_KEY | 2519e47...*** |
| FRESHCHAT_API_URL | bb8d5ff...*** |
| FRESHCHAT_INBOX_ID | 505d8a4...*** |
| FRESHCHAT_WEBHOOK_PUBLIC_KEY | a128320...*** |
| FRESHSALES_API_KEY | 270d5bd...*** |
| FRESHSALES_API_URL | a967f6b...*** |
| FRESHDESK_API_KEY | 77875a9...*** |
| FRESHDESK_DOMAIN | e6cf77a...*** |
| FRESHDESK_FAQ_FOLDER_ID | 42056a6...*** |
| REDIS_URL | 65e2c40...*** |
| PUBLIC_URL | 6f1e070...*** |
| NODE_ENV | a331102...*** |
| LOG_LEVEL | 7a50c22...*** |
| PORT | 268c26f...*** |
| SENTRY_DSN | 4c3b158...*** |

### 3.4 Staging App Status

```
App
  Name     = freshchat-bridge-staging
  Owner    = we-do-soft-inc
  Hostname = freshchat-bridge-staging.fly.dev
  Image    = freshchat-bridge-staging:deployment-01KAJQV7FQJANB6WNKW6KB0N72

Machines
PROCESS ID              VERSION REGION  STATE   CHECKS              LAST UPDATED
app     78432e1a3e5dd8  79      nrt     stopped 1 total, 1 warning  2025-12-15T02:59:27Z
```

---

## 4. 코드 분석 요약

### 4.1 주요 기술 스택

| 항목 | 기술/버전 |
|------|-----------|
| Runtime | Node.js 18+ |
| Framework | Express.js |
| Bot SDK | botbuilder (Microsoft Bot Framework) |
| HTTP Client | axios |
| Crypto | node-rsa (webhook 서명 검증) |
| Cache | ioredis |
| Monitoring | Sentry |

### 4.2 주요 엔드포인트

| 경로 | 메서드 | 역할 |
|------|--------|------|
| `/` | GET | 헬스체크 |
| `/bot/callback` | POST | Bot Framework 메시지 수신 |
| `/api/messages` | POST | Bot Framework 메시지 수신 (별칭) |
| `/freshchat/webhook` | POST | Freshchat 웹훅 수신 |
| `/files/:key` | GET | 첨부파일 다운로드 |
| `/tab-config` | GET | Teams 탭 설정 |
| `/tab-content` | GET | Teams 탭 콘텐츠 |
| `/debug/mappings` | GET | 대화 매핑 조회 (디버그) |

### 4.3 메시지 흐름 핵심 함수

| 함수명 | 역할 |
|--------|------|
| `handleTeamsMessage()` | Teams 메시지 처리 → Freshchat 전송 |
| `app.post('/freshchat/webhook')` | Freshchat 웹훅 처리 → Teams 전송 |
| `ConversationStore` | 대화 매핑 관리 (Redis/메모리) |
| `buildFreshchatMessageParts()` | Freshchat 메시지 페이로드 생성 |
| `verifyFreshchatSignature()` | 웹훅 서명 검증 |

### 4.4 보안 기능

| 기능 | 구현 상태 |
|------|-----------|
| HTTPS 강제 | ✅ fly.toml |
| Webhook 서명 검증 | ✅ RSA (node-rsa) |
| 파일 업로드 제한 | ✅ 10MB |
| 환경변수 분리 | ✅ fly.io secrets |
| 중복 메시지 방지 | ✅ dedup TTL 10분 |

---

## 5. 참조 다이어그램 키 포인트

| 항목 | 값 |
|------|-----|
| Primary Region | nrt (Tokyo) |
| Internal Port | 3978 |
| Min Machines | 2 |
| Health Check Path | `/` |
| Health Check Interval | 15s |
| Bot Endpoint | `https://freshchat-bridge.fly.dev/bot/callback` |
| Webhook Endpoint | `https://freshchat-bridge.fly.dev/freshchat/webhook` |

---

## 6. 확인이 필요한 항목 [TBD]

| 항목 | 상태 | 비고 |
|------|------|------|
| Sentry 에러 로그 보관 기간 | [TBD] | Sentry 설정 확인 필요 |
| SLA 대응 시간 | [TBD] | 고객과 협의 필요 |
| 긴급 연락처 | [TBD] | 담당자 지정 필요 |
| 정기 백업 자동화 | [TBD] | 스크립트/스케줄 구성 필요 |
| 키 로테이션 알림 | [TBD] | 모니터링 설정 필요 |

