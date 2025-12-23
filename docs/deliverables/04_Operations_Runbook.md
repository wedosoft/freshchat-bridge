# 운영 런북 (Operations Runbook)

**문서번호:** FCBRIDGE-2024-OPS-001  
**작성일:** 2025-12-23  
**작성자:** 위두소프트

---

## 1. 정상 점검 체크리스트

### 1.1 매일 점검 항목

| 점검 항목 | 명령/방법 | 정상 기준 |
|-----------|-----------|-----------|
| 앱 상태 | `flyctl status -a freshchat-bridge` | State: started, Checks: passing |
| 헬스체크 | `curl https://freshchat-bridge.fly.dev/` | HTTP 200 |
| 로그 확인 | `flyctl logs -a freshchat-bridge` | 에러 없음 |

### 1.2 주간 점검 항목

| 점검 항목 | 명령/방법 | 정상 기준 |
|-----------|-----------|-----------|
| 인스턴스 수 | `flyctl status -a freshchat-bridge` | 2대 이상 running |
| 배포 버전 | `flyctl releases -a freshchat-bridge` | 최신 버전 일치 |
| Sentry 에러 | Sentry Dashboard | Critical 에러 없음 |
| Redis 연결 | 로그에서 `[Redis] Connected` 확인 | 정상 연결 |

### 1.3 월간 점검 항목

| 점검 항목 | 방법 | 기준 |
|-----------|------|------|
| Azure 키 만료일 | Azure Portal > App Registration | 3개월 전 알림 |
| Freshchat API 정상 | 테스트 메시지 송수신 | 양방향 동작 |
| 비용 검토 | fly.io billing | 예산 내 |

---

## 2. 일반 운영 명령어

### 2.1 상태 확인

```bash
# 앱 상태 조회
flyctl status -a freshchat-bridge

# 실시간 로그 확인
flyctl logs -a freshchat-bridge --no-tail

# 실시간 로그 스트리밍
flyctl logs -a freshchat-bridge

# 최근 배포 이력
flyctl releases -a freshchat-bridge

# 시크릿 목록 (값은 미표시)
flyctl secrets list -a freshchat-bridge
```

### 2.2 스케일링

```bash
# 인스턴스 수 조정
flyctl scale count 2 -a freshchat-bridge

# VM 사양 확인
flyctl scale show -a freshchat-bridge

# 메모리 조정 (필요 시)
flyctl scale memory 2048 -a freshchat-bridge
```

### 2.3 SSH 접근 (디버깅)

```bash
# SSH 콘솔 접속
flyctl ssh console -a freshchat-bridge

# 특정 인스턴스 접속
flyctl ssh console -a freshchat-bridge -s <machine-id>
```

---

## 3. 장애 유형별 트러블슈팅

### 3.1 Teams 측 장애

| 증상 | 원인 | 확인 방법 | 조치 |
|------|------|-----------|------|
| 메시지가 전송되지 않음 | Bot 채널 비활성 | Azure Portal > Bot > Channels | Teams 채널 재활성화 |
| "서비스를 사용할 수 없습니다" | Bot Endpoint 오류 | `curl https://freshchat-bridge.fly.dev/bot/callback` | Bridge 재기동 |
| 앱이 보이지 않음 | 배포 제거됨 | Teams Admin Center | 앱 재배포 |
| 인증 오류 | 토큰 만료 | Azure Portal > App Registration > Secrets | 새 Secret 발급 |

### 3.2 Bridge 측 장애 (fly.io)

| 증상 | 원인 | 확인 방법 | 조치 |
|------|------|-----------|------|
| 502/503 에러 | 인스턴스 다운 | `flyctl status -a freshchat-bridge` | 재기동 또는 스케일 업 |
| 헬스체크 실패 | 앱 크래시 | `flyctl logs -a freshchat-bridge` | 로그 분석 후 수정 배포 |
| Redis 연결 실패 | Redis 서버 문제 | 로그에서 `[Redis] error` | Redis URL 확인, 재연결 |
| 메모리 부족 | 과부하/메모리 누수 | `flyctl status` (메모리 사용량) | 인스턴스 재시작 |

**Bridge 재기동 명령:**
```bash
# 전체 앱 재시작
flyctl apps restart freshchat-bridge

# 특정 머신 재시작
flyctl machine restart <machine-id> -a freshchat-bridge

# 강제 재배포
flyctl deploy -a freshchat-bridge --strategy immediate
```

### 3.3 Azure Bot 측 장애

| 증상 | 원인 | 확인 방법 | 조치 |
|------|------|-----------|------|
| Bot 응답 없음 | Endpoint 미연결 | Azure Portal > Bot > Configuration | Endpoint URL 확인 |
| 401 Unauthorized | App Password 오류 | Bot Framework Emulator 테스트 | Secret 재발급 |
| 채널 연결 실패 | Teams 채널 설정 | Azure Portal > Bot > Channels | 채널 재구성 |

