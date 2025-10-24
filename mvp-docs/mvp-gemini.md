Microsoft Teams-Freshchat 양방향 메시지 브리지 구축을 위한 기술 아키텍처 및 구현 가이드1. 핵심 데이터 계약 및 이벤트 스키마 명세본 섹션에서는 전체 메시지 브리지 시스템의 표준 언어(lingua franca) 역할을 하는 정규 데이터 모델을 정의합니다. 잘 정의되고 검증된 스키마는 분산 시스템의 신뢰성을 보장하는 기반이며, 데이터 손상을 방지하고 각 구성 요소의 로직을 단순화합니다.1.1. 정규 이벤트 스키마 (JSON Schema 정의)시스템 내에서 유통되는 모든 메시지 이벤트는 아래의 표준 스키마를 준수해야 합니다. 이 스키마는 데이터 유형, 필수 필드, 문자열 패턴(ID), 열거형 값(direction, source) 등을 강제하여 시스템의 유입 및 유출 지점에서 자동화된 유효성 검사를 가능하게 하는 핵심적인 품질 게이트 역할을 수행합니다. 각 필드에는 목적과 출처를 명확히 하는 상세 설명이 포함되어 있어, 개발자를 위한 자체 문서화 아티팩트로 기능합니다.JSON{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CanonicalMessageEvent",
  "description": "A standardized message event schema for the Teams-Freshchat bridge.",
  "type": "object",
  "required": [
    "idempotencyKey",
    "tenantId",
    "direction",
    "source",
    "context",
    "content",
    "timestamp"
  ],
  "properties": {
    "idempotencyKey": {
      "description": "Unique key to prevent duplicate processing. Format: 'platform:<identifiers>'",
      "type": "string",
      "pattern": "^(teams|freshchat):.+$"
    },
    "tenantId": {
      "description": "The identifier for the customer tenant.",
      "type": "string"
    },
    "direction": {
      "description": "The direction of the message flow.",
      "type": "string",
      "enum": ["inbound", "outbound"]
    },
    "source": {
      "description": "The originating platform of the message.",
      "type": "string",
      "enum": ["teams", "freshchat"]
    },
    "context": {
      "type": "object",
      "properties": {
        "teamId": { "type": "string" },
        "channelId": { "type": "string" },
        "threadId": {
          "description": "The root message ID of the Teams thread.",
          "type": "string"
        },
        "user": {
          "type": "object",
          "properties": {
            "aadUserIdHash": {
              "description": "SHA-256 hash of the user's Azure AD Object ID.",
              "type": "string"
            }
          }
        },
        "conversationId": {
          "description": "The corresponding Freshchat conversation ID. Present in outbound flow.",
          "type": "string"
        }
      },
      "required": ["user"]
    },
    "content": {
      "type": "object",
      "properties": {
        "text": { "type": "string" },
        "mentions": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "enum": ["user"] },
              "display": { "type": "string" },
              "id": { "description": "The mentioned user's AAD Object ID.", "type": "string" }
            }
          }
        },
        "attachments": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "enum": ["image", "file"] },
              "name": { "type": "string" },
              "signedUrl": { "description": "Short-lived pre-signed URL to the sanitized attachment in object storage.", "type": "string" }
            }
          }
        }
      }
    },
    "routing": {
      "type": "object",
      "properties": {
        "tags": { "type": "array", "items": { "type": "string" } },
        "customAttributes": { "type": "object" }
      }
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    }
  }
}
1.2. 데이터 흐름 및 페이로드 매핑데이터 변환 과정의 모호성을 제거하기 위해, 각 흐름에 대한 상세 매핑 테이블을 제공합니다. 이는 Normalizer 및 Adapter 컴포넌트 구현의 핵심 지침이 됩니다.표 1: Teams Activity 객체 → 정규 스키마 매핑소스 (Activity 객체 필드) 대상 (정규 스키마 필드)변환 로직conversation.idcontext.teamId, context.channelId, context.threadIdconversation.id 문자열(19:...@thread.tacv2)을 파싱하여 팀, 채널, 스레드 ID 추출. threadId는 루트 메시지 ID를 의미.from.idcontext.user.aadUserIdHashAzure AD 사용자 ID를 SHA-256 알고리즘으로 해싱하여 개인정보를 보호.textcontent.text원본 텍스트 콘텐츠를 그대로 매핑.entities (type: 'mention')content.mentionsentities 배열을 순회하며 mentioned.id (AAD ID)와 text (<at>...</at> 태그 포함)를 추출하여 content.mentions 배열 객체로 재구성.attachmentscontent.attachments각 첨부 파일에 대해 다운로드, AV 스캔, 오브젝트 스토리지 업로드 후 생성된 서명된 URL을 signedUrl에 매핑.표 2: 정규 스키마 → Freshchat API 페이로드 매핑소스 (정규 스키마 필드)대상 (Freshchat POST /v2/conversations 페이로드 필드) 변환 로직content.textmessages.message_parts.text.content사용자 메시지 텍스트를 첫 번째 메시지의 콘텐츠로 매핑.routing.tagsproperties 객체 내 필드각 태그를 Freshchat의 properties 내 불리언(boolean) 필드 또는 tags라는 이름의 배열 필드로 매핑. (Freshchat API 사양 확인 필요)routing.customAttributespropertiescustomAttributes 객체의 키-값 쌍을 Freshchat의 properties 객체로 직접 매핑. 이는 IntelliAssign 라우팅의 핵심.context.channelId 등properties.source_channel_id 등라우팅 및 추적을 위해 Teams 컨텍스트 정보를 Freshchat의 사용자 정의 속성(custom properties)으로 주입.표 3: Freshchat Webhook → 정규 스키마 매핑소스 (Freshchat message_create Webhook 필드) 대상 (정규 스키마 필드)변환 로직data.message.conversation_idcontext.conversationIdFreshchat 대화 ID를 컨텍스트에 매핑.data.message.message_partscontent.textmessage_parts 배열에서 텍스트 콘텐츠를 추출하여 매핑.actor.actor_type(처리 로직)actor_type이 'agent' 또는 'bot'인 경우에만 처리하여 사용자 메시지 에코(echo)를 방지.action_timetimestamp이벤트 발생 시간을 UTC 타임스탬프로 매핑.1.3. 멱등성(Idempotency) 전략 분석제안된 멱등성 키 teams:<team>/<channel>/<thread>/<messageId>는 메시지 생성 이벤트의 중복 처리를 방지하는 데 효과적입니다. 메시지 시스템에서 흔히 발생하는 문제 중 하나는 메시지 수정 및 삭제 이벤트 처리이며, 이는 MVP 범위에는 포함되지 않지만 장기적인 안정성을 위해 초기 설계에서 고려해야 합니다.현재 제안된 키는 특정 메시지의 생성 이벤트를 고유하게 식별합니다. 사용자가 메시지를 보낼 때 고유한 messageId가 생성되고, 시스템은 이 키를 기반으로 중복 수신을 방지합니다. 그러나 만약 사용자가 기존 메시지를 수정하면, Teams는 messageUpdate 타입의 Activity 이벤트를 전송하며, 이 이벤트는 원본과 동일한 messageId를 가질 가능성이 높습니다.2 만약 시스템이 단순히 messageId 기반의 키만 확인한다면, 이 중요한 수정 이벤트를 최초 생성 이벤트의 중복으로 오인하여 무시하게 될 위험이 있습니다.따라서 MVP 범위에서는 제안된 키가 충분하지만, ingress 큐의 소비자가 Freshchat 대화를 생성하기 직전에 멱등성 검사를 수행하도록 구현해야 합니다. MVP 이후 로드맵에서는 이벤트 유형을 키에 포함시켜 teams:<...>/<messageId>:create와 teams:<...>/<messageId>:edit를 명확히 구분하는 방식으로 키를 확장해야 합니다. 이러한 사전 고려는 향후 아키텍처 재설계 비용을 최소화합니다.2. 수신 흐름 구현 (Teams → Freshchat)본 섹션에서는 Microsoft Teams에서 발생한 메시지를 수신, 보안 검증, 처리하는 구체적인 구현 방안을 기술합니다.2.1. Teams 봇 콜백 엔드포인트: 보안 및 응답 처리POST /bot/callback 엔드포인트는 시스템의 외부 진입점으로서, 인증과 즉각적인 응답 처리가 핵심 책임입니다. 제안된 설계에 따라, 이 엔드포인트는 동기적 처리를 최소화하여 안정성을 확보해야 합니다.JWT 유효성 검증: 모든 수신 요청에 대해 다음의 JWT 토큰 검증 절차를 반드시 수행해야 합니다.5요청 헤더에서 Authorization: Bearer <token> 값을 추출합니다.정적 URL인 https://login.botframework.com/v1/.well-known/openidconfiguration에서 OpenID 메타데이터 문서를 가져옵니다.메타데이터 문서 내 jwks_uri 속성을 통해 서명 키 목록(JWKS)의 위치를 확인합니다.JWKS 엔드포인트에서 유효한 공개 서명 키 목록을 가져옵니다. 이 키 목록은 최대 24시간 동안 캐시하여 사용해야 합니다.수신된 JWT 토큰의 서명을 캐시된 공개 키로 검증하고, iss (발급자), aud (대상) 등 표준 클레임의 유효성을 확인합니다.이 과정은 시스템을 보호하는 필수적인 보안 게이트이며, 모든 단계를 정확히 구현하지 않을 경우 시스템이 공격에 노출될 수 있습니다.5 jsonwebtoken, jwks-rsa와 같은 표준 라이브러리를 사용하여 이 검증 로직을 구현하는 것이 권장됩니다.즉각적인 큐잉: JWT 검증이 성공적으로 완료되면, 원본 Activity 객체를 즉시 ingress 이벤트 큐에 적재하고 클라이언트에게 200 OK 응답을 반환해야 합니다. 이는 공개 엔드포인트와 내부 처리 로직을 분리(decoupling)하여, 다운스트림 시스템의 장애가 외부 요청 처리에 영향을 미치지 않도록 보장합니다.2.2. 정규화 서비스: Teams 특화 콘텐츠 변환이 서비스는 수신 경로의 핵심 비즈니스 로직을 담당하며, Teams 플랫폼에 특화된 데이터를 표준화된 형식으로 변환합니다.멘션(Mention) 변환: Bot Framework의 Activity 객체는 entities 배열 내 type: 'mention' 객체로 멘션을 표현합니다.1 반면, Teams로 메시지를 회신할 때 사용하는 Graph API는 HTML 본문 내에 <at> 태그와 별도의 mentions JSON 배열을 동시에 요구합니다.7정규화 서비스는 이 비대칭을 해결하는 중요한 역할을 합니다. 수신된 Activity의 entities 배열에서 사용자 AAD ID와 표시 이름을 추출하여 정규 스키마의 content.mentions 필드에 미리 저장해야 합니다. 이렇게 사전 처리된 데이터가 있으면, 나중에 Teams Adapter가 회신 메시지를 구성할 때 content.mentions 배열을 사용하여 Graph API가 요구하는 mentions JSON 구조와 <at> 태그를 손쉽게 생성할 수 있습니다. 이 방식은 Teams Adapter의 복잡도를 현저히 낮춥니다.첨부 파일 처리: 보안을 최우선으로 고려한 첨부 파일 처리 워크플로우는 다음과 같습니다.Activity.attachments 배열에서 첨부 파일 메타데이터를 수신합니다.제공된 URL에서 인증된 세션을 통해 파일 콘텐츠를 안전하게 다운로드합니다.컨테이너화된 ClamAV 등을 사용하여 경량 바이러스 검사를 수행합니다. 이는 악성 파일이 고객 지원 시스템으로 유입되는 것을 방지하는 필수 보안 단계입니다.검증된 파일을 중간 오브젝트 스토리지(Azure Blob, AWS S3 등)에 업로드합니다.업로드된 객체에 대해 짧은 만료 시간을 가진 사전 서명된 URL(pre-signed URL)을 생성합니다.이 서명된 URL을 정규 스키마의 content.attachments.signedUrl 필드에 저장합니다.2.3. Freshchat 어댑터: 대화 생성 및 라우팅이 컴포넌트는 ingress 큐의 메시지를 소비하여 Freshchat API와 상호작용합니다.API 페이로드 구성: POST /v2/conversations API 요청을 위한 완전하고 주석이 달린 JSON 페이로드 예시를 제공합니다. 이 예시는 3에서 확인된 상세 페이로드 구조를 기반으로 하며, 정규 스키마의 routing.customAttributes와 같은 필드가 Freshchat의 properties 객체에 어떻게 정확히 매핑되는지 보여줍니다.Freshchat의 IntelliAssign 기능은 대화 생성 시점에 전달되는 데이터에 의해 결정됩니다. 3의 예시 페이로드는 properties 객체 내에 cf_type, cf_rating과 같은 사용자 정의 필드를 포함하고 있습니다. 이는 정규 스키마의 routing.customAttributes를 Freshchat의 properties 객체로 매핑하는 것이 올바른 접근 방식임을 확인시켜 줍니다. routing.tags의 경우, Freshchat이 tags라는 이름의 배열 속성을 지원한다면 직접 매핑하고, 그렇지 않다면 각 태그를 별도의 불리언 속성으로 변환하여 전달하는 전략을 고려해야 합니다. 이는 Freshchat API 문서를 통해 명확히 해야 할 주요 구현 결정 사항입니다.상태 관리: Freshchat API로부터 201 Created 응답을 받아 대화 생성이 성공하면, 어댑터는 즉시 teamsThreadId와 freshchatConversationId 간의 매핑 정보를 상태 저장소(State Store)에 기록해야 합니다. 이 매핑 정보는 발신 흐름(Egress Flow)이 올바르게 동작하기 위한 필수 전제 조건입니다.3. 발신 흐름 구현 (Freshchat → Teams)본 섹션에서는 Freshchat 상담원의 회신이 정확한 Teams 스레드로 안정적이고 안전하게 전달되도록 보장하는 역방향 경로를 상세히 기술합니다.3.1. Freshchat Webhook 수신: 보안 및 비동기 처리HMAC 서명 검증: 발신 엔드포인트 보안의 가장 중요한 단계는 HMAC 서명 검증입니다. Freshchat은 X-Freshchat-Signature 헤더를 통해 서명을 전달하며 9, 검증 프로세스는 HMAC-SHA256 알고리즘을 기반으로 합니다.10요청 본문(body)을 파싱하지 않은 원시 바이트 문자열(raw byte string) 형태로 읽습니다.X-Freshchat-Signature 헤더 값을 읽습니다.Key Vault 또는 KMS와 같은 보안 저장소에 보관된 공유 비밀 키(shared secret)를 사용하여 원시 본문의 HMAC-SHA256 해시를 계산합니다.계산된 해시를 Base64로 인코딩합니다.시간 기반 공격(timing attack)에 안전한 hash_equals와 같은 함수를 사용하여, 계산된 서명과 헤더로 전달된 서명을 비교합니다.이 로직은 오류가 발생하기 쉬운 부분이므로, 아래 Python 코드 예시와 같이 신중하게 구현해야 합니다.Pythonimport hmac
import hashlib
import base64

