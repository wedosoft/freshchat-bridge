# SharePoint/OneDrive HTML 파일 경로 설정 가이드

## 🎯 3가지 시나리오

### 시나리오 1: 로컬 파일 사용 (기본) ✅

**언제 사용:** 고객이 SharePoint를 사용하지 않거나, 도움말을 고정된 내용으로 제공

**설정 방법:**
```bash
# 환경변수 (기본값이므로 설정 안 해도 됨)
HELP_TAB_SOURCE=local

# 파일 위치
public/help-tab.html  # 이 파일이 표시됨
```

**장점:**
- ✅ 설정 불필요
- ✅ 가장 간단
- ✅ SharePoint 권한 불필요

**단점:**
- ❌ 내용 변경 시 서버 재배포 필요
- ❌ 고객이 직접 수정 불가

---

### 시나리오 2: 고객사 SharePoint 사용 🔥 권장

**언제 사용:** 고객이 도움말 내용을 직접 관리하고 싶을 때

#### 2-1. 고객사 작업

**1단계: SharePoint에 파일 업로드**

```
1. SharePoint 사이트 접속
   예: https://customer.sharepoint.com/sites/ITSupport

2. 문서 라이브러리 선택
   예: "Shared Documents" 또는 "공유 문서"

3. help-guide.html 파일 업로드
   - 기본 템플릿: /Users/alan/GitHub/freshchat-bridge/public/help-tab.html 복사
   - 고객이 내용 편집 후 업로드

4. 파일 URL 복사
```

**SharePoint 파일 URL 얻는 방법:**

```
방법 A: 파일 우클릭 → "세부 정보" → "경로" 복사
방법 B: 파일 우클릭 → "링크 복사" → 직접 링크 선택
방법 C: 브라우저 주소창에서 URL 복사
```

**예시 URL:**
```
https://customer.sharepoint.com/sites/ITSupport/Shared%20Documents/help-guide.html
```

#### 2-2. We Do Soft 작업 (환경변수 설정)

고객으로부터 SharePoint URL을 받으면:

```bash
# Fly.dev 환경변수 설정
fly secrets set HELP_TAB_SOURCE=sharepoint
fly secrets set HELP_TAB_FILE_URL="https://customer.sharepoint.com/sites/ITSupport/Shared%20Documents/help-guide.html"

# 캐시 TTL 설정 (선택사항, 기본값: 5분)
fly secrets set HELP_TAB_CACHE_TTL=300000

# 자동으로 서버 재시작됨
```

**확인:**
```bash
# 설정된 환경변수 확인
fly secrets list

# 예상 출력:
# HELP_TAB_SOURCE              sharepoint
# HELP_TAB_FILE_URL            https://customer.sharepoint.com/...
```

---

### 시나리오 3: 고객사 OneDrive 사용

**언제 사용:** SharePoint 사이트가 없고 OneDrive만 있을 때

#### 3-1. 고객사 작업

**1단계: OneDrive에 파일 업로드**

```
1. OneDrive 접속 (onedrive.live.com 또는 office.com)

2. 적절한 폴더 선택
   예: "Documents" 또는 "IT Support" 폴더

3. help-guide.html 파일 업로드

4. 파일 URL 복사
```

**OneDrive 파일 URL 얻는 방법:**

```
방법 A: 파일 우클릭 → "공유" → "조직 내 사용자" → 링크 복사
방법 B: 파일 클릭 → 브라우저 주소창에서 URL 복사
```

**예시 URL:**
```
https://customer-my.sharepoint.com/personal/john_doe_customer_com/Documents/help-guide.html
```

#### 3-2. We Do Soft 작업

```bash
# Fly.dev 환경변수 설정
fly secrets set HELP_TAB_SOURCE=onedrive
fly secrets set HELP_TAB_FILE_URL="https://customer-my.sharepoint.com/personal/john_doe_customer_com/Documents/help-guide.html"
```

---

## 🔄 URL 형식별 처리

현재 코드는 다양한 URL 형식을 자동으로 처리합니다:

### 1. 직접 파일 URL (Private)
```
https://customer.sharepoint.com/sites/IT/Shared%20Documents/help.html
```
→ Graph API 인증으로 접근 (Sites.Read.All 권한 필요)

