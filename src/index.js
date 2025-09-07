import { SignJWT } from 'jose';
import { v4 as uuidv4 } from 'uuid';

// =================================================================
// 輔助函式 (Helpers)
// =================================================================

function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

async function hmacSha256(message, secret) {
    const key = await crypto.subtle.importKey(
        'raw', (new TextEncoder()).encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false, ['sign']
    );
    const signature = await crypto.subtle.sign('HMAC', key, (new TextEncoder()).encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
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

// =================================================================
// Cloudflare Worker 主體 (Entry Point)
// =================================================================

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const pathname = url.pathname;
        const method = request.method;

        // --- Webhook 路由器 ---
        if (pathname === '/api/webhook-router' && method === 'POST') {
            const signature = request.headers.get('X-Line-Signature');
            if (signature) {
                console.log('[Router] Forwarding user message to Auto-Reply Bot...');
                if (!env.AUTO_REPLY_BOT_URL) {
                    console.error("[Router] AUTO_REPLY_BOT_URL is not set!");
                    return new Response("Router misconfigured: AUTO_REPLY_BOT_URL is missing.", { status: 500 });
                }
                // 將請求原封不動地轉發給您的自動回覆機器人
                return fetch(env.AUTO_REPLY_BOT_URL, request);
            } else {
                console.log('[Router] Received a non-user message, processing as payment webhook...');
                // 直接在內部呼叫處理付款的函式
                return handlePaymentWebhook(request, env);
            }
        }
        
        // --- API 路由 ---
        const LINE_PAY_API_URL = "https://sandbox-api-pay.line.me";
        
        console.log(`[Request] Method: ${method}, Path: ${pathname}`);

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
                else if (pathname === '/api/room-details' && method === 'GET') response = await handleGetRoomDetails(request, env);
                else if (pathname === '/api/payment/create' && method === 'POST') response = await handleCreatePayment(request, env, LINE_PAY_API_URL);
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
    }
};


// =================================================================
// API 處理函式 (Handlers)
// =================================================================

async function handleGetRoomDetails(request, env) {
    const url = new URL(request.url);
    const roomId = url.searchParams.get("roomId");
    if (!roomId) {
        return new Response(JSON.stringify({ error: "Missing roomId parameter" }), { status: 400 });
    }
    const roomsData = await env.ROOMS_KV.get("rooms_data", "json");
    if (!roomsData) {
        return new Response(JSON.stringify({ error: "Rooms data not found." }), { status: 404 });
    }
    const room = roomsData.find(r => r.id === roomId);
    if (!room) {
        return new Response(JSON.stringify({ error: `Room with id ${roomId} not found.` }), { status: 404 });
    }
    return new Response(JSON.stringify(room), { status: 200, headers: { "Content-Type": "application/json" } });
}

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

    const allBookings = await fetchAllBookings(env, true);
    const targetBooking = allBookings.find(b => b.bookingId === bookingId);

    if (!targetBooking) throw new Error("找不到此訂單。");
    if (targetBooking.lineUserId !== lineUserId) throw new Error("權限不足，無法取消不屬於您的訂單。");
    
    if (targetBooking.status === 'CONFIRMED') {
        throw new Error("此訂單已付款成功，如需取消或變更，請直接聯繫客服人員為您處理。");
    }
    if (targetBooking.status === 'CANCELLED') throw new Error("此訂單已經是取消狀態。");

    const diffDays = (new Date(targetBooking.checkInDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24);

    if (diffDays < 2) {
        throw new Error("訂房當日(或前一日)不可取消，若有問題請洽客服人員");
    }
    
    await updateBookingStatusInSheet(env, targetBooking.rowNumber, 'CANCELLED');
    
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
        return new Response(JSON.stringify({ error: "Missing required booking data." }), { status: 400 });
    }
    const result = await writeBookingToSheet(env, bookingData);
    return new Response(JSON.stringify(result), { status: 201, headers: { 'Content-Type': 'application/json' } });
}

