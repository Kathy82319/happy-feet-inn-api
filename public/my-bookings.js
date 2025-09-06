document.addEventListener('DOMContentLoaded', () => {
    const LIFF_ID = "2008032417-DPqYdL7p"; 
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
            fetchRoomsAndThenBookings(); // 先載入房型資料，再載入訂單
        }).catch(err => console.error("Get profile failed", err));
    }

    // 位於 public/my-bookings.js

async function fetchRoomsAndThenBookings() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/rooms`);
        if (!response.ok) { // 關鍵的檢查
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

            bookingListDiv.innerHTML = ''; // 清空舊列表

            if (bookings.length === 0) {
                noBookingMessage.classList.remove('hidden');
            } else {
                noBookingMessage.classList.add('hidden');
                // 將訂單按入住日期由新到舊排序
                bookings.sort((a, b) => new Date(b.checkInDate) - new Date(a.checkInDate));
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

    function createBookingCard(booking) {
        const card = document.createElement('div');
        card.className = 'booking-card';
        card.dataset.bookingId = booking.bookingId; // 方便之後操作

        const roomInfo = roomDataCache[booking.roomId] || { name: booking.roomId, imageUrl: 'https://placehold.co/600x400?text=No+Image' };
        const nights = (new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24);

        // 判斷是否可取消
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const checkInDate = new Date(booking.checkInDate);
        const diffDays = (checkInDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
        const isCancellable = diffDays >= 2 && booking.status !== 'CANCELLED';

        card.innerHTML = `
            <div class="booking-card-header">
                <h3>${roomInfo.name}</h3>
                <span class="status-badge status-${(booking.status || '').toLowerCase()}">${booking.status}</span>
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
                ${isCancellable ? '<button class="cta-button cancel-button">取消此訂單</button>' : ''}
            </div>
        `;
        
        if (isCancellable) {
            card.querySelector('.cancel-button').addEventListener('click', () => handleCancelBooking(booking.bookingId, checkInDate));
        }

        return card;
    }

    async function handleCancelBooking(bookingId, checkInDate) {
        // 防呆詢問
        const confirmed = confirm("您確定要取消這筆訂單嗎？此操作無法復原。");
        if (!confirmed) return;

        // 再次檢查日期，確保前端檢查與後端一致
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
            // 視覺上更新卡片狀態，避免重新整理
            const cardToUpdate = document.querySelector(`.booking-card[data-booking-id="${bookingId}"]`);
            if (cardToUpdate) {
                cardToUpdate.querySelector('.status-badge').textContent = 'CANCELLED';
                cardToUpdate.querySelector('.status-badge').className = 'status-badge status-cancelled';
                cardToUpdate.querySelector('.cancel-button').remove(); // 移除取消按鈕
            }
        } catch (error) {
            console.error('Cancel booking failed:', error);
            alert(`取消失敗：${error.message}`);
        }
    }

    main();
});