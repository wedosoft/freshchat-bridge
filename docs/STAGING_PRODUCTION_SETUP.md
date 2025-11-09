# 스테이징 및 운영 환경 구성 가이드

이 가이드는 개발-스테이징-운영 환경을 브랜치와 Fly.io로 구성하는 방법을 설명합니다.

## 📋 환경 구조

### 브랜치 전략
```
main (운영)
  └── staging (스테이징)
       └── develop (개발)
```

### Fly.io 앱 구성
- **운영**: `freshchat-bridge` (main 브랜치에서 자동 배포)
- **스테이징**: `freshchat-bridge-staging` (staging 브랜치에서 자동 배포)

### 워크플로우
1. `develop` 브랜치에서 개발 진행 (로컬 테스트)
2. `staging` 브랜치로 PR → 스테이징 배포
3. 스테이징 검증 후 `main` 브랜치로 PR → 운영 배포

---

## 🚀 초기 설정

### 1단계: 스테이징 브랜치 생성

```bash
# staging 브랜치 생성 및 푸시
git checkout -b staging
git push -u origin staging

# develop 브랜치 생성 및 푸시
git checkout -b develop
git push -u origin develop

# main으로 돌아가기
git checkout main
```

### 2단계: Fly.io 스테이징 앱 생성

```bash
# 스테이징 앱 생성 (nrt 리전)
flyctl apps create freshchat-bridge-staging --org personal

# fly.staging.toml 파일 생성
cp fly.toml fly.staging.toml
```

`fly.staging.toml` 수정:
```toml
app = "freshchat-bridge-staging"
primary_region = "nrt"

[build]

[http_service]
  internal_port = 3978
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 1
  processes = ["app"]

  [[http_service.checks]]
    interval = "15s"
    timeout = "10s"
    grace_period = "5s"
    method = "GET"
    path = "/"

  [http_service.concurrency]
    type = "connections"
    soft_limit = 25
    hard_limit = 50

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory_mb = 1024

[autoscale]
  min_count = 1
  max_count = 3  # 스테이징은 더 작게
```

### 3단계: 환경별 Secrets 설정

#### 운영 환경 Secrets (freshchat-bridge)
```bash
flyctl secrets set \
  BOT_APP_ID="운영-bot-app-id" \
  BOT_APP_PASSWORD="운영-bot-password" \
  BOT_TENANT_ID="운영-tenant-id" \
  FRESHCHAT_API_KEY="운영-api-key" \
  FRESHCHAT_API_URL="https://api.freshchat.com/v2" \
  FRESHCHAT_INBOX_ID="운영-inbox-id" \
  FRESHCHAT_WEBHOOK_PUBLIC_KEY="운영-public-key" \
  PUBLIC_URL="https://freshchat-bridge.fly.dev" \
  NODE_ENV="production" \
  --app freshchat-bridge
```

#### 스테이징 환경 Secrets (freshchat-bridge-staging)
```bash
flyctl secrets set \
  BOT_APP_ID="스테이징-bot-app-id" \
  BOT_APP_PASSWORD="스테이징-bot-password" \
  BOT_TENANT_ID="스테이징-tenant-id" \
  FRESHCHAT_API_KEY="스테이징-api-key" \
  FRESHCHAT_API_URL="https://api.freshchat.com/v2" \
  FRESHCHAT_INBOX_ID="스테이징-inbox-id" \
  FRESHCHAT_WEBHOOK_PUBLIC_KEY="스테이징-public-key" \
  PUBLIC_URL="https://freshchat-bridge-staging.fly.dev" \
  NODE_ENV="staging" \
  --app freshchat-bridge-staging
```

---

## 🔄 GitHub Actions 워크플로우 설정

### 1단계: 운영 배포 워크플로우 (기존 유지)

`.github/workflows/fly-deploy-production.yml`:
```yaml
name: Deploy to Production (Fly.io)

on:
  push:
    branches:
      - main
    paths-ignore:
      - 'teams-app/**'
      - 'docs/**'
      - '**.md'

jobs:
  deploy:
    name: Deploy to Production
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://freshchat-bridge.fly.dev
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io (Production)
        run: flyctl deploy --remote-only --config fly.toml
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 2단계: 스테이징 배포 워크플로우 생성

`.github/workflows/fly-deploy-staging.yml`:
```yaml
name: Deploy to Staging (Fly.io)

on:
  push:
    branches:
      - staging
    paths-ignore:
      - 'teams-app/**'
      - 'docs/**'
      - '**.md'

jobs:
  deploy:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    environment:
      name: staging
      url: https://freshchat-bridge-staging.fly.dev
    
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Flyctl
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io (Staging)
        run: flyctl deploy --remote-only --config fly.staging.toml --app freshchat-bridge-staging
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

### 3단계: GitHub Secrets 설정

GitHub Repository Settings → Secrets and variables → Actions에서:
- `FLY_API_TOKEN`: Fly.io API 토큰 (기존 것 사용)

### 4단계: GitHub Environments 설정 (선택사항)

Settings → Environments에서:
1. **production** environment 생성
   - 보호 규칙: main 브랜치만 배포 가능
   - 승인 필요 (선택)

2. **staging** environment 생성
   - 보호 규칙: staging 브랜치만 배포 가능

---

## 🔧 개발 워크플로우

### 일반적인 개발 흐름

