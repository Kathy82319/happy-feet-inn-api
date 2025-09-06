// 輔助函式：將 Date 物件格式化為 "YYYY-MM-DD" 字串
function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

document.addEventListener('DOMContentLoaded', () => {
    const LIFF_ID = "2008032417-DPqYdL7p"; 
    const API_BASE_URL = "https://happy-feet-inn-api.pages.dev";

    let lineProfile = {}, selectedRoom = {}, datepicker, finalTotalPrice = 0;
    let selectedDates = []; 
    
    const loadingSpinner = document.getElementById('loading-spinner');
    const userProfileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    const userPictureImg = document.getElementById('user-picture');
    const mainContent = document.getElementById('main-content');
    const roomListDiv = document.getElementById('room-list');
    const bookingModal = document.getElementById('booking-modal');
    const modalRoomName = document.getElementById('modal-room-name');
    const dateRangePickerEl = document.getElementById('date-range-picker');
    const availabilityResultEl = document.getElementById('availability-result');
    const priceCalculationEl = document.getElementById('price-calculation');
    const guestNameInput = document.getElementById('guest-name');
    const guestPhoneInput = document.getElementById('guest-phone');
    const submitBookingButton = document.getElementById('submit-booking-button');
    const bookingErrorEl = document.getElementById('booking-error');
    const closeButton = document.querySelector('.close-button');

    

    function main() {
        liff.init({ liffId: LIFF_ID })
            .then(() => {
                if (!liff.isLoggedIn()) liff.login();
                else getUserProfile();
            })
            .catch(err => console.error("LIFF Initialization failed", err));
    }

    function getUserProfile() {
        liff.getProfile().then(profile => {
            lineProfile = profile;
            userNameSpan.textContent = profile.displayName;
            userPictureImg.src = profile.pictureUrl;
            userProfileDiv.classList.remove('hidden');
            guestNameInput.value = profile.displayName;
            fetchRooms();
        }).catch(err => console.error("Get profile failed", err));
    }

    function fetchRooms() {
        fetch(`${API_BASE_URL}/api/rooms`)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(rooms => {
                roomListDiv.innerHTML = '';
                rooms.forEach(room => roomListDiv.appendChild(createRoomCard(room)));
                loadingSpinner.classList.add('hidden');
                mainContent.classList.remove('hidden');
            })
            .catch(error => {
                console.error('Fetching rooms failed:', error);
                loadingSpinner.classList.add('hidden');
                mainContent.classList.remove('hidden');
                roomListDiv.innerHTML = '<p>載入房型資料失敗，請稍後再試。</p>';
            });
    }

function createRoomCard(room) {
    const card = document.createElement('div');
    card.className = 'room-card';
    card.innerHTML = `
        <img src="${room.imageUrl || 'https://placehold.co/600x400?text=No+Image'}" alt="${room.name}">
        <div class="room-card-content">
            <h3>${room.name}</h3>
            <p class="price">NT$ ${room.price} <span>起 / 每晚</span></p>
            <p>${room.description || '暫無詳細描述。'}</p>
            <div class="card-actions">
                <button class="cta-button secondary details-button">查看詳情</button>
                <button class="cta-button booking-button">立即預訂</button>
            </div>
        </div>
    `;
    // 【修改】為兩個按鈕分別綁定事件
    card.querySelector('.details-button').addEventListener('click', () => openRoomDetailsModal(room));
    card.querySelector('.booking-button').addEventListener('click', () => openBookingModal(room));
    return card;
}

    async function openBookingModal(room) {
        selectedRoom = room;
        selectedDates = [];
        finalTotalPrice = 0;
        modalRoomName.textContent = `預訂房型： ${room.name}`;
        bookingErrorEl.textContent = '';
        priceCalculationEl.textContent = '';
        availabilityResultEl.textContent = '請選擇住房日期';
        submitBookingButton.disabled = true;
        submitBookingButton.textContent = '確認訂房';
        submitBookingButton.style.backgroundColor = ''; 
        guestPhoneInput.value = '';
        initializeDatepicker();
        bookingModal.classList.remove('hidden');
        const today = new Date();


        initializeDatepicker();
        bookingModal.classList.remove('hidden');
    }

    // --- 【新增】打開房型詳細視窗的函式 ---
async function openRoomDetailsModal(room) {
    const modal = document.getElementById('room-details-modal');
    const detailsContent = document.getElementById('details-content');

    detailsContent.innerHTML = '<p>正在載入房型詳細資訊...</p>';
    modal.classList.remove('hidden');

    try {
        const response = await fetch(`${API_BASE_URL}/api/room-details?roomId=${room.id}`);
        if (!response.ok) throw new Error('無法取得房型資料');
        const roomDetails = await response.json();

        // --- 【升級】建立圖片陣列，並過濾掉空的圖片網址 ---
        const images = [roomDetails.imageUrl, roomDetails.imageUrl_2, roomDetails.imageUrl_3].filter(img => img);

        // --- 【升級】產生圖片輪播的 HTML ---
        const galleryHTML = images.map((img, index) => `
            <div class="slide ${index === 0 ? 'active' : ''}">
                <img src="${img}" alt="${roomDetails.name} picture ${index + 1}">
            </div>
        `).join('');

        detailsContent.innerHTML = `
            <div class="details-gallery">
                ${galleryHTML}
                ${images.length > 1 ? '<button class="gallery-nav prev">&lt;</button><button class="gallery-nav next">&gt;</button>' : ''}
            </div>
            <div class="details-info">
                <h2>${roomDetails.name}</h2>
                <p class="price">平日 NT$ ${roomDetails.price.toLocaleString()} 起</p>
                <p class="description">${roomDetails.detailedDescription || roomDetails.description || '此房型暫無更詳細的描述。'}</p>
                <button id="modal-book-now" class="cta-button">立即預訂</button>
            </div>
        `;

        document.getElementById('modal-book-now').addEventListener('click', () => {
            modal.classList.add('hidden');
            openBookingModal(room);
        });

        // --- 【新增】讓圖片輪播按鈕動起來 ---
        if (images.length > 1) {
            let currentSlide = 0;
            const slides = detailsContent.querySelectorAll('.slide');
            const nextBtn = detailsContent.querySelector('.gallery-nav.next');
            const prevBtn = detailsContent.querySelector('.gallery-nav.prev');

            function showSlide(index) {
                slides.forEach((slide, i) => {
                    slide.classList.toggle('active', i === index);
                });
            }

            nextBtn.addEventListener('click', () => {
                currentSlide = (currentSlide + 1) % images.length;
                showSlide(currentSlide);
            });

            prevBtn.addEventListener('click', () => {
                currentSlide = (currentSlide - 1 + images.length) % images.length;
                showSlide(currentSlide);
            });
        }

    } catch (error) {
        console.error('Fetch room details failed:', error);
        detailsContent.innerHTML = '<p class="error-message">載入失敗，請稍後再試。</p>';
    }
}

// --- 【修正核心】將關閉按鈕的事件監聽，移到 liff-app.js 的主要邏輯區 ---
// 找到檔案中其他的 closeButton.addEventListener... 把它們放在一起，會比較好管理
const detailsModal = document.getElementById('room-details-modal');
detailsModal.querySelector('.close-button').addEventListener('click', () => {
    detailsModal.classList.add('hidden');
});
    

    function closeBookingModal() {
        bookingModal.classList.add('hidden');
        if (datepicker) {
            datepicker.destroy();
            datepicker = null;
        }
    }

    // public/liff-app.js

function initializeDatepicker() {
    if (datepicker) datepicker.destroy();
    const Datepicker = window.Datepicker;
    if (!Datepicker) {
        console.error("Datepicker library not loaded!");
        return;
    }
    datepicker = new Datepicker(dateRangePickerEl, {
        language: 'zh-TW',
        format: 'yyyy-mm-dd',
        autohide: true,
        todayHighlight: true,
        minDate: new Date(),
        maxNumberOfDates: 2,
        buttonClass: 'btn',
    });
    dateRangePickerEl.addEventListener('changeDate', handleDateChange);
}

async function handleDateChange(e) {
    // 重置狀態
    priceCalculationEl.textContent = '';
    submitBookingButton.disabled = true;

    if (!e.detail || !e.detail.date || e.detail.date.length < 2) {
        availabilityResultEl.textContent = '請選擇退房日期';
        return;
    }

    selectedDates = e.detail.date;
    selectedDates.sort((a, b) => a - b);
    const dates = selectedDates.map(date => formatDate(date));
    const [startDate, endDate] = dates;

    availabilityResultEl.textContent = '正在查詢空房與價格...';

    try {
        const startDateObj = new Date(startDate);
        const endDateObj = new Date(endDate);
        const availabilityUrl = `${API_BASE_URL}/api/availability?roomId=${selectedRoom.id}&startDate=${startDate}&endDate=${endDate}`;
        const availabilityResponse = await fetch(availabilityUrl);
        if (!availabilityResponse.ok) throw new Error('查詢空房請求失敗');
        const availabilityData = await availabilityResponse.json();
        if (availabilityData.error) throw new Error(availabilityData.error);

        if (availabilityData.availableCount > 0) {
            const priceUrl = `${API_BASE_URL}/api/calculate-price?roomId=${selectedRoom.id}&startDate=${startDate}&endDate=${endDate}`;
            const priceResponse = await fetch(priceUrl);
            if (!priceResponse.ok) throw new Error('價格計算失敗');
            const priceData = await priceResponse.json();
            finalTotalPrice = priceData.totalPrice;
            const nights = (endDateObj - startDateObj) / (1000 * 60 * 60 * 24);
            availabilityResultEl.textContent = `✓ 太棒了！您選擇的期間還有 ${availabilityData.availableCount} 間空房。`;
            priceCalculationEl.textContent = `共 ${nights} 晚，總計 NT$ ${finalTotalPrice.toLocaleString()}`;
            submitBookingButton.disabled = false;
        } else {
            availabilityResultEl.textContent = '✗ 抱歉，您選擇的日期已客滿。';
        }
    } catch (error) {
        availabilityResultEl.textContent = '✗ 查詢失敗，請稍後再試。';
        console.error("API check failed:", error);
    }
}

// 位於 public/liff-app.js

// --- 【請用這個乾淨版本，取代現有的 submitBooking 函式】 ---
async function submitBooking() {
    if (selectedDates.length < 2 || !guestNameInput.value || !guestPhoneInput.value) {
        bookingErrorEl.textContent = '請選擇完整的日期並填寫所有必填欄位。';
        return;
    }

    submitBookingButton.disabled = true;
    submitBookingButton.textContent = '正在為您處理...';
    const dates = selectedDates.map(date => formatDate(date));
    const [startDate, endDate] = dates;

    const bookingData = {
        lineUserId: lineProfile.userId,
        lineDisplayName: lineProfile.displayName,
        roomId: selectedRoom.id,
        checkInDate: startDate,
        checkOutDate: endDate,
        guestName: guestNameInput.value,
        guestPhone: guestNameInput.value,
        totalPrice: finalTotalPrice,
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            throw new Error(result.error || '訂房失敗，請稍後再試');
        }

        // 訂房成功後，呼叫發送訊息的邏輯
        await sendBookingConfirmation(result.bookingDetails, LIFF_ID); 

        // 恢復成最終的成功訊息與自動關閉流程
        submitBookingButton.textContent = '訂房成功！';
        submitBookingButton.style.backgroundColor = '#00B900';
        bookingErrorEl.textContent = '';
        availabilityResultEl.textContent = `訂單 ${result.bookingDetails.bookingId} 已送出，確認訊息已發送至您的 LINE！ 3 秒後將關閉視窗。`;

        setTimeout(() => {
            closeBookingModal();
        }, 3000);

    } catch (error) {
        bookingErrorEl.textContent = `發生錯誤：${error.message}`;
        submitBookingButton.disabled = false;
        submitBookingButton.textContent = '確認訂房';
    }
}

async function submitBooking() {
    if (selectedDates.length < 2 || !guestNameInput.value || !guestPhoneInput.value) {
        bookingErrorEl.textContent = '請選擇完整的日期並填寫所有必填欄位。';
        return;
    }

    submitBookingButton.disabled = true;
    submitBookingButton.textContent = '正在為您處理...';
    const dates = selectedDates.map(date => formatDate(date));
    const [startDate, endDate] = dates;

        const bookingData = {
            lineUserId: lineProfile.userId,
            lineDisplayName: lineProfile.displayName,
            roomId: selectedRoom.id,
            checkInDate: startDate,
            checkOutDate: endDate,
            guestName: guestNameInput.value,
            guestPhone: guestPhoneInput.value,
            totalPrice: finalTotalPrice,
        };

try {
        const response = await fetch(`${API_BASE_URL}/api/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
            // 如果後端回傳錯誤，也把它當成一個錯誤來發送
            throw new Error(`後端錯誤: ${result.error || '訂房失敗，請稍後再試'}`);
        }

        // 訂房成功後，呼叫發送訊息的邏輯
        await sendBookingConfirmation(result.bookingDetails); 

        // 成功訊息的提示文字
        submitBookingButton.textContent = '訂房成功！';
        submitBookingButton.style.backgroundColor = '#00B900';
        bookingErrorEl.textContent = '';
        availabilityResultEl.textContent = `訂單 ${result.bookingDetails.bookingId} 已送出！ 3 秒後將關閉視窗。`;

        setTimeout(() => { closeBookingModal(); }, 3000);

    } catch (error) {
        // --- 【偵錯核心】如果上面有任何錯誤，執行這裡 ---
        bookingErrorEl.textContent = `發生錯誤：${error.message}`;
        submitBookingButton.disabled = false;
        submitBookingButton.textContent = '確認訂房';

        // 呼叫發送偵錯訊息的函式
        await sendDebugMessage(error);
    }
}

    closeButton.addEventListener('click', closeBookingModal);
    submitBookingButton.addEventListener('click', submitBooking);

    main();
});

async function sendBookingConfirmation(details, liffId) {
    if (!liff.isInClient()) {
        console.log('不在 LINE 環境中，略過發送訊息。');
        return;
    }

    const nights = (new Date(details.checkOutDate) - new Date(details.checkInDate)) / (1000 * 60 * 60 * 24);

    // --- Flex Message 的完整 JSON 結構 ---
    const flexMessage = {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                { "type": "text", "text": "訂單成立通知", "weight": "bold", "color": "#1DB446", "size": "sm" },
                { "type": "text", "text": "快樂腳旅棧", "weight": "bold", "size": "xxl", "margin": "md" },
                { "type": "text", "text": `訂單編號： ${details.bookingId}`, "size": "xs", "color": "#aaaaaa", "wrap": true }
            ]
        },
        "hero": {
            "type": "image",
            "url": details.imageUrl,
            "size": "full",
            "aspectRatio": "20:13",
            "aspectMode": "cover"
        },
        "body": {
            "type": "box",
            "layout": "vertical",
            "contents": [
                {
                    "type": "box",
                    "layout": "vertical",
                    "margin": "lg",
                    "spacing": "sm",
                    "contents": [
                        { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [
                            { "type": "text", "text": "房型", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                            { "type": "text", "text": details.roomName, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
                        ]},
                        { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [
                            { "type": "text", "text": "訂房大名", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                            { "type": "text", "text": details.guestName, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
                        ]},
                        { "type": "separator", "margin": "lg" },
                        { "type": "box", "layout": "baseline", "spacing": "sm", "margin": "lg", "contents": [
                            { "type": "text", "text": "入住", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                            { "type": "text", "text": details.checkInDate, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
                        ]},
                        { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [
                            { "type": "text", "text": "退房", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                            { "type": "text", "text": `${details.checkOutDate} (${nights}晚)`, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 }
                        ]},
                        // --- 【新增】總金額區塊 ---
                        { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [
                            { "type": "text", "text": "總金額", "color": "#aaaaaa", "size": "sm", "flex": 2 },
                            { "type": "text", "text": `NT$ ${details.totalPrice.toLocaleString()}`, "wrap": true, "color": "#666666", "size": "sm", "flex": 5, "weight": "bold" }
                        ]}
                    ]
                }
            ]
        },
        "footer": {
            "type": "box",
            "layout": "vertical",
            "spacing": "sm",
            "contents": [
                { "type": "button", "style": "link", "height": "sm", "action": {
                    "type": "uri",
                    "label": "查看我的所有訂單",
                    "uri": "https://www.google.com"
                }},
                { "type": "box", "layout": "vertical", "contents": [], "margin": "sm" }
            ],
            "flex": 0
        }
    };

    try {
        await liff.sendMessages([{
            type: 'flex',
            altText: `您的訂單 ${details.bookingId} 已成立！`,
            contents: flexMessage
        }]);
        console.log('發送確認訊息成功!');
    } catch (error) {
        console.error('發送確認訊息失敗，但訂單仍成功建立:', error);
    }
}