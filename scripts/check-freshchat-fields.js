/**
 * Freshchat 사용자 properties 확인
 * 
 * 사용법:
 * FRESHCHAT_API_TOKEN=your_token FRESHCHAT_API_URL=your_url node scripts/check-freshchat-fields.js
 */

const axios = require('axios');

async function checkUserFields() {
    const freshchatApiUrl = process.env.FRESHCHAT_API_URL || 'https://api.freshchat.com/v2';
    const freshchatApiToken = process.env.FRESHCHAT_API_TOKEN;

    if (!freshchatApiToken) {
        console.error('❌ FRESHCHAT_API_TOKEN not found');
        console.log('Usage: FRESHCHAT_API_TOKEN=your_token node scripts/check-freshchat-fields.js');
        process.exit(1);
    }

    try {
        console.log('\n📋 Freshchat User Sample:\n');
        console.log('═══════════════════════════════════════════\n');
        
        // Get recent users to see what properties exist
        const response = await axios.get(`${freshchatApiUrl}/users`, {
            headers: {
                'Authorization': `Bearer ${freshchatApiToken}`,
                'Content-Type': 'application/json'
            },
            params: {
                page: 1,
                items_per_page: 10,
                sort_order: 'desc'
            }
        });

        if (response.data && response.data.users && response.data.users.length > 0) {
            const users = response.data.users;
            console.log(`Found ${users.length} recent users\n`);

            // Collect all unique property names
            const allPropertyNames = new Set();
            users.forEach(user => {
                if (user.properties) {
                    user.properties.forEach(prop => {
                        allPropertyNames.add(prop.name);
                    });
                }
            });

            console.log(`\n🔍 All Property Names Found (${allPropertyNames.size} unique):\n`);
            console.log('═══════════════════════════════════════════\n');
            Array.from(allPropertyNames).sort().forEach((name, index) => {
                console.log(`${index + 1}. ${name}`);
            });

            console.log('\n\n📊 Sample User with Properties:\n');
            console.log('═══════════════════════════════════════════\n');
            
            // Find a user with properties
            const userWithProps = users.find(u => u.properties && u.properties.length > 0);
            if (userWithProps) {
                console.log(`User: ${userWithProps.first_name || 'Unknown'} (${userWithProps.id})`);
                console.log(`Email: ${userWithProps.email || 'N/A'}`);
                console.log(`\nProperties (${userWithProps.properties.length}):`);
                userWithProps.properties.forEach(prop => {
                    console.log(`  - ${prop.name}: ${prop.value}`);
                });
            }

            // Check our mapped fields
            console.log('\n\n�️  Our Mapped Fields Status:\n');
            console.log('═══════════════════════════════════════════\n');
            
            const fieldMap = {
                'job_title': '직함',
                'cf_field3632': '부서',
                'work_number': '직장 전화',
                'mobile_number': '휴대폰',
                'cf_field480': '회사위치',
                'teams_email': 'Teams 이메일',
                'teams_display_name': 'Teams 이름',
                'source': '소스'
            };

            Object.entries(fieldMap).forEach(([fieldName, description]) => {
                const exists = allPropertyNames.has(fieldName);
                const status = exists ? '✅' : '❌';
                console.log(`${status} ${fieldName.padEnd(25)} (${description})`);
            });

        } else {
            console.log('No users found in response');
            console.log('Response:', JSON.stringify(response.data, null, 2));
        }

    } catch (error) {
        console.error('\n❌ Error:', error.response?.data || error.message);
        if (error.response?.status === 401) {
            console.error('\n💡 Tip: Check your FRESHCHAT_API_TOKEN');
        }
    }
}

checkUserFields();
