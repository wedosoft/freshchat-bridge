Now I have enough information to provide comprehensive API specifications, Terraform modules, and test examples. Let me proceed to generate the answer.

# Teams ↔ Freshchat MVP 아키텍처: API 스펙, Terraform, 테스트 구현 가이드

귀하의 MVP 아키텍처 설계는 SLA 중심의 안전한 양방향 메시지 브리지 구현에 필요한 모든 핵심 요소를 포함하고 있습니다. 이 문서에서는 설계를 즉시 구현 가능한 형태로 제공하기 위해 **API 스펙**, **Terraform 모듈**, **메시지 변환 테스트 예시**를 상세히 제시합니다.

## 1. API 스펙 (OpenAPI 3.1 기반)

### 1.1 Teams Bot 콜백 엔드포인트

Teams Bot Framework는 JWT 기반 인증을 사용하며, 봇 채널 서명 검증이 필수입니다. 다음은 Teams 메시지 수신을 위한 API 스펙입니다.[1][2]

**엔드포인트**: `POST /bot/callback`

**요청 헤더**:```json
{
  "Authorization": "Bearer <JWT_TOKEN>",
  "Content-Type": "application/json"
}
```

**JWT 검증 요구사항**:[1]
- Issuer: `https://api.botframework.com`
- Audience: Bot의 Microsoft App ID
- 서명 검증: OpenID 메타데이터에서 공개키 조회 (`https://login.botframework.com/v1/.well-known/keys`)
- Clock skew: 5분 허용
- ServiceUrl 클레임이 Activity의 serviceUrl과 일치해야 함

**요청 본문** (Teams Activity 객체):
```json
{
  "type": "message",
  "id": "1234567890",
  "timestamp": "2025-10-23T00:00:00.000Z",
  "serviceUrl": "https://smba.trafficmanager.net/teams/",
  "channelId": "msteams",
  "from": {
    "id": "29:1a2b3c4d...",
    "name": "User Name",
    "aadObjectId": "user-aad-id-hash"
  },
  "conversation": {
    "id": "19:meeting_xxx@thread.v2",
    "tenantId": "tenant-id"
  },
  "recipient": {
    "id": "28:bot-id",
    "name": "Bot Name"
  },
  "text": "사용자 문의 내용",
  "replyToId": "parent-message-id",
  "attachments": [
    {
      "contentType": "image/png",
      "contentUrl": "https://...",
      "name": "screenshot.png"
    }
  ]
}
```

**응답**:
```json
{
  "statusCode": 200,
  "body": {
    "accepted": true,
    "idempotencyKey": "teams:tenant-id/channel-id/thread-id/msg-id"
  }
}
```

**에러 응답**:
```json
{
  "statusCode": 401,
  "body": {
    "error": "INVALID_JWT",
    "message": "JWT signature verification failed"
  }
}
```

### 1.2 Freshchat Webhook 엔드포인트

Freshchat은 HMAC SHA-256 서명을 사용하여 웹훅 요청을 인증합니다.[3][4]

**엔드포인트**: `POST /freshchat/webhook`

**요청 헤더**:
```json
{
  "X-Freshchat-Signature": "sha256=<HMAC_HEX_DIGEST>",
  "Content-Type": "application/json"
}
```

**서명 검증 로직**:[5][6]
```python
import hmac
import hashlib

def verify_freshchat_signature(payload: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(
        secret.encode('utf-8'),
        payload,
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(f"sha256={expected}", signature)
```

**요청 본문** (Freshchat Message Created 이벤트):[3]
```json
{
  "event": "message:created",
  "data": {
    "message": {
      "id": "msg-uuid",
      "conversation_id": "conv-uuid",
      "actor_type": "agent",
      "actor_id": "agent-uuid",
      "message_parts": [
        {
          "text": {
            "content": "에이전트 답변 내용"
          }
        }
      ],
      "created_time": "2025-10-23T00:00:00.000Z",
      "channel_id": "channel-uuid"
    }
  }
}
```

**응답**:
```json
{
  "statusCode": 200,
  "body": {
    "received": true
  }
}
```

### 1.3 표준 메시지 스키마 (내부 이벤트)

큐 시스템에서 사용되는 정규화된 메시지 포맷입니다. 이 스키마는 아이템포턴시 보장을 위한 고유 키를 포함합니다.[7][8]

```json
{
  "idempotencyKey": "teams:tenant-id/channel-id/thread-id/msg-id-123456",
  "tenantId": "TENANT_01",
  "direction": "inbound",
  "source": "teams",
  "context": {
    "teamId": "team-uuid",
    "channelId": "19:channel-id@thread.v2",
    "threadId": "thread-id",
    "user": {
      "aadUserIdHash": "sha256-hash-of-user-id",
      "displayName": "User Name"
    },
    "conversationId": null
  },
  "content": {
    "text": "고객 문의: 환불 처리 방법을 알고 싶습니다.",
    "mentions": [
      {
        "type": "user",
        "display": "@Support Team",
        "id": "29:mentioned-user-id"
      }
    ],
    "attachments": [
      {
        "type": "image",
        "name": "receipt.png",
        "signedUrl": "https://storage.blob.core.windows.net/attachments/...",
        "expiresAt": "2025-10-23T02:00:00Z"
      }
    ]
  },
  "routing": {
    "tags": ["teams", "product:refund", "region:kr", "priority:normal"],
    "customAttributes": {
      "source": "teams",
      "channelName": "ops-seoul",
      "teamName": "Sales Team"
    }
  },
  "timestamp": "2025-10-23T00:00:00.000Z",
  "retryCount": 0
}
```

### 1.4 Freshchat API 호출 스펙

**대화 조회**:[3]
```http
GET https://api.freshchat.com/v2/conversations/{conversation_id}
Authorization: Bearer {API_KEY}
```

