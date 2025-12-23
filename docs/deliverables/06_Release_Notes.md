# 릴리즈 노트 (Release Notes)

**문서번호:** FCBRIDGE-2024-RN-001  
**작성일:** 2025-12-23  
**작성자:** 위두소프트

---

## 버전 이력

| 버전 | 날짜 | 유형 | 주요 변경 |
|------|------|------|-----------|
| v227 | 2025-12-17 | Hotfix | 최신 운영 버전 |
| v79 | 2025-12-15 | Staging | Staging 환경 테스트 |
| v1.0 | 2025-10-25 | Initial | 초기 PoC 배포 |

---

## 상세 변경 이력

### v227 (2025-12-17) - Production

**배포 정보:**
- 배포자: GitHub Actions / 위두소프트
- 대상: freshchat-bridge.fly.dev
- 인스턴스: 2대 (nrt)

**변경 내용:**
- [TBD] 구체적 변경 사항 확인 필요 (Git 커밋 로그 참조)

**영향:**
- 정상 운영 중

---

### v1.0 (2025-10-25) - Initial Release

**배포 정보:**
- 배포자: 위두소프트
- 대상: Production 환경

**변경 내용:**
1. Teams ↔ Freshchat 양방향 메시지 브릿지 구현
2. 첨부파일 (이미지/문서) 양방향 전송
3. Redis 기반 세션 관리
4. Webhook 서명 검증
5. Azure Bot Service 연동
6. Sentry 에러 모니터링 연동

**검증 결과:**
- Teams → Freshchat 메시지 전송: ✅
- Freshchat → Teams 메시지 전송: ✅
- 이미지 첨부파일 전송: ✅
- 문서 첨부파일 전송: ✅

---

## Azure 리소스 생성 이력

| 리소스 | 생성일 | 비고 |
|--------|--------|------|
| App Registration (Production) | 2025-10-25 | freshchat-bridge |
| Azure Bot Service (Production) | 2025-10-25 | F0 tier |
| App Registration (Staging) | 2025-11-09 | freshchat-bridge-staging |
| Azure Bot Service (Staging) | 2025-11-09 | F0 tier |

---

## 키/시크릿 이력

| 키 | 생성일 | 만료일 | 비고 |
|----|--------|--------|------|
| Bot Runtime - 20251026-1055 | 2025-10-26 | 2026-04-24 | Production |
| GitHub Action - 20251026-1046 | 2025-10-26 | 2026-04-24 | CI/CD |
| Staging 20251109-1347 | 2025-11-09 | 2026-05-08 | Staging |

---

## 향후 계획

| 항목 | 예정일 | 상태 |
|------|--------|------|
| 키 로테이션 | 2026-03 | 예정 |
| [TBD] | - | - |

---

**문서 종료**
