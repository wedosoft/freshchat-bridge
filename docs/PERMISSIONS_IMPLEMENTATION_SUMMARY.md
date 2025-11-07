# 권한 구현 요약

## 📋 개요

고객사 배포 시 필요한 두 가지 권한 문제를 해결했습니다:

1. **사용자 프로필 정보 접근** - Graph API를 통한 Teams 사용자 상세 정보 수집
2. **SharePoint/OneDrive 파일 접근** - 도움말 탭 HTML 파일 읽기

## 🎯 구현 내용

### 1. Azure AD 권한 설정

**필요한 Application 권한:**
- ✅ `User.Read.All` - 사용자 프로필 정보 (이름, 이메일, 직급, 부서, 전화번호, 근무지)
- ✅ `Sites.Read.All` - SharePoint 파일 읽기 (또는 `Files.Read.All` for OneDrive)
- ✅ `Team.ReadBasic.All` - Teams 대화 컨텍스트

### 2. Teams 앱 매니페스트 업데이트

**파일:** [teams-app/manifest.json](../teams-app/manifest.json)

추가된 섹션:
```json
{
  "webApplicationInfo": {
    "id": "6a46afe9-3109-4af6-a0f9-275f6fddf929",
    "resource": "api://freshchat-bridge.fly.dev/6a46afe9-3109-4af6-a0f9-275f6fddf929"
  }
}
```

이를 통해 Teams 앱 설치 시 자동으로 권한 동의를 요청할 수 있습니다.

### 3. 관리자 동의 엔드포인트

**파일:** [poc-bridge.js](../poc-bridge.js)

새로운 엔드포인트 추가:

#### `/auth/admin-consent`
- Azure AD 관리자 동의 페이지로 리디렉션
- 고객사 IT 관리자가 URL 클릭 한 번으로 전사 권한 승인 가능

#### `/auth/admin-consent/callback`
- 권한 승인 완료 후 결과 표시
- 성공/실패 여부를 사용자 친화적인 HTML 페이지로 안내

#### `/auth/permissions-status`
- 현재 부여된 권한 상태를 실시간으로 확인
- 각 권한을 테스트하여 실제 작동 여부 검증
- JSON 형식으로 결과 반환

**사용 예시:**
```bash
# 관리자 동의 URL (고객사 IT 관리자에게 전달)
https://freshchat-bridge.fly.dev/auth/admin-consent

# 권한 상태 확인
https://freshchat-bridge.fly.dev/auth/permissions-status
```

### 4. 문서화

생성된 문서:

| 문서 | 대상 | 설명 |
|------|------|------|
| [AZURE_AD_PERMISSIONS.md](./AZURE_AD_PERMISSIONS.md) | 기술팀 | Azure AD 권한 설정 상세 가이드 |
| [CUSTOMER_DEPLOYMENT_GUIDE.md](./CUSTOMER_DEPLOYMENT_GUIDE.md) | 고객사 IT 관리자 | 3가지 배포 방법 및 문제 해결 |
| [ADMIN_CONSENT_QUICKSTART.md](./ADMIN_CONSENT_QUICKSTART.md) | 고객사 IT 관리자 | 5분 빠른 시작 가이드 |
| [HELP_TAB_SHAREPOINT.md](./HELP_TAB_SHAREPOINT.md) | 관리자 | SharePoint 도움말 탭 설정 (기존) |

### 5. 환경 변수 업데이트

**파일:** [.env.example](../.env.example)

추가된 설명:
```bash
# ============================================================================
# Required Graph API Permissions
# ============================================================================
# Application Permissions (not Delegated):
# 1. User.Read.All          - Read user profile information
# 2. Sites.Read.All         - Read SharePoint files
# 3. Team.ReadBasic.All     - Read Teams conversation context
#
# To grant these permissions:
# Method 1 (Easiest): Visit https://YOUR_PUBLIC_URL/auth/admin-consent
# Method 2: Azure Portal → API permissions → Grant admin consent
# Method 3: Teams Admin Center → Upload app package → Accept permissions
#
# Verify permissions status: https://YOUR_PUBLIC_URL/auth/permissions-status
```

## 🚀 고객사 배포 프로세스

### 방법 1: 간편 URL (권장) ⭐

```
https://freshchat-bridge.fly.dev/auth/admin-consent
```

1. 위 URL을 고객사 IT 관리자에게 전달
2. 관리자 계정으로 로그인
3. 권한 검토 후 "조직을 대신하여 동의함" 체크 → 수락
4. 완료!

**소요 시간:** 2분

### 방법 2: Teams Admin Center

1. Teams Admin Center에서 앱 패키지 업로드
2. 자동으로 권한 동의 화면 표시
3. Accept 클릭
4. 앱 정책 설정

**소요 시간:** 5-10분

### 방법 3: Azure Portal

1. Azure Portal → App registrations
2. EXO헬프 앱 검색
3. API permissions → Grant admin consent
4. 모든 권한 녹색 체크 확인

**소요 시간:** 3-5분

## ✅ 검증 방법

### 1. 권한 상태 API 호출

```bash
curl https://freshchat-bridge.fly.dev/auth/permissions-status
```