**대화 생성**:[3]
```http
POST https://api.freshchat.com/v2/conversations
Authorization: Bearer {API_KEY}
Content-Type: application/json

{
  "status": "new",
  "channel_id": "inbox-uuid",
  "messages": [
    {
      "message_parts": [
        {
          "text": {
            "content": "초기 메시지 내용"
          }
        }
      ],
      "actor_type": "user",
      "actor_id": "freshchat-user-id",
      "message_type": "normal"
    }
  ],
  "properties": {
    "cf_source": "teams"
  },
  "users": [
    {
      "id": "freshchat-user-id"
    }
  ]
}
```

**메시지 전송**:[3]
```http
POST https://api.freshchat.com/v2/conversations/{conversation_id}/messages
Authorization: Bearer {API_KEY}
Content-Type: application/json

{
  "messages": [
    {
      "message_parts": [
        {
          "text": {
            "content": "추가 메시지"
          }
        }
      ],
      "actor_type": "user",
      "actor_id": "user-id",
      "channel_id": "channel-id"
    }
  ]
}
```

### 1.5 Teams Graph API 호출 스펙

**채널 메시지 전송**:
```http
POST https://graph.microsoft.com/v1.0/teams/{team-id}/channels/{channel-id}/messages
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json

{
  "body": {
    "contentType": "html",
    "content": "<p>에이전트 답변 내용</p>"
  },
  "replyToId": "parent-message-id"
}
```

**DM 전송**:
```http
POST https://graph.microsoft.com/v1.0/chats/{chat-id}/messages
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json

{
  "body": {
    "contentType": "text",
    "content": "답변 내용"
  }
}
```

## 2. Terraform 모듈 스켈레톤 (Azure)

### 2.1 디렉토리 구조

```
terraform/
├── main.tf
├── variables.tf
├── outputs.tf
├── modules/
│   ├── api-gateway/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── service-bus/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── container-apps/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   ├── storage/
│   │   ├── main.tf
│   │   ├── variables.tf
│   │   └── outputs.tf
│   └── monitoring/
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
└── environments/
    ├── dev.tfvars
    ├── stg.tfvars
    └── prod.tfvars
```

### 2.2 메인 모듈 (main.tf)

```hcl
terraform {
  required_version = ">= 1.5.0"
  
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
  
  backend "azurerm" {
    resource_group_name  = "rg-tfstate"
    storage_account_name = "sttfstate"
    container_name       = "tfstate"
    key                  = "teams-freshchat-bridge.tfstate"
  }
}

provider "azurerm" {
  features {
    key_vault {
      purge_soft_delete_on_destroy = false
    }
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}

locals {
  common_tags = {
    Project     = "teams-freshchat-bridge"
    Environment = var.environment
    ManagedBy   = "terraform"
    CostCenter  = var.cost_center
  }
  
  resource_prefix = "tfb-${var.environment}"
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = "rg-${local.resource_prefix}"
  location = var.location
  tags     = local.common_tags
}

# API Management (Gateway + WAF)
module "api_gateway" {
  source = "./modules/api-gateway"
  
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  resource_prefix     = local.resource_prefix
  
  sku_name            = var.apim_sku
  publisher_name      = var.publisher_name
  publisher_email     = var.publisher_email
  
  bot_callback_path       = "/bot/callback"
  freshchat_webhook_path  = "/freshchat/webhook"
  
  key_vault_id        = module.key_vault.id
  
  tags = local.common_tags
}

# Service Bus (Queue + DLQ)
module "service_bus" {
  source = "./modules/service-bus"
  
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  resource_prefix     = local.resource_prefix
  
  sku                     = var.servicebus_sku
  capacity                = var.servicebus_capacity
  
  ingress_queue_config = {
    max_delivery_count          = 3
    dead_lettering_on_timeout   = true
    default_message_ttl         = "PT1H"
    duplicate_detection_window  = "PT10M"
  }
  
  egress_queue_config = {
    max_delivery_count          = 5
    dead_lettering_on_timeout   = true
    default_message_ttl         = "PT2H"
    duplicate_detection_window  = "PT10M"
  }
  
  tags = local.common_tags
}

# Container Apps (Normalizer, Adapters)
module "container_apps" {
  source = "./modules/container-apps"
  
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  resource_prefix     = local.resource_prefix
  
  container_images = {
    normalizer        = var.normalizer_image
    freshchat_adapter = var.freshchat_adapter_image
    teams_adapter     = var.teams_adapter_image
  }
  
  service_bus_connection_string = module.service_bus.connection_string
  cosmos_db_connection_string   = module.cosmos_db.connection_string
  storage_connection_string     = module.storage.connection_string
  
  key_vault_id = module.key_vault.id
  
  min_replicas = var.container_min_replicas
  max_replicas = var.container_max_replicas
  
  tags = local.common_tags
}

# Blob Storage (첨부파일)
module "storage" {
  source = "./modules/storage"
  
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  resource_prefix     = local.resource_prefix
  
  account_tier             = "Standard"
  account_replication_type = var.storage_replication
  
  containers = ["attachments", "temp-uploads"]
  
  lifecycle_rules = {
    temp_uploads_expiry = {
      prefix_match = ["temp-uploads/"]
      age_days     = 1
    }
  }
  
  tags = local.common_tags
}

# Cosmos DB (State Store)
module "cosmos_db" {
  source = "./modules/cosmos-db"
  
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  resource_prefix     = local.resource_prefix
  
  offer_type      = "Standard"
  consistency_level = "Session"
  
  databases = [
    {
      name       = "bridge-state"
      throughput = var.cosmos_throughput
      containers = [
        {
          name               = "thread-mappings"
          partition_key_path = "/tenantId"
          ttl                = 604800  # 7 days
        },
        {
          name               = "user-mappings"
          partition_key_path = "/tenantId"
          ttl                = 2592000  # 30 days
        },
        {
          name               = "channel-inbox-mappings"
          partition_key_path = "/tenantId"
          ttl                = -1  # No expiry
        }
      ]
    }
  ]
  
  tags = local.common_tags
}

# Key Vault (비밀 관리)
resource "azurerm_key_vault" "main" {
  name                = "kv-${local.resource_prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"
  
  purge_protection_enabled   = var.environment == "prod" ? true : false
  soft_delete_retention_days = 90
  
  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
    ip_rules       = var.allowed_ips
  }
  
  tags = local.common_tags
}

# Monitoring
module "monitoring" {
  source = "./modules/monitoring"
  
  resource_group_name = azurerm_resource_group.main.name
  location            = var.location
  resource_prefix     = local.resource_prefix
  
  log_analytics_sku          = "PerGB2018"
  log_retention_days         = var.log_retention_days
  
  application_insights_type  = "web"
  
  alert_recipients = var.alert_email_recipients
  
  slo_targets = {
    availability_percent = 99.9
    p95_latency_ms      = 2500
    error_rate_percent  = 0.1
  }
  
  tags = local.common_tags
}

data "azurerm_client_config" "current" {}
```

