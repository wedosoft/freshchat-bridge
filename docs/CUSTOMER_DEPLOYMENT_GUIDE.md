# 고객사 배포 가이드

## 📋 개요

이 문서는 고객사 IT 관리자가 EXO헬프 Teams 앱을 배포하고 필요한 권한을 승인하는 방법을 안내합니다.

## 🎯 배포 목적

EXO헬프 앱은 다음 기능을 제공하기 위해 특정 권한이 필요합니다:

1. **사용자 프로필 정보 전송** - Freshchat 상담원이 고객 정보를 확인할 수 있도록 Teams 사용자 정보(이름, 이메일, 직급, 부서, 전화번호 등)를 자동으로 전송합니다.
2. **실시간 도움말 탭** - 관리자가 SharePoint/OneDrive에서 관리하는 HTML 파일을 도움말 탭으로 표시하여, 서버 재배포 없이 내용을 실시간으로 업데이트할 수 있습니다.

## 🔐 필요한 권한

### Microsoft Graph API 권한

| 권한 | 유형 | 용도 | 위험도 |
|------|------|------|--------|
| **User.Read.All** | Application | 사용자 프로필 정보 읽기 (이름, 이메일, 직급, 부서, 전화번호) | 중간 |
| **Sites.Read.All** | Application | SharePoint에 업로드된 도움말 HTML 파일 읽기 | 낮음 (읽기 전용) |
| **Team.ReadBasic.All** | Application | Teams 대화 컨텍스트 정보 읽기 | 낮음 |

**중요:** 모든 권한은 **읽기 전용**이며, 쓰기/수정/삭제 권한은 요청하지 않습니다.

## 🚀 배포 방법 (3가지 옵션)

### 방법 1️⃣: 간편 URL 방식 (권장) ⭐

**가장 쉽고 빠른 방법입니다!**

1. 아래 URL을 클릭합니다:
   ```
   https://freshchat-bridge.fly.dev/auth/admin-consent
   ```

2. Microsoft 로그인 화면이 나타나면 **조직 관리자 계정**으로 로그인합니다.

3. 권한 승인 화면에서 다음 권한을 검토합니다:
   - ✅ 사용자 프로필 읽기 (User.Read.All)
   - ✅ SharePoint 파일 읽기 (Sites.Read.All)
   - ✅ Teams 정보 읽기 (Team.ReadBasic.All)

4. **조직을 대신하여 동의함** 체크박스를 선택합니다.

5. **수락** 버튼을 클릭합니다.

6. 성공 화면이 표시되면 완료! 🎉

**필요한 권한:**
- Azure AD의 **Global Administrator** 또는 **Application Administrator** 역할

**소요 시간:** 약 2분

---

### 방법 2️⃣: Teams Admin Center 방식

**Teams 앱 업로드와 권한 승인을 동시에 진행합니다.**

#### 1단계: 앱 패키지 다운로드

당사에서 제공한 `app-package.zip` 파일을 다운로드합니다.

#### 2단계: Teams Admin Center에서 앱 업로드

