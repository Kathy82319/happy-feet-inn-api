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
    // --- 【新增】開始 ---
    let calendarMetadata = { unavailableDates: [], specialPriceDates: [] };
    // --- 【新增】結束 ---
    
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

    // --- 【新增】開始 ---
    async function fetchCalendarMetadata(roomId, year, month) {
    try {
        const response = await fetch(`${API_BASE_URL}/api/calendar-metadata?roomId=${roomId}&year=${year}&month=${month}`);
        if (!response.ok) throw new Error('無法取得日曆資料');
        calendarMetadata = await response.json();
    } catch (error) {
        console.error("抓取日曆資料失敗:", error);
        calendarMetadata = { unavailableDates: [], specialPriceDates: [] };
    }
    }

    // 將客製化邏輯獨立成一個函式，方便重複使用
    function customDayRenderer(date) {
    const dateString = formatDate(date);
    const dayOfWeek = date.getDay();

    if (calendarMetadata.specialPriceDates.includes(dateString)) {
        return { classes: 'special-day', tooltip: '特殊假日價格' };
    }
    if (dayOfWeek === 6) { return { classes: 'saturday-day' }; } // 週六
    if (dayOfWeek === 5) { return { classes: 'friday-day' }; } // 週五
        }
    // --- 【新增】結束 ---

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

    // --- 【修改】建立更詳細的價格描述 ---
    let priceText = `平日 NT$ ${room.price.toLocaleString()}`;
    if (room.fridayPrice) {
        priceText += ` / 週五 NT$ ${room.fridayPrice.toLocaleString()}`;
    }
    if (room.saturdayPrice) {
        priceText += ` / 週六 NT$ ${room.saturdayPrice.toLocaleString()}`;
    }

    card.innerHTML = `
        <img src="${room.imageUrl || 'https://placehold.co/600x400?text=No+Image'}" alt="${room.name}">
        <div class="room-card-content">
            <h3>${room.name}</h3>
            <p class="price-summary">${priceText}</p>
            <p>${room.description || '暫無詳細描述。'}</p>
            <button class="cta-button">立即預訂</button>
        </div>
    `;
    card.querySelector('.cta-button').addEventListener('click', () => openBookingModal(room));
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
        await fetchCalendarMetadata(room.id, today.getFullYear(), today.getMonth() + 1);

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

    // public/liff-app.js

function initializeDatepicker() {
    if (datepicker) datepicker.destroy();
    const Datepicker = window.Datepicker;
    if (!Datepicker) { /* ... */ }

    datepicker = new Datepicker(dateRangePickerEl, {
        language: 'zh-TW',
        format: 'yyyy-mm-dd',
        autohide: true,
        todayHighlight: true,
        minDate: new Date(),
        maxNumberOfDates: 2,
        buttonClass: 'btn',
        // --- 【新增】日曆客製化選項 ---
        datesDisabled: calendarMetadata.unavailableDates,
        beforeShowDay: customDayRenderer,
    });

    // --- 【新增】監聽月份變更事件 ---
    dateRangePickerEl.addEventListener('changeMonth', async (e) => {
        const newDate = e.detail.date;
        const year = newDate.getFullYear();
        const month = newDate.getMonth() + 1;

        // 重新抓取新月份的資料
        await fetchCalendarMetadata(selectedRoom.id, year, month);

        // 更新日曆選項
        datepicker.setOptions({
            datesDisabled: calendarMetadata.unavailableDates,
            beforeShowDay: customDayRenderer
        });
        datepicker.update(); // 重新整理日曆畫面
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

    // 我們不再需要手動更新 input，函式庫會自己處理
    // datepicker.setDate(selectedDates); 
    
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
            if (!response.ok || result.error) throw new Error(result.error || '訂房失敗');

            submitBookingButton.textContent = '訂房成功！';
            submitBookingButton.style.backgroundColor = '#00B900';
            bookingErrorEl.textContent = '';
            availabilityResultEl.textContent = `訂單 ${result.bookingId} 已送出，3 秒後將返回訂房首頁。`;
            
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 3000);

        } catch (error) {
            bookingErrorEl.textContent = `錯誤：${error.message}`;
            submitBookingButton.disabled = false;
            submitBookingButton.textContent = '確認訂房';
        }
    }

    closeButton.addEventListener('click', closeBookingModal);
    submitBookingButton.addEventListener('click', submitBooking);

    main();
});