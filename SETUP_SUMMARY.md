# 스테이징/운영 환경 구성 완료 요약

## 📦 생성된 파일들

### 1. Fly.io 설정
- ✅ `fly.staging.toml` - 스테이징 앱 설정 (max 3 instances)
- ✅ `fly.toml` - 운영 앱 설정 (기존, max 5 instances)

### 2. GitHub Actions 워크플로우
- ✅ `.github/workflows/fly-deploy.yml` - 운영 배포 (main 브랜치)
- ✅ `.github/workflows/fly-deploy-staging.yml` - 스테이징 배포 (staging 브랜치)

### 3. Teams 앱 빌드 스크립트
- ✅ `teams-app/build-staging.sh` - 스테이징 앱 패키지 빌드
- ✅ `teams-app/build-production.sh` - 운영 앱 패키지 빌드

### 4. 유틸리티 스크립트
- ✅ `scripts/check-environment.sh` - 환경 설정 확인 도구

### 5. 문서
- ✅ `docs/STAGING_PRODUCTION_SETUP.md` - 전체 설정 가이드
- ✅ `docs/QUICKSTART_STAGING.md` - 빠른 시작 가이드
- ✅ `README.md` - 환경 관리 섹션 추가
- ✅ `.gitignore` - 임시 파일 패턴 추가

---

## 🚀 다음 단계

### 1. 브랜치 생성 (필수)
```bash
git checkout -b staging
git push -u origin staging

git checkout -b develop
git push -u origin develop

git checkout main
```

### 2. Fly.io 스테이징 앱 생성 (필수)
```bash
flyctl apps create freshchat-bridge-staging
```

### 3. 스테이징 Secrets 설정 (필수)

먼저 Azure Portal에서 **스테이징 전용 Bot**을 등록하고, Freshchat에서 **스테이징 전용 Inbox**를 생성하세요.

그 다음:
```bash
flyctl secrets set \
  BOT_APP_ID="[스테이징-bot-id]" \
  BOT_APP_PASSWORD="[스테이징-bot-password]" \
  BOT_TENANT_ID="[스테이징-azure-tenant-id]" \
  FRESHCHAT_API_KEY="[스테이징-api-key]" \
  FRESHCHAT_API_URL="https://api.freshchat.com/v2" \
  FRESHCHAT_INBOX_ID="[스테이징-inbox-id]" \
  FRESHCHAT_WEBHOOK_PUBLIC_KEY="[스테이징-public-key]" \
  PUBLIC_URL="https://freshchat-bridge-staging.fly.dev" \
  NODE_ENV="staging" \
  --app freshchat-bridge-staging
```

### 4. 운영 Secrets 확인 (권장)
```bash
flyctl secrets list --app freshchat-bridge
```

누락된 것이 있다면:
```bash
flyctl secrets set \
  NODE_ENV="production" \
  PUBLIC_URL="https://freshchat-bridge.fly.dev" \
  --app freshchat-bridge
```

### 5. 첫 스테이징 배포 (필수)
```bash
git checkout staging
flyctl deploy --config fly.staging.toml --app freshchat-bridge-staging
```

### 6. GitHub 브랜치 보호 설정 (권장)

GitHub Repository → Settings → Branches:
- **main 브랜치**: Require PR, Require 1 approval
- **staging 브랜치**: Require PR (선택)

### 7. 환경 확인
```bash
./scripts/check-environment.sh
```

---

## 🔄 개발 워크플로우

### 일반 개발
```
develop (개발) 
  → staging (검증) 
  → main (운영)
```

1. `develop`에서 개발
2. `staging`으로 머지 → 자동 배포 → 검증
3. `main`으로 PR → 리뷰 → 머지 → 자동 배포

### 핫픽스
```
main (핫픽스 적용)
  → staging (동기화)
  → develop (동기화)
```

---

## 📋 Teams 앱 배포

### 스테이징 앱
1. `teams-app/manifest.json`을 복사하여 `manifest.staging.json` 생성
2. `botId`를 스테이징 Bot ID로 변경
3. 빌드:
```bash
cd teams-app
./build-staging.sh
```
4. `freshchat-bridge-staging.zip`을 Teams Admin Center에 업로드

### 운영 앱
1. `teams-app/manifest.json`을 복사하여 `manifest.production.json` 생성
2. `botId`를 운영 Bot ID로 변경
3. 빌드:
```bash
cd teams-app
./build-production.sh
```
4. `freshchat-bridge-production.zip`을 Teams Admin Center에 업로드

---

## 🎯 주요 개념

### 환경 격리
- 스테이징과 운영은 **완전히 별도의 Bot 및 Freshchat 계정** 사용
- 환경변수는 **Fly.io Secrets**로만 관리 (코드에 포함 안 함)
- 코드는 **동일**, 설정만 **다름**

### 자동 배포
- `staging` 브랜치 push → 스테이징 자동 배포
- `main` 브랜치 push → 운영 자동 배포
- GitHub Actions가 모두 처리

### 안전한 배포
- 스테이징에서 **충분히 검증**
- main 브랜치는 **PR 리뷰 필수**
- 문제 발생 시 **이전 커밋으로 롤백**

---

## 🔍 확인 체크리스트

- [ ] `staging`, `develop` 브랜치 생성 완료
- [ ] Fly.io 스테이징 앱 (`freshchat-bridge-staging`) 생성
- [ ] 스테이징 Secrets 설정 완료
- [ ] 스테이징 첫 배포 성공
- [ ] GitHub Actions 워크플로우 실행 확인
- [ ] 스테이징 환경에서 메시지 송수신 테스트
- [ ] GitHub 브랜치 보호 규칙 설정
- [ ] Teams 스테이징 앱 패키지 생성 및 업로드
- [ ] 운영 배포 프로세스 문서화

---

## 📚 참고 문서

- **빠른 시작**: `docs/QUICKSTART_STAGING.md` (15분 가이드)
- **전체 가이드**: `docs/STAGING_PRODUCTION_SETUP.md` (상세 설명)
- **개발 가이드**: `AGENTS.md`
- **멀티 테넌트**: `docs/MULTI_TENANT_GUIDE.md`

---

## 💡 팁

### 로그 확인
```bash
# 스테이징 실시간 로그
flyctl logs --app freshchat-bridge-staging

# 운영 실시간 로그
flyctl logs --app freshchat-bridge
```

### 앱 상태 확인
```bash
flyctl status --app freshchat-bridge-staging
flyctl status --app freshchat-bridge
```

### Secrets 관리
```bash
# 목록 확인
flyctl secrets list --app freshchat-bridge-staging

# 추가/수정
flyctl secrets set KEY=VALUE --app freshchat-bridge-staging

# 삭제
flyctl secrets unset KEY --app freshchat-bridge-staging
```

### 수동 배포
```bash
# 스테이징
flyctl deploy --config fly.staging.toml --app freshchat-bridge-staging

# 운영
flyctl deploy --config fly.toml --app freshchat-bridge
```

---

## 🎉 완료!

이제 안전하고 체계적인 개발 환경이 구축되었습니다.

**궁금한 점이 있으면 문서를 참고하거나 이슈를 생성해 주세요!**
