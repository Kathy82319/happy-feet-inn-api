document.addEventListener('DOMContentLoaded', () => {
    const LIFF_ID = "2008032417-DPqYdL7p";
    const API_BASE_URL = "https://happy-feet-inn-api.pages.dev";

    let lineProfile = {};
    const roomDataCache = {}; 

    const loadingSpinner = document.getElementById('loading-spinner');
    const userProfileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    const userPictureImg = document.getElementById('user-picture');
    const mainContent = document.getElementById('main-content');
    const bookingListDiv = document.getElementById('booking-list');
    const noBookingMessage = document.getElementById('no-booking-message');

    let pollingInterval;
    let pollingCount = 0;
    const MAX_POLLING_COUNT = 5;

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
            fetchRoomsAndThenBookings();
        }).catch(err => console.error("Get profile failed", err));
    }

    async function fetchRoomsAndThenBookings() {
        try {
            const response = await fetch(`${API_BASE_URL}/api/rooms`);
            if (!response.ok) throw new Error('載入房型資料失敗');
            const rooms = await response.json();
            rooms.forEach(room => {
                roomDataCache[room.id] = { name: room.name, imageUrl: room.imageUrl };
            });
        } catch (error) {
            console.error('載入房型資料失敗:', error);
        } finally {
            await fetchMyBookings();
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.has('fromPayment')) {
                const bookingIdToCheck = urlParams.get('bookingId');
                startPolling(bookingIdToCheck);
            }
        }
    }

    async function fetchMyBookings() {
        loadingSpinner.classList.remove('hidden');
        mainContent.classList.add('hidden');
        try {
            const response = await fetch(`${API_BASE_URL}/api/my-bookings?lineUserId=${lineProfile.userId}`);
            if (!response.ok) throw new Error('無法取得訂單資料');
            const bookings = await response.json();

            bookingListDiv.innerHTML = '';

            if (bookings.length === 0) {
                noBookingMessage.classList.remove('hidden');
            } else {
                noBookingMessage.classList.add('hidden');
                bookings.sort((a, b) => {
                    if (a.status === 'CANCELLED' && b.status !== 'CANCELLED') return 1;
                    if (b.status === 'CANCELLED' && a.status !== 'CANCELLED') return -1;
                    return b.bookingId.localeCompare(a.bookingId);
                });
                bookings.forEach(booking => {
                    const bookingCard = createBookingCard(booking);
                    bookingListDiv.appendChild(bookingCard);
                });
            }
        } catch (error) {
            console.error('Fetching bookings failed:', error);
            bookingListDiv.innerHTML = '<p class="error-message">載入訂單失敗，請稍後再試。</p>';
        } finally {
            loadingSpinner.classList.add('hidden');
            mainContent.classList.remove('hidden');
        }
    }
    
    // --- 【修改】輪詢的啟動與停止邏輯，確保一定會停止 ---
    function startPolling(bookingId) {
        stopPolling(); // 確保開始前是乾淨的
        
        console.log(`Starting to poll for booking ID: ${bookingId}`);
        pollingInterval = setInterval(async () => {
            pollingCount++;
            console.log(`Polling attempt #${pollingCount}`);
            
            // 如果輪詢次數過多，就強制停止，不再拉取資料
            if (pollingCount >= MAX_POLLING_COUNT) {
                stopPolling();
                return; // 提前結束，避免多餘的 API 呼叫
            }
            
            await fetchMyBookings();
            
            const targetCard = document.querySelector(`.booking-card[data-booking-id="${bookingId}"]`);
            const statusBadge = targetCard ? targetCard.querySelector('.status-badge') : null;

            // 如果狀態已變成 '已確認'，也停止
            if (statusBadge && statusBadge.textContent === '已確認') {
                stopPolling();
            }
        }, 2000); // 每 2 秒檢查一次
    }

    function stopPolling() {
        if (pollingInterval) {
            console.log('Stopping polling.');
            clearInterval(pollingInterval);
            pollingInterval = null;
            pollingCount = 0; // 重置計數器
        }
    }

    function getStatusText(status) {
        switch (status) {
            case 'PENDING_PAYMENT': return '尚未付款';
            case 'CONFIRMED': return '已確認';
            case 'CANCELLED': return '已取消';
            case 'COMPLETED': return '已完成';
            default: return status;
        }
    }

    function showBookingDetailsModal(booking) {
        const modal = document.getElementById('booking-details-modal');
        const modalContent = document.getElementById('details-modal-content');
        const roomInfo = roomDataCache[booking.roomId] || { name: booking.roomId };
        modalContent.innerHTML = `<h3>訂單明細：${roomInfo.name}</h3><p><strong>訂單編號:</strong> ${booking.bookingId}</p><p><strong>入住日期:</strong> ${booking.checkInDate}</p><p><strong>訂房大名:</strong> ${booking.guestName}</p><hr><h4>入住須知</h4><ul><li>入住時間 (Check-in) 為下午 3:00 後。</li><li>退房時間 (Check-out) 為上午 11:00 前。</li><li>請持訂房人有效證件辦理入住，未滿18歲需家長同意書。</li><li>為響應環保，我們不主動提供一次性盥洗用品，敬請自備。</li><li>全館禁止吸菸，禁止攜帶寵物，感謝您的合作。</li></ul><div class="contact-info"><h4>聯絡我們</h4><p><strong>地址：</strong><a href="https://maps.google.com/?q=台中市中區中華路一段185號十樓" target="_blank">台中市中區中華路一段185號十樓</a></p><p><strong>電話：</strong><a href="tel:+886-4-22232033">04-2223-2033 (點擊撥打)</a></p></div><button id="close-details-modal" class="cta-button">關閉</button>`;
        modal.classList.remove('hidden');
        document.getElementById('close-details-modal').addEventListener('click', () => modal.classList.add('hidden'));
    }

    // --- 【修改】createBookingCard 函式，加入付款按鈕 ---
    function createBookingCard(booking) {
        const card = document.createElement('div');
        const isPendingPayment = booking.status === 'PENDING_PAYMENT';
        card.className = `booking-card ${booking.status === 'CANCELLED' ? 'cancelled-card' : ''} ${isPendingPayment ? 'pending-card' : ''}`;
        card.dataset.bookingId = booking.bookingId;

        const roomInfo = roomDataCache[booking.roomId] || { name: booking.roomId, imageUrl: 'https://placehold.co/600x400?text=No+Image' };
        const nights = (new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24);
        const diffDays = (new Date(booking.checkInDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24);
        const isCancellable = diffDays >= 2 && booking.status !== 'CANCELLED' && booking.status !== 'CONFIRMED';
        const statusText = getStatusText(booking.status);

        let footerHTML = '';
        if (isPendingPayment) {
            footerHTML += `<button class="cta-button pay-now-button">進行付款</button>`;
        }
        if (isCancellable) {
            footerHTML += `<button class="cta-button cancel-button">取消此訂單</button>`;
        }
        
        card.innerHTML = `<div class="booking-card-header"><h3>${roomInfo.name}</h3><span class="status-badge status-${(booking.status || '').toLowerCase()}">${statusText}</span></div><div class="booking-card-body"><img src="${roomInfo.imageUrl}" alt="${roomInfo.name}"><div class="booking-details"><p><strong>訂單編號:</strong> ${booking.bookingId}</p><p><strong>入住日期:</strong> ${booking.checkInDate}</p><p><strong>退房日期:</strong> ${booking.checkOutDate} (${nights}晚)</p><p><strong>訂單總額:</strong> NT$ ${booking.totalPrice.toLocaleString()}</p></div></div><div class="booking-card-footer">${footerHTML}</div>`;
        
        if (isPendingPayment) {
            // 讓卡片上半部可以點擊顯示詳情
            card.querySelector('.booking-card-body').addEventListener('click', () => showBookingDetailsModal(booking));
            // 為付款按鈕綁定事件
            card.querySelector('.pay-now-button').addEventListener('click', (e) => {
                e.stopPropagation();
                handleRepayment(booking.bookingId);
            });
        }

        if (isCancellable) {
            card.querySelector('.cancel-button').addEventListener('click', (e) => {
                e.stopPropagation();
                handleCancelBooking(booking.bookingId, new Date(booking.checkInDate));
            });
        }
        
        return card;
    }

    // --- 【新增】處理重新付款的函式 ---
    async function handleRepayment(bookingId) {
        const payButton = document.querySelector(`.booking-card[data-booking-id="${bookingId}"] .pay-now-button`);
        if(payButton) payButton.textContent = '處理中...';
        
        try {
            const response = await fetch(`${API_BASE_URL}/api/payment/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: bookingId }),
            });
            const result = await response.json();
            if (!response.ok || !result.paymentUrl) {
                throw new Error(result.error || '建立付款連結失敗');
            }
            window.location.href = result.paymentUrl;
        } catch (error) {
            alert(`發生錯誤：${error.message}`);
            if(payButton) payButton.textContent = '進行付款';
        }
    }

    async function handleCancelBooking(bookingId, checkInDate) {
        const confirmed = confirm("您確定要取消這筆訂單嗎？此操作無法復原。");
        if (!confirmed) return;
        try {
            const response = await fetch(`${API_BASE_URL}/api/bookings/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bookingId: bookingId, lineUserId: lineProfile.userId }),
            });
            const result = await response.json();
            if (!response.ok || result.error) throw new Error(result.error || '取消訂單失敗');
            alert('訂單已成功取消！');
            fetchMyBookings();
        } catch (error) {
            console.error('Cancel booking failed:', error);
            alert(`取消失敗：${error.message}`);
        }
    }

    main();
});