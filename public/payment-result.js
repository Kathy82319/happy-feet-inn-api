document.addEventListener('DOMContentLoaded', () => {
    const messageEl = document.getElementById('result-message');
    const descriptionEl = document.getElementById('result-description');
    const viewBookingsBtn = document.getElementById('view-my-bookings-btn');
    const spinner = document.querySelector('.spinner');

    const urlParams = new URLSearchParams(window.location.search);
    // LINE Pay V3 會在 confirmUrl 帶上 orderId
    const bookingId = urlParams.get('orderId');

    // 【修改】無論如何，都先顯示成功訊息
    if (spinner) spinner.style.display = 'none'; // 隱藏轉圈圈圖示
    messageEl.textContent = '付款處理完成！';
    descriptionEl.textContent = '您的訂單狀態已更新，詳細的付款成功通知將會由 LINE 官方帳號發送給您。';

    // 當使用者點擊按鈕時，跳轉到我的訂單頁，並帶上參數以啟動輪詢
    viewBookingsBtn.addEventListener('click', () => {
        if (bookingId) {
            // 帶上 fromPayment=true 和 bookingId，通知 my-bookings.js 啟動輪詢
            window.location.href = `my-bookings.html?fromPayment=true&bookingId=${bookingId}`;
        } else {
            // 如果沒有 bookingId，直接跳轉
            window.location.href = 'my-bookings.html';
        }
    });
});