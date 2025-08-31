import { SignJWT } from 'jose';

export default {
  /**
   * 處理 API 請求的地方
   * 目前保持不變，之後我們會在這裡加上 /api/rooms 等端點
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
          'Access-Control-Allow-Origin': '*' // 允許所有來源的前端呼叫，方便開發
        },
      });
    }
    return new Response('你好，我是快樂腳旅棧的 API 伺服器！');
  },

  /**
   * 處理定時任務的地方
   * 這段程式碼會每 5 分鐘自動執行一次
   */
  async scheduled(event, env, ctx) {
    console.log("CRON job triggered: Syncing data from Google Sheet...");
    try {
      // 執行同步任務，並等待它完成
      await syncGoogleSheetToKV(env);
      console.log("Sync successful!");
    } catch (error) {
      console.error("Sync failed:", error);
    }
  },
};

/**
 * 核心函式：從 Google Sheet 同步資料到 Cloudflare KV
 * @param {object} env - Worker 的環境變數 (包含金鑰和 KV)
 */
async function syncGoogleSheetToKV(env) {
  // 1. 取得 Google API 的存取令牌
  const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);

  // 2. 使用令牌從 Google Sheet API 讀取資料
  const sheetId = env.GOOGLE_SHEET_ID;
  const range = 'rooms!A2:G'; // 從 A2 開始讀取，避開標頭
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Google Sheets API error: ${JSON.stringify(errorData)}`);
  }

  const sheetData = await response.json();
  const rows = sheetData.values || [];

  // 3. 將 Google Sheet 的原始資料轉換成乾淨的 JSON 物件陣列
  const rooms = rows.map(row => {
    // 根據我們在 Part 1 定義的欄位順序來解析
    return {
      id: row[0] || '',
      name: row[1] || '',
      description: row[2] || '',
      price: parseInt(row[3], 10) || 0,
      totalQuantity: parseInt(row[4], 10) || 0,
      imageUrl: row[5] || '',
      isActive: (row[6] || 'FALSE').toUpperCase() === 'TRUE',
    };
  }).filter(room => room.id && room.isActive); // 只保留有 id 且上架中的房型

  // 4. 將整理好的資料存入 KV 中
  // 我們將整個房型陣列用 'all_rooms' 這個 key 存成一個 JSON 字串
  await env.ROOMS_KV.put('all_rooms', JSON.stringify(rooms));
}


/**
 * 輔助函式：使用服務帳號金鑰產生 Google API 的 Access Token
 * @param {string} serviceAccountKeyJson - 存在 Secret 中的服務帳號金鑰 (JSON 字串)
 * @returns {Promise<string>} - Google API 的存取令牌
 */
async function getGoogleAuthToken(serviceAccountKeyJson) {
  const serviceAccount = JSON.parse(serviceAccountKeyJson);

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
        (serviceAccount.private_key).replace(/\\n/g, "\n"),
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
  return tokens.access_token;
}