### 2.3 Service Bus 모듈 (modules/service-bus/main.tf)

Azure Service Bus는 Premium SKU에서만 VNet 통합과 더 높은 처리량을 제공합니다.[9][10][11]

```hcl
resource "azurerm_servicebus_namespace" "main" {
  name                = "sb-${var.resource_prefix}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = var.sku
  capacity            = var.capacity
  
  # Premium SKU 전용
  premium_messaging_partitions = var.sku == "Premium" ? var.premium_partitions : null
  
  tags = var.tags
}

# Ingress Queue (Teams → Normalizer)
resource "azurerm_servicebus_queue" "ingress" {
  name         = "queue-ingress"
  namespace_id = azurerm_servicebus_namespace.main.id
  
  max_delivery_count                = var.ingress_queue_config.max_delivery_count
  dead_lettering_on_message_expiration = var.ingress_queue_config.dead_lettering_on_timeout
  default_message_ttl               = var.ingress_queue_config.default_message_ttl
  
  enable_partitioning               = true
  requires_duplicate_detection      = true
  duplicate_detection_history_time_window = var.ingress_queue_config.duplicate_detection_window
  
  forward_dead_lettered_messages_to = azurerm_servicebus_queue.ingress_dlq.name
}

# Ingress DLQ
resource "azurerm_servicebus_queue" "ingress_dlq" {
  name         = "queue-ingress-dlq"
  namespace_id = azurerm_servicebus_namespace.main.id
  
  max_delivery_count = 1
  enable_partitioning = true
}

# Egress Queue (Freshchat → Teams Adapter)
resource "azurerm_servicebus_queue" "egress" {
  name         = "queue-egress"
  namespace_id = azurerm_servicebus_namespace.main.id
  
  max_delivery_count                = var.egress_queue_config.max_delivery_count
  dead_lettering_on_message_expiration = var.egress_queue_config.dead_lettering_on_timeout
  default_message_ttl               = var.egress_queue_config.default_message_ttl
  
  enable_partitioning               = true
  requires_duplicate_detection      = true
  duplicate_detection_history_time_window = var.egress_queue_config.duplicate_detection_window
  
  forward_dead_lettered_messages_to = azurerm_servicebus_queue.egress_dlq.name
}

# Egress DLQ
resource "azurerm_servicebus_queue" "egress_dlq" {
  name         = "queue-egress-dlq"
  namespace_id = azurerm_servicebus_namespace.main.id
  
  max_delivery_count = 1
  enable_partitioning = true
}

# Authorization Rules
resource "azurerm_servicebus_namespace_authorization_rule" "send_listen" {
  name         = "SendListenPolicy"
  namespace_id = azurerm_servicebus_namespace.main.id
  
  listen = true
  send   = true
  manage = false
}

output "connection_string" {
  value     = azurerm_servicebus_namespace_authorization_rule.send_listen.primary_connection_string
  sensitive = true
}

output "ingress_queue_name" {
  value = azurerm_servicebus_queue.ingress.name
}

output "egress_queue_name" {
  value = azurerm_servicebus_queue.egress.name
}

output "namespace_hostname" {
  value = "${azurerm_servicebus_namespace.main.name}.servicebus.windows.net"
}
```

### 2.4 Variables 정의 (variables.tf)

```hcl
variable "environment" {
  description = "Environment name (dev, stg, prod)"
  type        = string
  validation {
    condition     = contains(["dev", "stg", "prod"], var.environment)
    error_message = "Environment must be dev, stg, or prod."
  }
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "koreacentral"
}

variable "cost_center" {
  description = "Cost center for billing"
  type        = string
}

variable "servicebus_sku" {
  description = "Service Bus SKU (Basic, Standard, Premium)"
  type        = string
  default     = "Standard"
  validation {
    condition     = contains(["Basic", "Standard", "Premium"], var.servicebus_sku)
    error_message = "SKU must be Basic, Standard, or Premium."
  }
}

variable "servicebus_capacity" {
  description = "Service Bus capacity (Premium only: 1, 2, 4, 8, 16)"
  type        = number
  default     = 0
}

variable "storage_replication" {
  description = "Storage replication type"
  type        = string
  default     = "LRS"
}

variable "cosmos_throughput" {
  description = "Cosmos DB throughput (RU/s)"
  type        = number
  default     = 400
}

variable "container_min_replicas" {
  description = "Minimum container replicas"
  type        = number
  default     = 1
}

variable "container_max_replicas" {
  description = "Maximum container replicas"
  type        = number
  default     = 10
}

variable "log_retention_days" {
  description = "Log retention in days"
  type        = number
  default     = 30
}

variable "allowed_ips" {
  description = "Allowed IP addresses for Key Vault"
  type        = list(string)
  default     = []
}

variable "alert_email_recipients" {
  description = "Email recipients for alerts"
  type        = list(string)
}

variable "normalizer_image" {
  description = "Normalizer container image"
  type        = string
}

variable "freshchat_adapter_image" {
  description = "Freshchat adapter container image"
  type        = string
}

variable "teams_adapter_image" {
  description = "Teams adapter container image"
  type        = string
}

variable "apim_sku" {
  description = "API Management SKU"
  type        = string
  default     = "Developer_1"
}

variable "publisher_name" {
  description = "API Management publisher name"
  type        = string
}

variable "publisher_email" {
  description = "API Management publisher email"
  type        = string
}
```