// --- 金流 Webhook 處理 ---
async function handlePaymentWebhook(request, env) {
    const bodyText = await request.text();
    console.log('[Webhook] Received Raw Body:', bodyText);

    try {
        const data = JSON.parse(bodyText);
        if (data.returnCode === '0000' && data.info && data.info.transactions) {
            const transaction = data.info.transactions[0];
            const bookingId = transaction.orderId;
            const transactionId = transaction.transactionId;
            
            console.log(`[Webhook] Processing bookingId: ${bookingId}, transactionId: ${transactionId}`);
            
            const allBookings = await fetchAllBookings(env, true);
            const targetBooking = allBookings.find(b => b.bookingId === bookingId);

            if (targetBooking && targetBooking.status === 'PENDING_PAYMENT') {
                await updateBookingStatusInSheet(env, targetBooking.rowNumber, 'CONFIRMED', transactionId);
                await sendPaymentSuccessMessage(env, targetBooking);
                console.log(`[Webhook] Successfully confirmed bookingId: ${bookingId}`);
            } else {
                console.warn(`[Webhook] Booking not found, already processed, or in invalid state for bookingId: ${bookingId}`);
            }
        } else {
             console.warn('[Webhook] Received webhook is not a successful LINE Pay format.');
        }
    } catch(e) {
        console.error('[Webhook] Error parsing webhook body:', e.message);
    }
    return new Response(JSON.stringify({ success: true }), { status: 200 });
}

