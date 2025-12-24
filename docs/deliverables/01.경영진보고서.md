# 경영진 요약 (Executive Summary)

**문서번호:** FCBRIDGE-2024-ES-001  
**작성일:** 2025-12-23  
**작성자:** 위두소프트

---

## 1. 목적 및 배경

고객사 내부 사용자가 Microsoft Teams 환경에서 직접 헬프데스크에 문의하고, Freshchat을 통해 상담원이 응대할 수 있는 **양방향 실시간 채팅 브릿지** 시스템을 구축하였습니다.

- **도입 배경**: 기존 이메일/전화 기반 지원의 지연, Teams 환경 일원화 요구
- **적용 기간**: 2025년 10월 ~ 현재 운영 중

---

## 2. 적용 범위

| 구분 | 내용 |
|------|------|
| 대상 부서 | 고객사 전 임직원 (Teams 사용자) |
| 채널 | Microsoft Teams → Freshchat |
| 데이터 저장소 | Freshchat/Freshdesk (고객 소유) |
| 운영 환경 | Production (fly.io) |

---

## 3. 구현 요약

```
[Teams 사용자] ←→ [Teams App] ←→ [Azure Bot Service] ←→ [Bridge (fly.io)] ←→ [Freshchat]
```

**주요 특징:**
- Teams 앱은 **고객 테넌트에 배포**
- Bot 인프라(App Registration, Azure Bot Service)는 **위두소프트 테넌트 소유**
- Bridge 백엔드는 **fly.io**(Tokyo 리전)에서 운영
- 대화 원본 데이터는 **Freshchat/Freshdesk**에 저장 (고객 소유)

---

## 4. 성과

| 지표 | 내용 |
|------|------|
| 서비스 가용성 | 운영 중 (2대 인스턴스, 헬스체크 통과) |
| 메시지 양방향 전달 | Teams ↔ Freshchat 실시간 동기화 |
| 첨부파일 지원 | 이미지/파일 양방향 전송 가능 |
| 데이터 보존 | Freshchat에 원본 저장, 고객사 관리 |

---

## 5. 운영 현황

| 항목 | 상태 |
|------|------|
| Production 앱 | `freshchat-bridge.fly.dev` - **정상 운영** |
| Staging 앱 | `freshchat-bridge-staging.fly.dev` - 중지 상태 |
| 인스턴스 수 | 2대 (자동 확장/축소 지원) |
| 리전 | nrt (도쿄) |
| 헬스체크 | 15초 간격, 정상 |

**남은 리스크/제약:**
- Bot App Password 만료일: 2026-04-24 (로테이션 필요)
- Redis 세션 저장소 의존 (서버 재시작 시 일시적 매핑 복구 지연)

---

## 6. 다음 단계

### 옵션 1: 현행 유지
- 현재 범위 내 운영 지속
- 정기 모니터링 및 키 로테이션 관리

### 옵션 2: 추가 요청 시 (CR)
- Multi-tenant 확장
- 추가 채널 연동 (Freshdesk Ticket 등)
- 커스텀 보고서/분석 기능