### 2.5 환경별 설정 (environments/prod.tfvars)

```hcl
environment     = "prod"
location        = "koreacentral"
cost_center     = "CS-OPERATIONS"

servicebus_sku      = "Premium"
servicebus_capacity = 1

storage_replication = "GRS"
cosmos_throughput   = 1000

container_min_replicas = 3
container_max_replicas = 30

log_retention_days = 90

allowed_ips = [
  "203.0.113.0/24"  # Office IP
]

alert_email_recipients = [
  "ops-team@example.com",
  "sre-oncall@example.com"
]

normalizer_image        = "acr.azurecr.io/normalizer:v1.2.0"
freshchat_adapter_image = "acr.azurecr.io/freshchat-adapter:v1.2.0"
teams_adapter_image     = "acr.azurecr.io/teams-adapter:v1.2.0"

apim_sku        = "Premium_1"
publisher_name  = "Operations Team"
publisher_email = "api@example.com"
```

## 3. 메시지 변환 유닛 테스트 (Python + Pytest)

### 3.1 테스트 구조

```
tests/
├── conftest.py
├── unit/
│   ├── test_normalizer.py
│   ├── test_mention_transformer.py
│   ├── test_routing_tagger.py
│   └── test_idempotency.py
├── integration/
│   ├── test_teams_to_freshchat_flow.py
│   └── test_freshchat_to_teams_flow.py
└── fixtures/
    ├── teams_messages.json
    └── freshchat_messages.json
```

### 3.2 Conftest (공통 픽스처)

```python
# tests/conftest.py
import pytest
import json
from pathlib import Path

@pytest.fixture
def fixtures_dir():
    return Path(__file__).parent / "fixtures"

@pytest.fixture
def teams_message_simple(fixtures_dir):
    with open(fixtures_dir / "teams_messages.json") as f:
        data = json.load(f)
    return data["simple_text"]

@pytest.fixture
def teams_message_with_mention(fixtures_dir):
    with open(fixtures_dir / "teams_messages.json") as f:
        data = json.load(f)
    return data["with_mention"]

@pytest.fixture
def teams_message_with_attachment(fixtures_dir):
    with open(fixtures_dir / "teams_messages.json") as f:
        data = json.load(f)
    return data["with_attachment"]

@pytest.fixture
def channel_inbox_mapping():
    return {
        "tenant-01/team-01/channel-01": "freshchat-inbox-uuid-sales",
        "tenant-01/team-01/channel-02": "freshchat-inbox-uuid-support",
        "tenant-01/team-02/channel-01": "freshchat-inbox-uuid-engineering"
    }

@pytest.fixture
def idempotency_store():
    """In-memory idempotency store for testing"""
    return {}
```

### 3.3 멘션 변환 테스트

```python
# tests/unit/test_mention_transformer.py
import pytest
from normalizer.mention_transformer import MentionTransformer

class TestMentionTransformer:
    """
    Teams 멘션 형식을 Freshchat 텍스트로 변환하는 로직 테스트
    """
    
    @pytest.fixture
    def transformer(self):
        return MentionTransformer()
    
    def test_transform_single_user_mention(self, transformer):
        """단일 사용자 멘션 변환"""
        teams_text = "<at id=\"0\">John Doe</at> 문의드립니다"
        mentions = [
            {
                "id": 0,
                "mentionText": "John Doe",
                "mentioned": {
                    "user": {
                        "id": "29:user-id-123",
                        "displayName": "John Doe"
                    }
                }
            }
        ]
        
        result = transformer.transform(teams_text, mentions)
        
        assert result == "@John Doe 문의드립니다"
    
    def test_transform_multiple_mentions(self, transformer):
        """복수 멘션 변환"""
        teams_text = "<at id=\"0\">John</at>과 <at id=\"1\">Jane</at>에게 알려주세요"
        mentions = [
            {
                "id": 0,
                "mentionText": "John",
                "mentioned": {"user": {"displayName": "John"}}
            },
            {
                "id": 1,
                "mentionText": "Jane",
                "mentioned": {"user": {"displayName": "Jane"}}
            }
        ]
        
        result = transformer.transform(teams_text, mentions)
        
        assert result == "@John과 @Jane에게 알려주세요"
    
    def test_transform_channel_mention(self, transformer):
        """채널 전체 멘션 변환"""
        teams_text = "<at id=\"0\">Support Team</at> 긴급 문의입니다"
        mentions = [
            {
                "id": 0,
                "mentionText": "Support Team",
                "mentioned": {
                    "conversation": {
                        "id": "19:channel-id@thread.tacv2",
                        "displayName": "Support Team"
                    }
                }
            }
        ]
        
        result = transformer.transform(teams_text, mentions)
        
        assert result == "@[Support Team] 긴급 문의입니다"
    
    def test_no_mentions(self, transformer):
        """멘션 없는 경우 원문 반환"""
        teams_text = "일반 텍스트 메시지입니다"
        mentions = []
        
        result = transformer.transform(teams_text, mentions)
        
        assert result == teams_text
    
    def test_malformed_mention_tag(self, transformer):
        """잘못된 멘션 태그 처리"""
        teams_text = "<at>잘못된 형식</at> 메시지"
        mentions = []
        
        result = transformer.transform(teams_text, mentions)
        
        # 변환 실패 시 원문 유지 또는 태그 제거
        assert "<at>" not in result or result == teams_text
```

