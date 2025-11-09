#!/bin/bash
# Teams 앱 운영 패키지 빌드 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔨 Building Production Teams App Package..."

# 임시 디렉토리 생성
TEMP_DIR="./temp-production"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# manifest.json을 임시 디렉토리로 복사
if [ ! -f "manifest.json" ]; then
    echo "❌ Error: manifest.json not found"
    echo "Please create manifest.json with production bot credentials"
    exit 1
fi

cp manifest.json "$TEMP_DIR/manifest.json"

# manifest에서 버전 추출
VERSION=$(grep -o '"version": "[^"]*"' manifest.json | cut -d'"' -f4)
echo "📦 Version: $VERSION"

# 아이콘 파일 복사
if [ -f "color.png" ]; then
    cp color.png "$TEMP_DIR/"
else
    echo "⚠️  Warning: color.png not found"
fi

if [ -f "outline.png" ]; then
    cp outline.png "$TEMP_DIR/"
else
    echo "⚠️  Warning: outline.png not found"
fi

# ZIP 파일 생성
cd "$TEMP_DIR"
PACKAGE_NAME="exohelp-v${VERSION}.zip"
zip -r "../$PACKAGE_NAME" ./*

cd ..
rm -rf "$TEMP_DIR"

echo "✅ Production package created: $PACKAGE_NAME"
echo ""
echo "⚠️  IMPORTANT: This is for PRODUCTION deployment"
echo "Please review and test thoroughly before uploading to Teams"
