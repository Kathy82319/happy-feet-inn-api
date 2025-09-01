import { SignJWT } from 'jose';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 原本的 API 端點，保持不變
    if (url.pathname === '/api/rooms') {
      const roomsData = await env.ROOMS_KV.get('all_rooms', 'json');
      if (!roomsData) {
        return new Response(JSON.stringify({ error: 'Rooms data not found. Please wait for the next sync.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(roomsData), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
      });
    }

    // 【新增的秘密按鈕】手動觸發同步的 API 端點
    if (url.pathname === '/api/sync') {
      try {
        console.log("Manual sync triggered via API...");
        // 手動執行我們的主同步函式
        await syncGoogleSheetToKV(env);
        // 如果成功，回傳成功訊息
        return new Response("Manual sync completed successfully!", { status: 200 });
      } catch (error) {
        // 如果失敗，在日誌中印出詳細錯誤，並回傳錯誤訊息
        console.error("Manual sync failed:", error.stack);
        return new Response(`Sync failed: ${error.message}`, { status: 500 });
      }
    }

    return new Response('你好，我是快樂腳旅棧的 API 伺服器！');
  },

  // 定時任務保持不變，雖然它可能沒被啟用，但我們先留著
  async scheduled(event, env, ctx) {
    console.log("CRON job triggered: Attempting to sync data from Google Sheet...");
    try {
      await syncGoogleSheetToKV(env);
      console.log("Scheduled sync successful!");
    } catch (error) {
      console.error("Scheduled sync failed:", error.stack);
    }
  },
};

// --- 下方的 syncGoogleSheetToKV 和 getGoogleAuthToken 函式保持完全不變 ---

async function syncGoogleSheetToKV(env) {
  // ... (此處程式碼完全不變)
  const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
  const sheetId = env.GOOGLE_SHEET_ID;
  const range = 'rooms!A2:G';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Google Sheets API error: ${JSON.stringify(errorData)}`);
  }
  const sheetData = await response.json();
  const rows = sheetData.values || [];
  const rooms = rows.map(row => ({
    id: row[0] || '',
    name: row[1] || '',
    description: row[2] || '',
    price: parseInt(row[3], 10) || 0,
    totalQuantity: parseInt(row[4], 10) || 0,
    imageUrl: row[5] || '',
    isActive: (row[6] || 'FALSE').toUpperCase() === 'TRUE',
  })).filter(room => room.id && room.isActive);
  await env.ROOMS_KV.put('all_rooms', JSON.stringify(rooms));
}

/**
 * 輔助函式：將 PEM 格式的金鑰字串，轉換為加密函式庫所需的 ArrayBuffer 格式
 * @param {string} pem - PEM 格式的金鑰字串
 * @returns {ArrayBuffer}
 */
function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, ''); // 移除所有空白和換行符
  const binary_string = atob(b64); // atob() 是 Base64 解碼的標準函式
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 輔助函式：使用服務帳號金鑰產生 Google API 的 Access Token
 * @param {string} serviceAccountKeyJson - 存在 Secret 中的服務帳號金鑰 (JSON 字串)
 * @returns {Promise<string>} - Google API 的存取令牌
 */
async function getGoogleAuthToken(serviceAccountKeyJson) {
  const serviceAccount = JSON.parse(serviceAccountKeyJson);

  // 【關鍵修正】在這裡，我們先將金鑰字串「鑄造」成實體鑰匙
  const privateKeyBuffer = pemToArrayBuffer(serviceAccount.private_key);

  const jwt = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(await crypto.subtle.importKey(
        "pkcs8",
        privateKeyBuffer, // <-- 將鑄造好的實體鑰匙交給開鎖機器
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    ));

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokens = await response.json();
  if (!tokens.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(tokens)}`);
  }
  return tokens.access_token;
}