// --- 建立付款請求 ---
async function handleCreatePayment(request, env, LINE_PAY_API_URL) {
    const { bookingId } = await request.json();
    if (!bookingId) return new Response(JSON.stringify({ error: "Missing bookingId" }), { status: 400 });

    const allBookings = await fetchAllBookings(env);
    const booking = allBookings.find(b => b.bookingId === bookingId);
    if (!booking) return new Response(JSON.stringify({ error: "Booking not found" }), { status: 404 });

    const allRooms = await env.ROOMS_KV.get("rooms_data", "json") || [];
    const room = allRooms.find(r => r.id === booking.roomId);
    if (!room) return new Response(JSON.stringify({ error: "Room not found for this booking" }), { status: 404 });

    const requestBody = {
        amount: booking.totalPrice,
        currency: "TWD",
        orderId: booking.bookingId,
        packages: [{
            id: room.id,
            amount: booking.totalPrice,
            name: room.name,
            products: [{
                name: room.name,
                quantity: 1,
                price: booking.totalPrice,
                imageUrl: room.imageUrl || 'https://placehold.co/100x100?text=Room'
            }]
        }],
        redirectUrls: {
            confirmUrl: `https://${new URL(request.url).hostname}/payment-result.html`,
            cancelUrl: `https://${new URL(request.url).hostname}/payment-result.html`
        }
    };
    
    const nonce = uuidv4();
    const requestUri = "/v3/payments/request";
    const signatureText = env.LINE_PAY_CHANNEL_SECRET + requestUri + JSON.stringify(requestBody) + nonce;
    const signature = await hmacSha256(signatureText, env.LINE_PAY_CHANNEL_SECRET);

    const headers = {
        'Content-Type': 'application/json',
        'X-LINE-ChannelId': env.LINE_PAY_CHANNEL_ID,
        'X-LINE-Authorization-Nonce': nonce,
        'X-LINE-Authorization': signature
    };

    const response = await fetch(`${LINE_PAY_API_URL}${requestUri}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (data.returnCode === '0000') {
        const paymentUrl = data.info.paymentUrl.web;
        return new Response(JSON.stringify({ paymentUrl }), { status: 200 });
    } else {
        console.error("LINE Pay Request API Error:", data.returnMessage);
        return new Response(JSON.stringify({ error: `LINE Pay Error: ${data.returnMessage}` }), { status: 500 });
    }
}


// =================================================================
// Google Sheets 與 LINE API 互動函式 (Interactions)
// =================================================================

async function sendPaymentSuccessMessage(env, bookingDetails) {
    if (!bookingDetails.lineUserId) {
        console.error("Cannot send push message: lineUserId is missing.");
        return;
    }
    const allRooms = await env.ROOMS_KV.get("rooms_data", "json") || [];
    const room = allRooms.find(r => r.id === bookingDetails.roomId);

    if (!room) {
        console.error(`Cannot send push message: Room with id ${bookingDetails.roomId} not found.`);
        return;
    }

    const nights = (new Date(bookingDetails.checkOutDate) - new Date(bookingDetails.checkInDate)) / (1000 * 60 * 60 * 24);

    const flexMessage = {
        type: "bubble",
        header: {
            type: "box",
            layout: "vertical",
            contents: [
                { type: "text", text: "付款成功通知", weight: "bold", color: "#1DB446", size: "sm" },
                { type: "text", text: "快樂腳旅棧", weight: "bold", size: "xxl", margin: "md" },
                { type: "text", text: `訂單編號： ${bookingDetails.bookingId}`, size: "xs", color: "#aaaaaa", wrap: true }
            ]
        },
        hero: {
            type: "image",
            url: room.imageUrl || 'https://placehold.co/1024x512?text=Payment+Confirmed',
            size: "full",
            aspectRatio: "20:13",
            aspectMode: "cover"
        },
        body: {
            type: "box",
            layout: "vertical",
            contents: [{
                type: "box",
                layout: "vertical",
                margin: "lg",
                spacing: "sm",
                contents: [
                    { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [
                        { "type": "text", "text": "房型", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                        { "type": "text", "text": room.name, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
                    ]},
                    { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [
                        { "type": "text", "text": "訂房大名", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                        { "type": "text", "text": bookingDetails.guestName, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
                    ]},
                    { "type": "separator", "margin": "lg" },
                    { "type": "box", "layout": "baseline", "spacing": "sm", "margin": "lg", "contents": [
                        { "type": "text", "text": "入住", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                        { "type": "text", "text": bookingDetails.checkInDate, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
                    ]},
                    { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [
                        { "type": "text", "text": "退房", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                        { "type": "text", "text": `${bookingDetails.checkOutDate} (${nights}晚)`, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
                    ]},
                    { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [
                        { "type": "text", "text": "已付金額", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                        { "type": "text", "text": `NT$ ${bookingDetails.totalPrice.toLocaleString()}`, "wrap": true, "color": "#1DB446", "size": "sm", "flex": 5, "weight": "bold" }
                    ]}
                ]
            }]
        },
        footer: {
            type: "box",
            layout: "vertical",
            spacing: "sm",
            contents: [
                { "type": "button", "style": "link", "height": "sm", "action": {
                    "type": "uri",
                    "label": "查看我的所有訂單",
                    "uri": `https://liff.line.me/${env.LIFF_ID}/my-bookings.html`
                }},
                { "type": "box", "layout": "vertical", "contents": [], "margin": "sm" }
            ],
            flex: 0
        }
    };

    const apiRequestBody = {
        to: bookingDetails.lineUserId,
        messages: [{
            type: 'flex',
            altText: `您的訂單 ${bookingDetails.bookingId} 已付款成功！`,
            contents: flexMessage
        }]
    };
    
    const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.LINE_MESSAGING_CHANNEL_TOKEN}`
        },
        body: JSON.stringify(apiRequestBody)
    });

    if (!response.ok) {
        const errorBody = await response.json();
        console.error("Failed to send Push Message:", response.status, JSON.stringify(errorBody));
    } else {
        console.log(`Successfully sent payment confirmation to ${bookingDetails.lineUserId}`);
    }
}

async function writeBookingToSheet(env, booking) {
    const availability = await getAvailabilityForRoom(env, booking.roomId, booking.checkInDate, booking.checkOutDate);
    if (availability.availableCount <= 0) {
        throw new Error("抱歉，您選擇的日期已無空房。");
    }

    const accessToken = await getGoogleAuthToken(env);
    const sheetId = env.GOOGLE_SHEET_ID;
    const range = "bookings!A:L";
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}:append?valueInputOption=USER_ENTERED`;
    const timestamp = new Date().toISOString();
    const bookingId = `HB-${Date.now()}`;
    const newRow = [ bookingId, timestamp, booking.lineUserId || "", booking.lineDisplayName || "", booking.roomId, booking.checkInDate, booking.checkOutDate, booking.guestName, booking.guestPhone || "", booking.totalPrice, "PENDING_PAYMENT", "" ];
    
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ values: [newRow] }), });
    if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to write booking to Google Sheets:", errorText);
        throw new Error("寫入訂單至 Google Sheets 失敗");
    }
    
    return { bookingId: bookingId };
}