### 2. 공유 링크 (Public Share Link)
```
https://customer.sharepoint.com/:w:/s/ITSupport/EabcdefgHIJ?e=xyz123
```
→ 직접 다운로드 (권한 불필요)

### 3. OneDrive 공유 링크
```
https://1drv.ms/w/s!Abc123def
```
→ 리디렉션 후 다운로드 (권한 불필요)

### 4. OneDrive Embed URL
```
https://onedrive.live.com/embed?resid=ABC123&authkey=xyz
```
→ 다운로드 URL로 변환 (권한 불필요)

---

## 📊 URL 형식별 권한 요구사항

| URL 형식 | Sites.Read.All 필요 | 설명 |
|----------|---------------------|------|
| 직접 파일 경로 | ✅ 필요 | Private 파일 |
| 공유 링크 (:w:/) | ❌ 불필요 | Public 링크 |
| 1drv.ms 짧은 링크 | ❌ 불필요 | Public 링크 |
| OneDrive embed | ❌ 불필요 | Public 링크 |

**권장:**
- Private 파일: Sites.Read.All 권한 필요 (이미 설정됨)
- Public 링크: 권한 불필요하지만, 보안상 Private 권장

---

## 🎬 실제 배포 시나리오

### 패턴 A: 초기에는 로컬, 나중에 SharePoint

**1단계: 초기 배포 (로컬 파일)**
```bash
# 환경변수 설정 없음 (기본값 사용)
# HELP_TAB_SOURCE=local (기본값)

# 배포
fly deploy
```

→ `/public/help-tab.html` 파일이 사용됨

**2단계: 고객이 SharePoint URL 제공**

고객이 SharePoint에 파일 업로드 후 URL을 알려주면:

```bash
# 환경변수 업데이트
fly secrets set HELP_TAB_SOURCE=sharepoint
fly secrets set HELP_TAB_FILE_URL="https://customer.sharepoint.com/.../help.html"

# 서버 자동 재시작됨
```

→ SharePoint 파일이 사용됨

**3단계: 고객이 파일 수정**

고객이 SharePoint에서 파일을 직접 수정하면:

```
- 즉시 반영 안 됨 (캐시 있음)
- 5분 후 자동 갱신 (HELP_TAB_CACHE_TTL)
- 또는 수동 갱신: curl -X POST https://freshchat-bridge.fly.dev/tab-content/refresh
```

---

### 패턴 B: 처음부터 SharePoint

**배포 전 고객에게 요청:**

```markdown
안녕하세요,

EXO헬프 앱의 도움말 탭을 귀사에서 직접 관리하실 수 있습니다.

아래 파일을 SharePoint에 업로드하고 URL을 알려주시면,
언제든지 내용을 수정하실 수 있습니다.

📎 첨부: help-guide-template.html

업로드 위치:
1. SharePoint 사이트 (예: ITSupport)
2. "Shared Documents" 폴더
3. 파일명: help-guide.html

업로드 후 파일 URL을 회신 부탁드립니다.

감사합니다.
```

**고객 응답 예시:**
```
파일을 업로드했습니다.
URL: https://ourcompany.sharepoint.com/sites/IT/Shared%20Documents/help-guide.html
```

**환경변수 설정 후 배포:**
```bash
fly secrets set HELP_TAB_SOURCE=sharepoint
fly secrets set HELP_TAB_FILE_URL="https://ourcompany.sharepoint.com/sites/IT/Shared%20Documents/help-guide.html"

fly deploy
```

---

## 🔍 URL 테스트 방법

### 테스트 1: 브라우저에서 확인

```bash
# 도움말 탭 열기
open https://freshchat-bridge.fly.dev/tab-content
```

**성공:**
- SharePoint 파일 내용이 표시됨

**실패:**
- "도움말을 불러올 수 없습니다" 오류 페이지
- 로그 확인: `fly logs`

### 테스트 2: 캐시 새로고침

```bash
# 수동으로 캐시 갱신
curl -X POST https://freshchat-bridge.fly.dev/tab-content/refresh

# 성공 응답:
{
  "success": true,
  "message": "Help tab cache refreshed successfully",
  "contentLength": 12345,
  "timestamp": "2025-11-07T10:30:00.000Z"
}
```

