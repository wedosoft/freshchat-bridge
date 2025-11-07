# SharePoint/OneDrive 도움말 탭 설정 가이드

Teams 앱의 도움말 탭을 SharePoint나 OneDrive의 HTML 파일로 연결하여, 관리자가 실시간으로 내용을 편집할 수 있도록 설정하는 방법입니다.

## 📋 목차

1. [왜 SharePoint/OneDrive를 사용하나요?](#왜-sharepointonedrive를-사용하나요)
2. [설정 방법](#설정-방법)
3. [HTML 파일 준비](#html-파일-준비)
4. [환경 변수 설정](#환경-변수-설정)
5. [캐시 관리](#캐시-관리)
6. [문제 해결](#문제-해결)

---

## 왜 SharePoint/OneDrive를 사용하나요?

### ✅ 장점

- **실시간 편집**: 서버 재배포 없이 HTML 파일만 수정하면 즉시 반영
- **협업 가능**: 여러 관리자가 SharePoint에서 함께 편집 가능
- **버전 관리**: SharePoint의 버전 기록으로 변경 이력 추적
- **권한 관리**: SharePoint 권한으로 편집자 제어
- **간편한 업데이트**: 긴급 공지나 매뉴얼 변경 시 즉시 대응

### 📝 사용 시나리오

- 긴급 공지사항 추가
- FAQ 업데이트
- 연락처 정보 변경
- 내부 정책 문서 링크 수정
- 계절별/이벤트별 안내사항 변경

---

## 설정 방법

### 1단계: HTML 파일 준비

기본 템플릿을 복사하여 SharePoint/OneDrive에 업로드합니다.

```bash
# 프로젝트의 기본 템플릿 사용
cp public/help-tab.html ~/Documents/help-guide.html
```

### 2단계: SharePoint/OneDrive에 업로드

#### SharePoint 사이트에 업로드

1. SharePoint 사이트 접속 (예: `https://yourcompany.sharepoint.com/sites/ITSupport`)
2. **Shared Documents** 또는 **문서** 라이브러리로 이동
3. `help-guide.html` 파일 업로드
4. 파일 URL 복사 (예: `https://yourcompany.sharepoint.com/sites/ITSupport/Shared%20Documents/help-guide.html`)

#### OneDrive에 업로드

1. OneDrive 접속
2. 적절한 폴더에 `help-guide.html` 파일 업로드
3. 파일 URL 복사 (예: `https://yourcompany-my.sharepoint.com/personal/username/Documents/help-guide.html`)

### 3단계: 권한 설정

**중요**: Bot 앱이 파일에 접근할 수 있도록 권한을 설정해야 합니다.

#### Azure AD 앱 권한 추가

1. [Azure Portal](https://portal.azure.com) → **Azure Active Directory** → **App registrations**
2. Bot 앱 선택 (BOT_APP_ID에 해당하는 앱)
3. **API permissions** → **Add a permission**
4. **Microsoft Graph** → **Application permissions** 선택
5. 다음 권限 추가:
   - **Sites.Read.All** (SharePoint 파일 읽기)
   - 또는 **Files.Read.All** (OneDrive 파일 읽기)
6. **Grant admin consent** 클릭

### 4단계: 환경 변수 설정

`.env` 파일에 다음 설정을 추가합니다:

```bash
# SharePoint 사용 예시
HELP_TAB_SOURCE=sharepoint
HELP_TAB_FILE_URL=https://yourcompany.sharepoint.com/sites/ITSupport/Shared%20Documents/help-guide.html
HELP_TAB_CACHE_TTL=300000

# OneDrive 사용 예시
HELP_TAB_SOURCE=onedrive
HELP_TAB_FILE_URL=https://yourcompany-my.sharepoint.com/personal/username/Documents/help-guide.html
HELP_TAB_CACHE_TTL=300000
```

#### 환경 변수 설명

| 변수명 | 설명 | 기본값 |
|--------|------|--------|
| `HELP_TAB_SOURCE` | 파일 소스 (`local`, `sharepoint`, `onedrive`) | `local` |
| `HELP_TAB_FILE_URL` | SharePoint/OneDrive 파일 전체 URL | - |
| `HELP_TAB_CACHE_TTL` | 캐시 유지 시간 (밀리초) | `300000` (5분) |

### 5단계: 서버 재시작

```bash
npm run dev
# 또는 프로덕션
npm start
```

---

## HTML 파일 준비

### 기본 구조

SharePoint/OneDrive에 업로드할 HTML 파일은 완전한 HTML 문서여야 합니다:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>도움말</title>
    <script src="https://res.cdn.office.net/teams-js/2.0.0/js/MicrosoftTeams.min.js"></script>
    <style>
        /* 스타일 추가 */
    </style>
</head>
<body>
    <!-- 내용 -->
    <script>
        microsoftTeams.app.initialize();
    </script>
</body>
</html>
```

### ⚠️ 주의사항

1. **완전한 HTML 문서**: `<!DOCTYPE html>`부터 `</html>`까지 모두 포함
2. **Teams SDK 필수**: `<script src="https://res.cdn.office.net/teams-js/2.0.0/js/MicrosoftTeams.min.js"></script>`
3. **초기화 코드 필수**: `microsoftTeams.app.initialize();`
4. **인코딩**: UTF-8로 저장 (한글 깨짐 방지)
5. **외부 리소스**: 이미지, CSS, JS는 절대 URL 사용 권장

### 예시 템플릿

프로젝트의 `public/help-tab.html` 파일을 참고하여 작성하세요. 주요 섹션:

```html
<!-- 헤더 섹션 -->
<div class="header">
    <h1>도움말</h1>
    <p class="subtitle">설명</p>
</div>

<!-- 링크 카드 -->
<div class="link-card">
    <div class="link-icon">📄</div>
    <div class="link-content">
        <a href="https://example.com" target="_blank">
            <strong>링크 제목</strong>
        </a>
        <p>링크 설명</p>
    </div>
</div>
```

---

## 캐시 관리

### 자동 캐시 갱신

- 설정한 `HELP_TAB_CACHE_TTL` 시간이 지나면 자동으로 SharePoint에서 최신 파일을 다운로드
- 기본값: 5분 (300000ms)

### 수동 캐시 새로고침

SharePoint에서 파일을 수정한 후 즉시 반영하려면:

```bash
curl -X POST https://your-server.com/tab-content/refresh
```

응답 예시:
```json
{
  "success": true,
  "message": "Help tab cache refreshed successfully",
  "contentLength": 12345,
  "timestamp": "2025-11-07T10:30:00.000Z"
}
```

### 캐시 동작 방식

1. 첫 요청: SharePoint에서 파일 다운로드 → 캐시 저장
2. 이후 요청 (TTL 내): 캐시된 내용 반환 (빠름)
3. TTL 초과: SharePoint에서 다시 다운로드 → 캐시 갱신
4. 오류 발생: 로컬 `public/help-tab.html`로 자동 폴백

---

## 문제 해결

### 1. "도움말을 불러올 수 없습니다" 오류

**원인**: SharePoint 파일 접근 권한 부족

**해결**:
1. Azure Portal에서 앱 권한 확인 (`Sites.Read.All` 또는 `Files.Read.All`)
2. Admin consent 부여 확인
3. 파일 URL이 올바른지 확인
4. 로그 확인: `[Help Tab] Failed to fetch from SharePoint/OneDrive`

### 2. 파일이 업데이트되지 않음

**원인**: 캐시가 아직 유효함

**해결**:
```bash
# 수동으로 캐시 새로고침
curl -X POST https://your-server.com/tab-content/refresh
```

또는 `.env`에서 `HELP_TAB_CACHE_TTL`을 더 짧게 설정:
```bash
HELP_TAB_CACHE_TTL=60000  # 1분
```

### 3. 한글이 깨져서 표시됨

**원인**: HTML 파일 인코딩 문제

**해결**:
1. HTML 파일을 UTF-8로 저장
2. `<meta charset="utf-8">` 태그 확인
3. SharePoint에서 다시 업로드

### 4. Graph API 인증 오류

**원인**: Bot 인증 정보 오류

**해결**:
`.env` 파일 확인:
```bash
BOT_APP_ID=올바른값
BOT_APP_PASSWORD=올바른값
BOT_TENANT_ID=올바른값
```

### 5. 로컬 파일로 폴백됨

**로그 확인**:
```
[Help Tab] Failed to fetch from SharePoint/OneDrive, falling back to local file
```

**원인**:
- SharePoint URL이 잘못됨
- 권한 부족
- 네트워크 오류

**해결**:
1. `HELP_TAB_FILE_URL` 정확성 확인
2. Azure AD 앱 권한 재확인
3. 파일이 실제로 존재하는지 확인

---

## 실시간 편집 워크플로우

### 관리자 작업 흐름

1. **SharePoint에서 HTML 파일 열기**
   - 웹 브라우저에서 직접 편집
   - 또는 파일을 다운로드하여 로컬에서 편집 후 재업로드

2. **내용 수정**
   - 링크 변경
   - 텍스트 업데이트
   - 새 섹션 추가

3. **저장**
   - SharePoint가 자동으로 버전 저장

4. **반영 확인**
   - 5분 이내 자동 반영 (기본 캐시 TTL)
   - 또는 즉시 반영: `POST /tab-content/refresh` 호출

5. **Teams에서 확인**
   - 도움말 탭 새로고침하여 변경사항 확인

---

## 고급 설정

### 1. 여러 환경별 파일 관리

프로덕션과 개발 환경에서 다른 파일 사용:

```bash
# .env.production
HELP_TAB_FILE_URL=https://company.sharepoint.com/sites/ITSupport/Production/help.html

# .env.development
HELP_TAB_FILE_URL=https://company.sharepoint.com/sites/ITSupport/Dev/help.html
```

### 2. 다국어 지원

환경 변수로 언어별 파일 지정:

```bash
HELP_TAB_FILE_URL_KO=https://company.sharepoint.com/.../help-ko.html
HELP_TAB_FILE_URL_EN=https://company.sharepoint.com/.../help-en.html
```

### 3. A/B 테스트

서로 다른 버전의 도움말 페이지 테스트:

```bash
# 50% 사용자에게 버전 A, 50%에게 버전 B
HELP_TAB_FILE_URL_A=https://.../help-v1.html
HELP_TAB_FILE_URL_B=https://.../help-v2.html
```

---

## 보안 고려사항

### 1. 최소 권한 원칙

Bot 앱에는 필요한 최소 권한만 부여:
- ✅ `Sites.Read.All` (읽기 전용)
- ❌ `Sites.ReadWrite.All` (불필요)

### 2. 파일 접근 제한

SharePoint 파일에 대한 접근을 IT 관리자만 수정할 수 있도록 설정

### 3. HTTPS 필수

모든 SharePoint/OneDrive URL은 HTTPS 사용 (자동)

### 4. 민감 정보 주의

HTML 파일에 다음 정보를 포함하지 마세요:
- API 키
- 비밀번호
- 개인정보
- 내부 시스템 상세 정보

---

## FAQ

**Q: SharePoint에서 파일을 수정하면 얼마나 빨리 반영되나요?**
A: 기본 5분 이내 자동 반영. 즉시 반영하려면 `/tab-content/refresh` 엔드포인트 호출.

**Q: OneDrive 개인 계정도 사용할 수 있나요?**
A: 네, 조직 OneDrive와 개인 OneDrive 모두 지원합니다.

**Q: HTML 파일 크기 제한이 있나요?**
A: Graph API 제한에 따라 일반적으로 4MB까지 가능합니다.

**Q: 이미지는 어떻게 포함하나요?**
A: 이미지는 SharePoint에 함께 업로드하고 절대 URL로 참조하거나, 외부 CDN 사용을 권장합니다.

**Q: 로컬 파일로 되돌리려면?**
A: `.env`에서 `HELP_TAB_SOURCE=local`로 변경하고 서버 재시작.

---

## 참고 자료

- [Microsoft Graph API 문서](https://docs.microsoft.com/graph/api/overview)
- [SharePoint 파일 접근](https://docs.microsoft.com/graph/api/driveitem-get-content)
- [Azure AD 앱 권한](https://docs.microsoft.com/azure/active-directory/develop/v2-permissions-and-consent)
- [Teams 앱 탭 개발](https://docs.microsoft.com/microsoftteams/platform/tabs/what-are-tabs)

---

**문의**: 문제가 지속되면 [GitHub Issues](https://github.com/your-repo/issues)에 보고해 주세요.
