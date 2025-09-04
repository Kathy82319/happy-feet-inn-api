import { SignJWT } from 'jose';

// --- 主路由器 ---
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // API 請求日誌
    console.log(`[Request] Method: ${method}, Path: ${pathname}`);

    // API 路由器
    if (pathname.startsWith('/api/')) {
      // CORS 預檢請求處理
      if (method === 'OPTIONS') {
        return handleCorsPreflight();
      }
 
      try {
        let response;
        // 根據路徑和方法，分派到不同的處理函式
        if (pathname === '/api/rooms' && method === 'GET') {
          response = await handleGetRooms(request, env);
        } else if (pathname === '/api/sync' && method === 'GET') {
          response = await handleSync(request, env);
        } else if (pathname === '/api/bookings' && method === 'POST') {
          response = await handleCreateBooking(request, env);
        } else if (pathname === '/api/availability' && method === 'GET') {
          response = await handleGetAvailability(request, env);
        } else {
          response = new Response(JSON.stringify({ error: 'API endpoint not found' }), { status: 404 });
        }
        
        // 為所有 API 回應加上 CORS 標頭
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        return new Response(response.body, {
          status: response.status,
          headers: newHeaders,
        });

      } catch (error) {
        console.error("[Error] Unhandled API error:", error.stack);
        return new Response(JSON.stringify({ error: 'An internal server error occurred.' }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    // 前端靜態檔案伺服器
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    console.log("[Cron] Scheduled sync triggered...");
    try {
      await syncAllSheetsToKV(env);
      console.log("[Cron] Scheduled sync completed successfully.");
    } catch (error) {
      console.error("[Cron] Scheduled sync failed:", error);
    }
  },
};

// --- API 處理函式 ---

async function handleGetRooms(request, env) {
  const roomsData = await env.ROOMS_KV.get('rooms_data', 'json');
  if (!roomsData) {
    return new Response(JSON.stringify({ error: 'Rooms data not found.' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify(roomsData), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function handleSync(request, env) {
  await syncAllSheetsToKV(env);
  return new Response("Manual sync completed successfully!", { status: 200 });
}

async function handleGetAvailability(request, env) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get('roomId');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  if (!roomId || !startDate || !endDate) {
    return new Response(JSON.stringify({ error: 'Missing required parameters' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const availability = await getAvailabilityForRoom(env, roomId, startDate, endDate);
  return new Response(JSON.stringify(availability), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function handleCreateBooking(request, env) {
  const bookingData = await request.json();
  if (!bookingData.roomId || !bookingData.checkInDate || !bookingData.guestName) {
    return new Response(JSON.stringify({ error: 'Missing required booking data.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const newBookingId = await writeBookingToSheet(env, bookingData);
  return new Response(JSON.stringify({ success: true, bookingId: newBookingId }), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

function handleCorsPreflight() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}


// --- 核心商業邏輯 ---

/**
 * 【v2.0 全新同步函式】
 * 一次性讀取所有營運相關的 Google Sheet 分頁，並存入 KV。
 */
/**
 * 【v2.0 全新同步函式 - 偵錯版】
 * 我們在每一步都加入了詳細的日誌，來追蹤執行過程。
 */
async function syncAllSheetsToKV(env) {
  console.log("[Sync Log] Step 1: Starting syncAllSheetsToKV function.");

  const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
  console.log("[Sync Log] Step 2: Successfully obtained Google Auth Token.");

  const sheetId = env.GOOGLE_SHEET_ID;
  const ranges = ['rooms!A2:H', 'inventory_calendar!A2:D', 'pricing_rules!A2:C'];
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?ranges=${ranges.join('&ranges=')}`;

  console.log("[Sync Log] Step 3: Fetching data from Google Sheets batch API.");
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Sync Log] Error: Failed to fetch from Google Sheets. Status: ${response.status}. Response: ${errorText}`);
    throw new Error('Failed to fetch from Google Sheets');
  }

  const data = await response.json();
  console.log("[Sync Log] Step 4: Successfully fetched and parsed data from Google Sheets.");

  const [roomsData, inventoryData, pricingData] = data.valueRanges;

  // 1. 處理房型資料
  try {
    console.log(`[Sync Log] Step 5.1: Processing rooms data. Found ${roomsData.values ? roomsData.values.length : 0} rows.`);
    const rooms = (roomsData.values || []).map(row => ({
      id: row[0], name: row[1], description: row[2], 
      price: parseInt(row[3], 10) || 0,
      weekendPrice: row[4] ? parseInt(row[4], 10) : null,
      totalQuantity: parseInt(row[5], 10) || 0,
      imageUrl: row[6], 
      isActive: (row[7] || 'FALSE').toUpperCase() === 'TRUE',
    })).filter(room => room.id && room.isActive);
    await env.ROOMS_KV.put('rooms_data', JSON.stringify(rooms));
    console.log(`[Sync Log] Step 5.2: Successfully wrote ${rooms.length} rooms to KV.`);
  } catch(e) {
    console.error("[Sync Log] Error processing ROOMS data:", e);
  }

  // 2. 處理庫存日曆
  try {
    console.log(`[Sync Log] Step 6.1: Processing inventory calendar. Found ${inventoryData.values ? inventoryData.values.length : 0} rows.`);
    const inventoryCalendar = {};
    (inventoryData.values || []).forEach(row => {
      const [date, roomId, inventory, close] = row;
      if (!date || !roomId) return; // 跳過不完整的行
      if (!inventoryCalendar[date]) inventoryCalendar[date] = {};
      inventoryCalendar[date][roomId] = {
        inventory: inventory ? parseInt(inventory, 10) : null,
        isClosed: (close || 'FALSE').toUpperCase() === 'TRUE',
      };
    });
    await env.ROOMS_KV.put('inventory_calendar', JSON.stringify(inventoryCalendar));
    console.log("[Sync Log] Step 6.2: Successfully wrote inventory calendar to KV.");
  } catch(e) {
    console.error("[Sync Log] Error processing INVENTORY CALENDAR data:", e);
  }

  // 3. 處理特殊定價
  try {
    console.log(`[Sync Log] Step 7.1: Processing pricing rules. Found ${pricingData.values ? pricingData.values.length : 0} rows.`);
    const pricingRules = {};
    (pricingData.values || []).forEach(row => {
      const [date, roomId, price] = row;
      if (!date || !roomId || !price) return; // 跳過不完整的行
      if (!pricingRules[date]) pricingRules[date] = {};
      pricingRules[date][roomId] = parseInt(price, 10);
    });
    await env.ROOMS_KV.put('pricing_rules', JSON.stringify(pricingRules));
    console.log("[Sync Log] Step 7.2: Successfully wrote pricing rules to KV.");
  } catch(e) {
    console.error("[Sync Log] Error processing PRICING RULES data:", e);
  }
}

/**
 * 【v2.0 全新空房查詢函式】
 * 整合了手動關房與庫存控制的邏輯。
 */
async function getAvailabilityForRoom(env, roomId, startDateStr, endDateStr) {
  // 1. 從 KV 讀取必要的營運資料
  const allRooms = await env.ROOMS_KV.get('rooms_data', 'json');
  const inventoryCalendar = await env.ROOMS_KV.get('inventory_calendar', 'json') || {};
  
  const targetRoom = allRooms.find(room => room.id === roomId);
  if (!targetRoom) return { error: 'Room not found', availableCount: 0 };
  
  // 2. 從 Google Sheet 讀取即時的訂單資料
  const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
  const sheetId = env.GOOGLE_SHEET_ID;
  const range = 'bookings!A2:K';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error('Failed to fetch bookings');
  const sheetData = await response.json();
  const bookings = (sheetData.values || []).map(row => ({
    roomId: row[4], checkInDate: row[5], checkOutDate: row[6], status: row[10]
  }));

  // 3. 核心演算法：計算每日剩餘數量
  let minAvailableCount = Infinity;
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  let currentDate = new Date(startDate);
  while (currentDate < endDate) {
    const dateString = currentDate.toISOString().split('T')[0];
    const dayOverrides = inventoryCalendar[dateString] ? inventoryCalendar[dateString][roomId] : null;

    // 優先權 1: 強制關房
    if (dayOverrides && dayOverrides.isClosed) {
      minAvailableCount = 0;
      break; 
    }

    // 優先權 2: 手動設定的庫存
    let dayTotalQuantity = targetRoom.totalQuantity;
    if (dayOverrides && dayOverrides.inventory !== null) {
      dayTotalQuantity = dayOverrides.inventory;
    }

    // 計算當日已預訂數量
    const occupiedCount = bookings.filter(b => {
      const checkIn = new Date(b.checkInDate);
      const checkOut = new Date(b.checkOutDate);
      return b.roomId === roomId && b.status !== 'CANCELLED' && currentDate >= checkIn && currentDate < checkOut;
    }).length;

    const available = dayTotalQuantity - occupiedCount;
    if (available < minAvailableCount) {
      minAvailableCount = available;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return {
    roomId, startDate: startDateStr, endDate: endDateStr,
    availableCount: Math.max(0, minAvailableCount === Infinity ? targetRoom.totalQuantity : minAvailableCount),
  };
}


/**
 * 【v2.0 全新寫入訂單函式】
 * 在寫入前，我們需要重新計算一次價格，並驗證空房，確保資料正確性。
 */
async function writeBookingToSheet(env, booking) {
  // 在寫入前，做最後一次空房驗證
  const availability = await getAvailabilityForRoom(env, booking.roomId, booking.checkInDate, booking.checkOutDate);
  if (availability.availableCount <= 0) {
    throw new Error('Sorry, the room is no longer available for the selected dates.');
  }

  // 價格由後端計算，不再相信前端傳來的值
  const finalPrice = await calculateTotalPrice(env, booking.roomId, booking.checkInDate, booking.checkOutDate);
  
  const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
  const sheetId = env.GOOGLE_SHEET_ID;
  const range = 'bookings!A:K';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
  const timestamp = new Date().toISOString();
  const bookingId = `HB-${Date.now()}`;
  
  const newRow = [
    bookingId, timestamp,
    booking.lineUserId || '', booking.lineDisplayName || '',
    booking.roomId, booking.checkInDate, booking.checkOutDate,
    booking.guestName, booking.guestPhone || '',
    finalPrice, // 使用後端計算的最終價格
    'PENDING_PAYMENT', // 預設狀態改為等待付款
  ];

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [newRow] }),
  });
  if (!response.ok) throw new Error('Failed to write booking to Google Sheets');
  return bookingId;
}


/**
 * 【v2.0 全新價格計算函式】
 * 由後端根據多層次規則計算總價。
 */
async function calculateTotalPrice(env, roomId, startDateStr, endDateStr) {
    const allRooms = await env.ROOMS_KV.get('rooms_data', 'json');
    const pricingRules = await env.ROOMS_KV.get('pricing_rules', 'json') || {};

    const targetRoom = allRooms.find(room => room.id === roomId);
    if (!targetRoom) throw new Error('Room not found for price calculation.');

    let totalPrice = 0;
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    let currentDate = new Date(startDate);
    while (currentDate < endDate) {
        const dateString = currentDate.toISOString().split('T')[0];
        const dayOfWeek = currentDate.getDay(); // 0=週日, 5=週五, 6=週六

        let dailyPrice = targetRoom.price; // 預設價格

        // 優先權 2: 週末價
        if (targetRoom.weekendPrice && (dayOfWeek === 5 || dayOfWeek === 6)) {
            dailyPrice = targetRoom.weekendPrice;
        }

        // 優先權 1: 特殊定價
        if (pricingRules[dateString] && pricingRules[dateString][roomId]) {
            dailyPrice = pricingRules[dateString][roomId];
        }

        totalPrice += dailyPrice;
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return totalPrice;
}


// 請找到檔案底部的輔助函式區塊，並用下面這兩個新版本替換它們

/**
 * 輔助函式：將 PEM 格式的金鑰字串，轉換為加密函式庫所需的 ArrayBuffer 格式
 * @param {string} pem - PEM 格式的金鑰字串
 * @returns {ArrayBuffer}
 */
function pemToArrayBuffer(pem) {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const binary_string = atob(b64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * 【偵錯版】輔助函式：使用服務帳號金鑰產生 Google API 的 Access Token
 * @param {string} serviceAccountKeyJson - 存在 Secret 中的服務帳號金鑰 (JSON 字串)
 * @returns {Promise<string>} - Google API 的存取令牌
 */
async function getGoogleAuthToken(serviceAccountKeyJson) {
  console.log("[Auth Log] Step A: Starting token generation.");

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountKeyJson);
    console.log(`[Auth Log] Step B: Successfully parsed service account JSON for email: ${serviceAccount.client_email}`);
  } catch (e) {
    console.error("[Auth Log] Error: Failed to parse GCP_SERVICE_ACCOUNT_KEY JSON.", e);
    throw new Error("Invalid GCP_SERVICE_ACCOUNT_KEY JSON format.");
  }

  const privateKeyBuffer = pemToArrayBuffer(serviceAccount.private_key);

  const jwt = await new SignJWT({
    // 【重要】確保這裡使用的是完整的讀寫權限
    scope: 'https://www.googleapis.com/auth/spreadsheets',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(serviceAccount.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(await crypto.subtle.importKey(
        "pkcs8",
        privateKeyBuffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    ));
  console.log("[Auth Log] Step C: Successfully created JWT.");

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokens = await response.json();

  if (!response.ok || !tokens.access_token) {
    console.error(`[Auth Log] Error: Failed to get access token from Google. Response: ${JSON.stringify(tokens)}`);
    throw new Error('Failed to get access token from Google.');
  }

  console.log("[Auth Log] Step D: Successfully received access token from Google.");
  // 為了安全，我們不在日誌中印出完整的 token，只確認它存在
  // console.log(`[Auth Log] Token: ${tokens.access_token.substring(0, 20)}...`);

  return tokens.access_token;
}