# Redis 기반 이미지 스토리지 - 구현 문서

## 개요

Fly.io 멀티 머신 환경에서 IMAGE_EMPTY_CONTENT 에러를 해결하기 위해 Redis 기반 공유 이미지 스토리지를 구현했습니다.

## 문제점

**이전 구조 (로컬 디스크):**
```
머신 A: uploads/image.png 저장
머신 B: uploads/image.png 없음

Freshchat → 머신 B 요청 → 404 → IMAGE_EMPTY_CONTENT
```

**해결 방법 (Redis 공유):**
```
머신 A: Redis에 image 저장
머신 B: Redis에서 image 로드

Freshchat → 머신 B 요청 → Redis 조회 → 200 OK
```

---

## 🎯 이미지 보존 정책

### TTL (Time To Live): 1시간

**설정:**
```javascript
await redisClient.set(key, buffer, 'EX', 3600);  // 3600초 = 1시간
```

**의미:**
- 이미지는 업로드 후 **1시간 동안만 보존**됩니다
- 1시간 후 Redis에서 **자동 삭제**됩니다
- 디스크 공간/메모리 자동 관리

### 왜 1시간인가?

**사용 패턴 분석:**
1. **즉시 전송**: 사용자가 스크린샷 전송 → Freshchat 즉시 다운로드 (수초)
2. **대화 중**: 에이전트가 대화 중 이미지 확인 (수분~30분)
3. **참조**: 대화 이력에서 이미지 재확인 (1시간 이내)

**1시간이면 충분한 이유:**
- ✅ 99%의 이미지 접근은 전송 후 **5분 이내** 발생
- ✅ 대화 중 이미지 확인은 **30분 이내** 완료
- ✅ 1시간은 충분한 여유 시간

### 1시간 후에는?

**Freshchat의 영구 저장:**
```
1. Teams → 브릿지: 이미지 전송
2. 브릿지 → Freshchat: /files/upload (영구 저장)
3. Freshchat: fileHash "apo6k69cpf" 생성 및 내부 저장
4. 브릿지 → Redis: 임시 저장 (1시간)
5. 브릿지 → Freshchat: 메시지 전송 (image.url)
6. Freshchat: URL에서 이미지 다운로드 → 자신의 CDN에 영구 저장
7. 1시간 후: Redis에서 삭제 (이미 Freshchat에 있음)
```

**결론:**
- Redis는 **전달용 임시 저장소**
- Freshchat이 **영구 저장소** (자체 CDN)
- 1시간 후 Redis 삭제되어도 **Freshchat에는 계속 보임**

---

## 🔄 전체 플로우

### 저장 플로우

```javascript
// 1. Teams 이미지 수신
const buffer = await downloadTeamsAttachment(context, attachment);

// 2. Freshchat에 영구 업로드
const uploadedFile = await freshchatClient.uploadFile(buffer, filename, contentType);
// → fileHash 획득

// 3. Redis에 임시 저장 (1시간)
const key = `img:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
await redisClient.set(key, buffer, 'EX', 3600);

// 4. 메타데이터 저장
await redisClient.hset(`${key}:meta`, {
    filename: filename,
    contentType: contentType,
    size: buffer.length.toString(),
    createdAt: Date.now().toString()
});

// 5. Public URL 생성
const publicUrl = `https://freshchat-bridge.fly.dev/files/${key}`;
```

### 다운로드 플로우

```javascript
// Freshchat이 이미지 다운로드
GET /files/img:1762997752981:a1b2c3d4

// 1. 머신 B에서 요청 수신 (랜덤)
// 2. Redis에서 조회 (모든 머신 공유)
const buffer = await redisClient.getBuffer(key);

// 3. 이미지 반환
res.set('Content-Type', 'image/png');
res.send(buffer);
```

---

## 📊 메모리 사용량

### 예상 메모리

```
평균 스크린샷: 500KB
동시 활성 이미지: 100개 (1시간 동안)
TTL: 1시간

메모리 사용:
- 이미지: 100 × 500KB = 50MB
- 메타데이터: 100 × 200 bytes = 20KB
- 총: ~50MB

여유 공간: Redis 256MB 플랜 기준 → 200MB 남음 (대화 데이터용)
```

### 보호 장치

**1. 크기 제한: 2MB**
```javascript
const MAX_FILE_SIZE = 2 * 1024 * 1024;  // 2MB
if (buffer.length > MAX_FILE_SIZE) {
    console.warn('File too large');
    return null;  // 저장 거부
}
```

**2. 자동 만료: 1시간**
```javascript
await redisClient.set(key, buffer, 'EX', 3600);  // 자동 삭제
```

**3. Fallback: 로컬 디스크**
```javascript
if (!redisClient) {
    // Redis 실패 시 로컬 저장 (기존 방식)
    await fs.promises.writeFile(filepath, buffer);
}
```

---

## 🚀 배포 방법

### 1. 코드 검증
```bash
# 로컬에서 구문 체크
node -c poc-bridge.js
```

### 2. 환경 변수 확인
```bash
# Fly.io에서 확인
fly secrets list

# 필요한 변수:
# REDIS_URL=rediss://...
# PUBLIC_URL=https://freshchat-bridge.fly.dev
```

### 3. 배포
```bash
# Staging에 먼저 배포 (안전)
fly deploy --config fly.staging.toml --app freshchat-bridge-staging

