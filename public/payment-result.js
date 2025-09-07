document.addEventListener('DOMContentLoaded', () => {
    const messageEl = document.getElementById('result-message');
    const descriptionEl = document.getElementById('result-description');
    const viewBookingsBtn = document.getElementById('view-my-bookings-btn');

    const urlParams = new URLSearchParams(window.location.search);
    const bookingId = urlParams.get('orderId'); // 從 LINE Pay 回傳的 URL 取得訂單 ID

    if (bookingId) {
        messageEl.textContent = '付款請求已送出';
        descriptionEl.textContent = '系統正在後端確認中，請稍後到您的 LINE 查看由官方帳號發送的最終付款結果通知。';
    } else {
        messageEl.textContent = '付款已取消或失敗';
        descriptionEl.textContent = '您已取消付款，或付款過程發生錯誤。訂單尚未成立，您可以回到「我的訂單」頁面查看狀態或重新預訂。';
    }

    // 當使用者點擊按鈕時，跳轉到我的訂單頁，並帶上參數
    viewBookingsBtn.addEventListener('click', () => {
        // 【核心】帶上 fromPayment=true 和 bookingId，通知 my-bookings.js 啟動輪詢
        window.location.href = `my-bookings.html?fromPayment=true&bookingId=${bookingId}`;
    });
});