1. [Teams Admin Center](https://admin.teams.microsoft.com) 접속
2. 좌측 메뉴에서 **Teams apps** → **Manage apps** 선택
3. 상단의 **Upload** 버튼 클릭
4. `app-package.zip` 파일 선택 후 업로드

#### 3단계: 권한 승인

1. 앱 업로드 후 자동으로 권한 승인 화면이 표시됩니다.
2. 요청된 권한을 검토합니다:
   - User.Read.All
   - Sites.Read.All
   - Team.ReadBasic.All
3. **Accept** 버튼 클릭

#### 4단계: 앱 정책 설정

1. **Teams apps** → **Setup policies** 선택
2. 적용할 정책 선택 (또는 새로 생성)
3. **Installed apps** 섹션에서 **Add apps** 클릭
4. "EXO헬프" 검색 후 추가
5. **Save** 클릭

**필요한 권한:**
- Teams Administrator 또는 Global Administrator 역할

**소요 시간:** 약 5-10분

---

### 방법 3️⃣: Azure Portal 방식

**Azure Portal에 익숙한 관리자에게 적합합니다.**

#### 1단계: Azure Portal 접속

1. [Azure Portal](https://portal.azure.com) 접속
2. **Azure Active Directory** 선택

#### 2단계: 앱 찾기

1. 좌측 메뉴에서 **App registrations** 선택
2. 상단 탭에서 **All applications** 선택
3. 검색창에 다음 중 하나를 입력:
   - 앱 이름: **EXO헬프**
   - 또는 App ID: **6a46afe9-3109-4af6-a0f9-275f6fddf929**

#### 3단계: API 권한 확인

1. 찾은 앱을 클릭
2. 좌측 메뉴에서 **API permissions** 선택
3. 다음 권한이 표시되는지 확인:
   - Microsoft Graph → User.Read.All
   - Microsoft Graph → Sites.Read.All
   - Microsoft Graph → Team.ReadBasic.All

#### 4단계: 관리자 동의 부여

1. **Grant admin consent for [조직명]** 버튼 클릭
2. 확인 대화상자에서 **Yes** 클릭
3. 모든 권한의 **Status** 열이 녹색 체크 표시(✓)로 변경되었는지 확인

**필요한 권한:**
- Global Administrator 또는 Application Administrator 역할

**소요 시간:** 약 3-5분

---

## ✅ 배포 후 확인

### 1. 권한 상태 확인

브라우저에서 다음 URL을 열어 권한 상태를 확인합니다:

```
https://freshchat-bridge.fly.dev/auth/permissions-status
```

**성공 예시:**
```json
{
  "success": true,
  "tenant": "your-tenant-id",
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

### 2. Teams 앱 테스트

1. Microsoft Teams 앱 실행
2. 좌측 사이드바에서 **Apps** (앱) 클릭
3. "EXO헬프" 검색
4. **Add** (추가) 클릭
5. 챗봇에게 테스트 메시지 전송
6. **도움말** 탭이 정상적으로 표시되는지 확인

### 3. 사용자 정보 전송 확인

1. Teams에서 EXO헬프 봇과 대화 시작
2. Freshchat 관리자 페이지에서 새 대화 확인
3. 사용자 프로필에 다음 정보가 표시되는지 확인:
   - ✅ 이름
   - ✅ 이메일
   - ✅ 직급 (teams_job_title)
   - ✅ 부서 (teams_department)
   - ✅ 전화번호 (teams_phone)
   - ✅ 근무지 (teams_office_location)

---

## 🛠️ 문제 해결

### 문제 1: "권한이 부족합니다" 오류

**증상:**
```
[Graph API] Error: Insufficient privileges to complete the operation
```

**원인:** 관리자 동의가 부여되지 않음

**해결:**
1. [방법 1](#방법-1️⃣-간편-url-방식-권장-)의 URL을 다시 방문하여 권한 승인
2. 또는 Azure Portal에서 직접 **Grant admin consent** 클릭

---

### 문제 2: "도움말을 불러올 수 없습니다" 오류

**증상:** 도움말 탭에 오류 메시지 표시

**원인:** SharePoint 파일 접근 권한 부족

**해결:**
1. `.env` 파일에서 `HELP_TAB_SOURCE` 설정 확인:
   ```bash
   HELP_TAB_SOURCE=sharepoint
   HELP_TAB_FILE_URL=https://your-sharepoint-url/help.html
   ```
2. Azure Portal에서 **Sites.Read.All** 권한이 부여되었는지 확인
3. SharePoint 파일이 실제로 존재하는지 확인

---

### 문제 3: "Need admin approval" 메시지

**증상:** 사용자가 앱 사용 시 "Need admin approval" 메시지 표시

**원인:** Application 권한 대신 Delegated 권한으로 설정됨

**해결:**
1. Azure Portal → App registrations → API permissions
2. 기존 Delegated 권한 삭제
3. **Application permissions**로 다시 추가
4. **Grant admin consent** 재부여

---

### 문제 4: 특정 사용자 정보만 수집되지 않음

**증상:** 이름과 이메일은 전송되지만, 직급이나 부서 정보는 누락됨

**원인:** Azure AD에서 해당 사용자의 프로필 정보가 비어있음

**해결:**
1. [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **Users**
2. 해당 사용자 선택
3. **Profile** 섹션에서 누락된 정보 입력:
   - Job title (직급)
   - Department (부서)
   - Office location (근무지)
   - Business phones (전화번호)
4. **Save** 클릭

---

## 📊 권한 감사 및 모니터링

### Azure AD 감사 로그 확인

모든 Graph API 호출은 Azure AD 감사 로그에 기록됩니다:

1. [Azure Portal](https://portal.azure.com) → **Azure Active Directory**
2. **Monitoring** → **Audit logs** 선택
3. 필터 설정:
   - **Service**: Microsoft Graph
   - **Application**: EXO헬프
4. 최근 활동 확인

### 권한 사용 통계

Microsoft 365 관리 센터에서 앱의 API 사용 통계를 확인할 수 있습니다:

1. [Microsoft 365 Admin Center](https://admin.microsoft.com)
2. **Reports** → **Usage** → **Microsoft 365 apps**
3. "EXO헬프" 앱 선택
4. API 호출 통계 및 사용자 수 확인

---

## 🔒 보안 및 개인정보 보호

### 데이터 처리 정책

- ✅ 수집된 사용자 정보는 Freshchat 전송 목적으로만 사용
- ✅ 서버에 영구 저장하지 않음 (24시간 메모리 캐시만 사용)
- ✅ 모든 통신은 HTTPS 암호화
- ✅ 최소 권한 원칙 준수 (읽기 전용 권한만 요청)

### GDPR 준수

앱은 다음 GDPR 요구사항을 준수합니다:

- **데이터 최소화**: 필요한 정보만 수집
- **투명성**: 수집하는 정보와 용도를 명확히 고지
- **보안**: 암호화된 통신 및 안전한 저장
- **접근 권한**: 관리자 동의를 통한 명시적 승인

---

## 📞 지원 및 문의

### 기술 지원

배포 중 문제가 발생하면 다음 정보를 포함하여 문의해 주세요:

- 조직 Tenant ID
- 오류 메시지 스크린샷
- 권한 상태 확인 결과 (`/auth/permissions-status`)
- Azure Portal 감사 로그 (해당되는 경우)

**이메일:** support@wedosoft.net
**전화:** 02-XXXX-XXXX
**영업시간:** 평일 09:00 - 18:00 (KST)

### 추가 문서

- [Azure AD 권한 설정 가이드](./AZURE_AD_PERMISSIONS.md)
- [SharePoint 도움말 탭 설정](./HELP_TAB_SHAREPOINT.md)
- [문제 해결 FAQ](./TROUBLESHOOTING.md)

---

## 📝 체크리스트

배포 전 다음 사항을 확인하세요:

- [ ] 조직의 Global Administrator 또는 Application Administrator 권한 확보
- [ ] 배포 방법 선택 (방법 1, 2, 또는 3)
- [ ] 권한 승인 완료 (3가지 권한 모두)
- [ ] 권한 상태 확인 (`/auth/permissions-status`)
- [ ] Teams 앱 정책 설정 (방법 2 사용 시)
- [ ] 테스트 사용자로 앱 동작 확인
- [ ] Freshchat에서 사용자 정보 수신 확인
- [ ] 도움말 탭 정상 표시 확인
- [ ] 사용자 교육 자료 준비 (선택사항)

---

**배포 완료 후 팀원들에게 안내하세요:**

> 📢 **EXO헬프 앱이 설치되었습니다!**
>
> Microsoft Teams의 **앱** 메뉴에서 "EXO헬프"를 검색하여 추가하세요.
> IT 문제나 기술 지원이 필요하면 언제든지 대화를 시작하세요.
>
> 상담원이 신속하게 도움을 드릴 수 있도록 여러분의 기본 정보(이름, 부서, 연락처)가 자동으로 전달됩니다.

---

**문서 버전:** 1.0
**최종 수정일:** 2025-11-07
**작성자:** We Do Soft Inc.
