/**
 * Freshchat 사용자 필드 스키마 확인
 * 
 * 사용법:
 * node scripts/check-freshchat-fields.js
 */

require('dotenv').config();
const axios = require('axios');

async function checkFields() {
    const freshchatApiUrl = process.env.FRESHCHAT_API_URL || 'https://api.freshchat.com/v2';
    const freshchatApiToken = process.env.FRESHCHAT_API_TOKEN;

    if (!freshchatApiToken) {
        console.error('❌ FRESHCHAT_API_TOKEN not found');
        console.log('Please set FRESHCHAT_API_TOKEN environment variable');
        process.exit(1);
    }

    try {
        console.log('\n📋 Freshchat User Fields Schema:\n');
        console.log('═══════════════════════════════════════════\n');
        
        const response = await axios.get(`${freshchatApiUrl}/users/fields`, {
            headers: {
                'Authorization': `Bearer ${freshchatApiToken}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.fields) {
            console.log(`Found ${response.data.fields.length} fields:\n`);
            
            response.data.fields.forEach((field, index) => {
                console.log(`${index + 1}. ${field.label} (${field.name})`);
                console.log(`   Type: ${field.type}`);
                if (field.choices && field.choices.length > 0) {
                    console.log(`   Choices: ${field.choices.join(', ')}`);
                }
                console.log('');
            });

            // Check our mapped fields
            console.log('\n🔍 Checking our mapped fields:\n');
            console.log('═══════════════════════════════════════════\n');
            
            const fieldMap = {
                'job_title': '직함',
                'cf_field3632': '부서',
                'work_number': '직장 전화',
                'mobile_number': '휴대폰',
                'cf_field480': '회사위치'
            };

            const fieldNames = response.data.fields.map(f => f.name);
            
            Object.entries(fieldMap).forEach(([fieldName, description]) => {
                const exists = fieldNames.includes(fieldName);
                const status = exists ? '✅' : '❌';
                console.log(`${status} ${fieldName} (${description}): ${exists ? 'EXISTS' : 'NOT FOUND'}`);
            });

        } else {
            console.log('Response:', JSON.stringify(response.data, null, 2));
        }

    } catch (error) {
        console.error('\n❌ Error:', error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.error('\n💡 Tip: Check your FRESHCHAT_API_TOKEN');
        }
    }
}

checkFields();