### 3.4 라우팅 태그 주입 테스트

```python
# tests/unit/test_routing_tagger.py
import pytest
from normalizer.routing_tagger import RoutingTagger

class TestRoutingTagger:
    """
    채널 정보 기반 라우팅 태그 생성 테스트
    """
    
    @pytest.fixture
    def tagger(self, channel_inbox_mapping):
        return RoutingTagger(channel_inbox_mapping)
    
    def test_generate_tags_from_channel_name(self, tagger):
        """채널명 기반 태그 생성"""
        context = {
            "teamId": "team-01",
            "channelId": "channel-01",
            "channelName": "sales-korea-urgent"
        }
        
        tags = tagger.generate_tags(context)
        
        assert "teams" in tags
        assert "product:sales" in tags or "sales" in tags
        assert "region:kr" in tags or "korea" in tags
        assert "priority:high" in tags or "urgent" in tags
    
    def test_generate_custom_attributes(self, tagger):
        """커스텀 속성 생성"""
        context = {
            "teamId": "team-01",
            "channelId": "channel-01",
            "channelName": "support-vip"
        }
        
        attrs = tagger.generate_custom_attributes(context)
        
        assert attrs["source"] == "teams"
        assert "channelName" in attrs
        assert attrs["channelName"] == "support-vip"
    
    def test_map_channel_to_inbox(self, tagger):
        """채널 → 인박스 매핑"""
        mapping_key = "tenant-01/team-01/channel-01"
        
        inbox_id = tagger.get_inbox_id(mapping_key)
        
        assert inbox_id == "freshchat-inbox-uuid-sales"
    
    def test_missing_channel_mapping_returns_default(self, tagger):
        """매핑 없는 채널은 기본 인박스 반환"""
        mapping_key = "tenant-99/team-99/channel-99"
        
        inbox_id = tagger.get_inbox_id(mapping_key, default="default-inbox")
        
        assert inbox_id == "default-inbox"
    
    def test_priority_detection_from_keywords(self, tagger):
        """키워드 기반 우선순위 감지"""
        urgent_text = "긴급 환불 요청입니다"
        normal_text = "일반 문의사항"
        
        urgent_priority = tagger.detect_priority(urgent_text)
        normal_priority = tagger.detect_priority(normal_text)
        
        assert urgent_priority == "high"
        assert normal_priority == "normal"
```

### 3.5 아이템포턴시 테스트

아이템포턴시는 분산 시스템에서 중복 메시지 처리를 방지하는 핵심 패턴입니다.[8][12][7]

```python
# tests/unit/test_idempotency.py
import pytest
from normalizer.idempotency import IdempotencyManager

class TestIdempotencyManager:
    """
    아이템포턴시 키 생성 및 중복 감지 테스트
    """
    
    @pytest.fixture
    def manager(self, idempotency_store):
        return IdempotencyManager(idempotency_store)
    
    def test_generate_idempotency_key(self, manager):
        """아이템포턴시 키 생성"""
        event = {
            "tenantId": "tenant-01",
            "context": {
                "teamId": "team-01",
                "channelId": "channel-01",
                "threadId": "thread-123",
            },
            "messageId": "msg-456"
        }
        
        key = manager.generate_key(event)
        
        assert key == "teams:tenant-01/team-01/channel-01/thread-123/msg-456"
    
    @pytest.mark.idempotent
    def test_first_message_not_duplicate(self, manager):
        """최초 메시지는 중복 아님"""
        key = "teams:tenant-01/.../msg-001"
        
        is_duplicate = manager.is_duplicate(key)
        
        assert is_duplicate is False
    
    @pytest.mark.idempotent
    def test_same_message_twice_is_duplicate(self, manager):
        """동일 메시지 재수신 시 중복 감지"""
        key = "teams:tenant-01/.../msg-002"
        
        # 첫 번째 처리
        manager.mark_processed(key, result={"status": "success"})
        
        # 두 번째 수신 (중복)
        is_duplicate = manager.is_duplicate(key)
        
        assert is_duplicate is True
    
    @pytest.mark.idempotent
    def test_return_cached_result_for_duplicate(self, manager):
        """중복 메시지는 캐시된 결과 반환"""
        key = "teams:tenant-01/.../msg-003"
        expected_result = {"conversationId": "conv-123", "messageId": "fc-msg-789"}
        
        # 첫 번째 처리 및 결과 저장
        manager.mark_processed(key, result=expected_result)
        
        # 중복 메시지 처리 시
        cached_result = manager.get_cached_result(key)
        
        assert cached_result == expected_result
    
    def test_expired_key_not_duplicate(self, manager):
        """만료된 키는 중복 아님"""
        import time
        key = "teams:tenant-01/.../msg-004"
        
        # TTL 1초로 설정
        manager.mark_processed(key, result={}, ttl_seconds=1)
        
        # 2초 대기
        time.sleep(2)
        
        is_duplicate = manager.is_duplicate(key)
        
        assert is_duplicate is False
    
    def test_different_threads_not_duplicate(self, manager):
        """다른 스레드의 동일 메시지 ID는 중복 아님"""
        key1 = "teams:tenant-01/.../thread-A/msg-001"
        key2 = "teams:tenant-01/.../thread-B/msg-001"
        
        manager.mark_processed(key1, result={})
        
        is_duplicate = manager.is_duplicate(key2)
        
        assert is_duplicate is False
```

### 3.6 통합 플로우 테스트

