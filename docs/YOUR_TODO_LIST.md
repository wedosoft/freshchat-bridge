# 🎯 배포 전 체크리스트 (We Do Soft 작업)

## Phase 1: Azure Portal 설정 (5분) ⚠️ 필수

### 1-1. Azure Portal 접속

1. https://portal.azure.com 접속
2. **Azure Active Directory** 클릭
3. 좌측 메뉴 **App registrations** 클릭

### 1-2. EXO헬프 Bot 앱 찾기

**검색 방법 1:** 이름으로 검색
- 상단 검색창에 "EXO헬프" 입력

**검색 방법 2:** App ID로 검색
- 상단 탭에서 **All applications** 선택
- 검색창에 `6a46afe9-3109-4af6-a0f9-275f6fddf929` 입력

### 1-3. API 권한 추가

1. 찾은 앱을 클릭
2. 좌측 메뉴에서 **API permissions** 클릭
3. **+ Add a permission** 버튼 클릭
4. **Microsoft Graph** 선택
5. **Application permissions** 선택 (⚠️ Delegated가 아님!)
6. 다음 권한을 검색하여 체크:

   - [ ] `User.Read.All`
     - 검색: "User" → User.Read.All 찾기 → 체크

   - [ ] `Sites.Read.All`
     - 검색: "Sites" → Sites.Read.All 찾기 → 체크

   - [ ] `Team.ReadBasic.All`
     - 검색: "Team" → Team.ReadBasic.All 찾기 → 체크

7. **Add permissions** 버튼 클릭

### 1-4. 확인 (중요!)

**✅ 해야 할 것:**
- API permissions 화면에서 3개 권한이 모두 표시되는지 확인
- 각 권한의 Type이 **Application**인지 확인

**❌ 하지 말아야 할 것:**
- **"Grant admin consent for [조직명]" 버튼을 누르지 마세요!**
- 이유: 여러분 조직이 아니라 고객사 조직의 데이터에 접근해야 하므로

**예상 화면:**
```
Permission                     Type          Status
────────────────────────────────────────────────────
User.Read.All                  Application   Not granted
Sites.Read.All                 Application   Not granted
Team.ReadBasic.All             Application   Not granted
```

Status가 "Not granted"여도 정상입니다! 고객사가 승인할 것입니다.

---

## Phase 2: 코드 배포 (5분)

### 2-1. Git 커밋 및 푸시

```bash
cd /Users/alan/GitHub/freshchat-bridge

# 변경사항 확인
git status

# 모든 변경사항 추가
git add .

# 커밋
git commit -m "feat: Add admin consent endpoints and Graph API permissions

- Add /auth/admin-consent endpoint for organization-wide consent
- Add /auth/permissions-status endpoint to verify granted permissions
- Update manifest.json with webApplicationInfo
- Add comprehensive deployment documentation
- Support for User.Read.All, Sites.Read.All, Team.ReadBasic.All"

# 푸시
git push origin main
```

### 2-2. Fly.dev 배포

```bash
# Fly.dev에 배포
fly deploy

# 배포 상태 확인
fly status

# 로그 확인 (선택사항)
fly logs
```

### 2-3. 환경변수 확인

```bash
# 현재 설정된 환경변수 확인
fly secrets list

# 필수 환경변수가 모두 있는지 체크:
# ✓ BOT_APP_ID
# ✓ BOT_APP_PASSWORD
# ✓ BOT_TENANT_ID
# ✓ FRESHCHAT_API_KEY
# ✓ FRESHCHAT_API_URL
# ✓ FRESHCHAT_INBOX_ID
# ✓ PUBLIC_URL
```

**누락된 환경변수가 있으면 추가:**
```bash
fly secrets set BOT_APP_ID=6a46afe9-3109-4af6-a0f9-275f6fddf929
fly secrets set BOT_APP_PASSWORD=your-actual-secret
fly secrets set BOT_TENANT_ID=your-tenant-id
fly secrets set PUBLIC_URL=https://freshchat-bridge.fly.dev

# etc...
```

---

## Phase 3: 앱 패키지 생성 (2분)

### 3-1. manifest.json 확인

