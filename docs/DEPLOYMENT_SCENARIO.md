# 배포 시나리오 완전 가이드

## 🏗️ 시스템 아키텍처

### 누가 무엇을 호스팅하는가?

```
┌─────────────────────────────────────────────────────────────────┐
│                        We Do Soft (여러분)                       │
├─────────────────────────────────────────────────────────────────┤
│ 1. Azure/Entra ID (wedosoft.onmicrosoft.com)                   │
│    ├─ Bot App 등록 (6a46afe9-3109-4af6-a0f9-275f6fddf929)      │
│    ├─ Client Secret 관리                                        │
│    └─ Graph API 권한 설정                                       │
│                                                                  │
│ 2. 서버 (freshchat-bridge.fly.dev)                             │
│    ├─ poc-bridge.js 실행                                        │
│    ├─ Bot Framework 엔드포인트                                  │
│    ├─ Freshchat 연동 로직                                       │
│    └─ 환경변수 (.env)                                           │
│       ├─ BOT_APP_ID=6a46afe9-3109-4af6-a0f9-275f6fddf929       │
│       ├─ BOT_APP_PASSWORD=your-secret                           │
│       ├─ BOT_TENANT_ID=wedosoft-tenant-id                       │
│       └─ FRESHCHAT_API_KEY=...                                  │
└─────────────────────────────────────────────────────────────────┘

                              ▼ 앱 패키지만 전달

┌─────────────────────────────────────────────────────────────────┐
│                    고객사 (예: Samsung, LG)                      │
├─────────────────────────────────────────────────────────────────┤
│ 1. Teams Admin Center                                           │
│    └─ app-package.zip 업로드 (manifest.json + 아이콘)          │
│                                                                  │
│ 2. Azure AD (customer.onmicrosoft.com)                          │
│    └─ We Do Soft의 Bot 앱에 대한 권한 승인                     │
│       ├─ User.Read.All (고객사 사용자 정보 읽기)               │
│       ├─ Sites.Read.All (고객사 SharePoint 읽기)               │
│       └─ Team.ReadBasic.All                                     │
│                                                                  │
│ 3. SharePoint/OneDrive (선택사항)                               │
│    └─ help-guide.html 파일 업로드 및 관리                      │
└─────────────────────────────────────────────────────────────────┘
```

## 📋 단계별 배포 프로세스

### Phase 1: We Do Soft 준비 작업 (배포 전)

#### 1-1. Azure에 Bot 앱 등록 (이미 완료됨)

```bash
# 이미 등록된 정보
App ID: 6a46afe9-3109-4af6-a0f9-275f6fddf929
App Name: EXO헬프
Tenant: wedosoft.onmicrosoft.com
```

#### 1-2. API 권한 추가 (Azure Portal)

**중요:** 이 단계는 **여러분의 Azure Portal**에서 한 번만 설정합니다!

