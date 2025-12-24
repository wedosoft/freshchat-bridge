# Freshdesk Omni Export 및 Exit 런북

**문서번호:** FCBRIDGE-2024-EXIT-001  
**작성일:** 2025-12-23  
**작성자:** 위두소프트

---

## 1. 목적

이 문서는 다음 상황을 대비한 데이터 Export 및 서비스 중단(Exit) 절차를 정의합니다:
- 감사 대비 데이터 백업
- 시스템 전환/마이그레이션
- 서비스 종료
- **락인(Lock-in) 방지**: 데이터 주권 확보

### ⚠️ 중요: Freshdesk Omni 환경 특성

고객사는 **Freshdesk Omni**를 사용하며, 운영 흐름은 다음과 같습니다:

```
[Teams 사용자] → [Freshchat 채팅] → [상담원 대응] → [Freshdesk 티켓 변환] (선택적)
```

**주의사항:**
- 모든 채팅이 티켓으로 변환되지 않을 수 있음
- 티켓 변환 없이 채팅만으로 종료된 대화 존재 가능
- **따라서 채팅(Freshchat) + 티켓(Freshdesk) 모두 아카이빙 필수**

---

## 2. 데이터 Export 범위

### 2.1 Export 전략: 듀얼 아카이빙

| 소스 | 역할 | 필수 여부 | 이유 |
|------|------|-----------|------|
| **Freshchat** | 원본 채팅 대화 | **필수** | 티켓 미전환 대화 포함 |
| **Freshdesk** | 티켓화된 대화 | **필수** | 공식 기록, 추가 메타데이터 |

### 2.2 Export 대상 (Freshchat) - 채팅 원본

| 데이터 유형 | 필수/선택 | API 엔드포인트 | 설명 |
|-------------|-----------|----------------|------|
| 대화(Conversations) | **필수** | `GET /conversations` | 전체 채팅 대화 목록 |
| 메시지(Messages) | **필수** | `GET /conversations/{id}/messages` | 대화별 메시지 내역 |
| 첨부파일(Attachments) | **필수** | 메시지 내 URL 다운로드 | 이미지/파일 |
| 사용자(Users) | **필수** | `GET /users` | 채팅 사용자 정보 |
| 상담원(Agents) | 권장 | `GET /agents` | 상담원 목록 |

### 2.3 Export 대상 (Freshdesk) - 티켓 기록

| 데이터 유형 | 필수/선택 | API 엔드포인트 | 설명 |
|-------------|-----------|----------------|------|
| 티켓(Tickets) | **필수** | `GET /api/v2/tickets` | 전체 티켓 목록 |
| 티켓 대화(Conversations) | **필수** | `GET /api/v2/tickets/{id}/conversations` | 티켓별 대화 내역 |
| 첨부파일 | **필수** | 대화 내 URL 다운로드 | 티켓 첨부파일 |
| 연락처(Contacts) | **필수** | `GET /api/v2/contacts` | 고객 정보 |
| 회사(Companies) | 권장 | `GET /api/v2/companies` | 회사 정보 |
| 상담원(Agents) | 권장 | `GET /api/v2/agents` | 상담원 목록 |

### 2.4 데이터 연계 검증

티켓 미전환 대화를 식별하기 위해 다음을 확인:

| 검증 항목 | 방법 | 기대 결과 |
|-----------|------|-----------|
| 채팅 → 티켓 연결 | Freshchat 대화의 `ticket_id` 필드 | 값 없으면 미전환 |
| 누락 대화 수 | 전체 채팅 - 티켓 연결된 채팅 | 누락 건수 파악 |

---

## 3. Export 절차

### 3.1 사전 준비

```bash
# 필요 도구 설치
npm install axios fs-extra

# 환경변수 설정 (.env)
FRESHCHAT_API_URL=[REDACTED]
FRESHCHAT_API_KEY=[REDACTED]
FRESHDESK_DOMAIN=[REDACTED]
FRESHDESK_API_KEY=[REDACTED]
```

### 3.2 통합 Export 스크립트 (Freshchat + Freshdesk)

