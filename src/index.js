import { Hono } from 'hono';
import { serveStatic } from 'hono/cloudflare-pages';

const staticContent = serveStatic({
  root: './public',
  notFound: (path, c) => {
    return c.notFound();
  },
});

// --- 輔助函式與 Google 認證邏輯 ---

// --- 輔助函式與 Google 認證邏輯 (已驗證版本) ---
function base64url(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

// 字串轉 ArrayBuffer
function str2ab(str) {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
    }
    return buf;
}

function pemToArrayBuffer(pem) {
    const b64 = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "").replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
    const binary_string = atob(b64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// --- 使用原生 crypto API 的 Google 認證函式 ---
async function getGoogleAuthToken(serviceAccountKeyJson) {
    if (!serviceAccountKeyJson) throw new Error("GCP_SERVICE_ACCOUNT_KEY is not available.");
    const serviceAccount = JSON.parse(serviceAccountKeyJson);
    const privateKeyBuffer = pemToArrayBuffer(serviceAccount.private_key);
    const privateKey = await crypto.subtle.importKey("pkcs8", privateKeyBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["sign"]);
    const header = { alg: "RS256", typ: "JWT" };
    const now = Math.floor(Date.now() / 1000);
    const payload = { iss: serviceAccount.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };
    const encodedHeader = base64url(str2ab(JSON.stringify(header)));
    const encodedPayload = base64url(str2ab(JSON.stringify(payload)));
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const signatureBuffer = await crypto.subtle.sign({ name: "RSASSA-PKCS1-v1_5" }, privateKey, str2ab(signatureInput));
    const encodedSignature = base64url(signatureBuffer);
    const jwt = `${signatureInput}.${encodedSignature}`;
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type-jwt-bearer", assertion: jwt }),
    });
    const tokens = await response.json();
    if (!tokens.access_token) {
        console.error("Token exchange failed:", tokens);
        throw new Error("Failed to get access token from Google.");
    }
    return tokens.access_token;
}

function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}


// --- 核心商業邏輯 ---
async function syncAllSheetsToKV(env) {
    const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
    const sheetId = env.GOOGLE_SHEET_ID;
    const ranges = ["rooms!A2:I", "inventory_calendar!A2:D", "pricing_rules!A2:C"];
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?ranges=${ranges.join("&ranges=")}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) { const errorText = await response.text(); console.error(`[Sync Error] ${errorText}`); throw new Error("Sync failed"); }
    const data = await response.json();
    const [roomsRange, inventoryRange, pricingRange] = data.valueRanges;
    const rooms = (roomsRange.values || []).map(r => ({ id: r[0], name: r[1], description: r[2], price: parseInt(r[3], 10) || 0, fridayPrice: r[4] ? parseInt(r[4], 10) : null, saturdayPrice: r[5] ? parseInt(r[5], 10) : null, totalQuantity: parseInt(r[6], 10) || 0, imageUrl: r[7], isActive: (r[8] || "FALSE").toUpperCase() === "TRUE" })).filter(r => r.id && r.isActive);
    let roomsJsonString = JSON.stringify(rooms);
    if (roomsJsonString.charCodeAt(0) === 0xFEFF) {
        roomsJsonString = roomsJsonString.substring(1);
    }
    await env.ROOMS_KV.put("rooms_data", roomsJsonString);
    const inventoryCalendar = {};
    (inventoryRange.values || []).forEach(r => { const [date, roomId, inventory, close] = r; if (!date || !roomId) return; if (!inventoryCalendar[date]) inventoryCalendar[date] = {}; inventoryCalendar[date][roomId] = { inventory: inventory ? parseInt(inventory, 10) : null, isClosed: (close || "FALSE").toUpperCase() === "TRUE" }; });
    await env.ROOMS_KV.put("inventory_calendar", JSON.stringify(inventoryCalendar));
    const pricingRules = {};
    (pricingRange.values || []).forEach(r => { const [date, roomId, price] = r; if (!date || !roomId || !price) return; if (!pricingRules[date]) pricingRules[date] = {}; pricingRules[date][roomId] = parseInt(price, 10); });
    await env.ROOMS_KV.put("pricing_rules", JSON.stringify(pricingRules));
}

