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

    // --- 【修正1】新增一個變數來儲存從後端計算回來的正確總價 ---
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

    function openBookingModal(room) {
        selectedRoom = room;
        selectedDates = [];
        finalTotalPrice = 0; // 重置價格
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

// --- 新增一個全域變數來追蹤日期選擇狀態 ---
let isSelectingStartDate = true;
let firstDate = null;

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
        // --- 【v4.0 關鍵】回到最穩定、最不會出錯的內建雙日期模式 ---
        maxNumberOfDates: 2,
        buttonClass: 'btn',
    });
    
    // --- 【v4.0 關鍵】使用函式庫內建、最穩定的 changeDate 事件 ---
    dateRangePickerEl.addEventListener('changeDate', handleDateChange);
}


// --- 【v3.0 全新函式】處理日期點擊的核心邏輯 ---
async function handleDateChange(e) {
    // --- 每次日期變更時，先清除之前手動添加的樣式 ---
    document.querySelectorAll('.range-middle-custom').forEach(el => {
        el.classList.remove('range-middle-custom');
    });

    // 重置狀態
    priceCalculationEl.textContent = '';
    submitBookingButton.disabled = true;

    // 函式庫在選滿2個日期前，e.detail.date 的長度會是 1
    if (!e.detail || !e.detail.date || e.detail.date.length < 2) {
        availabilityResultEl.textContent = '請選擇退房日期';
        return; // 如果日期選擇不完整，提示使用者並返回
    }

    selectedDates = e.detail.date;
    // 【v4.0 修正】確保日期是從早到晚排序，杜絕負數天數
    selectedDates.sort((a, b) => a - b);
    
    const dates = selectedDates.map(date => formatDate(date));
    const [startDate, endDate] = dates;

    // 更新 input 框的顯示值
    datepicker.setDates(selectedDates);

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

            // 手動為中間日期添加自訂 class
            let currentDate = new Date(startDateObj);
            currentDate.setDate(currentDate.getDate() + 1);
            while (currentDate < endDateObj) {
                const dateString = formatDate(currentDate);
                const cellSelector = `.datepicker-cell[data-date='${new Date(dateString).getTime()}']`;
                const cellElement = document.querySelector(cellSelector);
                if (cellElement) {
                    cellElement.classList.add('range-middle-custom');
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }

        } else {
            availabilityResultEl.textContent = '✗ 抱歉，您選擇的日期已客滿。';
        }
    } catch (error) {
        availabilityResultEl.textContent = '✗ 查詢失敗，請稍後再試。';
        console.error("API check failed:", error);
    }
}


// --- 【v3.0 全新函式】將 API 查詢邏輯獨立出來 ---
async function triggerApiCheck(startDateObj, endDateObj) {
    const startDate = formatDate(startDateObj);
    const endDate = formatDate(endDateObj);

    // 清除之前手動添加的樣式
    document.querySelectorAll('.range-middle-custom').forEach(el => {
        el.classList.remove('range-middle-custom');
    });

    availabilityResultEl.textContent = '正在查詢空房與價格...';
    priceCalculationEl.textContent = '';
    submitBookingButton.disabled = true;

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
            const nights = (endDateObj - startDateObj) / (1000 * 60 * 60 * 24);
            availabilityResultEl.textContent = `✓ 太棒了！您選擇的期間還有 ${availabilityData.availableCount} 間空房。`;
            priceCalculationEl.textContent = `共 ${nights} 晚，總計 NT$ ${finalTotalPrice.toLocaleString()}`;
            submitBookingButton.disabled = false;

            // 手動為中間日期添加自訂 class
            let currentDate = new Date(startDateObj);
            currentDate.setDate(currentDate.getDate() + 1);
            while (currentDate < endDateObj) {
                const dateString = formatDate(currentDate);
                const cellSelector = `.datepicker-cell[data-date='${new Date(dateString).getTime()}']`;
                const cellElement = document.querySelector(cellSelector);
                if (cellElement) {
                    cellElement.classList.add('range-middle-custom');
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }

        } else {
            availabilityResultEl.textContent = '✗ 抱歉，您選擇的日期已客滿。';
        }
    } catch (error) {
        availabilityResultEl.textContent = '✗ 查詢失敗，請稍後再試。';
        console.error("API check failed:", error);
    }
}

    // --- 【修正2】重寫整個 handleDateChange 函式，整合空房查詢與價格計算 ---
   // 在 public/liff-app.js 中