```javascript
/**
 * Freshdesk Omni 통합 Data Export Script
 * 채팅(Freshchat) + 티켓(Freshdesk) 듀얼 아카이빙
 * 실행: node export-omni.js
 */

require('dotenv').config();
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');

// Freshchat API 클라이언트
const freshchatClient = axios.create({
    baseURL: process.env.FRESHCHAT_API_URL,
    headers: {
        'Authorization': `Bearer ${process.env.FRESHCHAT_API_KEY}`,
        'Content-Type': 'application/json'
    }
});

// Freshdesk API 클라이언트
const freshdeskClient = axios.create({
    baseURL: `https://${process.env.FRESHDESK_DOMAIN}.freshdesk.com/api/v2`,
    auth: {
        username: process.env.FRESHDESK_API_KEY,
        password: 'X'
    }
});

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function exportAll() {
    const timestamp = new Date().toISOString().split('T')[0];
    const exportDir = `./export_omni_${timestamp}`;
    
    console.log(`\n========================================`);
    console.log(`Freshdesk Omni 통합 Export 시작`);
    console.log(`Export 디렉토리: ${exportDir}`);
    console.log(`========================================\n`);

    await fs.ensureDir(exportDir);
    await fs.ensureDir(path.join(exportDir, 'freshchat'));
    await fs.ensureDir(path.join(exportDir, 'freshdesk'));
    
    // ========================================
    // Part 1: Freshchat Export (채팅 원본)
    // ========================================
    console.log('\n[1/4] Freshchat 대화 Export...');
    const chatConversations = await exportFreshchatConversations(exportDir);
    
    console.log('\n[2/4] Freshchat 메시지 Export...');
    await exportFreshchatMessages(exportDir, chatConversations);
    
    // ========================================
    // Part 2: Freshdesk Export (티켓)
    // ========================================
    console.log('\n[3/4] Freshdesk 티켓 Export...');
    const tickets = await exportFreshdeskTickets(exportDir);
    
    console.log('\n[4/4] Freshdesk 티켓 대화 Export...');
    await exportFreshdeskConversations(exportDir, tickets);
    
    // ========================================
    // Part 3: 데이터 검증 및 리포트
    // ========================================
    console.log('\n[검증] 데이터 연계 분석...');
    const report = await generateVerificationReport(exportDir, chatConversations, tickets);
    
    console.log('\n========================================');
    console.log('Export 완료!');
    console.log(`총 Freshchat 대화: ${chatConversations.length}건`);
    console.log(`총 Freshdesk 티켓: ${tickets.length}건`);
    console.log(`티켓 미전환 채팅: ${report.unlinkedChats}건`);
    console.log(`Export 위치: ${exportDir}`);
    console.log('========================================\n');
    
    return exportDir;
}

// Freshchat 대화 Export
async function exportFreshchatConversations(exportDir) {
    let page = 1;
    let hasMore = true;
    const allConversations = [];
    
    while (hasMore) {
        try {
            const response = await freshchatClient.get('/conversations', {
                params: { page, items_per_page: 50 }
            });
            
            const conversations = response.data.conversations || [];
            allConversations.push(...conversations);
            
            console.log(`  - Page ${page}: ${conversations.length}건`);
            
            hasMore = conversations.length === 50;
            page++;
            await delay(200);
        } catch (error) {
            console.error(`  ❌ Error on page ${page}:`, error.message);
            hasMore = false;
        }
    }
    
    await fs.writeJson(
        path.join(exportDir, 'freshchat', 'conversations.json'),
        allConversations,
        { spaces: 2 }
    );
    
    console.log(`  ✅ 총 ${allConversations.length}건 저장`);
    return allConversations;
}

