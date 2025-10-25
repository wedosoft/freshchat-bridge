# Teams App Auto-Deployment Setup Guide

## 1. Azure AD 앱 등록

### Azure Portal에서 앱 등록:
```bash
# Azure CLI로 앱 등록 (또는 Azure Portal 사용)
az ad app create \
  --display-name "GitHub Actions - Teams App Deployment" \
  --sign-in-audience AzureADMyOrg
```

### 또는 Azure Portal에서:
1. Azure Portal → Azure Active Directory → App registrations
2. "New registration" 클릭
3. Name: `GitHub Actions - Teams App Deployment`
4. Supported account types: `Accounts in this organizational directory only`
5. Register 클릭

## 2. API 권限 추가

### 필요한 권한:
- `AppCatalog.ReadWrite.All` (Application permission)
- `Directory.Read.All` (Application permission)

### Azure Portal에서:
1. 등록한 앱 → API permissions
2. "Add a permission" 클릭
3. Microsoft Graph → Application permissions
4. 검색하여 추가:
   - `AppCatalog.ReadWrite.All`
   - `Directory.Read.All`
5. "Grant admin consent" 클릭 (관리자 권한 필요)

### Azure CLI로:
```bash
# App ID를 변수에 저장
APP_ID="<your-app-id>"

# API 권한 추가
az ad app permission add \
  --id $APP_ID \
  --api 00000003-0000-0000-c000-000000000000 \
  --api-permissions \
    dc149144-f292-421e-b185-5953f2e98d7f=Role \
    7ab1d382-f21e-4acd-a863-ba3e13f7da61=Role

# 관리자 동의
az ad app permission admin-consent --id $APP_ID
```

## 3. Client Secret 생성

### Azure Portal에서:
1. 앱 → Certificates & secrets
2. "New client secret" 클릭
3. Description: `GitHub Actions`
4. Expires: `24 months` (또는 원하는 기간)
5. Add 클릭
6. **Value를 복사** (다시 볼 수 없음!)

### Azure CLI로:
```bash
az ad app credential reset \
  --id $APP_ID \
  --append \
  --display-name "GitHub Actions" \
  --years 2
```

## 4. GitHub Secrets 설정

다음 secrets를 GitHub 저장소에 추가:

```bash
# Azure Tenant ID 확인
az account show --query tenantId -o tsv

# GitHub CLI로 secrets 추가
gh secret set AZURE_TENANT_ID --body "<your-tenant-id>"
gh secret set AZURE_CLIENT_ID --body "<your-app-client-id>"
gh secret set AZURE_CLIENT_SECRET --body "<your-client-secret>"
```

### 또는 GitHub Web에서:
1. Repository → Settings → Secrets and variables → Actions
2. "New repository secret" 클릭하여 각각 추가:
   - `AZURE_TENANT_ID`: Azure AD Tenant ID
   - `AZURE_CLIENT_ID`: 등록한 앱의 Application (client) ID
   - `AZURE_CLIENT_SECRET`: 생성한 Client Secret의 Value

## 5. 필요한 정보 위치

### Azure Portal에서 찾기:
- **Tenant ID**: Azure Active Directory → Overview → Tenant ID
- **Client ID**: App registrations → 앱 선택 → Overview → Application (client) ID
- **Client Secret**: App registrations → 앱 선택 → Certificates & secrets → Client secrets

## 6. 배포 테스트

teams-app 폴더의 파일을 수정하고 push하면 자동으로 배포됩니다:

```bash
# 테스트를 위해 manifest.json의 version 업데이트
cd teams-app
# version을 "1.1.1"로 변경
git add manifest.json
git commit -m "Bump Teams app version to 1.1.1"
git push origin main
```

## 7. 배포 확인

1. GitHub Actions 탭에서 워크플로우 실행 확인
2. Teams Admin Center → Manage apps → Built for your org
3. teams-freshchat 앱이 업데이트되었는지 확인

## 참고사항

- Graph API 권한은 조직 관리자만 승인 가능
- Client Secret은 만료되기 전에 갱신 필요
- 앱 업데이트 시 사용자들은 자동으로 새 버전 사용