**Azure CLI 확인:**
```bash
# Bot 상태 확인
az bot show --resource-group my-vm-rg --name freshchat-bridge

# App Registration 확인
az ad app show --id 6a46afe9-3109-4af6-a0f9-275f6fddf929
```

### 3.4 Freshchat 측 장애

| 증상 | 원인 | 확인 방법 | 조치 |
|------|------|-----------|------|
| Webhook 미수신 | Webhook URL 오류 | Freshchat Admin > Webhooks | URL 재설정 |
| 메시지 전송 실패 | API Key 만료 | `401 Unauthorized` 로그 | 고객에게 새 API Key 요청 |
| 서명 검증 실패 | Public Key 불일치 | `[Security] signature failed` 로그 | Public Key 갱신 |
| 대화 생성 실패 | Inbox ID 오류 | `400 Bad Request` 로그 | FRESHCHAT_INBOX_ID 확인 |

---

## 4. 재기동/롤백 절차

### 4.1 일반 재기동

```bash
# 1. 현재 상태 확인
flyctl status -a freshchat-bridge

# 2. 앱 재시작
flyctl apps restart freshchat-bridge

# 3. 상태 재확인
flyctl status -a freshchat-bridge
flyctl logs -a freshchat-bridge --no-tail
```

### 4.2 특정 버전 롤백

```bash
# 1. 배포 이력 확인
flyctl releases -a freshchat-bridge

# 2. 이전 버전으로 롤백
flyctl deploy -a freshchat-bridge --image <previous-image>

# 또는 특정 릴리스로 롤백
flyctl releases rollback <version> -a freshchat-bridge
```

### 4.3 긴급 중지

```bash
# 모든 인스턴스 중지
flyctl scale count 0 -a freshchat-bridge

# 재시작
flyctl scale count 2 -a freshchat-bridge
```

---

## 5. 배포/변경 관리

### 5.1 일반 배포 절차

```bash
# 1. 로컬 테스트 완료 확인

# 2. Staging 배포 (선택)
flyctl deploy -a freshchat-bridge-staging

# 3. Staging 테스트 완료

# 4. Production 배포
flyctl deploy -a freshchat-bridge

# 5. 배포 확인
flyctl status -a freshchat-bridge
flyctl logs -a freshchat-bridge --no-tail
```

### 5.2 핫픽스 배포

```bash
# 긴급 배포 (롤링 없이 즉시)
flyctl deploy -a freshchat-bridge --strategy immediate

# 특정 이미지로 배포
flyctl deploy -a freshchat-bridge --image registry.fly.io/freshchat-bridge:tag
```

### 5.3 시크릿 변경

```bash
# 시크릿 설정 (자동 재배포됨)
flyctl secrets set KEY_NAME=value -a freshchat-bridge

# 여러 시크릿 동시 설정
flyctl secrets set KEY1=val1 KEY2=val2 -a freshchat-bridge

# 시크릿 삭제
flyctl secrets unset KEY_NAME -a freshchat-bridge
```

---

## 6. 지원 범위/SLA

### 6.1 지원 범위

| 구분 | 범위 |
|------|------|
| 시스템 | Bridge 서버, Azure Bot, App Registration |
| 언어 | 한국어 |
| 채널 | 이메일, Teams (합의 시) |

### 6.2 대응 기준

| 등급 | 정의 | 대응 시간 |
|------|------|-----------|
| Critical | 서비스 완전 중단 | [TBD] |
| High | 주요 기능 장애 | [TBD] |
| Medium | 일부 기능 제한 | [TBD] |
| Low | 문의/개선 요청 | [TBD] |

---

## 7. 연락 체계 (RACI)

| 역할 | 담당 | 연락처 |
|------|------|--------|
| 위두소프트 기술지원 | [TBD] | [TBD] |
| 고객 IT 담당자 | [TBD] | [TBD] |
| Azure 긴급 | Microsoft Support | support.microsoft.com |
| fly.io 긴급 | fly.io Support | community.fly.io |

### RACI 매트릭스

| 작업 | 위두소프트 | 고객 IT |
|------|-----------|---------|
| Bridge 운영/모니터링 | R/A | I |
| Azure 리소스 관리 | R/A | I |
| Teams 앱 배포/제거 | C | R/A |
| Freshchat API Key 관리 | I | R/A |
| 장애 대응 1차 | R/A | I |
| 장애 원인 분석 | R/A | C |

*R=Responsible, A=Accountable, C=Consulted, I=Informed*

---

## 8. 유용한 디버깅 엔드포인트

| 엔드포인트 | 용도 | 접근 |
|------------|------|------|
| `GET /` | 헬스체크 | 공개 |
| `GET /debug/mappings` | 대화 매핑 조회 | 내부용 |
| `POST /debug/reset` | 매핑 초기화 | 내부용 |
| `GET /auth/permissions-status` | 권한 상태 확인 | 내부용 |

---

**문서 종료**