// Freshchat 메시지 Export
async function exportFreshchatMessages(exportDir, conversations) {
    const messagesDir = path.join(exportDir, 'freshchat', 'messages');
    await fs.ensureDir(messagesDir);
    
    let processed = 0;
    for (const conv of conversations) {
        try {
            const msgResponse = await freshchatClient.get(`/conversations/${conv.id}/messages`);
            await fs.writeJson(
                path.join(messagesDir, `${conv.id}.json`),
                msgResponse.data,
                { spaces: 2 }
            );
            processed++;
            if (processed % 50 === 0) {
                console.log(`  - ${processed}/${conversations.length} 처리됨`);
            }
            await delay(100);
        } catch (error) {
            console.error(`  ⚠️ ${conv.id}: ${error.message}`);
        }
    }
    console.log(`  ✅ 총 ${processed}건 메시지 저장`);
}

// Freshdesk 티켓 Export
async function exportFreshdeskTickets(exportDir) {
    let page = 1;
    let hasMore = true;
    const allTickets = [];
    
    while (hasMore) {
        try {
            const response = await freshdeskClient.get('/tickets', {
                params: { 
                    page, 
                    per_page: 100,
                    include: 'description,requester'
                }
            });
            
            const tickets = response.data || [];
            allTickets.push(...tickets);
            
            console.log(`  - Page ${page}: ${tickets.length}건`);
            
            hasMore = tickets.length === 100;
            page++;
            await delay(500); // Freshdesk rate limit 고려
        } catch (error) {
            if (error.response?.status === 403) {
                console.log(`  - Page ${page}: 더 이상 데이터 없음`);
            } else {
                console.error(`  ❌ Error on page ${page}:`, error.message);
            }
            hasMore = false;
        }
    }
    
    await fs.writeJson(
        path.join(exportDir, 'freshdesk', 'tickets.json'),
        allTickets,
        { spaces: 2 }
    );
    
    console.log(`  ✅ 총 ${allTickets.length}건 저장`);
    return allTickets;
}

// Freshdesk 티켓 대화 Export
async function exportFreshdeskConversations(exportDir, tickets) {
    const conversationsDir = path.join(exportDir, 'freshdesk', 'conversations');
    await fs.ensureDir(conversationsDir);
    
    let processed = 0;
    for (const ticket of tickets) {
        try {
            const convResponse = await freshdeskClient.get(`/tickets/${ticket.id}/conversations`);
            await fs.writeJson(
                path.join(conversationsDir, `${ticket.id}.json`),
                convResponse.data,
                { spaces: 2 }
            );
            processed++;
            if (processed % 50 === 0) {
                console.log(`  - ${processed}/${tickets.length} 처리됨`);
            }
            await delay(200);
        } catch (error) {
            console.error(`  ⚠️ Ticket ${ticket.id}: ${error.message}`);
        }
    }
    console.log(`  ✅ 총 ${processed}건 대화 저장`);
}

// 검증 리포트 생성
async function generateVerificationReport(exportDir, chatConversations, tickets) {
    // 티켓과 연결된 채팅 찾기 (ticket_id 필드 또는 메타데이터)
    const linkedChats = chatConversations.filter(c => 
        c.ticket_id || c.meta?.ticket_id || c.properties?.ticket_id
    );
    
    const unlinkedChats = chatConversations.length - linkedChats.length;
    
    const report = {
        exportDate: new Date().toISOString(),
        summary: {
            totalFreshchatConversations: chatConversations.length,
            totalFreshdeskTickets: tickets.length,
            linkedChats: linkedChats.length,
            unlinkedChats: unlinkedChats
        },
        warning: unlinkedChats > 0 
            ? `⚠️ ${unlinkedChats}건의 채팅이 티켓으로 전환되지 않았습니다. Freshchat Export에서 확인하세요.`
            : '✅ 모든 채팅이 티켓으로 전환되었습니다.',
        unlinkedConversationIds: chatConversations
            .filter(c => !c.ticket_id && !c.meta?.ticket_id && !c.properties?.ticket_id)
            .map(c => c.id)
    };
    
    await fs.writeJson(
        path.join(exportDir, 'verification_report.json'),
        report,
        { spaces: 2 }
    );
    
    // 사람이 읽기 쉬운 요약
    const summaryText = `
========================================
Freshdesk Omni Export 검증 리포트
========================================
Export 일시: ${report.exportDate}

[데이터 요약]
- Freshchat 대화 총계: ${report.summary.totalFreshchatConversations}건
- Freshdesk 티켓 총계: ${report.summary.totalFreshdeskTickets}건
- 티켓 연결된 채팅: ${report.summary.linkedChats}건
- 티켓 미전환 채팅: ${report.summary.unlinkedChats}건

[검증 결과]
${report.warning}

${report.summary.unlinkedChats > 0 ? `
[주의] 티켓 미전환 채팅 목록은 verification_report.json의 
unlinkedConversationIds 필드를 확인하세요.
해당 채팅은 Freshchat Export에만 존재합니다.
` : ''}
========================================
`;
    
    await fs.writeFile(
        path.join(exportDir, 'VERIFICATION_SUMMARY.txt'),
        summaryText
    );
    
    console.log(summaryText);
    
    return report;
}

