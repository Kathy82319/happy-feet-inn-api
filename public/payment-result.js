document.addEventListener('DOMContentLoaded', () => {
    const messageEl = document.getElementById('result-message');
    const descriptionEl = document.getElementById('result-description');
    const viewBookingsBtn = document.getElementById('view-my-bookings-btn');
    const spinner = document.querySelector('.spinner');

    const urlParams = new URLSearchParams(window.location.search);
    const bookingId = urlParams.get('orderId');

    // 隱藏按鈕和轉圈圖示
    if (viewBookingsBtn) viewBookingsBtn.style.display = 'none';
    if (spinner) spinner.style.display = 'none';

    // 【修改】直接顯示肯定的成功訊息
    messageEl.textContent = '付款成功！';
    descriptionEl.textContent = `您的訂單已確認。3 秒後將自動跳轉至「我的訂單」頁面...`;

    // 【新增】設定 3 秒後自動跳轉
    setTimeout(() => {
        if (bookingId) {
            // 帶上參數，讓「我的訂單」頁面可以做輪詢，確保看到最新狀態
            window.location.href = `my-bookings.html?fromPayment=true&bookingId=${bookingId}`;
        } else {
            // 如果沒有 bookingId，直接跳轉
            window.location.href = 'my-bookings.html';
        }
    }, 3000); // 3000 毫秒 = 3 秒
});