def verify_freshchat_signature(secret: bytes, request_body: bytes, signature_header: str) -> bool:
    """Validates the HMAC-SHA256 signature of a Freshchat webhook."""
    computed_hash = hmac.new(secret, request_body, hashlib.sha256).digest()
    computed_signature = base64.b64encode(computed_hash).decode('utf-8')
    return hmac.compare_digest(computed_signature, signature_header)
페이로드 분석: message_create 웹훅 페이로드에서 4 핵심 필드는 data.message.conversation_id (상태 조회를 위함), actor.actor_type (상담원 메시지만 처리하기 위함), 그리고 data.message.message_parts (메시지 콘텐츠)입니다. actor.actor_type이 'agent'가 아닌 메시지는 무시하여 무한 루프를 방지해야 합니다.3.2. 상태 기반 컨텍스트 확인: 매핑의 핵심Teams Adapter는 egress 큐에서 메시지를 소비한 후, 가장 먼저 Freshchat 컨텍스트를 Teams 컨텍스트로 변환해야 합니다. 이를 위해 상태 저장소의 Thread Map 테이블을 조회합니다.데이터 모델: DynamoDB 또는 Cosmos DB와 같은 NoSQL 저장소에 적합한 Thread Map 테이블 스키마는 다음과 같습니다.파티션 키: freshchatConversationId (빠른 조회를 위함)속성: teamsTeamId, teamsChannelId, teamsThreadRootMessageId, tenantId, createdAt, ttl (Time-To-Live)여기서 가장 중요한 세부 사항은 Teams의 '스레드' 개념을 명확히 하는 것입니다. Graph API를 통해 특정 메시지에 회신하려면 POST.../messages/{message-id}/replies 엔드포인트를 사용해야 합니다.12 여기서 {message-id}는 스레드를 시작한 첫 번째 원본 메시지의 ID를 의미합니다. 따라서, 수신 흐름에서 매핑 정보를 생성할 때, 일반적인 스레드 식별자가 아닌 이 첫 번째 메시지의 ID를 teamsThreadRootMessageId로 정확히 저장해야 합니다. 이 미묘하지만 결정적인 차이가 전체 시스템의 성패를 좌우합니다.3.3. Teams 어댑터: 정확한 스레드로 회신API 엔드포인트 및 페이로드: 상태 저장소에서 조회한 컨텍스트 정보를 사용하여, POST /teams/{team-id}/channels/{channel-id}/messages/{teamsThreadRootMessageId}/replies API를 호출합니다. [13]을 참조하여 구성된 요청 본문 예시는 다음과 같습니다.JSON{
  "body": {
    "contentType": "html",
    "content": "Freshchat 상담원의 회신입니다."
  }
}
멘션 처리 (발신): 만약 Freshchat 상담원이 Teams 사용자를 @jane.smith@company.com과 같이 멘션하는 고급 기능을 구현한다면, Teams Adapter는 이 패턴을 감지해야 합니다. 이후 Graph API를 통해 해당 이메일에 해당하는 사용자의 AAD ID를 조회하고, [7]에서 설명하는 형식에 맞춰 mentions 배열과 <at> 태그를 포함한 페이로드를 동적으로 생성해야 합니다. 이는 MVP 이후의 기능으로 고려될 수 있습니다.4. 코드형 인프라 (IaC) 스켈레톤본 섹션에서는 Azure와 AWS 환경에 신속하게 배포할 수 있도록, 제안된 아키텍처에 기반한 모듈형 Terraform 코드 스켈레톤을 제공합니다.4.1. 아키텍처 구성 요소와 클라우드 서비스 매핑아래 표는 아키텍처의 개념적 구성 요소와 이를 구현하기 위한 특정 클라우드 서비스 및 주요 Terraform 리소스를 명확하게 매핑하여, 구현 선택의 근거를 제공하고 프로젝트 참여자의 이해를 돕습니다.아키텍처 구성 요소Azure 구현 (서비스)Azure Terraform 리소스AWS 구현 (서비스)AWS Terraform 리소스Teams 봇 엔드포인트Azure Bot Serviceazurerm_bot_service_azure_botN/A (ECS/Lambda에서 직접 실행)N/AAPI 게이트웨이/WAFAzure API Management + WAFazurerm_api_managementAWS API Gateway + WAFaws_apigatewayv2_api이벤트 큐 (+DLQ)Azure Service Busazurerm_servicebus_queueAWS SQSaws_sqs_queue컴퓨트 (핵심 로직)Azure Container Apps / AKSazurerm_container_appAWS ECS on Fargateaws_ecs_service상태 저장소Azure Cosmos DB / Table Storageazurerm_cosmosdb_sql_tableAWS DynamoDBaws_dynamodb_table오브젝트 스토리지Azure Blob Storageazurerm_storage_blobAWS S3aws_s3_bucket비밀 관리Azure Key Vaultazurerm_key_vault_secretAWS Secrets Manager / KMSaws_secretsmanager_secret관찰 가능성Azure Monitorazurerm_monitor_*AWS CloudWatchaws_cloudwatch_*4.2. Azure Terraform 모듈 (스켈레톤)봇 모듈 (/modules/bot/main.tf):azurerm_bot_service_azure_bot 14, azurerm_application_insights 15, 그리고 azurerm_service_plan 리소스를 정의합니다. Application Insights의 계측 키를 azurerm_bot_service_azure_bot 리소스의 developer_app_insights_key 인자에 전달하여 두 리소스를 연결합니다.Terraformresource "azurerm_resource_group" "main" {
  name     = "rg-${var.project_name}-${var.environment}"
  location = var.location
}