```python
# tests/integration/test_teams_to_freshchat_flow.py
import pytest
from unittest.mock import AsyncMock, patch
from normalizer.message_processor import MessageProcessor

@pytest.mark.asyncio
class TestTeamsToFreshchatFlow:
    """
    Teams → Normalizer → Freshchat Adapter 전체 플로우 테스트
    """
    
    @pytest.fixture
    def processor(self, channel_inbox_mapping, idempotency_store):
        return MessageProcessor(
            channel_inbox_mapping=channel_inbox_mapping,
            idempotency_store=idempotency_store
        )
    
    async def test_simple_text_message_flow(
        self, 
        processor, 
        teams_message_simple
    ):
        """단순 텍스트 메시지 처리"""
        with patch('normalizer.freshchat_client.FreshchatClient') as mock_fc:
            mock_fc.create_conversation = AsyncMock(
                return_value={"conversation_id": "conv-123"}
            )
            
            result = await processor.process_inbound(teams_message_simple)
            
            assert result["status"] == "success"
            assert result["conversationId"] == "conv-123"
            assert mock_fc.create_conversation.called
    
    async def test_message_with_mention_and_attachment(
        self, 
        processor, 
        teams_message_with_mention,
        teams_message_with_attachment
    ):
        """멘션 + 첨부파일 메시지 처리"""
        with patch('normalizer.freshchat_client.FreshchatClient') as mock_fc, \
             patch('normalizer.storage_client.StorageClient') as mock_storage:
            
            mock_storage.upload_attachment = AsyncMock(
                return_value={"signedUrl": "https://storage.../image.png"}
            )
            mock_fc.create_conversation = AsyncMock(
                return_value={"conversation_id": "conv-456"}
            )
            
            # 멘션 + 첨부 조합 메시지
            combined_message = {
                **teams_message_with_mention,
                "attachments": teams_message_with_attachment["attachments"]
            }
            
            result = await processor.process_inbound(combined_message)
            
            assert result["status"] == "success"
            assert mock_storage.upload_attachment.called
            # Freshchat 메시지에 변환된 멘션 포함 확인
            call_args = mock_fc.create_conversation.call_args
            message_text = call_args[1]["messages"][0]["message_parts"][0]["text"]["content"]
            assert "@" in message_text
    
    async def test_duplicate_message_returns_cached_result(
        self, 
        processor, 
        teams_message_simple
    ):
        """중복 메시지는 재처리 없이 캐시 반환"""
        with patch('normalizer.freshchat_client.FreshchatClient') as mock_fc:
            mock_fc.create_conversation = AsyncMock(
                return_value={"conversation_id": "conv-789"}
            )
            
            # 첫 번째 처리
            result1 = await processor.process_inbound(teams_message_simple)
            
            # 동일 메시지 재수신
            result2 = await processor.process_inbound(teams_message_simple)
            
            # Freshchat API는 1회만 호출
            assert mock_fc.create_conversation.call_count == 1
            # 결과는 동일
            assert result1 == result2
    
    async def test_routing_tags_applied_correctly(
        self, 
        processor, 
        teams_message_simple
    ):
        """라우팅 태그가 올바르게 적용됨"""
        with patch('normalizer.freshchat_client.FreshchatClient') as mock_fc:
            mock_fc.create_conversation = AsyncMock(
                return_value={"conversation_id": "conv-999"}
            )
            
            await processor.process_inbound(teams_message_simple)
            
            call_args = mock_fc.create_conversation.call_args
            tags = call_args[1].get("tags", [])
            custom_attrs = call_args[1].get("properties", {})
            
            assert "teams" in tags
            assert custom_attrs.get("source") == "teams"
```

### 3.7 테스트 픽스처 데이터

```json
// tests/fixtures/teams_messages.json
{
  "simple_text": {
    "type": "message",
    "id": "1234567890",
    "timestamp": "2025-10-23T00:00:00.000Z",
    "from": {
      "id": "29:user-aad-id",
      "name": "김철수",
      "aadObjectId": "aad-uuid-123"
    },
    "conversation": {
      "id": "19:meeting_abc@thread.v2",
      "tenantId": "tenant-01"
    },
    "channelData": {
      "team": {
        "id": "team-01"
      },
      "channel": {
        "id": "channel-01",
        "name": "support-general"
      }
    },
    "text": "환불 처리는 어떻게 하나요?",
    "entities": []
  },
  
  "with_mention": {
    "type": "message",
    "id": "1234567891",
    "timestamp": "2025-10-23T00:01:00.000Z",
    "from": {
      "id": "29:user-aad-id",
      "name": "이영희"
    },
    "conversation": {
      "id": "19:meeting_xyz@thread.v2",
      "tenantId": "tenant-01"
    },
    "text": "<at id=\"0\">Support Team</at> 긴급 문의입니다",
    "entities": [
      {
        "type": "mention",
        "mentioned": {
          "id": "29:support-team-id",
          "name": "Support Team"
        },
        "text": "<at id=\"0\">Support Team</at>"
      }
    ]
  },
  
  "with_attachment": {
    "type": "message",
    "id": "1234567892",
    "timestamp": "2025-10-23T00:02:00.000Z",
    "from": {
      "id": "29:user-aad-id",
      "name": "박민수"
    },
    "text": "오류 화면 캡처 첨부합니다",
    "attachments": [
      {
        "contentType": "image/png",
        "contentUrl": "https://graph.microsoft.com/v1.0/.../content",
        "name": "error_screenshot.png"
      }
    ]
  }
}
```

### 3.8 Pytest 실행 명령

```bash
# 전체 테스트 실행
pytest tests/ -v

# 아이템포턴시 테스트만 실행
pytest tests/unit/test_idempotency.py -v -m idempotent

# 커버리지 리포트 포함
pytest tests/ --cov=normalizer --cov-report=html

# 병렬 실행 (pytest-xdist 플러그인 필요)
pytest tests/ -n auto

# 특정 환경 변수 설정
COSMOS_ENDPOINT=https://... COSMOS_KEY=... pytest tests/integration/
```## 4. 구현 체크리스트

