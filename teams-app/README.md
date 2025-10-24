# Teams App Package

## 아이콘 파일 필요

Teams 앱을 배포하려면 다음 아이콘 파일이 필요합니다:

1. **color.png** - 192x192 픽셀, 풀컬러 아이콘
2. **outline.png** - 32x32 픽셀, 투명 배경의 흰색 아웃라인 아이콘

### 임시 해결책

아이콘 없이 테스트하려면:
1. 임의의 PNG 파일을 color.png, outline.png로 이름 변경
2. 또는 https://www.canva.com 등에서 간단한 아이콘 생성

### 패키지 생성

```bash
zip -r FreshchatBridge.zip manifest.json color.png outline.png
```

### Teams에 업로드

1. Microsoft Teams 열기
2. 왼쪽 사이드바에서 "Apps" 클릭
3. "Manage your apps" 클릭
4. "Upload an app" → "Upload a custom app" 클릭
5. FreshchatBridge.zip 파일 선택
6. "Add" 클릭
