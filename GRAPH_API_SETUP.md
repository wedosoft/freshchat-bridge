# Microsoft Graph API 설정 가이드

이 가이드는 Teams Bot에서 확장 사용자 프로필 정보(직급, 부서, 전화번호, 근무위치)를 수집하기 위한 Microsoft Graph API 설정 방법을 안내합니다.

## 📋 목차
1. [현재 상태](#현재-상태)
2. [Azure Portal 설정](#azure-portal-설정)
3. [OAuth Connection 설정](#oauth-connection-설정)
4. [환경 변수 설정](#환경-변수-설정)
5. [테스트](#테스트)
6. [문제 해결](#문제-해결)

---

## 현재 상태

### ✅ 이미 구현된 기능
- **기본 프로필 수집**: displayName, email (TeamsInfo.getMember로 수집)
- **확장 프로필 코드**: jobTitle, department, mobilePhone, officeLocation 수집 로직 구현됨
- **Graceful Fallback**: Graph API가 설정되지 않아도 기본 정보로 동작

### ⚠️ 추가 설정 필요
Graph API를 통한 확장 프로필 수집은 **Azure에서 OAuth 설정이 완료되어야** 동작합니다.

---

## Azure Portal 설정

### 1. Azure Portal에 로그인
https://portal.azure.com 접속

### 2. Bot 등록 정보 확인
1. **Azure Active Directory** → **App registrations** 이동
2. 현재 Bot 앱 검색 (App ID: `${BOT_APP_ID}`)
3. 앱 선택

### 3. API Permissions 추가

#### 3-1. Permissions 메뉴 이동
좌측 메뉴에서 **API permissions** 클릭

#### 3-2. Microsoft Graph 권한 추가
1. **Add a permission** 클릭
2. **Microsoft Graph** 선택
3. **Delegated permissions** 선택 (사용자 대신 실행)

#### 3-3. 필요한 권한 체크
다음 권한을 검색하여 추가:

| Permission | 설명 | 필수 여부 |
|------------|------|-----------|
| `User.Read` | 기본 사용자 프로필 읽기 | ✅ 필수 |
| `User.ReadBasic.All` | 조직 내 다른 사용자 기본 정보 읽기 | ⚠️ 권장 |

**참고**: `User.Read`만으로도 자신의 확장 프로필은 읽을 수 있습니다.

#### 3-4. Admin Consent (관리자 동의)
1. **Grant admin consent for [Your Organization]** 클릭
2. 관리자 계정으로 승인

---

## OAuth Connection 설정

### 방법 1: Azure Bot Service에서 설정 (권장)

#### 1-1. Azure Bot Resource 찾기
1. Azure Portal에서 **Bot Services** 검색
2. 현재 Bot 리소스 선택

#### 1-2. OAuth Connection 생성
1. 좌측 메뉴에서 **Configuration** → **Add OAuth Connection Settings** 클릭
2. 다음 정보 입력:

| 필드 | 값 |
|------|-----|
| **Name** | `graph` (코드에서 사용하는 이름) |
| **Service Provider** | `Azure Active Directory v2` |
| **Client id** | Bot App ID (BOT_APP_ID) |
| **Client secret** | Bot App Password (BOT_APP_PASSWORD) |
| **Tenant ID** | Bot Tenant ID (BOT_TENANT_ID) |
| **Scopes** | `User.Read User.ReadBasic.All` |

3. **Save** 클릭

### 방법 2: Bot Framework Composer에서 설정

Composer를 사용하는 경우:
1. **Project Settings** → **Connections** 이동
2. OAuth 연결 추가 (위와 동일한 정보 입력)

---

## 환경 변수 설정

`.env` 파일에 다음 변수가 이미 설정되어 있는지 확인:

```bash
# Bot Framework Credentials
BOT_APP_ID=your-app-id
BOT_APP_PASSWORD=your-app-password
BOT_TENANT_ID=your-tenant-id

# Graph API OAuth (선택사항 - Azure에서 설정한 경우)
# GRAPH_CONNECTION_NAME=graph  # 기본값: 'graph'
```

---

## 테스트

### 1. 패키지 설치
```bash
npm install
```

새로 추가된 패키지:
- `@microsoft/microsoft-graph-client`: Graph API 클라이언트
- `isomorphic-fetch`: HTTP 요청 라이브러리

### 2. Bot 재시작
```bash
npm start
# 또는
npm run dev
```

### 3. Teams에서 테스트

#### 3-1. OAuth 로그인 프롬프트
처음 메시지를 보낼 때 **로그인 카드**가 표시될 수 있습니다:
- "Sign in to continue" 클릭
- Microsoft 계정으로 로그인
- 권한 승인

#### 3-2. 확장 프로필 확인
로그에서 다음 메시지 확인:
```
[Graph] Extended profile retrieved
[Teams] User profile collected: {
  "displayName": "홍길동",
  "email": "hong@company.com",
  "jobTitle": "Senior Developer",
  "department": "Engineering",
  "mobilePhone": "+82-10-1234-5678",
  "officeLocation": "Seoul Office",
  "officePhone": "+82-2-1234-5678"
}
```

#### 3-3. Freshchat에서 확인
Freshchat 사용자 프로필에서 다음 Custom Properties 확인:
- `teams_job_title`: 직급
- `teams_department`: 부서
- `teams_mobile_phone`: 휴대폰
- `teams_office_phone`: 사무실 전화
- `teams_office_location`: 근무 위치

---

## 문제 해결

### ❌ "[Graph] No access token - OAuth not configured"

**원인**: OAuth Connection이 설정되지 않음

**해결방법**:
1. Azure Bot Service에서 OAuth Connection 설정 확인
2. Connection Name이 `graph`인지 확인
3. Bot 재시작

---

### ❌ "[Graph] Could not fetch extended profile: 401 Unauthorized"

**원인**: API 권한이 부여되지 않음

**해결방법**:
1. Azure Portal → App registrations → API permissions 확인
2. `User.Read` 권한 추가
3. **Grant admin consent** 클릭
4. 사용자가 Teams에서 재로그인

---

### ❌ "[Graph] Extended profile unavailable: getUserToken is not a function"

**원인**: botbuilder 버전이 너무 낮음

**해결방법**:
```bash
npm install botbuilder@^4.14.0
```

---

### ❌ Graph API 없이 기본 정보만 사용

**의도된 동작**: Graph API가 설정되지 않아도 Bridge는 정상 작동합니다.

수집되는 정보:
- ✅ displayName
- ✅ email
- ❌ jobTitle (Graph 필요)
- ❌ department (Graph 필요)
- ❌ mobilePhone (Graph 필요)
- ❌ officeLocation (Graph 필요)

---

## 참고 자료

### Microsoft 공식 문서
- [Bot Framework OAuth](https://learn.microsoft.com/en-us/azure/bot-service/bot-builder-authentication)
- [Microsoft Graph User API](https://learn.microsoft.com/en-us/graph/api/resources/user)
- [Graph API Permissions](https://learn.microsoft.com/en-us/graph/permissions-reference#userread)

### 추가 권한 (선택사항)

더 많은 정보를 수집하려면 다음 권한 추가:

| Permission | 추가 정보 |
|------------|----------|
| `User.Read.All` | 조직 전체 사용자 프로필 읽기 (관리자용) |
| `Calendars.Read` | 일정 정보 |
| `Contacts.Read` | 연락처 정보 |

---

## 요약

### ✅ OAuth 설정 완료 시
- 확장 프로필 자동 수집 (직급, 부서, 전화번호, 위치)
- Freshchat에 풍부한 사용자 정보 저장

### ⚠️ OAuth 미설정 시
- 기본 프로필만 수집 (이름, 이메일)
- Bridge는 정상 작동 (Graceful fallback)

**권장**: OAuth 설정으로 더 나은 고객 지원 경험 제공