### 4.1 Phase 1: 인프라 구축 (Week 1-2)

- [ ] Terraform 모듈 작성 및 dev 환경 배포[13]
- [ ] Service Bus 큐/DLQ 생성 및 연결 테스트[10][9]
- [ ] Cosmos DB 컨테이너 및 파티션 키 설정
- [ ] Key Vault에 비밀 저장 (API 키, 연결 문자열)
- [ ] API Management 정책 구성 (Rate Limiting, JWT 검증)[6][5]

### 4.2 Phase 2: 코어 서비스 개발 (Week 3-5)

- [ ] Teams Bot 콜백 핸들러 구현 + JWT 검증[2][1]
- [ ] Freshchat Webhook 핸들러 구현 + HMAC 검증[4][3]
- [ ] Normalizer: 멘션 변환, 이모지 처리, 라우팅 태그 주입
- [ ] Freshchat Adapter: 대화 조회/생성, 메시지 전송[3]
- [ ] Teams Adapter: Graph API 메시지 전송, 스레드 유지
- [ ] 아이템포턴시 매니저 구현 (Cosmos DB 기반)[12][7]

### 4.3 Phase 3: 테스트 및 최적화 (Week 6-7)

- [ ] 유닛 테스트 작성 (커버리지 > 80%)[14][15]
- [ ] 통합 테스트 시나리오 실행[13]
- [ ] 부하 테스트 (피크의 2배, p95 < 2.5s 검증)[16]
- [ ] DLQ 재처리 로직 구현 (지수 백오프)[17][18][19]
- [ ] 관찰가능성 대시보드 구성 (SLO 메트릭)[16]

### 4.4 Phase 4: 파일럿 및 배포 (Week 8)

- [ ] 1~2개 채널로 파일럿 테스트
- [ ] 채널↔인박스 매핑 테이블 데이터 마이그레이션
- [ ] Staging 환경 배포 및 UAT
- [ ] Production 배포 (점진적 롤아웃)
- [ ] 운영 SOP 문서화 및 온콜 팀 교육

## 5. 다음 단계

귀하의 설계는 이미 **매우 완성도가 높으며**, 특히 SLA 관점의 안전성과 운영 측면을 고려한 점이 탁월합니다. 위 API 스펙과 Terraform 모듈을 기반으로 다음을 확정하시면 즉시 구현에 착수 가능합니다:

1. **채널↔인박스 매핑 규칙**: 테넌트별 Teams 채널과 Freshchat 인박스 간 매핑 테이블 초기 데이터
2. **첨부 파일 정책**: 최대 크기(10MB), 허용 MIME 타입, AV 스캔 여부[20]
3. **재시도 정책 세부 파라미터**: 백오프 베이스(2초), 최대 재시도 횟수(3회), DLQ 이동 기준[18][19]
4. **모니터링 임계값**: 큐 적체 알림(1000개), DLQ 증가율(시간당 10개), p95 SLO 위반(2.5초)[16]

API Agent 도구로 OpenAPI 3.1 스펙 파일 생성이나 추가 Terraform 모듈(예: Cosmos DB, Container Apps)이 필요하시면 말씀해 주세요. 성공적인 MVP 구축을 응원합니다!