```bash
cd /Users/alan/GitHub/freshchat-bridge/teams-app

# manifest.json에 webApplicationInfo가 있는지 확인
cat manifest.json | grep -A 3 "webApplicationInfo"
```

**예상 출력:**
```json
"webApplicationInfo": {
  "id": "6a46afe9-3109-4af6-a0f9-275f6fddf929",
  "resource": "api://freshchat-bridge.fly.dev/6a46afe9-3109-4af6-a0f9-275f6fddf929"
}
```

### 3-2. 앱 패키지 생성

```bash
# teams-app 디렉토리에서 실행
cd /Users/alan/GitHub/freshchat-bridge/teams-app

# zip 파일 생성
zip -r app-package.zip manifest.json color.png outline.png

# 확인
unzip -l app-package.zip
```

**예상 출력:**
```
Archive:  app-package.zip
  Length      Date    Time    Name
---------  ---------- -----   ----
     xxxx  xx-xx-xxxx xx:xx   manifest.json
     xxxx  xx-xx-xxxx xx:xx   color.png
     xxxx  xx-xx-xxxx xx:xx   outline.png
---------                     -------
     xxxx                     3 files
```

### 3-3. 패키지 파일 위치 확인

```bash
ls -lh /Users/alan/GitHub/freshchat-bridge/teams-app/app-package.zip
```

---

## Phase 4: 배포 테스트 (5분)

### 4-1. 서버 상태 확인

```bash
# Health check
curl https://freshchat-bridge.fly.dev/

# 권한 상태 확인 (현재는 아무 고객도 승인 안 했으므로 오류 정상)
curl https://freshchat-bridge.fly.dev/auth/permissions-status
```

### 4-2. 관리자 동의 엔드포인트 확인

브라우저에서 열어보기:
```
https://freshchat-bridge.fly.dev/auth/admin-consent
```

**예상 동작:**
- Azure AD 로그인 페이지로 리디렉션됨
- (로그인하면 권한 승인 화면 표시됨 - 아직 하지 마세요!)

---

## Phase 5: 고객사 전달 준비 (10분)

### 5-1. 전달할 파일 준비

```bash
cd /Users/alan/GitHub/freshchat-bridge

# 고객사 전달용 폴더 생성
mkdir -p delivery

# 앱 패키지 복사
cp teams-app/app-package.zip delivery/

# 문서 복사
cp docs/CUSTOMER_DEPLOYMENT_GUIDE.md delivery/
cp docs/ADMIN_CONSENT_QUICKSTART.md delivery/
cp docs/HELP_TAB_SHAREPOINT.md delivery/  # SharePoint 사용 시만
```

### 5-2. 전달 이메일 작성

**수신:** 고객사 IT 담당자

**제목:** EXO헬프 Teams 앱 배포 안내

**본문 템플릿:**

```
안녕하세요,

EXO헬프 Teams 앱 배포를 위한 자료를 전달드립니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 첨부 파일:
1. app-package.zip - Teams 앱 설치 파일
2. ADMIN_CONSENT_QUICKSTART.md - 5분 빠른 시작 가이드 (필독!)
3. CUSTOMER_DEPLOYMENT_GUIDE.md - 상세 배포 가이드
4. HELP_TAB_SHAREPOINT.md - 도움말 탭 설정 (선택사항)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 배포 방법 (2가지 중 선택)

방법 1️⃣: Teams Admin Center (권장)
1. https://admin.teams.microsoft.com 접속
2. Teams apps → Manage apps → Upload 클릭
3. app-package.zip 업로드
4. 권한 승인 화면에서 "조직을 대신하여 동의함" 체크 → 수락

방법 2️⃣: 간편 URL
1. 아래 URL 클릭 (Global Administrator 권한 필요)
   https://freshchat-bridge.fly.dev/auth/admin-consent
2. 권한 검토 → "조직을 대신하여 동의함" 체크 → 수락
3. 이후 Teams Admin Center에서 app-package.zip 업로드

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 배포 완료 확인:
https://freshchat-bridge.fly.dev/auth/permissions-status

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 요청되는 권한 (읽기 전용):
- User.Read.All: 사용자 프로필 정보
- Sites.Read.All: SharePoint 도움말 파일
- Team.ReadBasic.All: Teams 정보

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 선택사항: 도움말 탭 직접 관리
고객사에서 도움말 내용을 직접 편집하고 싶으시면:
1. SharePoint/OneDrive에 help-guide.html 파일 업로드
2. 파일 URL을 저희에게 알려주시면 설정해드립니다
   (HELP_TAB_SHAREPOINT.md 참고)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

문의사항이 있으시면 언제든지 연락주세요.

감사합니다.
We Do Soft 팀
```

