document.addEventListener('DOMContentLoaded', () => {
    const LIFF_ID = "2008032417-DPqYdL7p";
    const API_BASE_URL = "https://happy-feet-inn-api.pages.dev";

    // --- 全域變數 ---
    let lineProfile = {}; // 存放使用者 LINE 資料
    let selectedRoom = {}; // 存放當前選擇的房型
    let datepicker; // 存放日曆實體

    // --- 頁面元素 ---
    const loadingSpinner = document.getElementById('loading-spinner');
    const userProfileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    const mainContent = document.getElementById('main-content');
    const roomListDiv = document.getElementById('room-list');
    // Modal 元素
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

    // --- 主流程 ---
    function main() {
        liff.init({ liffId: LIFF_ID })
            .then(() => {
                if (!liff.isLoggedIn()) {
                    liff.login();
                } else {
                    getUserProfile();
                }
            })
            .catch(err => console.error(err));
    }

    function getUserProfile() {
        liff.getProfile().then(profile => {
            lineProfile = profile;
            userNameSpan.textContent = profile.displayName;
            userProfileDiv.classList.remove('hidden');
            guestNameInput.value = profile.displayName; // 自動填入姓名
            fetchRooms();
        }).catch(err => console.error(err));
    }

    function fetchRooms() {
        // ... (fetchRooms 函式保持不變) ...
    }

    function createRoomCard(room) {
        const card = document.createElement('div');
        card.className = 'room-card';
        card.innerHTML = `
            <img src="${room.imageUrl || 'https://via.placeholder.com/400x200.png?text=No+Image'}" alt="${room.name}">
            <div class="room-card-content">
                <h3>${room.name}</h3>
                <p class="price">NT$ ${room.price} <span>起 / 每晚</span></p>
                <p>${room.description || '暫無詳細描述。'}</p>
                <button class="cta-button">立即預訂</button>
            </div>
        `;
        // 【新增】為按鈕加上點擊事件
        card.querySelector('.cta-button').addEventListener('click', () => {
            openBookingModal(room);
        });
        return card;
    }

    // --- Modal 相關函式 ---
    function openBookingModal(room) {
        selectedRoom = room;
        modalRoomName.textContent = `預訂房型： ${room.name}`;
        bookingErrorEl.textContent = '';
        priceCalculationEl.textContent = '';
        availabilityResultEl.textContent = '請選擇住房日期';
        submitBookingButton.disabled = true;

        initializeDatepicker();
        bookingModal.classList.remove('hidden');
    }

    function closeBookingModal() {
        bookingModal.classList.add('hidden');
        if (datepicker) {
            datepicker.destroy(); // 關閉時銷毀日曆，避免重複渲染
            datepicker = null;
        }
    }

    function initializeDatepicker() {
        if (datepicker) {
            datepicker.destroy();
        }
        datepicker = new Datepicker(dateRangePickerEl, {
            language: 'zh-TW',
            format: 'yyyy-mm-dd',
            autohide: true,
            todayHighlight: true,
            minDate: new Date(), // 只能選今天以後
            maxNumberOfDates: 2, // 範圍選擇
        });

        // 【核心】監聽日期選擇事件
        dateRangePickerEl.addEventListener('changeDate', handleDateChange);
    }

    async function handleDateChange(e) {
        const dates = datepicker.getDates('yyyy-mm-dd');
        if (dates.length < 2) {
            // 如果只選了一個日期，不執行任何操作
            return;
        }
        const [startDate, endDate] = dates;

        availabilityResultEl.textContent = '正在查詢空房...';
        submitBookingButton.disabled = true;

        // 呼叫後端 API 查詢空房
        try {
            const response = await fetch(`${API_BASE_URL}/api/availability?roomId=${selectedRoom.id}&startDate=${startDate}&endDate=${endDate}`);
            const data = await response.json();

            if (data.error) {
                throw new Error(data.error);
            }

            if (data.availableCount > 0) {
                availabilityResultEl.textContent = `太棒了！您選擇的期間還有 ${data.availableCount} 間空房。`;
                submitBookingButton.disabled = false; // 開放訂房按鈕
                calculatePrice(startDate, endDate);
            } else {
                availabilityResultEl.textContent = '抱歉，您選擇的日期已客滿。';
            }
        } catch (error) {
            availabilityResultEl.textContent = '查詢空房失敗，請稍後再試。';
            console.error("查詢空房失敗:", error);
        }
    }

    function calculatePrice(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const nights = (end - start) / (1000 * 60 * 60 * 24); // 計算晚數
        if (nights > 0) {
            const totalPrice = nights * selectedRoom.price;
            priceCalculationEl.textContent = `共 ${nights} 晚，總計 NT$ ${totalPrice}`;
        } else {
             priceCalculationEl.textContent = '';
        }
    }

    async function submitBooking() {
        const dates = datepicker.getDates('yyyy-mm-dd');
        if (dates.length < 2) {
            bookingErrorEl.textContent = '請選擇完整的入住和退房日期。';
            return;
        }
        if (!guestNameInput.value || !guestPhoneInput.value) {
            bookingErrorEl.textContent = '請填寫訂房大名與聯絡電話。';
            return;
        }

        submitBookingButton.disabled = true;
        submitBookingButton.textContent = '正在為您處理...';

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

            if (!response.ok || result.error) {
                throw new Error(result.error || '訂房失敗');
            }

            liff.sendMessages([
                {
                    type: 'text',
                    text: `您好，您的訂房請求已成功送出！\n訂單編號：${result.bookingId}\n房型：${selectedRoom.name}\n入住：${startDate}\n退房：${endDate}\n我們將會盡快與您確認訂房細節，謝謝！`
                }
            ]).then(() => {
                liff.closeWindow(); // 送出訊息後自動關閉 LIFF
            });

        } catch (error) {
            bookingErrorEl.textContent = `錯誤：${error.message}`;
            submitBookingButton.disabled = false;
            submitBookingButton.textContent = '確認訂房';
        }
    }


    function fetchRooms() {
        loadingSpinner.classList.remove('hidden');
        document.querySelector('#loading-spinner p').textContent = '正在載入房型資料...';

        // 【關鍵修正】確保這裡使用的是 ${API_BASE_URL} 組成的完整網址
        fetch(`${API_BASE_URL}/api/rooms`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(rooms => {
                console.log("成功取得房型資料:", rooms);
                roomListDiv.innerHTML = ''; 

                if (rooms.length === 0) {
                    roomListDiv.innerHTML = '<p>目前沒有可預訂的房型。</p>';
                } else {
                    rooms.forEach(room => {
                        const card = createRoomCard(room);
                        roomListDiv.appendChild(card);
                    });
                }

                loadingSpinner.classList.add('hidden');
                mainContent.classList.remove('hidden');
            })
            .catch(error => {
                console.error('載入房型資料失敗:', error);
                loadingSpinner.classList.add('hidden');
                mainContent.classList.remove('hidden');
                roomListDiv.innerHTML = '<p>載入房型資料失敗，請稍後再試。</p>';
            });
    }

    function createRoomCard(room) {
        const card = document.createElement('div');
        card.className = 'room-card';

        card.innerHTML = `
            <img src="${room.imageUrl || 'https://via.placeholder.com/400x200.png?text=No+Image'}" alt="${room.name}">
            <div class="room-card-content">
                <h3>${room.name}</h3>
                <p class="price">NT$ ${room.price} <span>起 / 每晚</span></p>
                <p>${room.description || '暫無詳細描述。'}</p>
            </div>
        `;
        return card;
    }
});