// 請用這個版本完整取代你現有的 handleDateChange 函式

async function handleDateChange(e) {
    // --- 每次日期變更時，先清除之前手動添加的樣式 ---
    document.querySelectorAll('.range-middle-custom').forEach(el => {
        el.classList.remove('range-middle-custom');
    });

    // 重置狀態
    priceCalculationEl.textContent = '';
    submitBookingButton.disabled = true;

    if (!e.detail || !e.detail.date || e.detail.date.length < 2) {
        return; // 如果日期選擇不完整，直接返回
    }

    selectedDates = e.detail.date;
    const dates = selectedDates.map(date => formatDate(date));
    const [startDate, endDate] = dates;
    availabilityResultEl.textContent = '正在查詢空房與價格...';

    try {
        // 第一步：查詢空房
        const availabilityUrl = `${API_BASE_URL}/api/availability?roomId=${selectedRoom.id}&startDate=${startDate}&endDate=${endDate}`;
        const availabilityResponse = await fetch(availabilityUrl);
        if (!availabilityResponse.ok) throw new Error('查詢空房請求失敗');
        const availabilityData = await availabilityResponse.json();
        if (availabilityData.error) throw new Error(availabilityData.error);

        if (availabilityData.availableCount > 0) {
            // 第二步：如果還有空房，就去後端計算正確價格
            const priceUrl = `${API_BASE_URL}/api/calculate-price?roomId=${selectedRoom.id}&startDate=${startDate}&endDate=${endDate}`;
            const priceResponse = await fetch(priceUrl);
            if (!priceResponse.ok) throw new Error('價格計算失敗');
            const priceData = await priceResponse.json();

            finalTotalPrice = priceData.totalPrice;

            const nights = (new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24);
            availabilityResultEl.textContent = `✓ 太棒了！您選擇的期間還有 ${availabilityData.availableCount} 間空房。`;
            priceCalculationEl.textContent = `共 ${nights} 晚，總計 NT$ ${finalTotalPrice.toLocaleString()}`;
            
            submitBookingButton.disabled = false;

            // --- 【v2.3 關鍵修正！】手動為中間日期添加自訂 class ---
            const startDateObj = new Date(startDate);
            const endDateObj = new Date(endDate);
            let currentDate = new Date(startDateObj);
            currentDate.setDate(currentDate.getDate() + 1); // 從起始日的隔天開始

            while (currentDate < endDateObj) {
                const dateString = formatDate(currentDate);
                const cellSelector = `.datepicker-cell[data-date='${new Date(dateString).getTime()}']`;
                const cellElement = document.querySelector(cellSelector);
                if (cellElement) {
                    cellElement.classList.add('range-middle-custom');
                }
                currentDate.setDate(currentDate.getDate() + 1);
            }

        } else {
            availabilityResultEl.textContent = '✗ 抱歉，您選擇的日期已客滿。';
        }
    } catch (error) {
        availabilityResultEl.textContent = '✗ 查詢失敗，請稍後再試。';
        console.error("Availability or Price check failed:", error);
    }
}

    // --- 【修正3】移除舊的 calculatePrice 函式 ---
    // (整個函式被刪除，因為它的邏輯已經整合到 handleDateChange 裡面了)

    async function submitBooking() {
        if (selectedDates.length < 2 || !guestNameInput.value || !guestPhoneInput.value) {
            bookingErrorEl.textContent = '請選擇完整的日期並填寫所有必填欄位。';
            return;
        }

        submitBookingButton.disabled = true;
        submitBookingButton.textContent = '正在為您處理...';

        const dates = selectedDates.map(date => formatDate(date));
        const [startDate, endDate] = dates;
        
        // --- 【修正4】使用儲存好的 finalTotalPrice，而不是重新計算 ---
        const bookingData = {
            lineUserId: lineProfile.userId,
            lineDisplayName: lineProfile.displayName,
            roomId: selectedRoom.id,
            checkInDate: startDate,
            checkOutDate: endDate,
            guestName: guestNameInput.value,
            guestPhone: guestPhoneInput.value,
            totalPrice: finalTotalPrice, // 使用從後端拿到的正確價格
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
            availabilityResultEl.textContent = `訂單 ${result.bookingId} 已送出，此視窗將在 3 秒後自動關閉。`;

            setTimeout(() => {
                liff.closeWindow();
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