# Freshchat API 메시지 수신확인 및 전달확인 기능 조사 결과

조사 일자: 2025년 11월 7일

## 요약

Freshchat API 공식 문서를 조사한 결과, **메시지 전달확인(delivery confirmation)과 읽음확인(read receipt) 기능에 대한 명시적인 지원이 확인되지 않았습니다.**

---

## 상세 조사 결과

### 1. 메시지 전달 확인 (Delivery Confirmation)

**지원 여부:** ❌ **명시적 지원 없음**

#### 관련 API 엔드포인트:
- **없음** - 메시지 전달 상태를 확인하는 전용 API가 없음

#### 조사 내용:
- Freshchat API 문서에서 메시지 객체(`message object`)의 속성을 검토한 결과:
  - `status` 속성은 **메시지 전송 실패 시에만** 존재 (예: "Failed")
  - 전달 완료(`delivered`) 상태는 응답 객체에 포함되지 않음
  
- **아웃바운드 메시지(Outbound Messages)**의 경우:
  - WhatsApp을 통한 프로액티브 메시지 전송 시에만 상태 추적 지원
  - 가능한 상태: `Accepted`, `Sent`, `Delivered`, `Failed`
  - 이는 일반적인 채팅 메시지가 아닌 **WhatsApp 템플릿 메시지 전용** 기능

```json
// Outbound Message 객체의 status 속성 (WhatsApp 전용)
{
  "status": "Delivered",  // Accepted, Sent, Delivered, Failed
  "failure_code": "string",
  "failure_reason": "string"
}
```

#### 제약사항:
- 일반 대화(conversation) 메시지의 전달 상태는 추적 불가
- WhatsApp 채널을 통한 아웃바운드 메시지만 제한적으로 상태 추적 가능

---

### 2. 메시지 읽음 확인 (Read Receipt)

**지원 여부:** ❌ **명시적 지원 없음**

#### 관련 API 엔드포인트:
- **없음** - 메시지 읽음 상태를 확인하는 API가 없음

#### 조사 내용:
- Message 객체 속성 검토 결과:
  - `read`, `seen`, `read_time`, `read_by` 등의 속성이 존재하지 않음
  - 사용 가능한 시간 관련 속성: `created_time` (메시지 생성 시간)만 존재

- 메시지 객체의 주요 속성:
```json
{
  "id": "string",
  "created_time": "2022-11-29T10:00:00.000Z",
  "message_parts": [...],
  "actor_type": "user",
  "actor_id": "string",
  "conversation_id": "string",
  "message_type": "normal"
}
```

#### 제약사항:
- 메시지가 사용자에게 읽혔는지 여부를 확인할 방법 없음
- 읽음 확인 타임스탬프 제공 안 됨

---

### 3. 메시지 상태 업데이트 추적

**지원 여부:** ⚠️ **매우 제한적**

#### 가능한 상태:
일반 대화 메시지의 경우 상태 추적이 거의 불가능하며, 대신 다음 정보만 제공:

1. **메시지 전송 성공/실패**
   - API 응답 코드로만 확인 가능
   - 200 OK: 메시지 전송 성공
   - 실패 시: `error_code`, `status`, `error_message` 속성 제공

2. **메시지 타입** (`message_type`)
   - `normal`: 일반 메시지
   - `private`: 비공개 메시지 (사용자에게 보이지 않음)
   - `system`: 시스템 메시지

#### 제약사항:
- `pending`, `sent`, `delivered`, `read`, `seen` 등의 상태 없음
- 메시지 생명주기 추적 불가

---

### 4. 웹훅 이벤트 (Webhook Events)

**지원 여부:** ⚠️ **웹훅 기능은 존재하나 메시지 상태 이벤트는 미확인**

#### 조사 내용:
- Freshchat 웹훅 문서 접근 시도 결과:
  - `https://developers.freshchat.com/webhooks/` - 페이지 없음 (404)
  - `https://support.freshchat.com/.../webhooks-in-freshchat` - 페이지 없음

- API 문서에서 웹훅 관련 내용 찾을 수 없음