1. [Azure Portal](https://portal.azure.com) 접속
2. Azure Active Directory → App registrations
3. "EXO헬프" 앱 선택
4. API permissions → Add a permission
5. Microsoft Graph → **Application permissions** 선택
6. 다음 권한 추가:
   - ✅ `User.Read.All`
   - ✅ `Sites.Read.All` (또는 `Files.Read.All`)
   - ✅ `Team.ReadBasic.All`

**주의:** 이 단계에서는 **Grant admin consent를 누르지 마세요!**
→ 여러분의 조직이 아니라 고객사 조직의 데이터에 접근해야 하므로, 고객사가 승인해야 합니다.

#### 1-3. 서버 배포 (Fly.dev)

```bash
# 코드 푸시
git add .
git commit -m "Add admin consent endpoints and permissions"
git push

# Fly.dev 배포
fly deploy

# 환경변수 설정 확인
fly secrets list
```

**필수 환경변수:**
```bash
BOT_APP_ID=6a46afe9-3109-4af6-a0f9-275f6fddf929
BOT_APP_PASSWORD=your-client-secret
BOT_TENANT_ID=your-wedosoft-tenant-id
FRESHCHAT_API_KEY=your-freshchat-key
FRESHCHAT_API_URL=https://api.freshchat.com/v2
FRESHCHAT_INBOX_ID=your-inbox-id
PUBLIC_URL=https://freshchat-bridge.fly.dev
```

#### 1-4. 앱 패키지 생성

```bash
cd teams-app
zip -r app-package.zip manifest.json color.png outline.png

# 파일 확인
unzip -l app-package.zip
```

**app-package.zip 내용:**
```
- manifest.json  (앱 설정, Bot ID 포함)
- color.png      (앱 컬러 아이콘)
- outline.png    (앱 아웃라인 아이콘)
```

**중요:** `manifest.json`의 `webApplicationInfo` 섹션이 포함되어 있어야 합니다:
```json
{
  "webApplicationInfo": {
    "id": "6a46afe9-3109-4af6-a0f9-275f6fddf929",
    "resource": "api://freshchat-bridge.fly.dev/6a46afe9-3109-4af6-a0f9-275f6fddf929"
  }
}
```

---

### Phase 2: 고객사 전달 (영업/PM 작업)

고객사 IT 담당자에게 전달할 것:

1. **앱 패키지 파일**
   - `app-package.zip`

2. **배포 가이드 문서**
   - [CUSTOMER_DEPLOYMENT_GUIDE.md](./CUSTOMER_DEPLOYMENT_GUIDE.md)
   - [ADMIN_CONSENT_QUICKSTART.md](./ADMIN_CONSENT_QUICKSTART.md)

3. **관리자 동의 URL**
   ```
   https://freshchat-bridge.fly.dev/auth/admin-consent
   ```

4. **(선택사항) SharePoint 설정 가이드**
   - [HELP_TAB_SHAREPOINT.md](./HELP_TAB_SHAREPOINT.md)
   - 고객이 도움말 탭을 직접 관리하고 싶을 때만 필요

---

### Phase 3: 고객사 설치 작업

#### 방법 A: Teams Admin Center (권장) ⭐

**3-1. 앱 업로드**

1. 고객사 IT 관리자가 [Teams Admin Center](https://admin.teams.microsoft.com) 접속
2. Teams apps → Manage apps → **Upload** 클릭
3. `app-package.zip` 파일 선택

**3-2. 권한 승인 (자동 표시됨)**

앱 업로드 직후, 다음과 같은 권한 승인 화면이 **자동으로** 표시됩니다:

```
┌─────────────────────────────────────────────────┐
│  EXO헬프 앱이 조직 데이터에 접근하려고 합니다  │
├─────────────────────────────────────────────────┤
│                                                  │
│  이 앱은 다음 권한을 요청합니다:                │
│                                                  │
│  ✓ 모든 사용자의 전체 프로필 읽기              │
│    (User.Read.All)                              │
│                                                  │
│  ✓ 모든 사이트 모음의 항목 읽기                │
│    (Sites.Read.All)                             │
│                                                  │
│  ✓ 팀의 기본 정보 읽기                         │
│    (Team.ReadBasic.All)                         │
│                                                  │
│  [ ] 조직을 대신하여 동의함                    │
│                                                  │
│      [취소]           [수락]                    │
└─────────────────────────────────────────────────┘
```

**중요:**
- ✅ "조직을 대신하여 동의함" 체크박스를 **반드시** 체크
- ✅ "수락" 버튼 클릭
- ❌ 체크하지 않으면 **각 사용자가 개별적으로 동의해야 함!**

**3-3. 앱 정책 설정**

1. Teams apps → Setup policies
2. 정책 선택 (또는 새로 생성)
3. Installed apps → Add apps → "EXO헬프" 선택
4. Save

---

#### 방법 B: 간편 URL 방식

Teams Admin Center 접근 권한이 없거나, 권한 승인만 먼저 하고 싶을 때:

**3-1. 관리자 동의 URL 방문**

```
https://freshchat-bridge.fly.dev/auth/admin-consent
```

**3-2. Microsoft 로그인**

- 고객사 Azure AD 계정으로 로그인
- Global Administrator 또는 Application Administrator 권한 필요

**3-3. 권한 승인**

위의 권한 승인 화면과 동일한 내용 표시
→ "조직을 대신하여 동의함" 체크 → 수락

**3-4. Teams 앱 업로드 (별도)**

이후 Teams Admin Center에서 `app-package.zip`을 업로드하면 권한 승인 화면이 다시 나타나지 않음 (이미 승인되었으므로)

---

### Phase 4: SharePoint 설정 (선택사항)

고객이 도움말 탭을 직접 관리하고 싶을 때만 필요합니다.

#### 4-1. 고객사 작업

1. SharePoint 사이트 또는 OneDrive에 `help-guide.html` 업로드
2. 파일 URL 복사
   ```
   예: https://customer.sharepoint.com/sites/ITSupport/Shared%20Documents/help-guide.html
   ```

#### 4-2. We Do Soft 작업 (환경변수 업데이트)

고객사로부터 SharePoint URL을 받으면:

```bash
# Fly.dev 환경변수 업데이트
fly secrets set HELP_TAB_SOURCE=sharepoint
fly secrets set HELP_TAB_FILE_URL=https://customer.sharepoint.com/.../help-guide.html

# 서버 재시작 (자동)
```

**중요:** 각 고객마다 다른 SharePoint URL을 사용하므로, **환경변수를 고객별로 관리**해야 합니다!

---

## 🤔 환경변수 문제 해결

### 문제: "여러 고객사가 있는데 환경변수를 어떻게 관리하나?"

현재 구조는 **단일 고객사용**입니다. 여러 고객사를 지원하려면:

#### 해결책 1: 고객사별 서버 배포 (권장)

```bash
# 고객사 A
App: freshchat-bridge-customer-a.fly.dev
BOT_APP_ID: 동일 (6a46afe9-...)
HELP_TAB_FILE_URL: customer-a의 SharePoint URL

# 고객사 B
App: freshchat-bridge-customer-b.fly.dev
BOT_APP_ID: 동일 (6a46afe9-...)
HELP_TAB_FILE_URL: customer-b의 SharePoint URL
```

**장점:**
- ✅ 환경변수 관리 단순
- ✅ 고객별 독립적 운영
- ✅ 한 고객의 장애가 다른 고객에게 영향 없음

**단점:**
- ❌ 서버 비용 증가
- ❌ 배포 관리 복잡

#### 해결책 2: 멀티 테넌트 지원 (.env.example 참고)

`.env.example`에 이미 힌트가 있습니다:

```bash
# ============================================================================
# Tenant Mode Configuration
# ============================================================================
TENANT_MODE=multi
TENANT_CONFIG_PATH=./tenants.json
```

**tenants.json 예시:**
```json
{
  "customer-a": {
    "helpTabSource": "sharepoint",
    "helpTabFileUrl": "https://customer-a.sharepoint.com/.../help.html"
  },
  "customer-b": {
    "helpTabSource": "sharepoint",
    "helpTabFileUrl": "https://customer-b.sharepoint.com/.../help.html"
  }
}
```

그러나 **현재 코드에는 멀티 테넌트 로직이 구현되지 않았습니다!**

---

## 🔑 권한 승인의 실제 의미

### 고객이 승인하는 것

```
고객사 IT 관리자: "We Do Soft의 Bot 앱이 우리 조직의 데이터에 접근하는 것을 허용합니다"

구체적으로:
- ✅ We Do Soft의 Bot 앱 (6a46afe9-...)이
- ✅ 고객사의 Azure AD 사용자 정보를 읽고
- ✅ 고객사의 SharePoint 파일을 읽는 것을
- ✅ 허용합니다
```

### 승인 후 흐름

```
1. Teams 사용자가 봇에게 메시지 전송
   ↓
2. 여러분의 서버 (freshchat-bridge.fly.dev)가 메시지 수신
   ↓
3. 서버가 Graph API 호출:
   - Authorization: Bearer <access_token>
   - Tenant: 고객사 tenant ID (자동 감지)
   ↓
4. Azure AD가 확인:
   - "이 앱(6a46afe9-...)이 이 조직의 사용자 정보를 읽을 권한이 있나?"
   - "있음! (고객사 IT 관리자가 승인했음)"
   ↓
5. 사용자 정보 반환
   ↓
6. Freshchat에 전송
```

---

## ✅ 체크리스트

### We Do Soft 준비 작업

- [ ] Azure Portal에서 Bot 앱에 API 권한 추가 (User.Read.All, Sites.Read.All, Team.ReadBasic.All)
- [ ] **주의: Grant admin consent 누르지 않기!** (고객사가 승인해야 함)
- [ ] 서버 코드 푸시 및 배포
- [ ] 환경변수 설정 (BOT_APP_ID, BOT_APP_PASSWORD, etc.)
- [ ] 앱 패키지 생성 (app-package.zip)
- [ ] 배포 가이드 문서 준비

### 고객사 전달

- [ ] app-package.zip 파일
- [ ] CUSTOMER_DEPLOYMENT_GUIDE.md
- [ ] ADMIN_CONSENT_QUICKSTART.md
- [ ] 관리자 동의 URL: https://freshchat-bridge.fly.dev/auth/admin-consent

### 고객사 설치 (고객 IT 관리자)

- [ ] Teams Admin Center에서 app-package.zip 업로드
- [ ] 권한 승인 화면에서 "조직을 대신하여 동의함" 체크 → 수락
- [ ] (또는) 관리자 동의 URL 방문 → 권한 승인
- [ ] 앱 정책 설정

### (선택) SharePoint 설정

- [ ] 고객이 help-guide.html을 SharePoint에 업로드
- [ ] SharePoint URL을 We Do Soft에 전달
- [ ] We Do Soft가 환경변수 업데이트

---

## 🚨 주의사항

### 1. Bot 앱은 여러분의 Entra ID에만 등록

- ✅ 한 번만 등록 (모든 고객사 공통 사용)
- ❌ 고객사마다 별도 Bot 앱 등록 필요 없음

### 2. 권한 승인은 고객사마다 필요

- 고객사 A가 승인 → 고객사 A의 데이터만 접근 가능
- 고객사 B가 승인 → 고객사 B의 데이터만 접근 가능

### 3. SharePoint URL은 고객사별로 다름

- 현재 구조: 환경변수 1개 (단일 고객용)
- 여러 고객: 멀티 테넌트 구조 필요 또는 고객별 서버 배포

### 4. manifest.json의 Public URL

현재 하드코딩된 URL:
```json
"contentUrl": "https://freshchat-bridge.fly.dev/tab-content"
```

모든 고객이 **동일한 서버**에 연결됩니다.
→ 고객별로 다른 서버를 사용하려면 **고객별로 다른 앱 패키지**가 필요합니다.

---

## 📊 권장 배포 전략

### 옵션 A: 단일 고객사 전용

```
✅ 현재 구조 그대로 사용
✅ 환경변수에 해당 고객의 SharePoint URL 설정
✅ 가장 간단
```

### 옵션 B: 여러 고객사, 고객별 서버

```
✅ Fly.dev에 고객별 앱 배포
✅ 고객별 환경변수 독립 관리
✅ 고객별 앱 패키지 (manifest.json의 URL만 다름)
```

### 옵션 C: 진정한 멀티 테넌트 (권장, 장기적)

```
❌ 현재 코드 수정 필요
✅ 단일 서버, 단일 앱 패키지
✅ 런타임에 tenant ID로 설정 분기
✅ tenants.json 또는 데이터베이스에서 설정 로드
```

---

**다음 단계가 필요하시면 알려주세요:**
1. 멀티 테넌트 지원 코드 구현
2. 고객별 서버 배포 자동화 스크립트
3. 배포 테스트 체크리스트