resource "azurerm_service_plan" "main" {
  name                = "plan-${var.project_name}-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "P1v2"
}

resource "azurerm_application_insights" "main" {
  name                = "appi-${var.project_name}-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
}

resource "azurerm_bot_service_azure_bot" "main" {
  name                = "bot-${var.project_name}-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = "global"
  sku                 = "F0"
  microsoft_app_id    = var.bot_app_id

  developer_app_insights_key = azurerm_application_insights.main.instrumentation_key
  developer_app_insights_application_id = azurerm_application_insights.main.app_id
}
비밀 관리 (/modules/security/main.tf):azurerm_key_vault와 azurerm_key_vault_secret 리소스를 생성하고, 시스템의 관리형 ID(Managed Identity)에 접근 권한을 부여하는 예시입니다.16Terraformresource "azurerm_key_vault" "main" {
  name                        = "kv-${var.project_name}-${var.environment}"
  #... (기타 설정)
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  sku_name                    = "standard"

  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = var.app_managed_identity_principal_id
    secret_permissions = ["Get", "List"]
  }
}

resource "azurerm_key_vault_secret" "freshchat_secret" {
  name         = "FreshchatWebhookSecret"
  value        = var.freshchat_webhook_secret_value
  key_vault_id = azurerm_key_vault.main.id
}
4.3. AWS Terraform 모듈 (스켈레톤)API 게이트웨이 모듈 (/modules/gateway/main.tf):서버리스 웹훅 수신을 위해 aws_apigatewayv2_api를 SQS 큐와 직접 통합하는 예시입니다. 핵심은 aws_apigatewayv2_integration 리소스의 integration_subtype을 SQS-SendMessage로 설정하는 것입니다.18 API Gateway가 SQS에 메시지를 보낼 수 있도록 aws_iam_role도 함께 정의해야 합니다.Terraformresource "aws_sqs_queue" "ingress_queue" {
  name = "freshchat-webhook-ingress-queue"
}

