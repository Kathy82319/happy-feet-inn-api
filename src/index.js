import { SignJWT } from 'jose';

// 輔助函式：將 Date 物件格式化為 "YYYY-MM-DD" 字串
function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// --- 主路由器 ---
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method;

        if (pathname.startsWith('/api/')) {
            if (method === 'OPTIONS') return handleCorsPreflight();
            try {
                let response;
                if (pathname === '/api/rooms' && method === 'GET') response = await handleGetRooms(request, env);
                else if (pathname === '/api/sync' && method === 'GET') response = await handleSync(request, env);
                else if (pathname === '/api/bookings' && method === 'POST') response = await handleCreateBooking(request, env);
                else if (pathname === '/api/availability' && method === 'GET') response = await handleGetAvailability(request, env);
                else if (pathname === '/api/calculate-price' && method === 'GET') response = await handleCalculatePrice(request, env);
                else if (pathname === '/api/my-bookings' && method === 'GET') response = await handleGetMyBookings(request, env);
                else if (pathname === '/api/bookings/cancel' && method === 'POST') response = await handleCancelBooking(request, env);
                else response = new Response(JSON.stringify({ error: 'API endpoint not found' }), { status: 404 });

                const newHeaders = new Headers(response.headers);
                newHeaders.set('Access-Control-Allow-Origin', '*');
                return new Response(response.body, { status: response.status, headers: newHeaders });
            } catch (error) {
                console.error(`[Error] Unhandled API error on ${method} ${pathname}:`, error.stack);
                return new Response(JSON.stringify({ error: error.message || 'An internal server error occurred.' }), { 
                    status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
        }
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


// --- API 處理函式 (以下所有函式都無需修改，保持原樣即可) ---
async function handleGetMyBookings(request, env) {
    const url = new URL(request.url);
    const lineUserId = url.searchParams.get("lineUserId");
    if (!lineUserId) {
        return new Response(JSON.stringify({ error: "Missing lineUserId" }), { status: 400 });
    }
    const allBookings = await fetchAllBookings(env);
    const myBookings = allBookings.filter(b => b.lineUserId === lineUserId);
    return new Response(JSON.stringify(myBookings), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleCancelBooking(request, env) {
    const { bookingId, lineUserId } = await request.json();
    if (!bookingId || !lineUserId) {
        return new Response(JSON.stringify({ error: "Missing bookingId or lineUserId" }), { status: 400 });
    }
    await cancelBookingInSheet(env, bookingId, lineUserId);
    return new Response(JSON.stringify({ success: true, message: "Booking cancelled successfully" }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleCalculatePrice(request, env) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    if (!roomId || !startDate || !endDate) {
        return new Response(JSON.stringify({ error: "Missing required parameters for price calculation" }), { status: 400 });
    }
    const totalPrice = await calculateTotalPrice(env, roomId, startDate, endDate);
    return new Response(JSON.stringify({ totalPrice }), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleGetRooms(request, env) {
    const roomsData = await env.ROOMS_KV.get("rooms_data", "json");
    if (!roomsData) {
        return new Response(JSON.stringify({ error: "Rooms data not found." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify(roomsData), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleSync(request, env) {
    await syncAllSheetsToKV(env);
    return new Response("Manual sync completed successfully!", { status: 200 });
}

async function handleGetAvailability(request, env) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId");
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    if (!roomId || !startDate || !endDate) {
        return new Response(JSON.stringify({ error: "Missing required parameters" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const availability = await getAvailabilityForRoom(env, roomId, startDate, endDate);
    return new Response(JSON.stringify(availability), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function handleCreateBooking(request, env) {
    const bookingData = await request.json();
    if (!bookingData.roomId || !bookingData.checkInDate || !bookingData.guestName) {
        return new Response(JSON.stringify({ error: "Missing required booking data." }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const newBookingId = await writeBookingToSheet(env, bookingData);
    return new Response(JSON.stringify({ success: true, bookingId: newBookingId }), { status: 201, headers: { "Content-Type": "application/json" } });
}

function handleCorsPreflight() {
    return new Response(null, {
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}


// --- 核心商業邏輯 (以下函式都無需修改) ---
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

    if (diffDays < 2) {
        throw new Error("訂房當日(或前一日)不可取消，若有問題請洽客服人員");
    }

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
            bookingId: row[0],
            timestamp: row[1],
            lineUserId: row[2],
            roomId: row[4],
            checkInDate: row[5],
            checkOutDate: row[6],
            guestName: row[7],
            totalPrice: parseInt(row[9], 10) || 0,
            status: row[10]
        };
        if (includeRowNumber) {
            booking.rowNumber = index + 2;
        }
        return booking;
    });
}

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
    await env.ROOMS_KV.put("rooms_data", JSON.stringify(rooms));

    const inventoryCalendar = {};
    (inventoryRange.values || []).forEach(r => { const [date, roomId, inventory, close] = r; if (!date || !roomId) return; if (!inventoryCalendar[date]) inventoryCalendar[date] = {}; inventoryCalendar[date][roomId] = { inventory: inventory ? parseInt(inventory, 10) : null, isClosed: (close || "FALSE").toUpperCase() === "TRUE" }; });
    await env.ROOMS_KV.put("inventory_calendar", JSON.stringify(inventoryCalendar));

    const pricingRules = {};
    (pricingRange.values || []).forEach(r => { const [date, roomId, price] = r; if (!date || !roomId || !price) return; if (!pricingRules[date]) pricingRules[date] = {}; pricingRules[date][roomId] = parseInt(price, 10); });
    await env.ROOMS_KV.put("pricing_rules", JSON.stringify(pricingRules));
}


async function getAvailabilityForRoom(env, roomId, startDateStr, endDateStr) {
  const allRooms = await env.ROOMS_KV.get('rooms_data', 'json');
  const inventoryCalendar = await env.ROOMS_KV.get('inventory_calendar', 'json') || {};
  const targetRoom = allRooms.find(room => room.id === roomId);
  if (!targetRoom) {
    return { error: 'Room not found', availableCount: 0 };
  }
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
    if (dayOverrides && dayOverrides.inventory !== null && dayOverrides.inventory !== undefined) {
      dayTotalQuantity = dayOverrides.inventory;
    }
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
  const finalCount = Math.max(0, minAvailableCount === Infinity ? targetRoom.totalQuantity : minAvailableCount);
  return {
    roomId, startDate: startDateStr, endDate: endDateStr,
    availableCount: finalCount,
  };
}

async function writeBookingToSheet(env, booking) {
    const availability = await getAvailabilityForRoom(env, booking.roomId, booking.checkInDate, booking.checkOutDate);
    if (availability.availableCount <= 0) {
        throw new Error("Sorry, the room is no longer available for the selected dates.");
    }
    const accessToken = await getGoogleAuthToken(env.GCP_SERVICE_ACCOUNT_KEY);
    const sheetId = env.GOOGLE_SHEET_ID;
    const range = "bookings!A:K";
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
    const timestamp = new Date().toISOString();
    const bookingId = `HB-${Date.now()}`;
    const newRow = [
        bookingId, timestamp,
        booking.lineUserId || "", booking.lineDisplayName || "",
        booking.roomId, booking.checkInDate, booking.checkOutDate,
        booking.guestName, booking.guestPhone || "",
        booking.totalPrice,
        "PENDING_PAYMENT",
    ];
    const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ values: [newRow] }),
    });
    if (!response.ok) throw new Error("Failed to write booking to Google Sheets");
    return bookingId;
}

async function calculateTotalPrice(env, roomId, startDateStr, endDateStr) {
    const allRooms = await env.ROOMS_KV.get("rooms_data", "json");
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
        if (dayOfWeek === 5 && targetRoom.fridayPrice) {
            dailyPrice = targetRoom.fridayPrice;
        } else if (dayOfWeek === 6 && targetRoom.saturdayPrice) {
            dailyPrice = targetRoom.saturdayPrice;
        }
        if (pricingRules[dateString] && pricingRules[dateString][roomId]) {
            dailyPrice = pricingRules[dateString][roomId];
        }
        totalPrice += dailyPrice;
        currentDate.setDate(currentDate.getDate() + 1);
    }
    return totalPrice;
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

// --- 【v3.5 關鍵修正】移除 .setSubject() ---
async function getGoogleAuthToken(serviceAccountKeyJson) {
    if (!serviceAccountKeyJson) throw new Error("GCP_SERVICE_ACCOUNT_KEY is not available.");
    
    const serviceAccount = JSON.parse(serviceAccountKeyJson);
    const privateKeyBuffer = pemToArrayBuffer(serviceAccount.private_key);

    const privateKey = await crypto.subtle.importKey(
        "pkcs8",
        privateKeyBuffer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        true,
        ["sign"]
    );

    const jwt = await new SignJWT({
            scope: "https://www.googleapis.com/auth/spreadsheets"
        })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(serviceAccount.client_email)
        .setAudience("https://oauth2.googleapis.com/token")
        // .setSubject(serviceAccount.client_email) // 移除這一行
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(privateKey);

    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type-jwt-bearer",
            assertion: jwt,
        }),
    });

    const tokens = await response.json();
    if (!tokens.access_token) {
        console.error("Token exchange failed:", tokens);
        throw new Error("Failed to get access token from Google.");
    }

    return tokens.access_token;
}