async function updateBookingStatusInSheet(env, rowNumber, status, transactionId = null) {
    const accessToken = await getGoogleAuthToken(env);
    const sheetId = env.GOOGLE_SHEET_ID;
    
    const updates = [{
        range: `bookings!K${rowNumber}`,
        values: [[status]]
    }];

    if (transactionId) {
        updates.push({
            range: `bookings!L${rowNumber}`,
            values: [[transactionId]]
        });
    }

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchUpdate`;
    
    const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            valueInputOption: "USER_ENTERED",
            data: updates
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to update booking status in Google Sheets:", errorText);
        throw new Error("更新訂單狀態失敗。");
    }
}

async function fetchAllBookings(env, includeRowNumber = false) {
    const accessToken = await getGoogleAuthToken(env);
    const sheetId = env.GOOGLE_SHEET_ID;
    const range = "bookings!A2:L";
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw new Error("Failed to fetch bookings from Google Sheet");
    const sheetData = await response.json();
    return (sheetData.values || []).map((row, index) => {
        const booking = {
            bookingId: row[0],
            timestamp: row[1],
            lineUserId: row[2],
            guestName: row[7], // 為了發送通知，我們需要 guestName
            roomId: row[4],
            checkInDate: row[5],
            checkOutDate: row[6],
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
    const accessToken = await getGoogleAuthToken(env);
    const sheetId = env.GOOGLE_SHEET_ID;
    const ranges = ["rooms!A2:L", "inventory_calendar!A2:D", "pricing_rules!A2:C"];
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?ranges=${ranges.join("&ranges=")}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) { const errorText = await response.text(); console.error(`[Sync Error] ${errorText}`); throw new Error("Sync failed"); }
    const data = await response.json();
    const [roomsRange, inventoryRange, pricingRange] = data.valueRanges;

    const rooms = (roomsRange.values || []).map(r => ({ 
        id: r[0], name: r[1], description: r[2], 
        price: parseInt(r[3], 10) || 0, 
        fridayPrice: r[4] ? parseInt(r[4], 10) : null, 
        saturdayPrice: r[5] ? parseInt(r[5], 10) : null, 
        totalQuantity: parseInt(r[6], 10) || 0, 
        imageUrl: r[7], 
        isActive: (r[8] || "FALSE").toUpperCase() === "TRUE",
        imageUrl_2: r[9] || null,
        imageUrl_3: r[10] || null,
        detailedDescription: r[11] || '',
    })).filter(r => r.id && r.isActive);
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
  for (let d = startDate; d < endDate; d.setDate(d.getDate() + 1)) {
    const dateString = formatDate(new Date(d));
    const dayOverrides = inventoryCalendar[dateString]?.[roomId];
    if (dayOverrides?.isClosed) {
      minAvailableCount = 0;
      break; 
    }
    let dayTotalQuantity = dayOverrides?.inventory ?? targetRoom.totalQuantity;
    const occupiedCount = bookings.filter(b => b.roomId === roomId && b.status !== 'CANCELLED' && new Date(b.checkInDate) <= d && d < new Date(b.checkOutDate)).length;
    const available = dayTotalQuantity - occupiedCount;
    minAvailableCount = Math.min(minAvailableCount, available);
  }
  return {
    roomId, startDate: startDateStr, endDate: endDateStr,
    availableCount: Math.max(0, minAvailableCount === Infinity ? targetRoom.totalQuantity : minAvailableCount),
  };
}

async function calculateTotalPrice(env, roomId, startDateStr, endDateStr) {
    const allRooms = await env.ROOMS_KV.get("rooms_data", "json");
    const pricingRules = await env.ROOMS_KV.get("pricing_rules", "json") || {};
    const targetRoom = allRooms.find(room => room.id === roomId);
    if (!targetRoom) throw new Error("Room not found for price calculation.");
    let totalPrice = 0;
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);
    for (let d = startDate; d < endDate; d.setDate(d.getDate() + 1)) {
        const dateString = formatDate(new Date(d));
        const dayOfWeek = d.getDay();
        let dailyPrice = pricingRules[dateString]?.[roomId] ?? (dayOfWeek === 5 && targetRoom.fridayPrice ? targetRoom.fridayPrice : (dayOfWeek === 6 && targetRoom.saturdayPrice ? targetRoom.saturdayPrice : targetRoom.price));
        totalPrice += dailyPrice;
    }
    return totalPrice;
}

// --- Google 驗證 ---
async function getGoogleAuthToken(env) {
    if (!env.GCP_SERVICE_ACCOUNT_KEY) throw new Error("GCP_SERVICE_ACCOUNT_KEY is not available.");
    const serviceAccount = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
    const privateKeyBuffer = pemToArrayBuffer(serviceAccount.private_key);
    const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(serviceAccount.client_email)
        .setAudience("https://oauth2.googleapis.com/token")
        .setExpirationTime("1h")
        .setIssuedAt()
        .sign(await crypto.subtle.importKey("pkcs8", privateKeyBuffer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]));
    const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    });
    const tokens = await response.json();
    if (!tokens.access_token) {
        throw new Error(`Failed to get access token: ${JSON.stringify(tokens)}`);
    }
    return tokens.access_token;
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