---

## Phase 6: 고객사 설치 후 작업 (고객이 승인한 후)

### 6-1. 권한 상태 확인

고객이 앱을 설치하고 권한을 승인했다고 알려주면:

```bash
# 권한 상태 확인
curl https://freshchat-bridge.fly.dev/auth/permissions-status
```

**성공 예시:**
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
  }
}
```

### 6-2. SharePoint URL 설정 (선택사항)

고객이 SharePoint에 도움말 파일을 업로드했다면:

```bash
# 고객으로부터 받은 SharePoint URL 설정
fly secrets set HELP_TAB_SOURCE=sharepoint
fly secrets set HELP_TAB_FILE_URL="https://customer.sharepoint.com/sites/IT/help-guide.html"

# 자동 재배포됨
```

### 6-3. 테스트

1. 고객사 직원 중 한 명이 Teams에서 EXO헬프 봇과 대화
2. Freshchat 관리 페이지에서 사용자 정보 확인:
   - ✅ teams_email
   - ✅ teams_job_title
   - ✅ teams_department
   - ✅ teams_phone
   - ✅ teams_office_location

---

## ⚠️ 주의사항

### 절대 하지 말 것

1. ❌ Azure Portal에서 "Grant admin consent" 버튼 클릭
   - 이유: 여러분 조직이 아니라 고객사 조직의 권한이 필요

2. ❌ BOT_APP_PASSWORD를 Git에 커밋
   - 이미 .gitignore로 보호되어 있지만 주의

3. ❌ 고객사 SharePoint URL을 다른 고객에게 노출
   - 고객사별 독립적 정보

### 반드시 확인할 것

1. ✅ manifest.json에 webApplicationInfo 섹션 존재
2. ✅ Azure Portal의 API permissions에 3개 권한 추가됨
3. ✅ Fly.dev 환경변수 모두 설정됨
4. ✅ app-package.zip 정상 생성됨

---

## 📞 문제 발생 시

### 고객이 "권한 승인 화면이 안 나타나요"

→ Azure Portal에서 API permissions를 추가했는지 확인

### 고객이 "User.Read.All 권한이 위험하다고 나와요"

→ 정상입니다. "읽기 전용"이며 필요한 권한임을 설명
→ CUSTOMER_DEPLOYMENT_GUIDE.md의 "보안 고려사항" 섹션 참고

### 배포 후 "사용자 정보가 Freshchat에 안 보여요"

→ 권한 상태 API로 확인:
```bash
curl https://freshchat-bridge.fly.dev/auth/permissions-status
```

→ "granted": false이면 고객이 권한 승인을 안 한 것

---

## ✅ 최종 체크리스트

배포 전 모든 항목을 확인하세요:

- [ ] Azure Portal에서 API permissions 추가 완료 (Grant consent는 안 함)
- [ ] Git 커밋 및 푸시 완료
- [ ] Fly.dev 배포 완료
- [ ] 환경변수 모두 설정 확인
- [ ] app-package.zip 생성 완료
- [ ] 전달 자료 준비 완료 (앱 패키지 + 문서)
- [ ] 고객사 이메일 작성 및 발송
- [ ] 권한 상태 확인 URL 테스트

**모두 완료되면 고객사에 전달하고 설치를 기다리세요!**

---

## 📚 참고 문서

- [배포 시나리오](./DEPLOYMENT_SCENARIO.md) - 전체 배포 흐름 이해
- [Azure AD 권한 가이드](./AZURE_AD_PERMISSIONS.md) - 권한 상세 설명
- [고객사 배포 가이드](./CUSTOMER_DEPLOYMENT_GUIDE.md) - 고객 전달용
- [빠른 시작](./ADMIN_CONSENT_QUICKSTART.md) - 고객용 2분 가이드
