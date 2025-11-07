# Azure AD 권한 설정 가이드

## 📋 개요

이 가이드는 Freshchat Bridge 앱이 고객사의 Microsoft Teams 환경에서 필요한 권한을 획득하는 방법을 설명합니다.

## 🎯 필요한 권한

### 1. Microsoft Graph API 권한

#### User Profile 정보 읽기
- **User.Read.All** (Application 권한)
  - 용도: Teams 사용자의 프로필 정보 조회
  - 수집 정보: 이름, 이메일, 직급, 부서, 전화번호, 근무지

#### SharePoint/OneDrive 파일 읽기
- **Sites.Read.All** (Application 권한)
  - 용도: SharePoint에 업로드된 도움말 탭 HTML 파일 읽기
  - 또는 **Files.Read.All** (OneDrive 사용 시)

#### 기타 필수 권한
- **Team.ReadBasic.All** (Application 권한)
  - 용도: Teams 대화 컨텍스트 정보 읽기

## 🔧 Azure Portal 설정 방법

### 1단계: Azure Portal에서 앱 등록

1. [Azure Portal](https://portal.azure.com) 접속
2. **Azure Active Directory** → **App registrations** 이동
3. 기존 Bot 앱 선택 (BOT_APP_ID에 해당)

### 2단계: API 권한 추가

1. 좌측 메뉴에서 **API permissions** 선택
2. **+ Add a permission** 클릭
3. **Microsoft Graph** 선택
4. **Application permissions** 선택 (Delegated가 아님!)
5. 다음 권한 검색 및 추가:
   - ✅ `User.Read.All`
   - ✅ `Sites.Read.All` (SharePoint 사용 시)
   - ✅ `Files.Read.All` (OneDrive 사용 시)
   - ✅ `Team.ReadBasic.All`

### 3단계: 관리자 동의 부여 (중요!)

⚠️ **이 단계가 가장 중요합니다!**

1. API permissions 화면에서 **Grant admin consent for [조직명]** 버튼 클릭
2. 확인 대화상자에서 **Yes** 클릭
3. 모든 권한의 **Status** 열이 녹색 체크 표시(✓)로 변경되었는지 확인

![Admin Consent](https://docs.microsoft.com/en-us/azure/active-directory/develop/media/quickstart-configure-app-access-web-apis/portal-02-app-reg-04.png)

### 4단계: 인증서/비밀 확인

1. 좌측 메뉴에서 **Certificates & secrets** 선택
2. Client Secret이 활성화되어 있는지 확인
3. 만료일 확인 (만료 전 갱신 필요)

## 📦 Teams 앱 매니페스트 설정

### webApplicationInfo 섹션 추가

`teams-app/manifest.json` 파일에 다음 섹션을 추가해야 합니다:

```json
{
  "webApplicationInfo": {
    "id": "6a46afe9-3109-4af6-a0f9-275f6fddf929",
    "resource": "api://freshchat-bridge.fly.dev/6a46afe9-3109-4af6-a0f9-275f6fddf929"
  }
}
```

### 권한 목록

```json
{
  "permissions": [
    "identity",
    "messageTeamMembers"
  ],
  "webApplicationInfo": {
    "id": "YOUR_BOT_APP_ID",
    "resource": "api://YOUR_PUBLIC_URL/YOUR_BOT_APP_ID"
  }
}
```

## 🚀 고객사 배포 프로세스

### 방법 1: 앱 설치 시 자동 동의 (권장)

앱을 Teams App Catalog에 업로드하면, 조직 관리자가 앱을 승인할 때 자동으로 권한 동의를 요청받습니다.

**장점:**
- ✅ 한 번의 승인으로 전사 적용
- ✅ 별도의 Azure Portal 접근 불필요
- ✅ 사용자 친화적

**단점:**
- ❌ Teams 관리자 권한 필요
- ❌ 초기 설정이 조금 더 복잡

#### 구현 단계:

1. **manifest.json 업데이트**
   ```json
   {
     "webApplicationInfo": {
       "id": "BOT_APP_ID",
       "resource": "api://PUBLIC_URL/BOT_APP_ID"
     }
   }
   ```

2. **앱 패키지 생성**
   ```bash
   cd teams-app
   zip -r app-package.zip manifest.json color.png outline.png
   ```

3. **Teams Admin Center에서 앱 업로드**
   - [Teams Admin Center](https://admin.teams.microsoft.com) 접속
   - **Teams apps** → **Manage apps** → **Upload** 클릭
   - `app-package.zip` 업로드

4. **권한 승인**
   - 업로드 후 자동으로 권한 동의 화면 표시
   - 관리자가 **Accept** 클릭

### 방법 2: Azure Portal에서 수동 동의

고객사의 Azure AD 관리자가 직접 Azure Portal에서 권한을 부여합니다.

**장점:**
- ✅ Azure Portal에 익숙한 관리자에게 적합
- ✅ 세밀한 권한 제어 가능

**단점:**
- ❌ Azure Portal 접근 권한 필요
- ❌ 매뉴얼한 작업 필요

#### 단계:

1. 고객사 관리자가 [Azure Portal](https://portal.azure.com) 접속
2. **Azure Active Directory** → **App registrations** 이동
3. **All applications** 탭에서 Bot 앱 검색 (BOT_APP_ID로 검색)
4. **API permissions** → **Grant admin consent** 클릭

### 방법 3: 동의 URL 제공 (가장 간편)

동의 URL을 생성하여 고객사 관리자에게 전달합니다.

**장점:**
- ✅ 가장 간편 (URL 클릭만으로 완료)
- ✅ 이메일로 전달 가능
- ✅ Azure Portal 지식 불필요

**단점:**
- ❌ URL 생성 필요

#### 동의 URL 생성:

```
https://login.microsoftonline.com/{TENANT_ID}/adminconsent?client_id={BOT_APP_ID}
```

실제 예시:
```
https://login.microsoftonline.com/common/adminconsent?client_id=6a46afe9-3109-4af6-a0f9-275f6fddf929
```

이 URL을 고객사 IT 관리자에게 전달하면, 클릭 한 번으로 권한 동의 완료됩니다.

## 🔐 권한 범위 설명

### User.Read.All
- **위험도**: 중간
- **수집 정보**: 사용자 프로필 (이름, 이메일, 직급, 부서)
- **민감 정보**: 전화번호, 사무실 위치
- **용도**: Freshchat에 사용자 정보 전달하여 상담원이 고객 정보 확인

### Sites.Read.All / Files.Read.All
- **위험도**: 낮음 (읽기 전용)
- **접근 범위**: SharePoint 사이트 또는 OneDrive 파일
- **용도**: 도움말 탭 HTML 파일 읽기
- **보안**: 읽기 전용이므로 파일 수정/삭제 불가

### Team.ReadBasic.All
- **위험도**: 낮음
- **접근 정보**: Teams 대화방 기본 정보
- **용도**: 메시지 컨텍스트 파악

## 📊 권한 승인 확인 방법

### Azure Portal에서 확인

1. [Azure Portal](https://portal.azure.com) → **Azure Active Directory**
2. **Enterprise applications** → Bot 앱 검색
3. **Permissions** 탭에서 다음 확인:
   - ✅ User.Read.All: **Granted for [조직명]**
   - ✅ Sites.Read.All: **Granted for [조직명]**
   - ✅ Team.ReadBasic.All: **Granted for [조직명]**

### 앱에서 확인

앱 시작 시 로그를 확인:

```bash
npm start
```

로그 출력:
```
[Graph API] Successfully authenticated with User.Read.All scope
[Graph API] Successfully authenticated with Sites.Read.All scope
[Help Tab] Successfully loaded content from SharePoint
```

오류 발생 시:
```
[Graph API] Error: Insufficient privileges to complete the operation
[Help Tab] Failed to fetch from SharePoint: 403 Forbidden
```

→ 권한이 부여되지 않았음을 의미

## 🛠️ 문제 해결

### 문제 1: "Insufficient privileges" 오류

**원인**: Admin consent가 부여되지 않음

**해결**:
1. Azure Portal → App registrations → API permissions
2. **Grant admin consent** 버튼 클릭
3. 모든 권한이 녹색 체크 표시인지 확인

### 문제 2: "Need admin approval" 메시지

**원인**: Delegated 권한으로 설정됨

**해결**:
1. API permissions에서 권한 삭제
2. **Application permissions**로 다시 추가 (Delegated 아님!)
3. Admin consent 재부여

### 문제 3: SharePoint 파일 접근 실패

**원인**: Sites.Read.All 권한 누락

**해결**:
1. API permissions에서 Sites.Read.All 추가
2. Admin consent 부여
3. 앱 재시작

## 📚 참고 자료

- [Microsoft Graph API 권한 문서](https://docs.microsoft.com/graph/permissions-reference)
- [Azure AD Admin Consent](https://docs.microsoft.com/azure/active-directory/develop/v2-admin-consent)
- [Teams 앱 권한](https://docs.microsoft.com/microsoftteams/platform/concepts/device-capabilities/browser-device-permissions)

## 🔒 보안 고려사항

### 최소 권한 원칙

앱은 필요한 최소한의 권한만 요청합니다:
- ✅ **읽기 전용** 권한 사용 (Read.All, 쓰기 권한 없음)
- ✅ **Application 권한** (사용자별 동의 불필요)
- ❌ **과도한 권한 요청하지 않음** (예: Mail.Send, Files.ReadWrite)

### 데이터 보호

- 수집된 사용자 정보는 Freshchat 전송용으로만 사용
- 서버에 영구 저장하지 않음 (메모리 캐시만 사용)
- 암호화된 HTTPS 통신만 사용

### 감사 로그

모든 Graph API 호출은 Azure AD 감사 로그에 기록됩니다:
- Azure Portal → Azure Active Directory → Audit logs
- 어떤 앱이 언제 어떤 데이터에 접근했는지 추적 가능

---

## ✅ 체크리스트

고객사 배포 전 확인사항:

- [ ] Azure AD에서 Bot 앱 등록 완료
- [ ] API permissions에 필요한 권한 추가 완료
- [ ] Admin consent 부여 완료 (녹색 체크 표시 확인)
- [ ] .env 파일에 BOT_APP_ID, BOT_APP_PASSWORD, BOT_TENANT_ID 설정
- [ ] manifest.json에 webApplicationInfo 섹션 추가
- [ ] 앱 패키지 생성 및 Teams에 업로드
- [ ] 테스트 사용자로 프로필 정보 전송 확인
- [ ] SharePoint 도움말 탭 로딩 확인

**배포 완료 후 고객사에 안내:**
- 앱 설치 시 권한 동의 필요
- IT 관리자 또는 Global Administrator 권한 필요
- 전사 사용자에게 자동 적용됨
