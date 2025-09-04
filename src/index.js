import { SignJWT } from 'jose';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;
   console.log(`[Backend Request Log] Method: ${method}, Path: ${pathname}`);
    // --- API 路由器 ---
    // 如果請求的路徑是以 /api/ 開頭，就進入後端 API 處理邏輯
    if (pathname.startsWith('/api/')) {

       // --- 【新增的、最終的診斷日誌】 ---
       // 讓程式親口告訴我們，它對 booking 路由的判斷結果是什麼
    if (isBookingRoute) { // <--- 我們直接使用上面的判斷結果
       try {
          const bookingData = await request.json();

          if (!bookingData.roomId || !bookingData.checkInDate || !bookingData.guestName) {
            return new Response(JSON.stringify({ error: 'Missing required booking data.' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
          }

          const newBookingId = await writeBookingToSheet(env, bookingData);

          return new Response(JSON.stringify({ success: true, bookingId: newBookingId }), {
            status: 201,
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


      // GET /api/sync: 手動觸發同步
      if (pathname === '/api/sync' && request.method === 'GET') {
        try {
          await syncGoogleSheetToKV(env);
          return new Response("Manual sync completed successfully!", { status: 200 });
        } catch (error) {
          console.error("Manual sync failed:", error.stack);
          return new Response(`Sync failed: ${error.message}`, { status: 500 });
        }
      }

      // POST /api/bookings: 建立新訂單
      if (pathname === '/api/bookings' && method === 'POST') {
         try {
            const bookingData = await request.json();

            if (!bookingData.roomId || !bookingData.checkInDate || !bookingData.guestName) {
              return new Response(JSON.stringify({ error: 'Missing required booking data.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
              });
            }

            const newBookingId = await writeBookingToSheet(env, bookingData);

            return new Response(JSON.stringify({ success: true, bookingId: newBookingId }), {
              status: 201,
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
            
      // 【全新功能】GET /api/availability: 查詢空房狀態
      if (pathname === '/api/availability' && request.method === 'GET') {
        try {
          // 從網址的查詢參數中取得房型 ID 和日期
          const roomId = url.searchParams.get('roomId');
          const startDate = url.searchParams.get('startDate');
          const endDate = url.searchParams.get('endDate');

          if (!roomId || !startDate || !endDate) {
            return new Response(JSON.stringify({ error: 'Missing required query parameters: roomId, startDate, endDate' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
          }

          // 執行查詢空房的核心任務
          const availability = await getAvailabilityForRoom(env, roomId, startDate, endDate);
          
          return new Response(JSON.stringify(availability), {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });

        } catch (error) {
          console.error("Availability check failed:", error.stack);
          return new Response(JSON.stringify({ error: `Availability check failed: ${error.message}` }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
      }

      // 如果是 /api/ 路徑但沒有匹配到任何端點，回傳 404
      return new Response(JSON.stringify({ error: 'API endpoint not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // --- 前端靜態檔案伺服器 ---
    // 如果請求的路徑不是 /api/ 開頭，就交給 Pages 內建的靜態資源服務處理
    // 這會自動幫我們回傳 index.html, style.css, liff-app.js 等檔案
    return env.ASSETS.fetch(request);
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


// --- 【全新函式】查詢指定房型在特定日期區間的空房狀況 ---
async function getAvailabilityForRoom(env, roomId, startDateStr, endDateStr) {
  // 1. 取得所有房型的資料，並找出目標房型的總房間數
  const allRooms = await env.ROOMS_KV.get('all_rooms', 'json');
  if (!allRooms) {
    throw new Error('Rooms data not available in KV store.');
  }
  const targetRoom = allRooms.find(room => room.id === roomId);
  if (!targetRoom) {
    return { error: 'Room not found', availableCount: 0 };
  }
  const totalQuantity = targetRoom.totalQuantity;

  // 2. 獲取 Google API 存取令牌
  const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
  const sheetId = env.GOOGLE_SHEET_ID;
  
  // 3. 讀取 `bookings` 分頁中的所有訂單紀錄
  const range = 'bookings!A2:K'; // 從 A2 開始讀取，撈取所有訂單
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Google Sheets API read error: ${JSON.stringify(errorData)}`);
  }
  const sheetData = await response.json();
  const bookings = (sheetData.values || []).map(row => ({
    // 根據 bookings 分頁的欄位順序解析
    bookingId: row[0],
    timestamp: row[1],
    lineUserId: row[2],
    lineDisplayName: row[3],
    roomId: row[4],
    checkInDate: row[5],
    checkOutDate: row[6],
    status: row[10] // 我們只關心狀態
  }));
  
  // 4. 核心演算法：計算指定日期範圍內，每天被佔用的房間數
  const occupiedCounts = {}; // 用來記錄每天被佔用的數量
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  // 遍歷每一筆已存在的訂單
  for (const booking of bookings) {
    // 只計算與我們要查詢的房型相同，且訂單狀態不是 CANCELLED 的訂單
    if (booking.roomId === roomId && booking.status !== 'CANCELLED') {
      const bookingCheckIn = new Date(booking.checkInDate);
      const bookingCheckOut = new Date(booking.checkOutDate);

      // 遍歷我們要查詢的日期範圍 (從入住日到退房前一天)
      let currentDate = new Date(startDate);
      while (currentDate < endDate) {
        const dateString = currentDate.toISOString().split('T')[0]; // 格式化為 YYYY-MM-DD

        // 判斷 currentDate 是否落在該筆訂單的住宿期間內
        if (currentDate >= bookingCheckIn && currentDate < bookingCheckOut) {
          occupiedCounts[dateString] = (occupiedCounts[dateString] || 0) + 1;
        }
        
        currentDate.setDate(currentDate.getDate() + 1); // 前進到下一天
      }
    }
  }

  // 5. 找出這段期間內，剩餘房間數最少的那一天
  let minAvailableCount = totalQuantity;
  let currentDate = new Date(startDate);
  while (currentDate < endDate) {
      const dateString = currentDate.toISOString().split('T')[0];
      const occupied = occupiedCounts[dateString] || 0;
      const available = totalQuantity - occupied;
      if (available < minAvailableCount) {
          minAvailableCount = available;
      }
      currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return {
    roomId: roomId,
    startDate: startDateStr,
    endDate: endDateStr,
    availableCount: minAvailableCount > 0 ? minAvailableCount : 0, // 確保回傳值不為負數
  };
}



async function syncGoogleSheetToKV(env) {
  console.log("Step 1: Starting sync process...");

  // 1. 取得 Google API 的存取令牌
  console.log("Step 2: Attempting to get Google Auth Token...");
  const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
  console.log("Step 3: Successfully got Google Auth Token.");

  // 2. 使用令牌從 Google Sheet API 讀取資料
  const sheetId = env.GOOGLE_SHEET_ID;
  const range = 'rooms!A2:G';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;

  console.log("Step 4: Attempting to fetch data from Google Sheets API...");
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });
  console.log(`Step 5: Received response from Google Sheets API. Status: ${response.status}`);

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Google Sheets API error: ${JSON.stringify(errorData)}`);
  }

  const sheetData = await response.json();
  const rows = sheetData.values || [];
  console.log(`Step 6: Successfully parsed sheet data. Found ${rows.length} rows.`);

  // 3. 將 Google Sheet 的原始資料轉換成乾淨的 JSON 物件陣列
  const rooms = rows.map(row => {
    return {
      id: row[0] || '',
      name: row[1] || '',
      description: row[2] || '',
      price: parseInt(row[3], 10) || 0,
      totalQuantity: parseInt(row[4], 10) || 0,
      imageUrl: row[5] || '',
      isActive: (row[6] || 'FALSE').toUpperCase() === 'TRUE',
    };
  }).filter(room => room.id && room.isActive);
  console.log(`Step 7: Processed and filtered data. ${rooms.length} rooms are active.`);

  // 4. 將整理好的資料存入 KV 中
  await env.ROOMS_KV.put('all_rooms', JSON.stringify(rooms));
  console.log("Step 8: Successfully wrote data to KV. Sync complete.");
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