resource "aws_iam_role" "api_gateway_sqs_role" {
  name = "api-gateway-sqs-role"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17",
    Statement =
  })
}

resource "aws_iam_role_policy" "api_gateway_sqs_policy" {
  role = aws_iam_role.api_gateway_sqs_role.id
  policy = jsonencode({
    Version   = "2012-10-17",
    Statement =
  })
}

resource "aws_apigatewayv2_api" "main" {
  name          = "freshchat-webhook-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_integration" "sqs_integration" {
  api_id             = aws_apigatewayv2_api.main.id
  integration_type   = "AWS_PROXY"
  integration_subtype = "SQS-SendMessage"
  credentials_arn    = aws_iam_role.api_gateway_sqs_role.arn
  request_parameters = {
    "QueueUrl"    = aws_sqs_queue.ingress_queue.id,
    "MessageBody" = "$request.body"
  }
}
5. 고급 신뢰성 및 보안 플레이북본 섹션에서는 엄격한 SLO를 충족시키기 위해 필요한 운영 우수성에 초점을 맞춘 고급 플레이북을 제공합니다.5.1. DLQ 관리 및 자동 재처리DLQ에 격리된 메시지는 원본 메시지 본문과 함께 실패 원인(오류 메시지, 실패 컴포넌트, 타임스탬프, 재시도 횟수)에 대한 메타데이터를 포함하도록 스키마를 확장해야 합니다.장애 처리 플레이북:경보: DLQ 메시지 수가 임계값(예: 15분 내 5건 이상)을 초과하면 경보가 발생합니다.분류: 담당 엔지니어는 실패 원인을 확인하고 다음과 같이 분류합니다.일시적 오류 (Transient Errors): 외부 API의 503 Service Unavailable 또는 429 Too Many Requests와 같은 오류. 자동 재처리 대상입니다.영구적 오류 (Permanent Errors): 스키마 유효성 검사 실패로 인한 400 Bad Request, 잘못된 키로 인한 401 Unauthorized 등. 수동 조사가 필요합니다.재처리 도구: DLQ에서 메시지를 읽고, 오류 유형에 따라 필터링한 후, 주 처리 큐에 다시 주입할 수 있는 간단한 CLI 도구(예: Python 스크립트)를 구현합니다. 이는 수동적이고 오류 발생 가능성이 높은 메시지 처리를 방지합니다.5.2. 무중단 비밀 키 순환(Rotation)단순히 비밀 키를 변경하는 것은 애플리케이션과 외부 서비스가 동시에 업데이트되지 않을 경우 서비스 중단을 유발할 수 있습니다. 따라서 무중단 순환 절차가 필수적입니다.Freshchat Webhook 비밀 키 순환 플레이북:Freshchat UI는 여러 개의 활성 비밀 키를 지원하지 않으므로, 애플리케이션 측에서 이중 검증 로직을 구현하는 "플립-더-스위치(flip-the-switch)" 접근 방식이 필요합니다.새로운 비밀 키를 안전하게 생성합니다.새 키를 Key Vault/Secrets Manager에 freshchat-webhook-secret-pending과 같은 이름으로 저장합니다.애플리케이션을 배포하여 freshchat-webhook-secret-current와 freshchat-webhook-secret-pending 키를 모두 읽도록 합니다. 서명 검증 로직은 두 키를 모두 시도해야 합니다.Freshchat 관리자 UI에서 웹훅 설정을 새로운 비밀 키로 업데이트합니다.업데이트 직후, 이전 키로 서명된 요청과 새 키로 서명된 요청이 혼재될 수 있으나, 이중 키 검증 로직이 이를 모두 처리합니다.모든 신규 웹훅이 새 키로 성공적으로 검증되는 것을 모니터링한 후, -pending 키를 -current로 승격시키고 이전 키와 이중 검증 로직을 제거하는 최종 배포를 진행합니다.이 단계적 접근 방식은 보안 절차 중에도 시스템의 가용성을 보장합니다.6. 권장 사항 및 향후 발전 방향본 섹션에서는 제안된 계획을 검증하고, 아키텍처의 미래 확장성을 고려한 전략적 로드맵을 제시합니다.6.1. MVP 선행 조건 검증다음 단계를 진행하기 위한 선행 조건으로, 채널↔인박스 매핑 규칙과 첨부 파일 정책(최대 크기, 허용 MIME 타입)을 최종 확정하는 것이 필수적입니다. 이는 Normalizer의 라우팅 규칙과 보안 정책을 구성하는 데 필요한 비즈니스 로직 결정 사항입니다.6.2. MVP 이후 전략적 로드맵플랫폼의 사용자 경험과 운영 성숙도를 향상시키기 위한 논리적인 발전 단계를 제안합니다.1단계 (리치 콘텐츠 지원): 메시지 수정/삭제 기능 지원(Teams의 messageUpdate/messageDelete 이벤트 처리 필요 2), 그리고 기본적인 서식(굵게, 기울임꼴) 렌더링을 구현합니다.2단계 (상호작용성 강화): 적응형 카드(Adaptive Cards)의 양방향 지원을 구현합니다. Normalizer가 Teams 메시지 내 카드를 식별하여 Freshchat이 표시할 수 있는 형식(또는 텍스트 대체)으로 변환하고, 그 반대도 처리하는 기능이 포함됩니다.3단계 (확장성 및 지능화): 특정 테넌트의 과도한 트래픽이 다른 테넌트에 영향을 주지 않도록 테넌트별 속도 제한(rate limiting)을 구현합니다. Normalizer에 감성 분석 기능을 도입하여 대화에 sentiment: positive/negative/neutral과 같은 태그를 자동으로 추가하고, 이를 Freshchat의 사용자 정의 속성으로 전달하여 라우팅 정확도를 더욱 향상시킵니다.