# Microsoft Graph API 설정 가이드

Teams Bot이 사용자 직급·부서·전화번호와 같은 확장 프로필을 읽어 Freshchat으로 전달하려면 Microsoft Graph에 대한 **애플리케이션 권한**과 클라이언트 자격 증명 토큰이 필요합니다. 이 가이드는 해당 구성을 완료하는 절차를 설명합니다.

## 📋 목차
1. [현재 상태](#현재-상태)
2. [Azure Portal 설정](#azure-portal-설정)
3. [애플리케이션 권한 토큰 흐름](#애플리케이션-권한-토큰-흐름)
4. [환경 변수 설정](#환경-변수-설정)
5. [테스트](#테스트)
6. [문제 해결](#문제-해결)

---

## 현재 상태

### ✅ 이미 구현된 기능
- **기본 프로필 수집**: `TeamsInfo.getMember`를 통해 displayName, email을 확보합니다.
- **확장 프로필 수집**: `getGraphAccessToken()`이 애플리케이션 토큰을 발급받아 `jobTitle`, `department`, `mobilePhone`, `businessPhones`, `officeLocation` 등을 조회합니다.
- **사용자 상호작용 불필요**: 더 이상 OAuth 로그인 카드가 표시되지 않으며, 모든 Teams 사용자는 추가 승인 없이 봇을 사용할 수 있습니다.

### ⚠️ 추가 설정 필요
- Azure AD App Registration(=Bot 앱)에는 **Application** 권한 `User.Read.All` 또는 `Directory.Read.All`이 필요합니다.
- `BOT_APP_ID`/`BOT_APP_PASSWORD`가 실제 클라이언트 ID/시크릿과 일치해야 하며, 시크릿은 만료되지 않아야 합니다.

---

## Azure Portal 설정

1. **Azure Portal 로그인** → **Azure Active Directory** → **App registrations**로 이동합니다.
2. Bot 앱(예: `${BOT_APP_ID}`)을 선택합니다.
3. **API permissions** 메뉴에서 **Add a permission** → **Microsoft Graph** → **Application permissions**를 차례로 선택합니다.
4. 다음 권한을 추가합니다.

| Permission | 설명 | 비고 |
|------------|------|------|
| `User.Read.All` | 모든 사용자의 전체 프로필 읽기 | 최소 권장 |
| `Directory.Read.All` | 디렉터리 개체 전체 읽기 | 조직 정책에 따라 선택 |

5. **Grant admin consent for &lt;Tenant&gt;** 버튼을 눌러 관리자 동의를 부여합니다.
6. 필요한 경우 시크릿을 재발급하고 `.env`의 `BOT_APP_PASSWORD`를 업데이트합니다.

> 참고: Delegated 권한(`User.Read`, `User.ReadBasic.All`)은 더 이상 사용되지 않습니다.

---

## 애플리케이션 권한 토큰 흐름

- `poc-bridge.js` 내 `getGraphAccessToken()`이 `client_credentials` 플로우를 사용해 `https://graph.microsoft.com/.default` 범위 토큰을 요청합니다.
- `collectTeamsUserProfile`은 Teams 사용자 AAD Object ID를 이용해 `/v1.0/users/{id}?$select=...` 호출을 수행합니다.
- 토큰은 서버 측에서만 사용되므로, Teams 사용자는 별도의 로그인/승인 과정을 겪지 않습니다.
- Graph 호출이 실패하더라도 기본 표시 이름과 이메일은 계속 Freshchat으로 전달됩니다.

---

## 환경 변수 설정

`.env` 또는 배포 환경에 다음 값을 확인합니다.

```bash
BOT_APP_ID=your-bot-client-id
BOT_APP_PASSWORD=your-bot-client-secret
BOT_TENANT_ID=your-tenant-id
FRESHCHAT_API_URL=https://api.freshchat.com
FRESHCHAT_API_KEY=xxxx
FRESHCHAT_INBOX_ID=1234567890
```

별도의 OAuth Connection 이름(`graph`)은 더 이상 필요하지 않습니다.

---

## 테스트

1. `npm install` (최초 1회).
2. `npm run dev` 혹은 `npm start`로 서버를 실행합니다.
3. Teams에서 아무 사용자나 봇에게 메시지를 보냅니다.
   - 로그인/승인 카드가 나타나지 않아야 합니다.
4. 서버 로그에서 다음과 유사한 메시지를 확인합니다.
   ```
   [Graph] Extended profile retrieved
   [Teams] User profile collected: { ... }
   ```
5. Freshchat 사용자 프로필 커스텀 속성(`teams_job_title`, `teams_department`, `teams_mobile_phone`, `teams_office_phone`, `teams_office_location`, `teams_display_name`)이 채워졌는지 확인합니다.

---

## 문제 해결

### ❌ `[Graph API] Failed to get access token`
- `BOT_APP_ID`, `BOT_APP_PASSWORD`, `BOT_TENANT_ID` 값이 정확한지 확인합니다.
- 클라이언트 시크릿이 만료되지 않았는지 확인합니다.

### ❌ `403 Forbidden` 또는 `Insufficient privileges`
- App Registration에 `User.Read.All`/`Directory.Read.All` Application 권한이 추가되어 있는지 확인합니다.
- **Grant admin consent** 버튼을 다시 눌러 승인 상태를 갱신합니다.

### ❌ Freshchat에 기본 정보만 표시됨
- Graph 호출이 실패해도 기본 정보만 전달되므로, 로그에서 `[Graph] Could not fetch extended profile` 메시지를 확인하고 위 오류 케이스를 점검합니다.

필요 시 `npm run verify`를 실행하여 Node 버전·환경 변수·Freshchat 연결 등을 한 번에 점검할 수 있습니다.