#### 일반적으로 예상되는 웹훅 이벤트 (확인 필요):
Freshchat이 웹훅을 지원한다면, 일반적으로 다음과 같은 이벤트가 있을 것으로 예상:
- `message:created` - 새 메시지 생성
- `conversation:created` - 새 대화 생성
- `conversation:resolved` - 대화 해결
- `conversation:assigned` - 대화 할당
- `user:created` - 사용자 생성

하지만 **메시지 상태 관련 이벤트** (`message:delivered`, `message:read` 등)는 문서에서 확인되지 않음

#### 제약사항:
- 웹훅 공식 문서에 접근 불가로 정확한 이벤트 목록 확인 불가
- 메시지 전달/읽음 상태 관련 웹훅 이벤트 미확인

---

## 대안 방안

메시지 상태 추적이 필요한 경우 다음 대안을 고려할 수 있습니다:

### 1. Reports API 활용
```
GET /v2/reports/raw
```

**사용 가능한 리포트:**
- `Chat-Transcript`: 대화 내역 및 메시지 추출
- `Message-Sent`: 전송된 메시지 목록
- `Conversation-Activity`: 대화 활동 내역

**제공 정보:**
- `created_time`: 메시지 생성 시간
- `actor_type`: 메시지 발신자 유형 (user, agent, system)
- `conversation_id`: 대화 ID

**제약:**
- 실시간이 아닌 배치 처리 방식
- 메시지 읽음 상태는 여전히 확인 불가

### 2. 메시지 리스트 API 폴링
```
GET /v2/conversations/{conversation_id}/messages
```

**방법:**
- 주기적으로 메시지 목록 조회
- 마지막 메시지 시간 비교를 통한 간접적 활동 추적

**제약:**
- 읽음 여부가 아닌 메시지 전송 여부만 확인 가능
- API 호출 제한(Rate Limit)에 주의 필요

### 3. WhatsApp 채널 활용 (제한적)
```
POST /v2/outbound-messages/whatsapp
GET /v2/outbound-messages
```

**지원 상태:**
- `Accepted`, `Sent`, `Delivered`, `Failed`

**제약:**
- WhatsApp 템플릿 메시지 전용
- 일반 채팅 메시지에는 적용 불가
- 읽음 확인은 여전히 미지원

---

## 결론

### 요청 사항별 결과

| 요청 사항 | 지원 여부 | 비고 |
|---------|---------|------|
| 1. 메시지 전달 확인 웹훅 | ❌ 없음 | 웹훅 문서 접근 불가 |
| 2. 메시지 읽음 확인 (Read Receipt) | ❌ 없음 | API 속성 미제공 |
| 3. 메시지 상태 추적 API | ⚠️ 매우 제한적 | 전송 성공/실패만 확인 가능 |
| 4. 메시지 상태 관련 웹훅 이벤트 | ❓ 미확인 | 문서 접근 불가로 확인 불가 |

### 권장사항

1. **Freshchat 공식 지원팀 문의**
   - 웹훅 이벤트의 전체 목록 확인
   - 메시지 상태 추적 로드맵 확인

2. **대안 솔루션 검토**
   - 메시지 읽음 확인이 필수인 경우, 이 기능을 지원하는 다른 플랫폼 고려
   - 또는 WhatsApp Business API 직접 통합 검토

3. **현재 가능한 기능 활용**
   - Reports API로 메시지 전송 이력 추적
   - 대화 상태(새 메시지 생성, 해결 등) 추적
   - Agent/User 활동 모니터링

---

## 참고 자료

- [Freshchat API 공식 문서](https://developers.freshchat.com/api/)
- [Freshchat Web SDK](https://developers.freshchat.com/web-sdk/)
- Freshchat API v2 Conversations 섹션
- Freshchat API v2 Outbound Messages 섹션
- Freshchat API v2 Reports 섹션

---

## 추가 확인 필요 사항

1. Freshchat 계정 관리자 또는 설정에서 웹훅 설정 확인
2. Freshchat 지원팀에 웹훅 이벤트 목록 문의
3. WhatsApp Business API 통합 시 읽음 확인 기능 가용성 확인
4. 최신 API 버전 업데이트 사항 확인