[1](https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0)
[2](https://learn.microsoft.com/ko-kr/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0)
[3](https://developers.freshchat.com/api/)
[4](https://crmsupport.freshworks.com/support/solutions/articles/50000002712-how-to-configure-conversation-apis-and-webhooks-for-chat-)
[5](https://stackoverflow.com/questions/79622735/how-can-i-securely-verify-the-source-of-a-webhook-call-in-azure-automation-runbo)
[6](https://vandsh.github.io/azure/2020/04/09/apim-webhook-validation.html)
[7](https://www.geeksforgeeks.org/system-design/role-of-idempotent-apis-in-modern-systems-design/)
[8](https://www.linkedin.com/posts/milan-jovanovic_%F0%9D%97%9C%F0%9D%97%B1%F0%9D%97%B2%F0%9D%97%BA%F0%9D%97%BD%F0%9D%97%BC%F0%9D%98%81%F0%9D%97%B2%F0%9D%97%BB%F0%9D%98%81-%F0%9D%97%96%F0%9D%97%BC%F0%9D%97%BB%F0%9D%98%80%F0%9D%98%82%F0%9D%97%BA%F0%9D%97%B2%F0%9D%97%BF%F0%9D%98%80-%F0%9D%97%B6%F0%9D%97%BB-activity-7335550357831397376-u2_t)
[9](https://dx.pagopa.it/blog/devex-azure-servicebus-0.1-alpha)
[10](https://github.com/hmcts/terraform-module-servicebus-namespace)
[11](https://github.com/claranet/terraform-azurerm-service-bus)
[12](https://www.linkedin.com/pulse/designing-idempotent-microservices-avoiding-duplicate-amit-jindal-wwgcf)
[13](https://learn.microsoft.com/en-us/azure/developer/terraform/azurerm/best-practices-integration-testing)
[14](https://raygun.com/blog/unit-testing-patterns/)
[15](https://pypi.org/project/pytest-idempotent/)
[16](https://uptrace.dev/blog/sla-slo-monitoring-requirements)
[17](https://stackoverflow.com/questions/70644282/aws-lambda-retry-using-sqs-dlq)
[18](https://aws.amazon.com/blogs/compute/using-amazon-sqs-dead-letter-queues-to-replay-messages/)
[19](https://littlehorse.io/blog/retries-and-dlq)
[20](https://stackoverflow.blog/2020/03/02/best-practices-for-rest-api-design/)
[21](https://stackoverflow.com/questions/78811619/ms-teams-azure-bot-verify-request-content)
[22](https://stackoverflow.com/questions/78495872/can-we-send-whatsapp-message-using-freshchat-api-without-template-also-facing-i)
[23](https://www.freshworks.com/explore-cx/whatsapp-proactive-messaging/)
[24](https://elixirforum.com/t/doing-jwt-by-hand-for-microsoft-teams-bot-understanding-how-to-use-elixir-jwt-libraries-for-this-scenario/49610)
[25](https://www.jorgebernhardt.com/terraform-azure-service-bus-topic/)
[26](https://learn.microsoft.com/ko-kr/azure/bot-service/rest-api/bot-framework-rest-connector-concepts?view=azure-bot-service-4.0)
[27](https://community.freshworks.dev/t/new-api-freshchat-api-endpoints-behaving-differently-to-documentation/8755)
[28](https://registry.terraform.io/modules/Azure/avm-res-servicebus-namespace/azurerm/latest)
[29](https://learn.microsoft.com/ko-kr/javascript/api/botframework-connector/jwttokenvalidation?view=botbuilder-ts-latest)
[30](https://developers.freshchat.com/web-sdk/)
[31](https://azure.github.io/Azure-Verified-Modules/indexes/terraform/tf-resource-modules/)
[32](https://www.servicenow.com/docs/bundle/zurich-integrate-applications/page/administer/integrationhub-store-spokes/task/setup-webhook-ms-teams-graph.html)
[33](https://community.freshworks.dev/t/is-it-possible-to-add-htlm-as-a-message-in-to-a-freshchat-conversation-via-the-api/8047)
[34](https://www.thinkmind.org/articles/sysmea_v2_n1_2009_3.pdf)
[35](https://learn.microsoft.com/en-us/answers/questions/923936/api-authentication-methods-which-can-configure-at)
[36](https://www.kom.tu-darmstadt.de/papers/RSS+09.pdf)
[37](https://java-design-patterns.com/patterns/microservices-idempotent-consumer/)
[38](https://sandbox.developer.basyspro.com/webhooks)
[39](https://dl.ifip.org/db/conf/im/im2003/DebusmannK03.pdf)
[40](https://microservices.io/post/microservices/patterns/2020/10/16/idempotent-consumer.html)
[41](https://learn.microsoft.com/en-us/answers/questions/2119086/signature-verification-in-azure-api-management-wit)
[42](https://johngrib.github.io/wiki/clipping/kafka-a-distributed-messaging-system-for-log-processing/)
[43](https://luizlelis.com/blog/outbox-pattern)
[44](https://learn.microsoft.com/en-us/answers/questions/845652/api-management-policy-example-to-validate-sha256-s)
[45](http://dpnm.postech.ac.kr/papers/APNOMS/02/sla-monitoring.pdf)
[46](https://microservices.io/patterns/communication-style/idempotent-consumer.html)
[47](https://learn.microsoft.com/en-us/answers/questions/862858/api-manager-policy-to-handle-webhook-secret)
[48](https://stackoverflow.com/questions/46236744/how-to-define-events-in-openapi-swagger-spec)
[49](https://restfulapi.net)
[50](https://redocly.com/docs/realm/content/api-docs/openapi-extensions/x-webhooks)
[51](https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design)
[52](https://github.com/OAI/OpenAPI-Specification/issues/3563)
[53](https://lf-onap.atlassian.net/wiki/display/DW/RESTful+API+Design+Specification)
[54](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html)
[55](https://www.speakeasy.com/blog/openapi-tips-webhooks-callbacks)
[56](https://learn.microsoft.com/ko-kr/azure/architecture/best-practices/api-design)
[57](https://github.com/aws-samples/amazon-sqs-dlq-replay-backoff)
[58](https://www.speakeasy.com/openapi/webhooks)
[59](https://bcho.tistory.com/954)
[60](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)
[61](https://bump.sh/blog/documenting-your-openapi-webhooks/)
[62](https://swagger.io/resources/articles/best-practices-in-api-design/)
[63](https://wonit.tistory.com/671)
[64](https://www.marktinderholt.com/infrastructure%20as%20code/testing/best%20practices/2025/07/05/reusable-iac-tests.html)
[65](https://dzone.com/articles/unit-testing-patterns-common-patterns-to-follow-fo)
[66](https://docs.aws.amazon.com/powertools/python/2.17.0/utilities/idempotency/)
[67](https://www.testdevlab.com/blog/the-ultimate-guide-to-unit-testing)
[68](https://www.thedigitalcatonline.com/blog/2020/09/10/tdd-in-python-with-pytest-part-1/)
[69](https://www.hashicorp.com/blog/testing-hashicorp-terraform)
[70](https://stackoverflow.com/questions/16211692/unit-testing-pattern)
[71](https://docs.powertools.aws.dev/lambda/python/3.9.0/utilities/idempotency/)
[72](https://learn.microsoft.com/ko-kr/azure/developer/terraform/best-practices-compliance-testing)
[73](https://docs.python.org/3/library/unittest.html)
[74](https://www.thedigitalcatonline.com/blog/2020/09/15/tdd-in-python-with-pytest-part-3/)
[75](https://learn.microsoft.com/ko-kr/azure/developer/terraform/best-practices-integration-testing)
[76](https://www.reddit.com/r/node/comments/dxow5i/what_are_some_of_the_most_common_antipatterns_you/)
[77](https://www.reddit.com/r/Python/comments/xrmnh0/best_way_to_test_requests_and_responses_in_pytest/)
[78](https://azure.github.io/Azure-Verified-Modules/specs/tf/ptn/)
[79](https://www.testrail.com/blog/how-to-write-unit-tests/)
[80](https://docs.pytest.org/en/stable/reference/plugin_list.html)