async function fetchAllBookings(env, includeRowNumber = false) {
    const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
    const sheetId = env.GOOGLE_SHEET_ID;
    const range = "bookings!A2:K";
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error("Failed to fetch bookings from Google Sheet");
    const sheetData = await response.json();
    return (sheetData.values || []).map((row, index) => {
        const booking = {
            bookingId: row[0], timestamp: row[1], lineUserId: row[2], roomId: row[4],
            checkInDate: row[5], checkOutDate: row[6], guestName: row[7],
            totalPrice: parseInt(row[9], 10) || 0, status: row[10]
        };
        if (includeRowNumber) booking.rowNumber = index + 2;
        return booking;
    });
}

async function getAvailabilityForRoom(env, roomId, startDateStr, endDateStr) {
  const allRoomsData = await env.ROOMS_KV.get("rooms_data", "json");
  if (!allRoomsData) throw new Error("Room data is not available in KV.");
  const allRooms = Array.isArray(allRoomsData) ? allRoomsData : JSON.parse(allRoomsData);
  
  const inventoryCalendar = await env.ROOMS_KV.get('inventory_calendar', 'json') || {};
  const targetRoom = allRooms.find(room => room.id === roomId);
  if (!targetRoom) return { error: 'Room not found', availableCount: 0 };
  
  const bookings = await fetchAllBookings(env);
  let minAvailableCount = Infinity;
  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);
  let currentDate = new Date(startDate);
  while (currentDate < endDate) {
    const dateString = formatDate(currentDate);
    const dayOverrides = inventoryCalendar[dateString] ? inventoryCalendar[dateString][roomId] : null;
    if (dayOverrides && dayOverrides.isClosed === true) {
      minAvailableCount = 0;
      break; 
    }
    let dayTotalQuantity = targetRoom.totalQuantity;
    if (dayOverrides && dayOverrides.inventory !== null && dayOverrides.inventory !== undefined) dayTotalQuantity = dayOverrides.inventory;
    const occupiedCount = bookings.filter(b => {
      const checkIn = new Date(b.checkInDate);
      const checkOut = new Date(b.checkOutDate);
      return b.roomId === roomId && b.status !== 'CANCELLED' && currentDate >= checkIn && currentDate < checkOut;
    }).length;
    const available = dayTotalQuantity - occupiedCount;
    if (available < minAvailableCount) minAvailableCount = available;
    currentDate.setDate(currentDate.getDate() + 1);
  }
  const finalCount = Math.max(0, minAvailableCount === Infinity ? targetRoom.totalQuantity : minAvailableCount);
  return { roomId, startDate: startDateStr, endDate: endDateStr, availableCount: finalCount };
}

async function calculateTotalPrice(env, roomId, startDateStr, endDateStr) {
    const allRoomsData = await env.ROOMS_KV.get("rooms_data", "json");
    if (!allRoomsData) throw new Error("Room data is not available in KV.");
    const allRooms = Array.isArray(allRoomsData) ? allRoomsData : JSON.parse(allRoomsData);

    const pricingRules = await env.ROOMS_KV.get("pricing_rules", "json") || {};
    const targetRoom = allRooms.find(room => room.id === roomId);
    if (!targetRoom) throw new Error("Room not found for price calculation.");
    let totalPrice = 0;
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    let currentDate = new Date(startDate);
    while (currentDate < endDate) {
        const dateString = formatDate(currentDate);
        const dayOfWeek = currentDate.getDay();
        let dailyPrice = targetRoom.price;
        if (dayOfWeek === 5 && targetRoom.fridayPrice) dailyPrice = targetRoom.fridayPrice;
        else if (dayOfWeek === 6 && targetRoom.saturdayPrice) dailyPrice = targetRoom.saturdayPrice;
        if (pricingRules[dateString] && pricingRules[dateString][roomId]) dailyPrice = pricingRules[dateString][roomId];
        totalPrice += dailyPrice;
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return totalPrice;
}

async function writeBookingToSheet(env, booking) {
    const availability = await getAvailabilityForRoom(env, booking.roomId, booking.checkInDate, booking.checkOutDate);
    if (availability.availableCount <= 0) throw new Error("Sorry, the room is no longer available for the selected dates.");
    const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
    const sheetId = env.GOOGLE_SHEET_ID;
    const range = "bookings!A:K";
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
    const timestamp = new Date().toISOString();
    const bookingId = `HB-${Date.now()}`;
    const newRow = [
        bookingId, timestamp, booking.lineUserId || "", booking.lineDisplayName || "",
        booking.roomId, booking.checkInDate, booking.checkOutDate,
        booking.guestName, booking.guestPhone || "", booking.totalPrice, "PENDING_PAYMENT",
    ];
    const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [newRow] }),
    });
    if (!response.ok) throw new Error("Failed to write booking to Google Sheets");
    return bookingId;
}

