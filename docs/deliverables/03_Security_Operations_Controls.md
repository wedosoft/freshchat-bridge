# 보안 및 운영 통제

**문서번호:** FCBRIDGE-2024-SEC-001  
**작성일:** 2025-12-23  
**작성자:** 위두소프트

---

## 1. 데이터 처리 및 저장 위치

| 데이터 유형 | 저장 위치 | 소유 주체 | 보관 기간 |
|-------------|-----------|-----------|-----------|
| 대화 메시지 원본 | Freshchat | 고객 | 고객 정책 |
| 첨부파일 원본 | Freshchat | 고객 | 고객 정책 |
| 세션/매핑 캐시 | Redis (fly.io) | 위두소프트 | 30일 TTL |
| 임시 파일 (업로드) | fly.io uploads/ | 위두소프트 | 휘발성 |
| 에러 로그 | Sentry | 위두소프트 | [TBD] |
| Bot 활동 로그 | fly.io console | 위두소프트 | 7일 |

### 핵심 원칙
- **대화 원본 데이터(System of Record)는 Freshchat에만 저장**
- Bridge는 메시지 라우팅만 수행, 장기 저장 없음
- 첨부파일은 전달 후 임시 저장만 (서버 재시작 시 삭제)

---

## 2. 접근 통제

### 2.1 Azure 리소스 접근

| 리소스 | 접근 권한 | 대상 |
|--------|-----------|------|
| App Registration | Owner | 위두소프트 관리자 |
| Azure Bot Service | Contributor | 위두소프트 관리자 |
| Azure Subscription | Owner | alan@wedosoft.net |

**고객 접근:**
- 고객 테넌트에서 Teams 앱 배포/제거 권한만 보유
- Azure 리소스 직접 접근 없음

### 2.2 Fly.io 접근

| 접근 수준 | 권한 | 대상 |
|-----------|------|------|
| Organization Admin | 전체 관리 | we-do-soft-inc 멤버 |
| App Deploy | 배포 전용 | GitHub Actions (토큰) |

**접근 방법:**
```bash
flyctl auth login  # 위두소프트 계정
flyctl ssh console -a freshchat-bridge  # SSH 접근 (필요 시)
```

### 2.3 Freshchat/Freshworks 접근

| 항목 | 소유/관리 |
|------|-----------|
| Freshchat 계정 | 고객 |
| API Key | 고객 발급 → 위두소프트 설정 |
| Webhook 설정 | 고객 관리 콘솔 |

---

## 3. 로그 및 감사

### 3.1 Bridge 애플리케이션 로그

**로그 범위:**
- 메시지 송수신 이벤트 (발신자, 대상, 타임스탬프)
- 첨부파일 처리 (파일명, 크기, 타입)
- API 호출 결과 (성공/실패)
- 에러 및 예외

**로그 출력 예시:**
```
[Teams → Freshchat]
From: 사용자명 (user-id)
Message: [내용 미포함 - 보안]
Attachments: 2
Conversation ID: xxx

[Freshchat → Teams Webhook]
Actor type: agent
Message ID: xxx
```

**민감정보 처리:**
- 메시지 본문 내용은 로그에 미포함
- API Key, Password 등은 환경변수로만 관리

### 3.2 로그 보관 및 조회

| 로그 유형 | 위치 | 보관 기간 | 조회 방법 |
|-----------|------|-----------|-----------|
| Application Log | fly.io | 7일 | `flyctl logs -a freshchat-bridge` |
| Error Tracking | Sentry | [TBD] | Sentry Dashboard |
| Deploy History | fly.io | 무기한 | `flyctl releases -a freshchat-bridge` |

---

## 4. 키/시크릿 관리

### 4.1 시크릿 저장소

| 시크릿 | 저장 위치 | 관리 주체 |
|--------|-----------|-----------|
| BOT_APP_PASSWORD | fly.io secrets | 위두소프트 |
| FRESHCHAT_API_KEY | fly.io secrets | 위두소프트 (고객 발급) |
| REDIS_URL | fly.io secrets | 위두소프트 |
| SENTRY_DSN | fly.io secrets | 위두소프트 |

### 4.2 키 만료/로테이션 일정

| 키 | 현재 만료일 | 로테이션 권장 |
|-----|------------|--------------|
| Bot Runtime Password | 2026-04-24 | 2026-03월 |
| GitHub Action Password | 2026-04-24 | 2026-03월 |
| Staging Password | 2026-05-08 / 2027-11-09 | 해당 시점 |

**로테이션 절차:**
1. Azure Portal에서 새 Client Secret 생성
2. `flyctl secrets set BOT_APP_PASSWORD=새값 -a freshchat-bridge`
3. 기존 Secret 삭제 (유예 기간 후)

### 4.3 문서 내 시크릿 처리 원칙

- 토큰, API Key, Password 원문 **절대 미기재**
- 필요 시 `[REDACTED]` 표기
- ID 값(App ID, Tenant ID)은 마스킹 가능하나 본 문서에서는 노출 허용

---

## 5. 중단(Exit) 통제 포인트

서비스 중단 시 아래 3단계 순서로 진행:

### 단계 1: Teams 앱 배포 회수 (고객)
- 고객 Teams Admin Center에서 앱 제거
- 영향: 사용자가 더 이상 채팅 불가

### 단계 2: Bridge 중지 (위두소프트)
```bash
flyctl scale count 0 -a freshchat-bridge
# 또는
flyctl apps destroy freshchat-bridge
```
- 영향: 메시지 라우팅 중단

### 단계 3: Azure Bot 비활성화 (위두소프트)
- Azure Portal > Bot Service > Teams 채널 제거
- App Registration 삭제 (선택)
- 영향: Bot Framework 연동 완전 해제

### 중단 전 필수 확인
- [ ] Freshchat 대화 데이터 Export 완료 (고객)
- [ ] 진행 중인 대화 종료 안내
- [ ] 캐시(Redis) 데이터 백업 불필요 (원본은 Freshchat)

---

## 6. 보안 체크리스트

| 항목 | 상태 | 비고 |
|------|------|------|
| HTTPS 강제 | ✅ | fly.toml: force_https=true |
| Webhook 서명 검증 | ✅ | FRESHCHAT_WEBHOOK_PUBLIC_KEY |
| 환경변수 분리 | ✅ | fly.io secrets |
| 멀티테넌트 인증 | ✅ | AzureADMultipleOrgs |
| 파일 업로드 제한 | ✅ | 10MB 제한, 확장자 검증 |
| Rate Limiting | ⚠️ | Freshchat API 의존 |
| DDoS 방어 | ✅ | fly.io 기본 제공 |

---

**문서 종료**
