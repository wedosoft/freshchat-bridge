#!/bin/bash
# Teams 앱 스테이징 패키지 빌드 스크립트

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔨 Building Staging Teams App Package..."

# 임시 디렉토리 생성
TEMP_DIR="./temp-staging"
rm -rf "$TEMP_DIR"
mkdir -p "$TEMP_DIR"

# manifest.staging.json을 manifest.json으로 복사
if [ ! -f "manifest.staging.json" ]; then
    echo "❌ Error: manifest.staging.json not found"
    echo "Please create manifest.staging.json with staging bot credentials"
    exit 1
fi

cp manifest.staging.json "$TEMP_DIR/manifest.json"

# manifest에서 버전 추출
VERSION=$(grep -o '"version": "[^"]*"' manifest.staging.json | cut -d'"' -f4)
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
PACKAGE_NAME="exohelp-staging-v${VERSION}.zip"
zip -r "../$PACKAGE_NAME" ./*

cd ..
rm -rf "$TEMP_DIR"

echo "✅ Staging package created: $PACKAGE_NAME"
echo ""
echo "Next steps:"
echo "1. Upload $PACKAGE_NAME to Teams Admin Center"
echo "2. Deploy to staging environment for testing"