```bash
# 1. develop 브랜치에서 작업
git checkout develop
git pull origin develop

# 2. 기능 브랜치 생성 (선택사항)
git checkout -b feature/new-feature

# 3. 개발 및 로컬 테스트
npm run dev

# 4. 커밋 및 푸시
git add .
git commit -m "feat: 새로운 기능 추가"
git push origin feature/new-feature

# 5. staging으로 PR 생성 (GitHub에서)
# develop <- feature/new-feature PR 생성
# 리뷰 후 머지

# 6. staging 브랜치로 전환 및 머지
git checkout staging
git pull origin staging
git merge develop
git push origin staging
# → 자동으로 스테이징 환경에 배포됨

# 7. 스테이징 검증 완료 후 main으로 PR
# GitHub에서 staging -> main PR 생성
# 리뷰 및 승인 후 머지
# → 자동으로 운영 환경에 배포됨
```

### 핫픽스 워크플로우

```bash
# 1. main에서 hotfix 브랜치 생성
git checkout main
git pull origin main
git checkout -b hotfix/critical-bug

# 2. 수정 작업
# ...

# 3. main으로 직접 PR
git push origin hotfix/critical-bug
# GitHub에서 main <- hotfix PR 생성 및 머지

# 4. staging과 develop에도 반영
git checkout staging
git merge main
git push origin staging

git checkout develop
git merge staging
git push origin develop
```

---

## 🎯 Teams 앱 배포 전략

### 스테이징 Teams 앱
- 별도의 Bot App 등록 필요 (Azure Portal)
- 스테이징 봇 ID로 `teams-app/manifest.json` 생성
- 패키지 이름: `freshchat-bridge-staging.zip`

### 운영 Teams 앱
- 운영용 Bot App 등록
- 운영 봇 ID로 `teams-app/manifest.json` 생성
- 패키지 이름: `freshchat-bridge-production.zip`

### Teams 앱 매니페스트 관리

```bash
teams-app/
  ├── manifest.staging.json    # 스테이징 설정
  ├── manifest.production.json # 운영 설정
  ├── build-staging.sh         # 스테이징 패키지 생성 스크립트
  └── build-production.sh      # 운영 패키지 생성 스크립트
```

---

## 📊 환경별 차이점

| 항목 | 스테이징 | 운영 |
|------|----------|------|
| Fly.io 앱 | `freshchat-bridge-staging` | `freshchat-bridge` |
| 브랜치 | `staging` | `main` |
| URL | `https://freshchat-bridge-staging.fly.dev` | `https://freshchat-bridge.fly.dev` |
| Bot App ID | 스테이징 전용 | 운영 전용 |
| Freshchat Inbox | 스테이징 전용 | 운영 전용 |
| 자동 배포 | ✅ staging 브랜치 push 시 | ✅ main 브랜치 push 시 |
| Max Instances | 3 | 5 |
| 배포 승인 | 불필요 | 선택적으로 필요 |

---

## 🔍 모니터링 및 로그

### 스테이징 로그 확인
```bash
flyctl logs --app freshchat-bridge-staging
```

### 운영 로그 확인
```bash
flyctl logs --app freshchat-bridge
```

### 앱 상태 확인
```bash
# 스테이징
flyctl status --app freshchat-bridge-staging

# 운영
flyctl status --app freshchat-bridge
```

---

## 🛡️ 보안 및 모범 사례

### 환경 격리
- ✅ 스테이징과 운영은 완전히 분리된 Bot 및 Freshchat 계정 사용
- ✅ Secrets는 Fly.io에서만 관리, 코드에 포함하지 않음
- ✅ `.env` 파일은 `.gitignore`에 포함

### 배포 안전성
- ✅ 스테이징에서 충분히 테스트 후 운영 배포
- ✅ main 브랜치는 보호 규칙 적용 (PR 리뷰 필수)
- ✅ 롤백 전략: 이전 커밋으로 되돌리고 재배포

### 설정 동기화
- ✅ 스테이징과 운영의 코드는 동일하게 유지
- ✅ 환경 변수만 차이가 있음
- ✅ `fly.toml`과 `fly.staging.toml`은 거의 동일 (앱 이름, 스케일링만 다름)

---

## 🚨 문제 해결

### 스테이징 배포 실패
```bash
# 앱 상태 확인
flyctl status --app freshchat-bridge-staging

# 로그 확인
flyctl logs --app freshchat-bridge-staging

# 수동 배포
git checkout staging
flyctl deploy --config fly.staging.toml --app freshchat-bridge-staging
```

### Secrets 업데이트
```bash
# 특정 secret 업데이트
flyctl secrets set KEY=VALUE --app freshchat-bridge-staging

# 모든 secrets 확인
flyctl secrets list --app freshchat-bridge-staging
```

### 브랜치 동기화 문제
```bash
# develop을 staging으로 머지
git checkout staging
git merge develop

# staging을 main으로 머지
git checkout main
git merge staging
```

---

## 📝 체크리스트

### 초기 설정
- [ ] staging, develop 브랜치 생성
- [ ] Fly.io 스테이징 앱 생성
- [ ] fly.staging.toml 파일 생성
- [ ] 스테이징 Secrets 설정
- [ ] GitHub Actions 워크플로우 추가
- [ ] 스테이징 Teams 앱 등록
- [ ] 스테이징 Freshchat Inbox 생성

### 배포 전
- [ ] 로컬에서 테스트 완료
- [ ] 커밋 메시지 작성 (Conventional Commits)
- [ ] staging 브랜치에 머지 및 푸시
- [ ] 스테이징 환경에서 검증
- [ ] main 브랜치로 PR 생성
- [ ] 리뷰 승인 받기
- [ ] 운영 배포 후 모니터링

---

## 🔗 관련 문서

- [Fly.io 공식 문서](https://fly.io/docs/)
- [GitHub Actions 문서](https://docs.github.com/en/actions)
- [Conventional Commits](https://www.conventionalcommits.org/)
- 프로젝트 문서:
  - `AGENTS.md` - 개발 가이드라인
  - `MULTI_TENANT_GUIDE.md` - 멀티 테넌트 설정
  - `README.md` - 프로젝트 개요