async function cancelBookingInSheet(env, bookingId, lineUserId) {
    const allBookings = await fetchAllBookings(env, true);
    const targetBooking = allBookings.find(b => b.bookingId === bookingId);
    if (!targetBooking) throw new Error("找不到此訂單。");
    if (targetBooking.lineUserId !== lineUserId) throw new Error("權限不足，無法取消不屬於您的訂單。");
    if (targetBooking.status === 'CANCELLED') throw new Error("此訂單已經是取消狀態。");
    const checkInDate = new Date(targetBooking.checkInDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffTime = checkInDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays < 2) throw new Error("訂房當日(或前一日)不可取消，若有問題請洽客服人員");
    const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
    const sheetId = env.GOOGLE_SHEET_ID;
    const range = `bookings!K${targetBooking.rowNumber}`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=USER_ENTERED`;
    const response = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [['CANCELLED']] }),
    });
    if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to update booking status in Google Sheets:", errorText);
        throw new Error("更新訂單狀態失敗。");
    }
}


// --- Hono 路由設定 ---
const app = new Hono();

// --- API 路由 ---
// 所有 /api/ 开头的请求都会由这个子路由器处理
const api = new Hono();
api.get('/rooms', async (c) => {
    try {
        let roomsDataString = await c.env.ROOMS_KV.get("rooms_data");
        if (!roomsDataString) return c.json({ error: "KV value for rooms_data is null." }, 500);
        if (roomsDataString.charCodeAt(0) === 0xFEFF) roomsDataString = roomsDataString.substring(1);
        return c.json(JSON.parse(roomsDataString));
    } catch (e) {
        return c.json({ error: "Failed to get or parse rooms_data from KV.", details: e.message }, 500);
    }
});
api.get('/sync', async (c) => {
    try {
        await syncAllSheetsToKV(c.env);
        return c.json({ success: true, message: "Manual sync completed successfully!" });
    } catch (e) {
        console.error("Error during sync:", e);
        return c.json({ error: e.message }, 500);
    }
});
api.get('/my-bookings', async (c) => {
    const { lineUserId } = c.req.query();
    if (!lineUserId) return c.json({ error: "Missing lineUserId" }, 400);
    const allBookings = await fetchAllBookings(c.env);
    const myBookings = allBookings.filter(b => b.lineUserId === lineUserId);
    return c.json(myBookings);
});
api.get('/availability', async (c) => {
    const { roomId, startDate, endDate } = c.req.query();
    if (!roomId || !startDate || !endDate) return c.json({ error: "Missing required parameters" }, 400);
    const availability = await getAvailabilityForRoom(c.env, roomId, startDate, endDate);
    return c.json(availability);
});
api.get('/calculate-price', async (c) => {
    const { roomId, startDate, endDate } = c.req.query();
    if (!roomId || !startDate || !endDate) return c.json({ error: "Missing required parameters" }, 400);
    const totalPrice = await calculateTotalPrice(c.env, roomId, startDate, endDate);
    return c.json({ totalPrice });
});
api.post('/bookings', async (c) => {
    const bookingData = await c.req.json();
    if (!bookingData.roomId || !bookingData.checkInDate || !bookingData.guestName) {
        return c.json({ error: "Missing required booking data." }, 400);
    }
    const newBookingId = await writeBookingToSheet(c.env, bookingData);
    return c.json({ success: true, bookingId: newBookingId }, 201);
});
api.post('/bookings/cancel', async (c) => {
    const { bookingId, lineUserId } = await c.req.json();
    if (!bookingId || !lineUserId) return c.json({ error: "Missing bookingId or lineUserId" }, 400);
    await cancelBookingInSheet(c.env, bookingId, lineUserId);
    return c.json({ success: true, message: "Booking cancelled successfully" });
});

// 【最終關鍵修正】將 API 路由掛載到主程式的 /api 路徑下
app.route('/api', api);

// 【最終關鍵修正】處理所有其他請求，將它們視為對 public 資料夾內靜態檔案的請求
app.get('*', serveStatic({ root: './public' }));

// --- Cloudflare Pages 的進入點 ---
export default app;