exportAll().catch(console.error);
```

### 3.3 폴더 구조

```
export_omni_2025-12-23/
├── freshchat/                      # Freshchat 채팅 원본
│   ├── conversations.json          # 대화 목록
│   └── messages/
│       ├── conv-id-001.json        # 대화별 메시지
│       ├── conv-id-002.json
│       └── ...
├── freshdesk/                      # Freshdesk 티켓
│   ├── tickets.json                # 티켓 목록
│   └── conversations/
│       ├── ticket-001.json         # 티켓별 대화
│       ├── ticket-002.json
│       └── ...
├── attachments/                    # 첨부파일 (선택)
│   ├── freshchat/
│   └── freshdesk/
├── verification_report.json        # 검증 리포트 (상세)
├── VERIFICATION_SUMMARY.txt        # 검증 요약 (사람용)
├── export_metadata.json            # Export 메타데이터
└── checksums.sha256               # 무결성 검증용
```

### 3.4 파일 네이밍 규칙

| 파일 유형 | 네이밍 규칙 | 예시 |
|-----------|-------------|------|
| Export 폴더 | `export_omni_YYYY-MM-DD` | export_omni_2025-12-23 |
| Freshchat 메시지 | `{conversation_id}.json` | abc123.json |
| Freshdesk 대화 | `{ticket_id}.json` | 12345.json |
| 첨부파일 | `{source}_{id}_{filename}` | freshchat_msg001_image.png |

---

## 4. 정기 백업 일정

| 백업 유형 | 주기 | 보관 기간 | 트리거 |
|-----------|------|-----------|--------|
| 전체 Export (채팅+티켓) | 월 1회 | 12개월 | 1일 01:00 |
| 이벤트 종료 시 | 수시 | 영구 | 캠페인/이벤트 종료 |
| 계약 종료 전 | 1회 | 영구 | 종료 30일 전 |

---

## 5. 검증 절차

### 5.1 건수 검증

```bash
# Freshchat 대화 건수 확인
cat export_omni_2025-12-23/freshchat/conversations.json | jq 'length'

# Freshdesk 티켓 건수 확인
cat export_omni_2025-12-23/freshdesk/tickets.json | jq 'length'

# 검증 리포트 확인
cat export_omni_2025-12-23/VERIFICATION_SUMMARY.txt
```

### 5.2 티켓 미전환 채팅 확인

```bash
# 미전환 채팅 ID 목록
cat export_omni_2025-12-23/verification_report.json | jq '.unlinkedConversationIds'

# 미전환 채팅 수
cat export_omni_2025-12-23/verification_report.json | jq '.summary.unlinkedChats'
```

### 5.3 무결성 검증 (해시)

```bash
# Export 시 해시 생성
find export_omni_2025-12-23 -type f -exec sha256sum {} \; > checksums.sha256

# 검증
sha256sum -c checksums.sha256
```

### 5.4 샘플 복원 테스트

**Freshchat 검증:**
1. 무작위 채팅 5건 선택
2. 원본 Freshchat UI와 Export 데이터 비교
3. 메시지 내용, 타임스탬프, 첨부파일 일치 확인

**Freshdesk 검증:**
1. 무작위 티켓 5건 선택
2. 원본 Freshdesk UI와 Export 데이터 비교
3. 티켓 상태, 대화 내역, 첨부파일 일치 확인

**연계 검증:**
1. 티켓 미전환 채팅 중 3건 샘플링
2. Freshchat UI에서 해당 대화 확인
3. 실제로 티켓 미생성 여부 확인

---

## 6. Exit(중단) 절차

### 6.1 중단 순서

```
[1] 사전 준비 (D-30)
    ├── 고객 통보
    ├── 데이터 Export 완료
    └── Export 검증