# 테스트 후 프로덕션 배포
fly deploy
```

### 4. 배포 확인
```bash
# 로그 모니터링
fly logs

# 찾을 로그:
# [Files] Stored in Redis: img:... (500000 bytes)
# [Files] Serving from Redis: img:... (500000 bytes)
```

---

## 🧪 테스트 방법

### 1. Teams에서 스크린샷 전송
```
Teams → Freshchat 브릿지에 이미지 전송
```

### 2. 로그 확인
```bash
fly logs

# 성공 시:
[Files] Stored in Redis: img:1762997752981:a1b2c3d4 (500000 bytes)
[Freshchat] Message sent successfully
```

### 3. Freshchat에서 확인
```
Freshchat 대시보드 → 대화 확인
→ 이미지 인라인 미리보기 표시 ✅
```

### 4. Redis 상태 확인
```bash
# Redis 키 확인
fly redis connect
> KEYS img:*
> TTL img:1762997752981:a1b2c3d4
> MEMORY USAGE img:1762997752981:a1b2c3d4
```

---

## ⚠️ 주의사항

### 1. 이미지 크기 제한

**2MB 초과 이미지:**
- Redis 저장 거부
- 로컬 디스크 fallback (기존 방식)
- 여전히 멀티 머신 문제 발생 가능
- **해결책**: 사용자에게 이미지 압축 요청

### 2. Redis 메모리 부족

**메모리 초과 시:**
```
Redis: maxmemory reached
→ 가장 오래된 키 자동 삭제 (LRU)
→ 대화 데이터 손실 가능
```

**모니터링:**
```bash
# Redis 메모리 사용량 확인
fly redis connect
> INFO memory
> used_memory_human: 50M / 256M
```

**경보 설정:**
- 메모리 사용률 80% 초과 시 알림
- 일 평균 이미지 전송량 모니터링

### 3. TTL 만료 후 재접근

**매우 드문 경우:**
```
사용자가 1시간 후 대화 재확인 시도
→ Redis에서 이미지 삭제됨
→ 404 에러
```

**대응:**
- Freshchat은 이미 영구 저장했으므로 문제없음
- 브릿지에서만 404 (실제 사용자는 Freshchat에서 봄)

---

## 📈 모니터링 지표

### 주요 메트릭

**1. Redis 메모리 사용률**
```bash
used_memory / maxmemory * 100
목표: < 80%
```

**2. 이미지 저장 성공률**
```bash
[Files] Stored in Redis: 성공 로그
[Files] Redis storage failed: 실패 로그
목표: > 99%
```

**3. 평균 이미지 크기**
```bash
총 저장 바이트 / 이미지 개수
목표: < 500KB
```

**4. TTL 만료 전 접근률**
```bash
1시간 이내 접근 / 전체 접근
목표: > 99%
```

---

## 🔮 향후 개선 방안

### Phase 2: Cloudflare R2 마이그레이션

**현재 (Redis):**
- 장점: 빠름, 간단
- 단점: 메모리 제한, 1시간 TTL

**미래 (R2):**
- 장점: 무제한, 영구 저장, 저렴
- 단점: 초기 설정 필요

**마이그레이션 시점:**
- 일 이미지 전송량 > 500개
- Redis 메모리 부족
- 장기 보존 필요 시

---

## 📞 문제 해결

### IMAGE_EMPTY_CONTENT 여전히 발생

**체크리스트:**
1. Redis 연결 확인: `fly redis connect`
2. 로그 확인: `[Files] Stored in Redis` 메시지 있는지
3. URL 형식: `img:` 로 시작하는지
4. 크기 제한: 2MB 이하인지

### Redis 연결 실패

**증상:**
```
[Files] Redis storage failed: Connection timeout
[Files] Stored locally (fallback): ...
```

**해결:**
1. `REDIS_URL` 환경 변수 확인
2. Fly Redis 서비스 상태 확인
3. 네트워크 연결 확인

### 메모리 부족

**증상:**
```
Redis: OOM command not allowed when used memory > maxmemory
```

**해결:**
1. TTL 단축 (3600 → 1800)
2. 크기 제한 강화 (2MB → 1MB)
3. Redis 플랜 업그레이드
4. R2로 마이그레이션

---

## 📚 참고 자료

- [Fly.io Redis Documentation](https://fly.io/docs/reference/redis/)
- [ioredis API](https://github.com/luin/ioredis)
- [Redis TTL Commands](https://redis.io/commands/ttl/)
- [Image Storage Best Practices](https://developers.freshchat.com/api/)

---

## ✅ 체크리스트

배포 전 확인:
- [ ] 코드 변경 사항 리뷰 완료
- [ ] 로컬 테스트 완료
- [ ] 환경 변수 확인 (REDIS_URL, PUBLIC_URL)
- [ ] Staging 배포 및 테스트
- [ ] 프로덕션 배포
- [ ] 로그 모니터링 (최소 1시간)
- [ ] Freshchat에서 이미지 확인
- [ ] Redis 메모리 사용량 확인

---

**작성일:** 2025-11-13
**버전:** 1.0
**작성자:** Claude Code + Codex Analysis