### 테스트 3: 로그 확인

```bash
fly logs --app freshchat-bridge

# 성공 예시:
[Help Tab] Fetching from SharePoint/OneDrive: https://...
[Help Tab] Successfully fetched content (12345 bytes)

# 실패 예시:
[Help Tab] Failed to fetch from SharePoint/OneDrive: 403 Forbidden
[Help Tab] Falling back to local file
```

---

## 🛠️ 문제 해결

### 문제 1: "도움말을 불러올 수 없습니다"

**원인:**
1. HELP_TAB_FILE_URL이 잘못됨
2. SharePoint 파일이 존재하지 않음
3. Sites.Read.All 권한이 승인되지 않음

**해결:**

```bash
# 1. 환경변수 확인
fly secrets list

# 2. 권한 상태 확인
curl https://freshchat-bridge.fly.dev/auth/permissions-status

# 3. 로그 확인
fly logs --app freshchat-bridge

# 4. 고객에게 파일 URL 재확인 요청
```

---

### 문제 2: 고객이 파일을 수정했는데 반영 안 됨

**원인:** 캐시 TTL (기본 5분)

**해결:**

```bash
# 즉시 반영하려면 캐시 새로고침
curl -X POST https://freshchat-bridge.fly.dev/tab-content/refresh
```

**또는 캐시 TTL 단축:**
```bash
fly secrets set HELP_TAB_CACHE_TTL=60000  # 1분
```

---

### 문제 3: 여러 고객사가 있는데 각각 다른 SharePoint URL

**현재 구조의 한계:**
- 환경변수 1개 = 고객사 1개
- 여러 고객사 = 서버 여러 개 또는 멀티 테넌트 필요

**해결책 A: 고객별 서버 배포**
```bash
# 고객 A
fly apps create freshchat-bridge-customer-a
fly secrets set HELP_TAB_FILE_URL="https://customer-a.sharepoint.com/..."

# 고객 B
fly apps create freshchat-bridge-customer-b
fly secrets set HELP_TAB_FILE_URL="https://customer-b.sharepoint.com/..."
```

**해결책 B: 멀티 테넌트 구현 (추후 개발)**
- 런타임에 tenant ID로 분기
- tenants.json 또는 DB에서 설정 로드

---

## 📋 체크리스트

### 배포 전

- [ ] 고객에게 SharePoint 사용 여부 확인
- [ ] SharePoint 사용 시: 템플릿 파일 전달
- [ ] 고객으로부터 SharePoint URL 수신
- [ ] 환경변수 설정 (`HELP_TAB_SOURCE`, `HELP_TAB_FILE_URL`)
- [ ] 배포

### 배포 후

- [ ] 도움말 탭 로딩 확인 (`/tab-content`)
- [ ] 권한 상태 확인 (`/auth/permissions-status`)
- [ ] 고객에게 파일 수정 방법 안내
- [ ] 캐시 새로고침 방법 안내

---

## 🎯 권장 설정

### 단일 고객사 (현재 구조)

```bash
# .env 또는 Fly secrets
HELP_TAB_SOURCE=sharepoint
HELP_TAB_FILE_URL=https://customer.sharepoint.com/sites/IT/help.html
HELP_TAB_CACHE_TTL=300000  # 5분
```

### 여러 고객사 (고객별 서버)

```bash
# Customer A 서버
fly apps create freshchat-bridge-customer-a
fly secrets set HELP_TAB_FILE_URL="https://customer-a.sharepoint.com/..."

# Customer B 서버
fly apps create freshchat-bridge-customer-b
fly secrets set HELP_TAB_FILE_URL="https://customer-b.sharepoint.com/..."
```

---

## 📚 관련 문서

- [SharePoint 도움말 탭 설정](./HELP_TAB_SHAREPOINT.md)
- [배포 시나리오](./DEPLOYMENT_SCENARIO.md)
- [고객사 배포 가이드](./CUSTOMER_DEPLOYMENT_GUIDE.md)

---

**요약:**
- 로컬 파일: 설정 불필요 (기본값)
- SharePoint: 고객이 URL 제공 → 환경변수 설정
- 여러 고객: 고객별 서버 또는 멀티 테넌트 필요
