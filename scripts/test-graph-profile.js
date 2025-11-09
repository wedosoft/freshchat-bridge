/**
 * Graph API 사용자 프로필 테스트
 * 
 * 사용법:
 * node scripts/test-graph-profile.js <AAD_USER_ID>
 * 
 * 예:
 * node scripts/test-graph-profile.js alan_wedosoft@poscointl.com
 */

require('dotenv').config();
const axios = require('axios');

async function getGraphAccessToken(targetTenantId = null) {
    // Use customer tenant ID for testing (can be overridden with --tenant parameter)
    const tenantId = targetTenantId || 'b9501eff-d05e-4bf1-8a87-898d83f46ceb';
    const clientId = process.env.BOT_APP_ID;
    const clientSecret = process.env.BOT_APP_PASSWORD;

    console.log(`🔐 Using tenant: ${tenantId}\n`);
    const tokenEndpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    try {
        const response = await axios.post(tokenEndpoint, new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'https://graph.microsoft.com/.default'
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        return response.data.access_token;
    } catch (error) {
        console.error('Failed to get access token:', error.response?.data || error.message);
        throw error;
    }
}

async function testGraphProfile(userIdOrEmail) {
    try {
        console.log(`\n🔍 Fetching profile for: ${userIdOrEmail}\n`);

        const accessToken = await getGraphAccessToken();
        console.log('✅ Access token obtained\n');

        const selectFields = [
            'id',
            'displayName',
            'mail',
            'userPrincipalName',
            'jobTitle',
            'department',
            'mobilePhone',
            'businessPhones',
            'officeLocation'
        ].join(',');

        const response = await axios.get(
            `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userIdOrEmail)}`,
            {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { $select: selectFields }
            }
        );

        console.log('📊 Graph API Response:');
        console.log('═══════════════════════════════════════════\n');
        console.log(JSON.stringify(response.data, null, 2));
        console.log('\n═══════════════════════════════════════════\n');

        // 필드 매핑 확인
        const profile = response.data;
        console.log('🗺️  Freshchat Field Mapping:');
        console.log('═══════════════════════════════════════════');
        console.log(`job_title (직함):           ${profile.jobTitle || '(없음)'}`);
        console.log(`cf_field3632 (부서):        ${profile.department || '(없음)'}`);
        console.log(`cf_field480 (회사위치):     ${profile.officeLocation || '(없음)'}`);
        console.log(`mobile_number (휴대폰):     ${profile.mobilePhone || '(없음)'}`);
        console.log(`work_number (직장 전화):    ${profile.businessPhones?.[0] || '(없음)'}`);
        console.log('═══════════════════════════════════════════\n');

    } catch (error) {
        console.error('\n❌ Error:', error.response?.data || error.message);
        if (error.response?.status === 404) {
            console.error('\n💡 Tip: User not found. Try using email or AAD Object ID.');
        }
    }
}

// 메인 실행
const userIdOrEmail = process.argv[2];

if (!userIdOrEmail) {
    console.error('Usage: node scripts/test-graph-profile.js <AAD_USER_ID_OR_EMAIL>');
    console.error('Example: node scripts/test-graph-profile.js alan_wedosoft@poscointl.com');
    process.exit(1);
}

testGraphProfile(userIdOrEmail);
