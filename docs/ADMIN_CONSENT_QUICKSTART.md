# ⚡ 관리자 동의 빠른 시작 가이드

## 🎯 5분 안에 완료하기

EXO헬프 앱이 정상적으로 작동하려면 **한 번만** 관리자 권한 승인이 필요합니다.

---

## ✨ 가장 쉬운 방법 (2분)

### 1️⃣ 이 링크를 클릭하세요

```
https://freshchat-bridge.fly.dev/auth/admin-consent
```

### 2️⃣ 관리자 계정으로 로그인

- **Global Administrator** 또는
- **Application Administrator** 권한이 있는 계정

### 3️⃣ 권한 검토 및 승인

요청되는 권한:
- ✅ **User.Read.All** - 사용자 프로필 읽기 (이름, 이메일, 직급, 부서)
- ✅ **Sites.Read.All** - SharePoint 도움말 파일 읽기
- ✅ **Team.ReadBasic.All** - Teams 정보 읽기

"**조직을 대신하여 동의함**" 체크 후 **수락** 클릭

### 4️⃣ 완료!

성공 페이지가 표시되면 완료입니다. 🎉

---

## 🔍 권한 확인

아래 링크에서 권한이 제대로 부여되었는지 확인하세요:

```
https://freshchat-bridge.fly.dev/auth/permissions-status
```

**정상 결과:**
```json
{
  "success": true,
  "permissions": {
    "User.Read.All": { "granted": true },
    "Sites.Read.All": { "granted": true },
    "Team.ReadBasic.All": { "granted": true }
  }
}
```

---

## ❓ 문제가 있나요?

### "권한이 부족합니다" 오류
→ Global Administrator 권한이 있는 계정으로 다시 시도하세요.

### "이미 동의함" 메시지
→ 이미 완료되었습니다! 권한 확인 링크로 상태를 확인하세요.

### 권한 상태가 "granted: false"
→ 관리자 동의 링크를 다시 방문하여 승인을 진행하세요.

---

## 📚 더 자세한 정보

- [전체 배포 가이드](./CUSTOMER_DEPLOYMENT_GUIDE.md)
- [Azure AD 권한 설정](./AZURE_AD_PERMISSIONS.md)
- [SharePoint 설정](./HELP_TAB_SHAREPOINT.md)

---

**도움이 필요하신가요?**
- 이메일: support@wedosoft.net
- 전화: 02-XXXX-XXXX
