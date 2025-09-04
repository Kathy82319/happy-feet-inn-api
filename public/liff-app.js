document.addEventListener('DOMContentLoaded', () => {
    // --- 【重要設定】請務必填寫你自己的資料 ---
    const LIFF_ID = "2008032417-DPqYdL7p"; 
    const API_BASE_URL = "https://happy-feet-inn-api.pages.dev";

    // --- 全域變數 ---
    let lineProfile = {};
    let selectedRoom = {};
    let datepicker;

    // --- 頁面元素 ---
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

    //輔助函式：將 Date 物件格式化為 "YYYY-MM-DD" 字串
    function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
    }

    // --- 主流程 ---
    function main() {
        liff.init({ liffId: LIFF_ID })
            .then(() => {
                if (!liff.isLoggedIn()) liff.login();
                else getUserProfile();
            })
            .catch(err => {
                console.error("LIFF Initialization failed", err);
                alert("LIFF 初始化失敗，請稍後再試。");
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
        document.querySelector('#loading-spinner p').textContent = '正在載入房型資料...';
        loadingSpinner.classList.remove('hidden');

        fetch(`${API_BASE_URL}/api/rooms`)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(rooms => {
                roomListDiv.innerHTML = '';
                if (rooms.length === 0) {
                    roomListDiv.innerHTML = '<p>目前沒有可預訂的房型。</p>';
                } else {
                    rooms.forEach(room => roomListDiv.appendChild(createRoomCard(room)));
                }
                loadingSpinner.classList.add('hidden');
                mainContent.classList.remove('hidden');
            })
            .catch(error => {
                console.error('Fetching rooms failed:', error);
                mainContent.classList.remove('hidden');
                loadingSpinner.classList.add('hidden');
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
                <button class="cta-button">立即預訂</button>
            </div>
        `;
        card.querySelector('.cta-button').addEventListener('click', () => openBookingModal(room));
        return card;
    }

    // --- 訂房彈出視窗相關函式 ---
    function openBookingModal(room) {
        selectedRoom = room;
        modalRoomName.textContent = `預訂房型： ${room.name}`;
        bookingErrorEl.textContent = '';
        priceCalculationEl.textContent = '';
        availabilityResultEl.textContent = '請選擇住房日期';
        submitBookingButton.disabled = true;
        submitBookingButton.textContent = '確認訂房';
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

        // 【關鍵修正】直接從 window 物件取得 Datepicker 的建構函式
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
    // --- 【新增的偵錯日誌】 ---
    // 讓我們看看日曆送來的包裹長什麼樣子
    console.log("handleDateChange has been triggered!");
    console.log("Received event object (e):", e);
    console.log("Received event detail (e.detail):", e.detail);

      // 【關鍵修正】將所有 e.detail.dates 改為 e.detail.date (單數)
    if (!e.detail || !e.detail.date || e.detail.date.length < 2) {
        console.log("Guard clause triggered: Not a full date range yet. Exiting function.");
        priceCalculationEl.textContent = '';
        submitBookingButton.disabled = true;
        return;
    }

    // 【關鍵修正】從 e.detail.date 取出日期物件
    const dateObjects = e.detail.date;

    // 將日期物件轉換成 "YYYY-MM-DD" 格式的字串
    const dates = dateObjects.map(date => formatDate(date));

    const [startDate, endDate] = dates;
    availabilityResultEl.textContent = '正在查詢空房...';

    try {
        const response = await fetch(`${API_BASE_URL}/api/availability?roomId=${selectedRoom.id}&startDate=${startDate}&endDate=${endDate}`);
        if (!response.ok) throw new Error('查詢空房請求失敗');

        const data = await response.json();
        if (data.error) throw new Error(data.error);

        if (data.availableCount > 0) {
            availabilityResultEl.textContent = `✓ 太棒了！您選擇的期間還有 ${data.availableCount} 間空房。`;
            submitBookingButton.disabled = false;
            calculatePrice(startDate, endDate);
        } else {
            availabilityResultEl.textContent = '✗ 抱歉，您選擇的日期已客滿。';
        }
    } catch (error) {
        availabilityResultEl.textContent = '✗ 查詢空房失敗，請稍後再試。';
        console.error("Availability check failed:", error);
    }
}

    function calculatePrice(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const nights = (end - start) / (1000 * 60 * 60 * 24);
        if (nights > 0) {
            const totalPrice = nights * selectedRoom.price;
            priceCalculationEl.textContent = `共 ${nights} 晚，總計 NT$ ${totalPrice}`;
        }
    }

    async function submitBooking() {
    // 【關鍵修正】使用 datepicker.dates 屬性來取得選定的日期物件
    const dateObjects = datepicker.dates; 

    // 驗證資料是否齊全
    if (!dateObjects || dateObjects.length < 2 || !guestNameInput.value || !guestPhoneInput.value) {
        bookingErrorEl.textContent = '請選擇完整的日期並填寫所有欄位。';
        return;
    }

    submitBookingButton.disabled = true;
    submitBookingButton.textContent = '正在為您處理...';

    // 將日期物件轉換成 "YYYY-MM-DD" 格式的字串
    const dates = dateObjects.map(date => formatDate(date));
    const [startDate, endDate] = dates;
    const nights = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24);

    const bookingData = {
        lineUserId: lineProfile.userId,
        lineDisplayName: lineProfile.displayName,
        roomId: selectedRoom.id,
        checkInDate: startDate,
        checkOutDate: endDate,
        guestName: guestNameInput.value,
        guestPhone: guestPhoneInput.value,
        totalPrice: nights * selectedRoom.price,
    };

    try {
        const response = await fetch(`${API_BASE_URL}/api/bookings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData),
        });
        const result = await response.json();
        if (!response.ok || result.error) throw new Error(result.error || '訂房失敗');

        // 使用 LIFF 的 sendMessages API 發送確認訊息
        await liff.sendMessages([
            {
                type: 'text',
                text: `您好，您的訂房請求已成功送出！\n訂單編號：${result.bookingId}\n房型：${selectedRoom.name}\n入住：${startDate}\n退房：${endDate}\n我們將會盡快與您確認訂房細節，謝謝！`
            }
        ]);

        // 發送成功後關閉 LIFF 視窗
        liff.closeWindow();

    } catch (error) {
        bookingErrorEl.textContent = `錯誤：${error.message}`;
        submitBookingButton.disabled = false;
        submitBookingButton.textContent = '確認訂房';
    }
}

    // --- 事件監聽 ---
    closeButton.addEventListener('click', closeBookingModal);
    submitBookingButton.addEventListener('click', submitBooking);

    // --- 程式進入點 ---
    main();
});