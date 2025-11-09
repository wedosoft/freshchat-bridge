# 🚀 빠른 시작: 스테이징/운영 환경 설정

이 가이드는 **처음 설정하는 분들을 위한 단계별 체크리스트**입니다.

## ✅ 1단계: 브랜치 생성 (5분)

```bash
# 저장소 최신화
git checkout main
git pull origin main

# staging 브랜치 생성
git checkout -b staging
git push -u origin staging

# develop 브랜치 생성
git checkout -b develop
git push -u origin develop

# main으로 복귀
git checkout main
```

## ✅ 2단계: Fly.io 스테이징 앱 생성 (5분)

```bash
# 스테이징 앱 생성 (조직명은 본인 계정에 맞게 변경)
flyctl apps create freshchat-bridge-staging

# 생성 확인
flyctl apps list
```

## ✅ 3단계: 스테이징 환경변수 설정 (10분)

스테이징용 Bot과 Freshchat 계정을 준비한 후:

```bash
flyctl secrets set \
  BOT_APP_ID="스테이징-bot-app-id" \
  BOT_APP_PASSWORD="스테이징-bot-password" \
  BOT_TENANT_ID="스테이징-azure-tenant-id" \
  FRESHCHAT_API_KEY="스테이징-freshchat-api-key" \
  FRESHCHAT_API_URL="https://api.freshchat.com/v2" \
  FRESHCHAT_INBOX_ID="스테이징-inbox-id" \
  FRESHCHAT_WEBHOOK_PUBLIC_KEY="스테이징-webhook-public-key" \
  PUBLIC_URL="https://freshchat-bridge-staging.fly.dev" \
  NODE_ENV="staging" \
  --app freshchat-bridge-staging
```

💡 **Tip**: 각 값은 Azure Portal 및 Freshchat 대시보드에서 확인 가능

## ✅ 4단계: GitHub 브랜치 보호 설정 (3분)

GitHub 저장소 → Settings → Branches:

### main 브랜치 보호
- ✅ Require a pull request before merging
- ✅ Require approvals: 1
- ✅ Require review from Code Owners (선택)

### staging 브랜치 보호 (선택)
- ✅ Require a pull request before merging

## ✅ 5단계: 첫 스테이징 배포 (5분)

```bash
# staging 브랜치로 전환
git checkout staging

# 수동 배포 (첫 배포)
flyctl deploy --config fly.staging.toml --app freshchat-bridge-staging

# 배포 확인
flyctl status --app freshchat-bridge-staging
flyctl logs --app freshchat-bridge-staging
```

✅ 성공하면 `https://freshchat-bridge-staging.fly.dev`에서 접근 가능

## ✅ 6단계: 자동 배포 확인 (2분)

```bash
# staging 브랜치에서 테스트 커밋
git checkout staging
echo "# Test" >> test.txt
git add test.txt
git commit -m "test: 스테이징 자동 배포 테스트"
git push origin staging
```

GitHub Actions 탭에서 배포 진행 상황 확인 → 자동 배포 완료!

## ✅ 7단계: 운영 환경변수 확인 (5분)

기존 운영 환경의 secrets 확인:

```bash
flyctl secrets list --app freshchat-bridge
```

누락된 것이 있다면 추가:

```bash
flyctl secrets set \
  NODE_ENV="production" \
  PUBLIC_URL="https://freshchat-bridge.fly.dev" \
  --app freshchat-bridge
```

---

## 🎯 일상적인 개발 워크플로우

### 새 기능 개발

```bash
# 1. develop에서 작업
git checkout develop
git pull origin develop

# 2. 기능 개발
# ... 코드 작성 ...

# 3. 로컬 테스트
npm run dev

# 4. 커밋 및 푸시
git add .
git commit -m "feat: 새 기능 추가"
git push origin develop
```

### 스테이징 배포

```bash
# 1. staging으로 머지
git checkout staging
git pull origin staging
git merge develop
git push origin staging

# 2. GitHub Actions가 자동으로 배포

# 3. 스테이징 확인
# https://freshchat-bridge-staging.fly.dev
```

### 운영 배포

```bash
# 1. GitHub에서 PR 생성
#    staging -> main

# 2. 리뷰 및 승인

# 3. Merge → 자동 배포

# 4. 운영 확인
# https://freshchat-bridge.fly.dev
```

---

## 🔧 Teams 앱 매니페스트 관리

### 스테이징 앱 패키지 생성

1. `teams-app/manifest.staging.json` 생성 (스테이징 Bot ID 사용)
2. 빌드:
```bash
cd teams-app
./build-staging.sh
```
3. `freshchat-bridge-staging.zip` 생성 완료
4. Teams Admin Center에 업로드

### 운영 앱 패키지 생성

1. `teams-app/manifest.production.json` 생성 (운영 Bot ID 사용)
2. 빌드:
```bash
cd teams-app
./build-production.sh
```
3. `freshchat-bridge-production.zip` 생성 완료
4. Teams Admin Center에 업로드

---

## 🚨 트러블슈팅

### Q: 스테이징 배포가 실패합니다

```bash
# 로그 확인
flyctl logs --app freshchat-bridge-staging

# 앱 상태 확인
flyctl status --app freshchat-bridge-staging

# Secrets 확인
flyctl secrets list --app freshchat-bridge-staging
```

### Q: GitHub Actions가 실행되지 않습니다

1. `.github/workflows/` 파일들이 올바른 브랜치에 있는지 확인
2. GitHub Actions 탭에서 워크플로우 활성화 확인
3. `FLY_API_TOKEN` secret이 설정되어 있는지 확인

### Q: 브랜치를 잘못 머지했습니다

```bash
# 머지 되돌리기 (푸시 전)
git reset --hard HEAD~1

# 푸시 후라면
git revert HEAD
git push
```

---

## 📚 더 자세한 정보

- 전체 가이드: [docs/STAGING_PRODUCTION_SETUP.md](STAGING_PRODUCTION_SETUP.md)
- 멀티 테넌트: [docs/MULTI_TENANT_GUIDE.md](MULTI_TENANT_GUIDE.md)
- 개발 가이드라인: [AGENTS.md](../AGENTS.md)

---

## ✨ 완료!

이제 안전한 개발-스테이징-운영 파이프라인이 구축되었습니다! 🎉
