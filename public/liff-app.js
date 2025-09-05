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

    let lineProfile = {}, selectedRoom = {}, datepicker;
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

   async function handleDateChange() {
    const selectedRoomElement = document.querySelector('.room-card.selected');
    // 如果日期變更時，使用者還沒選房型，就先不動作
    if (!selectedRoomElement) {
        return;
    }

    const roomId = selectedRoomElement.dataset.roomId;
    const checkInDate = document.getElementById('check-in-date').value;
    const checkOutDate = document.getElementById('check-out-date').value;

    // 確保兩個日期都有值，且退房日 > 入住日
    if (!checkInDate || !checkOutDate || new Date(checkOutDate) <= new Date(checkInDate)) {
        // 如果日期不合法，隱藏預訂表單並清空舊的結果
        document.getElementById('booking-form').style.display = 'none';
        document.getElementById('availability-result').textContent = '';
        return;
    }

    const availabilityResultDiv = document.getElementById('availability-result');
    const bookingForm = document.getElementById('booking-form');
    const totalPriceElement = document.getElementById('total-price');
    
    // 開始查詢，顯示提示訊息
    availabilityResultDiv.textContent = '正在查詢空房...';
    bookingForm.style.display = 'none';
    if (totalPriceElement) totalPriceElement.textContent = '';


    try {
        // --- 第一步：檢查空房 (這部分是你原有的邏輯) ---
        const availabilityUrl = `${API_BASE_URL}/api/availability?roomId=${roomId}&startDate=${checkInDate}&endDate=${checkOutDate}`;
        const availabilityResponse = await fetch(availabilityUrl);
        if (!availabilityResponse.ok) throw new Error('Availability check failed');
        const availabilityData = await availabilityResponse.json();

        if (availabilityData.availableCount > 0) {
            
            // --- 第二步 (關鍵修正！)：取得正確價格並更新 UI ---
            availabilityResultDiv.textContent = `太棒了！還有 ${availabilityData.availableCount} 間空房。正在計算總金額...`;
            
            const priceUrl = `${API_BASE_URL}/api/calculate-price?roomId=${roomId}&startDate=${checkInDate}&endDate=${checkOutDate}`;
            const priceResponse = await fetch(priceUrl);
            if (!priceResponse.ok) throw new Error('Price calculation failed');
            const priceData = await priceResponse.json();

            // 更新最終的 UI 顯示
            const nightCount = (new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24);
            availabilityResultDiv.textContent = `太棒了！您選擇的期間還有 ${availabilityData.availableCount} 間空房。`;
            
            if (totalPriceElement) {
               totalPriceElement.textContent = `住宿 ${nightCount} 晚，總金額: TWD ${priceData.totalPrice.toLocaleString()}`;
            }
            
            // 顯示預訂表單
            bookingForm.style.display = 'block';

        } else {
            availabilityResultDiv.textContent = availabilityData.error || '抱歉，該房型在您選擇的日期已無空房。';
            bookingForm.style.display = 'none';
        }
    } catch (error) {
        console.error('查詢失敗:', error);
        availabilityResultDiv.textContent = '查詢時發生錯誤，請稍後再試。';
        bookingForm.style.display = 'none';
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
    if (selectedDates.length < 2 || !guestNameInput.value || !guestPhoneInput.value) {
        bookingErrorEl.textContent = '請選擇完整的日期並填寫所有必填欄位。';
        return;
    }

    submitBookingButton.disabled = true;
    submitBookingButton.textContent = '正在為您處理...';

    const dates = selectedDates.map(date => formatDate(date));
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

        // 【關鍵修正】不再使用 liff.sendMessages
        // 而是直接在畫面上顯示成功訊息
        submitBookingButton.textContent = '訂房成功！';
        submitBookingButton.style.backgroundColor = '#00B900'; // 讓按鈕變綠色
        bookingErrorEl.textContent = ''; // 清除舊的錯誤訊息
        availabilityResultEl.textContent = `訂單 ${result.bookingId} 已送出，此視窗將在 3 秒後自動關閉。`;

        // 延遲 3 秒鐘，然後自動關閉 LIFF 視窗
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