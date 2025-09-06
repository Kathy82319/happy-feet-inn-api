document.addEventListener('DOMContentLoaded', () => {
    const LIFF_ID = "2008032417-DPqYdL7p"; // 請確認與主頁的 LIFF ID 相同
    const API_BASE_URL = "https://happy-feet-inn-api.pages.dev";

    let lineProfile = {};
    const roomDataCache = {}; // 用來快取房型名稱與圖片

    const loadingSpinner = document.getElementById('loading-spinner');
    const userProfileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    const userPictureImg = document.getElementById('user-picture');
    const mainContent = document.getElementById('main-content');
    const bookingListDiv = document.getElementById('booking-list');
    const noBookingMessage = document.getElementById('no-booking-message');

    function main() {
        liff.init({ liffId: LIFF_ID })
            .then(() => {
                if (!liff.isLoggedIn()) {
                    liff.login();
                } else {
                    getUserProfile();
                }
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
            if (!response.ok) {
                const errorText = await response.text().catch(() => '無法讀取錯誤內容');
                throw new Error(`HTTP 請求失敗！ 狀態碼: ${response.status}, 訊息: ${errorText}`);
            }
            const rooms = await response.json();
            rooms.forEach(room => {
                roomDataCache[room.id] = { name: room.name, imageUrl: room.imageUrl };
            });
            fetchMyBookings();
        } catch (error) {
            console.error('載入房型資料失敗 (fetchRoomsAndThenBookings):', error);
            fetchMyBookings();
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
                    return new Date(b.checkInDate) - new Date(a.checkInDate);
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

    function getStatusText(status) {
        switch (status) {
            case 'PENDING_PAYMENT':
                return '尚未付款';
            case 'CONFIRMED':
                return '已確認';
            case 'CANCELLED':
                return '已取消';
            case 'COMPLETED':
                return '已完成';
            default:
                return status;
        }
    }

    function showBookingDetailsModal(booking) {
        const modal = document.getElementById('booking-details-modal');
        const modalContent = document.getElementById('details-modal-content');
        const roomInfo = roomDataCache[booking.roomId] || { name: booking.roomId };

        modalContent.innerHTML = `
            <h3>訂單明細：${roomInfo.name}</h3>
            <p><strong>訂單編號:</strong> ${booking.bookingId}</p>
            <p><strong>入住日期:</strong> ${booking.checkInDate}</p>
            <p><strong>訂房大名:</strong> ${booking.guestName}</p>
            <hr>
            <h4>入住須知</h4>
            <ul>
                <li>入住時間 (Check-in) 為下午 3:00 後。</li>
                <li>退房時間 (Check-out) 為上午 11:00 前。</li>
                <li>請持訂房人有效證件辦理入住。</li>
                <li>為響應環保，我們不主動提供一次性盥洗用品，敬請自備。</li>
                <li>全館禁止吸菸，感謝您的合作。</li>
            </ul>
            <button id="close-details-modal" class="cta-button">關閉</button>
        `;

        modal.classList.remove('hidden');

        document.getElementById('close-details-modal').addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    function createBookingCard(booking) {
        const card = document.createElement('div');
        const isPendingPayment = booking.status === 'PENDING_PAYMENT';
        card.className = `booking-card ${booking.status === 'CANCELLED' ? 'cancelled-card' : ''} ${isPendingPayment ? 'pending-card' : ''}`;
        card.dataset.bookingId = booking.bookingId;

        const roomInfo = roomDataCache[booking.roomId] || { name: booking.roomId, imageUrl: 'https://placehold.co/600x400?text=No+Image' };
        const nights = (new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkInDate = new Date(booking.checkInDate);
        const diffDays = (checkInDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        const isCancellable = diffDays >= 2 && booking.status !== 'CANCELLED';
        const statusText = getStatusText(booking.status);

        card.innerHTML = `
            <div class="booking-card-header">
                <h3>${roomInfo.name}</h3>
                <span class="status-badge status-${(booking.status || '').toLowerCase()}">${statusText}</span>
            </div>
            <div class="booking-card-body">
                <img src="${roomInfo.imageUrl}" alt="${roomInfo.name}">
                <div class="booking-details">
                    <p><strong>訂單編號:</strong> ${booking.bookingId}</p>
                    <p><strong>入住日期:</strong> ${booking.checkInDate}</p>
                    <p><strong>退房日期:</strong> ${booking.checkOutDate} (${nights}晚)</p>
                    <p><strong>訂房大名:</strong> ${booking.guestName}</p>
                    <p><strong>訂單總額:</strong> NT$ ${booking.totalPrice.toLocaleString()}</p>
                </div>
            </div>
            <div class="booking-card-footer">
                ${isPendingPayment ? '<p class="footer-note">點擊卡片查看付款資訊與入住須知</p>' : ''}
                ${isCancellable ? '<button class="cta-button cancel-button">取消此訂單</button>' : ''}
            </div>
        `;

        if (isCancellable) {
            card.querySelector('.cancel-button').addEventListener('click', (e) => {
                e.stopPropagation();
                handleCancelBooking(booking.bookingId, checkInDate)
            });
        }
        if (isPendingPayment) {
            card.addEventListener('click', () => showBookingDetailsModal(booking));
        }

        return card;
    }

    async function handleCancelBooking(bookingId, checkInDate) {
        const confirmed = confirm("您確定要取消這筆訂單嗎？此操作無法復原。");
        if (!confirmed) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const diffDays = (checkInDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays < 2) {
            alert("訂房當日(或前一日)不可取消，若有問題請洽客服人員。");
            return;
        }
        try {
            const response = await fetch(`${API_BASE_URL}/api/bookings/cancel`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    bookingId: bookingId,
                    lineUserId: lineProfile.userId
                }),
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