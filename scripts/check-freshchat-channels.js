// Freshchat Channel ID 확인 스크립트
require('dotenv').config();
const axios = require('axios');

async function listChannels() {
  try {
    const apiUrl = process.env.FRESHCHAT_API_URL;
    const apiKey = process.env.FRESHCHAT_API_KEY;

    console.log('🔍 Freshchat Channel 목록 조회 중...\n');
    console.log(`API URL: ${apiUrl}/channels\n`);

    const response = await axios.get(`${apiUrl}/channels`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data && response.data.channels) {
      console.log('📋 사용 가능한 Channel 목록:\n');
      response.data.channels.forEach((channel, index) => {
        console.log(`${index + 1}. Channel Name: ${channel.name}`);
        console.log(`   Channel ID: ${channel.id}`);
        console.log(`   Enabled: ${channel.enabled !== false ? 'Yes' : 'No'}`);
        console.log(`   Tags: ${channel.tags ? channel.tags.join(', ') : 'None'}`);
        console.log('');
      });

      if (response.data.channels.length > 0) {
        console.log('✅ 위 Channel ID 중 하나를 선택하여 .env 파일에 입력하세요:');
        console.log(`\nFRESHCHAT_INBOX_ID=${response.data.channels[0].id}`);
        console.log('\n💡 참고: FRESHCHAT_INBOX_ID라는 이름이지만, 실제로는 channel_id를 사용합니다.');
      }
    } else {
      console.log('⚠️  Channel을 찾을 수 없습니다.');
      console.log('응답 데이터:', JSON.stringify(response.data, null, 2));
    }

  } catch (error) {
    console.error('❌ Channel 조회 실패:');
    if (error.response) {
      console.error(`상태 코드: ${error.response.status}`);
      console.error(`응답 데이터:`, JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }

    console.log('\n📌 문제 해결 방법:');
    console.log('1. .env 파일에 FRESHCHAT_API_KEY가 올바르게 설정되어 있는지 확인');
    console.log('2. FRESHCHAT_API_URL이 https://로 시작하는지 확인');
    console.log('3. API Key에 channel:read 권한이 있는지 확인');
  }
}

listChannels();
