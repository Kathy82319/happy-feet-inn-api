// 輔助函式：將 Date 物件格式化為 "YYYY-MM-DD" 字串
function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

document.addEventListener('DOMContentLoaded', () => {
    // --- 程式碼開頭先印出一個日誌，確保 JS 檔案有被正確載入 ---
    console.log("[DEBUG] liff-app.js Loaded Successfully!");

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
        console.log("[DEBUG] Starting to fetch rooms..."); // 追蹤 fetchRooms 是否被呼叫
        document.querySelector('#loading-spinner p').textContent = '正在載入房型資料...';
        loadingSpinner.classList.remove('hidden');
        fetch(`${API_BASE_URL}/api/rooms`)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                return response.json();
            })
            .then(rooms => {
                console.log(`[DEBUG] Successfully fetched ${rooms.length} rooms.`); // 確認收到幾間房
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
        
        // --- 【v4.0 關鍵偵錯點】 ---
        const bookingButton = card.querySelector('.cta-button');
        if (bookingButton) {
            console.log(`[DEBUG] Attaching listener to button for room: ${room.name}`);
            bookingButton.addEventListener('click', () => {
                // 如果你點擊按鈕後，F12 Console 有出現這一行，代表監聽器是好的！
                console.log(`[SUCCESS] Button clicked for room: ${room.name}`);
                openBookingModal(room);
            });
        } else {
            // 如果 F12 Console 出現這一行，代表我們的 HTML 結構有問題
            console.error(`[ERROR] Could not find .cta-button for room: ${room.name}`);
        }
        
        return card;
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
        // ... (以下所有函式維持不變)
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
        document.querySelectorAll('.range-middle-custom').forEach(el => {
            el.classList.remove('range-middle-custom');
        });
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