[2] Teams 앱 제거 (D-7)
    ├── 고객: Teams Admin Center에서 앱 제거
    └── 사용자 접근 차단

[3] Bridge 중지 (D-Day)
    ├── fly.io 인스턴스 중지
    └── Webhook 수신 중단

[4] Azure 리소스 정리 (D+7)
    ├── Bot Service Teams 채널 제거
    ├── (선택) App Registration 삭제
    └── (선택) Bot Service 삭제

[5] 최종 확인 (D+14)
    ├── 잔여 리소스 없음 확인
    └── 비용 청구 종료 확인
```

### 6.2 중단 명령 (상세)

**Step 2: Teams 앱 제거 (고객 수행)**
```
1. Microsoft Teams Admin Center 접속
2. Teams apps > Manage apps
3. "Freshchat Bridge" 검색
4. 앱 선택 > Delete
```

**Step 3: Bridge 중지 (위두소프트 수행)**
```bash
# 인스턴스 중지
flyctl scale count 0 -a freshchat-bridge

# 상태 확인
flyctl status -a freshchat-bridge
# Expected: "No machines are running"

# (완전 삭제 시)
flyctl apps destroy freshchat-bridge --yes
```

**Step 4: Azure 리소스 정리 (위두소프트 수행)**
```bash
# Teams 채널 제거
az bot msteams delete --resource-group my-vm-rg --name freshchat-bridge

# Bot Service 삭제 (선택)
az bot delete --resource-group my-vm-rg --name freshchat-bridge

# App Registration 삭제 (선택)
az ad app delete --id 6a46afe9-3109-4af6-a0f9-275f6fddf929
```

### 6.3 중단 후 검증

| 검증 항목 | 방법 | 기대 결과 |
|-----------|------|-----------|
| Teams 앱 접근 | Teams에서 검색 | 앱 없음 |
| Bridge URL | `curl https://freshchat-bridge.fly.dev/` | 503 또는 연결 실패 |
| Bot Endpoint | Azure Portal > Bot | 채널 없음 |
| fly.io 비용 | billing 페이지 | 청구 중지 |

---

## 7. 비상 연락처

| 상황 | 담당 | 연락처 |
|------|------|--------|
| Export 문의 | 위두소프트 기술지원 | [TBD] |
| Freshchat API 문의 | Freshworks Support | [TBD] |
| Azure 문의 | Microsoft Support | support.microsoft.com |

---

## 8. 체크리스트

### Export 체크리스트
- [ ] Freshchat API 키 유효성 확인
- [ ] Freshdesk API 키 유효성 확인
- [ ] Export 스크립트 테스트 완료
- [ ] 저장 공간 충분
- [ ] **Freshchat 대화 건수 일치**
- [ ] **Freshchat 메시지 건수 일치**
- [ ] **Freshdesk 티켓 건수 일치**
- [ ] **Freshdesk 대화 건수 일치**
- [ ] 첨부파일 다운로드 완료
- [ ] 해시 검증 통과
- [ ] 샘플 복원 테스트 통과
- [ ] **티켓 미전환 채팅 리스트 확인**
- [ ] **검증 리포트 검토 완료**

### Exit 체크리스트
- [ ] 고객 사전 통보 (30일 전)
- [ ] **Freshchat 데이터 Export 완료**
- [ ] **Freshdesk 데이터 Export 완료**
- [ ] **검증 리포트 확인 (누락 데이터 없음)**
- [ ] Teams 앱 제거 완료
- [ ] Bridge 인스턴스 중지
- [ ] Webhook URL 무효화
- [ ] Azure Bot 채널 제거
- [ ] (선택) App Registration 삭제
- [ ] 최종 비용 정산 확인

