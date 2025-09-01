import { SignJWT } from 'jose';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // --- GET /api/rooms: 取得房型列表 (保持不變) ---
    if (url.pathname === '/api/rooms' && request.method === 'GET') {
      const roomsData = await env.ROOMS_KV.get('all_rooms', 'json');
      if (!roomsData) {
        return new Response(JSON.stringify({ error: 'Rooms data not found.' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      return new Response(JSON.stringify(roomsData), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // --- 手動同步觸發 (保持不變) ---
    if (url.pathname === '/api/sync' && request.method === 'GET') {
      try {
        await syncGoogleSheetToKV(env);
        return new Response("Manual sync completed successfully!", { status: 200 });
      } catch (error) {
        console.error("Manual sync failed:", error.stack);
        return new Response(`Sync failed: ${error.message}`, { status: 500 });
      }
    }

    // --- 【全新功能】POST /api/bookings: 建立新訂單 ---
    if (url.pathname === '/api/bookings' && request.method === 'POST') {
      try {
        const bookingData = await request.json(); // 解析前端傳來的 JSON 資料

        // 簡單的資料驗證
        if (!bookingData.roomId || !bookingData.checkInDate || !bookingData.guestName) {
          return new Response(JSON.stringify({ error: 'Missing required booking data.' }), {
            status: 400, // 400 代表 "Bad Request" (請求格式錯誤)
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
        
        // 執行寫入 Google Sheet 的核心任務
        const newBookingId = await writeBookingToSheet(env, bookingData);

        // 回傳成功訊息與新的訂單 ID
        return new Response(JSON.stringify({ success: true, bookingId: newBookingId }), {
          status: 201, // 201 代表 "Created" (已建立)
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
 
      } catch (error) {
        console.error("Booking creation failed:", error.stack);
        return new Response(JSON.stringify({ error: `Booking creation failed: ${error.message}` }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }
    
    // 處理跨來源 OPTIONS 請求 (CORS) - 這是前端呼叫 API 的必要步驟
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
        });
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


// --- 【全新函式】將訂單資料寫入 Google Sheet ---
async function writeBookingToSheet(env, booking) {
  const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
  const sheetId = env.GOOGLE_SHEET_ID;
  
  // Google Sheets API 的 "append" 端點
  const range = 'bookings!A:K'; // 我們要操作 `bookings` 分頁的所有欄位
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;

  const timestamp = new Date().toISOString();
  const bookingId = `HB-${Date.now()}`; // 產生一個簡單的訂單 ID

  // 準備要寫入的那一「列」資料
  // 【重要】這裡的順序，必須和 `bookings` 分頁的欄位順序完全一致
  const newRow = [
    bookingId,
    timestamp,
    booking.lineUserId || '', // 從前端傳來的資料
    booking.lineDisplayName || '',
    booking.roomId,
    booking.checkInDate,
    booking.checkOutDate,
    booking.guestName,
    booking.guestPhone || '',
    booking.totalPrice || 0,
    'PENDING_CONFIRMATION', // 預設訂單狀態
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      values: [newRow], // API 要求 `values` 是一個包含多列的陣列
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Google Sheets API write error: ${JSON.stringify(errorData)}`);
  }

  return bookingId; // 將新的訂單 ID 回傳
}


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
    scope: 'https://www.googleapis.com/auth/spreadsheets',
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