#!/bin/bash
# 환경 설정 확인 스크립트

set -e

echo "🔍 Freshchat Bridge - Environment Configuration Check"
echo "===================================================="
echo ""

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check_flyctl() {
    if ! command -v flyctl &> /dev/null; then
        echo -e "${RED}❌ flyctl not found${NC}"
        echo "   Install: https://fly.io/docs/hands-on/install-flyctl/"
        return 1
    else
        echo -e "${GREEN}✅ flyctl installed${NC}"
        return 0
    fi
}

check_app() {
    local APP_NAME=$1
    local ENV_NAME=$2
    
    echo ""
    echo "📦 Checking $ENV_NAME environment ($APP_NAME)..."
    echo "----------------------------------------"
    
    # 앱 존재 확인
    if flyctl status --app "$APP_NAME" &> /dev/null; then
        echo -e "${GREEN}✅ App exists${NC}"
        
        # 상태 확인
        echo ""
        echo "📊 App Status:"
        flyctl status --app "$APP_NAME"
        
        # Secrets 확인
        echo ""
        echo "🔐 Configured Secrets:"
        flyctl secrets list --app "$APP_NAME" 2>/dev/null || echo "   Unable to list secrets"
        
        # 최근 배포 확인
        echo ""
        echo "🚀 Recent Deployments:"
        flyctl releases --app "$APP_NAME" --limit 3 2>/dev/null || echo "   Unable to list releases"
        
    else
        echo -e "${RED}❌ App not found${NC}"
        echo "   Create with: flyctl apps create $APP_NAME"
        return 1
    fi
}

check_branches() {
    echo ""
    echo "🌿 Git Branches"
    echo "----------------------------------------"
    
    if [ -d .git ]; then
        # 로컬 브랜치
        echo "Local branches:"
        git branch
        
        echo ""
        echo "Remote branches:"
        git branch -r | grep -E "(main|staging|develop)" || echo "   No key branches found"
        
        # 현재 브랜치
        CURRENT_BRANCH=$(git branch --show-current)
        echo ""
        echo -e "Current branch: ${GREEN}$CURRENT_BRANCH${NC}"
    else
        echo -e "${RED}❌ Not a git repository${NC}"
    fi
}

check_workflows() {
    echo ""
    echo "⚙️  GitHub Actions Workflows"
    echo "----------------------------------------"
    
    if [ -f .github/workflows/fly-deploy.yml ]; then
        echo -e "${GREEN}✅ Production workflow (fly-deploy.yml)${NC}"
    else
        echo -e "${YELLOW}⚠️  Production workflow not found${NC}"
    fi
    
    if [ -f .github/workflows/fly-deploy-staging.yml ]; then
        echo -e "${GREEN}✅ Staging workflow (fly-deploy-staging.yml)${NC}"
    else
        echo -e "${YELLOW}⚠️  Staging workflow not found${NC}"
    fi
}

check_config_files() {
    echo ""
    echo "📄 Configuration Files"
    echo "----------------------------------------"
    
    if [ -f fly.toml ]; then
        echo -e "${GREEN}✅ fly.toml (production)${NC}"
        APP_NAME=$(grep "^app = " fly.toml | cut -d'"' -f2)
        echo "   App: $APP_NAME"
    else
        echo -e "${RED}❌ fly.toml not found${NC}"
    fi
    
    if [ -f fly.staging.toml ]; then
        echo -e "${GREEN}✅ fly.staging.toml${NC}"
        APP_NAME=$(grep "^app = " fly.staging.toml | cut -d'"' -f2)
        echo "   App: $APP_NAME"
    else
        echo -e "${YELLOW}⚠️  fly.staging.toml not found${NC}"
    fi
    
    if [ -f .env ]; then
        echo -e "${GREEN}✅ .env (local development)${NC}"
    else
        echo -e "${YELLOW}⚠️  .env not found (OK if using Fly secrets)${NC}"
    fi
}

# Main execution
echo "1️⃣  Checking prerequisites..."
check_flyctl || exit 1

check_config_files
check_branches
check_workflows

# Fly.io 앱 확인
if command -v flyctl &> /dev/null; then
    check_app "freshchat-bridge" "PRODUCTION"
    check_app "freshchat-bridge-staging" "STAGING"
fi

echo ""
echo "===================================================="
echo -e "${GREEN}✅ Environment check completed${NC}"
echo ""
echo "📚 Next steps:"
echo "   - Review: docs/QUICKSTART_STAGING.md"
echo "   - Full guide: docs/STAGING_PRODUCTION_SETUP.md"