**성공 응답:**
```json
{
  "success": true,
  "tenant": "customer-tenant-id",
  "permissions": {
    "User.Read.All": {
      "granted": true,
      "tested": true
    },
    "Sites.Read.All": {
      "granted": true,
      "tested": true
    },
    "Team.ReadBasic.All": {
      "granted": true,
      "tested": true
    }
  },
  "timestamp": "2025-11-07T10:30:00.000Z"
}
```

### 2. 사용자 정보 전송 테스트

1. Teams에서 EXO헬프 봇과 대화 시작
2. Freshchat 관리 페이지에서 사용자 프로필 확인
3. 다음 정보가 표시되어야 함:
   - ✅ teams_email
   - ✅ teams_job_title
   - ✅ teams_department
   - ✅ teams_phone
   - ✅ teams_office_location

### 3. SharePoint 도움말 탭 테스트

1. `.env`에 SharePoint URL 설정:
   ```bash
   HELP_TAB_SOURCE=sharepoint
   HELP_TAB_FILE_URL=https://company.sharepoint.com/.../help.html
   ```
2. Teams 앱의 "도움말" 탭 열기
3. SharePoint 파일 내용이 정상 표시되어야 함

## 🔐 보안 고려사항

### 최소 권한 원칙

- ✅ **읽기 전용** 권한만 요청 (쓰기/삭제 권한 없음)
- ✅ **Application 권한** 사용 (사용자별 동의 불필요)
- ✅ **필요한 범위만** 요청 (과도한 권한 요청하지 않음)

### 데이터 보호

- 수집된 정보는 Freshchat 전송용으로만 사용
- 서버에 영구 저장하지 않음 (24시간 메모리 캐시)
- 모든 통신은 HTTPS 암호화
- Azure AD 감사 로그에 모든 접근 기록

### GDPR 준수

- 데이터 최소화
- 명시적 동의 (관리자 승인)
- 투명성 (수집 정보 명시)
- 보안 조치 (암호화, 로그)

## 📊 기술 세부사항

### Graph API 토큰 획득

```javascript
async function getGraphAccessToken() {
    const tokenEndpoint = `https://login.microsoftonline.com/${BOT_TENANT_ID}/oauth2/v2.0/token`;
    const response = await axios.post(tokenEndpoint, new URLSearchParams({
        client_id: BOT_APP_ID,
        client_secret: BOT_APP_PASSWORD,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
    }));
    return response.data.access_token;
}
```

### 사용자 프로필 조회

기존 코드의 `getUserProfile()` 함수가 이미 구현되어 있으며, 다음 정보를 수집합니다:

```javascript
{
    displayName: user.displayName,
    email: user.mail || user.userPrincipalName,
    jobTitle: user.jobTitle,
    department: user.department,
    officeLocation: user.officeLocation,
    mobilePhone: user.mobilePhone,
    businessPhones: user.businessPhones?.[0]
}
```

### SharePoint 파일 접근

```javascript
// Graph API를 통한 SharePoint 파일 다운로드
const graphUrl = `https://graph.microsoft.com/v1.0/sites/${hostname}.sharepoint.com:/sites/${siteName}:/drive/root:/${filePath}:/content`;

const response = await axios.get(graphUrl, {
    headers: {
        'Authorization': `Bearer ${accessToken}`
    }
});
```

## 🛠️ 문제 해결

### "Insufficient privileges" 오류

**원인:** Admin consent가 부여되지 않음

**해결:**
1. `/auth/admin-consent` URL 재방문
2. 또는 Azure Portal에서 직접 "Grant admin consent" 클릭

### "Need admin approval" 메시지

**원인:** Delegated 권한으로 설정됨

**해결:**
1. Azure Portal → API permissions
2. 기존 권한 삭제 후 Application 권한으로 재추가
3. Admin consent 재부여

### SharePoint 파일 접근 실패

**원인:** Sites.Read.All 권한 누락 또는 잘못된 파일 URL

**해결:**
1. 권한 상태 API로 Sites.Read.All 확인
2. SharePoint 파일 URL이 정확한지 확인
3. 파일이 실제로 존재하는지 확인

## 📚 추가 리소스

- [Microsoft Graph API 문서](https://docs.microsoft.com/graph/api/overview)
- [Azure AD Admin Consent](https://docs.microsoft.com/azure/active-directory/develop/v2-admin-consent)
- [Teams 앱 권한](https://docs.microsoft.com/microsoftteams/platform/concepts/device-capabilities/browser-device-permissions)
- [Graph API Explorer](https://developer.microsoft.com/graph/graph-explorer)

## 🎯 다음 단계

1. **테스트 환경에서 검증**
   - 권한 상태 API 확인
   - 사용자 프로필 전송 테스트
   - SharePoint 도움말 탭 테스트

2. **고객사 배포 준비**
   - 배포 가이드 문서 전달
   - 관리자 동의 URL 제공
   - 지원 연락처 안내

3. **프로덕션 배포**
   - 고객사 IT 관리자와 협업
   - 권한 승인 완료
   - 전사 사용자 테스트

4. **모니터링**
   - Azure AD 감사 로그 확인
   - API 사용 통계 모니터링
   - 사용자 피드백 수집

---

**문서 버전:** 1.0
**최종 수정일:** 2025-11-07
**작성자:** We Do Soft Inc.
