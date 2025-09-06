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
    
    // 取得所有需要的 DOM 元素
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
    const detailsModal = document.getElementById('room-details-modal');
    const bookingModalCloseButton = bookingModal.querySelector('.close-button');
    const detailsModalCloseButton = detailsModal.querySelector('.close-button');

    // --- 應用程式主要邏輯 ---

    function main() {
        liff.init({ liffId: LIFF_ID })
            .then(() => {
                if (!liff.isLoggedIn()) liff.login();
                else getUserProfile();
            })
            .catch(err => {
                console.error("LIFF Initialization failed", err);
                loadingSpinner.classList.add('hidden');
                mainContent.classList.remove('hidden');
                roomListDiv.innerHTML = '<p class="error-message">LIFF 初始化失敗，請稍後再試。</p>';
            });
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
        card.querySelector('.details-button').addEventListener('click', () => openRoomDetailsModal(room));
        card.querySelector('.booking-button').addEventListener('click', () => openBookingModal(room));
        return card;
    }

    async function openRoomDetailsModal(room) {
        const detailsContent = document.getElementById('details-content');
        detailsContent.innerHTML = '<p>正在載入房型詳細資訊...</p>';
        detailsModal.classList.remove('hidden');
        try {
            const response = await fetch(`${API_BASE_URL}/api/room-details?roomId=${room.id}`);
            if (!response.ok) throw new Error('無法取得房型資料');
            const roomDetails = await response.json();
            const images = [roomDetails.imageUrl, roomDetails.imageUrl_2, roomDetails.imageUrl_3].filter(img => img);
            const galleryHTML = images.map((img, index) => `<div class="slide ${index === 0 ? 'active' : ''}"><img src="${img}" alt="${roomDetails.name} picture ${index + 1}"></div>`).join('');
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
                detailsModal.classList.add('hidden');
                openBookingModal(room);
            });
            if (images.length > 1) {
                let currentSlide = 0;
                const slides = detailsContent.querySelectorAll('.slide');
                const nextBtn = detailsContent.querySelector('.gallery-nav.next');
                const prevBtn = detailsContent.querySelector('.gallery-nav.prev');
                function showSlide(index) { slides.forEach((slide, i) => slide.classList.toggle('active', i === index)); }
                nextBtn.addEventListener('click', () => { currentSlide = (currentSlide + 1) % images.length; showSlide(currentSlide); });
                prevBtn.addEventListener('click', () => { currentSlide = (currentSlide - 1 + images.length) % images.length; showSlide(currentSlide); });
            }
        } catch (error) {
            console.error('Fetch room details failed:', error);
            detailsContent.innerHTML = '<p class="error-message">載入失敗，請稍後再試。</p>';
        }
    }

    function openBookingModal(room) {
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
    }

    function closeBookingModal() {
        bookingModal.classList.add('hidden');
        if (datepicker) {
            datepicker.destroy();
            datepicker = null;
        }
    }

    function initializeDatepicker() {
        if (datepicker) datepicker.destroy();
        const Datepicker = window.Datepicker;
        if (!Datepicker) { console.error("Datepicker library not loaded!"); return; }
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
        priceCalculationEl.textContent = '';
        submitBookingButton.disabled = true;
        if (!e.detail || !e.detail.date || e.detail.date.length < 2) {
            availabilityResultEl.textContent = '請選擇退房日期';
            return;
        }
        selectedDates = e.detail.date;
        selectedDates.sort((a, b) => a - b);
        const [startDate, endDate] = selectedDates.map(date => formatDate(date));
        availabilityResultEl.textContent = '正在查詢空房與價格...';
        try {
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
                const nights = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24);
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

    async function submitBooking() {
        if (selectedDates.length < 2 || !guestNameInput.value || !guestPhoneInput.value) {
            bookingErrorEl.textContent = '請選擇完整的日期並填寫所有必填欄位。';
            return;
        }
        submitBookingButton.disabled = true;
        submitBookingButton.textContent = '正在為您處理...';
        const [startDate, endDate] = selectedDates.map(date => formatDate(date));
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
                throw new Error(result.error || '訂房失敗，請稍後再試');
            }
            await sendBookingConfirmation(result.bookingDetails);
            submitBookingButton.textContent = '訂房成功！';
            submitBookingButton.style.backgroundColor = '#4CAF50';
            bookingErrorEl.textContent = '';
            availabilityResultEl.textContent = `訂單 ${result.bookingDetails.bookingId} 已送出，確認訊息已發送至您的 LINE！ 3 秒後將關閉視窗。`;
            setTimeout(() => { closeBookingModal(); }, 3000);
        } catch (error) {
            bookingErrorEl.textContent = `發生錯誤：${error.message}`;
            submitBookingButton.disabled = false;
            submitBookingButton.textContent = '確認訂房';
        }
    }

    async function sendBookingConfirmation(details) {
        if (!liff.isInClient()) {
            console.log('不在 LINE 環境中，略過發送訊息。');
            return;
        }
        const nights = (new Date(details.checkOutDate) - new Date(details.checkInDate)) / (1000 * 60 * 60 * 24);
        const flexMessage = {
            "type": "bubble", "header": { "type": "box", "layout": "vertical", "contents": [ { "type": "text", "text": "訂單成立通知", "weight": "bold", "color": "#1DB446", "size": "sm" }, { "type": "text", "text": "快樂腳旅棧", "weight": "bold", "size": "xxl", "margin": "md" }, { "type": "text", "text": `訂單編號： ${details.bookingId}`, "size": "xs", "color": "#aaaaaa", "wrap": true } ] }, "hero": { "type": "image", "url": details.imageUrl, "size": "full", "aspectRatio": "20:13", "aspectMode": "cover" }, "body": { "type": "box", "layout": "vertical", "contents": [ { "type": "box", "layout": "vertical", "margin": "lg", "spacing": "sm", "contents": [ { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [ { "type": "text", "text": "房型", "color": "#aaaaaa", "size": "sm", "flex": 2 }, { "type": "text", "text": details.roomName, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 } ]}, { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [ { "type": "text", "text": "訂房大名", "color": "#aaaaaa", "size": "sm", "flex": 2 }, { "type": "text", "text": details.guestName, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 } ]}, { "type": "separator", "margin": "lg" }, { "type": "box", "layout": "baseline", "spacing": "sm", "margin": "lg", "contents": [ { "type": "text", "text": "入住", "color": "#aaaaaa", "size": "sm", "flex": 2 }, { "type": "text", "text": details.checkInDate, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 } ]}, { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [ { "type": "text", "text": "退房", "color": "#aaaaaa", "size": "sm", "flex": 2 }, { "type": "text", "text": `${details.checkOutDate} (${nights}晚)`, "wrap": true, "color": "#666666", "size": "sm", "flex": 5 } ]}, { "type": "box", "layout": "baseline", "spacing": "sm", "contents": [ { "type": "text", "text": "總金額", "color": "#aaaaaa", "size": "sm", "flex": 2 }, { "type": "text", "text": `NT$ ${details.totalPrice.toLocaleString()}`, "wrap": true, "color": "#666666", "size": "sm", "flex": 5, "weight": "bold" } ]} ] } ] }, "footer": { "type": "box", "layout": "vertical", "spacing": "sm", "contents": [ { "type": "button", "style": "link", "height": "sm", "action": { "type": "uri", "label": "查看我的所有訂單", "uri": `https://liff.line.me/${LIFF_ID}/my-bookings.html` }}, { "type": "box", "layout": "vertical", "contents": [], "margin": "sm" } ], "flex": 0 }
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

    // --- 綁定事件監聽 ---
    bookingModalCloseButton.addEventListener('click', closeBookingModal);
    detailsModalCloseButton.addEventListener('click', () => { detailsModal.classList.add('hidden'); });
    submitBookingButton.addEventListener('click', submitBooking);
    
    // --- 啟動應用程式 ---
    main();
});