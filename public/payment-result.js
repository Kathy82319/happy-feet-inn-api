document.addEventListener('DOMContentLoaded', () => {
    // 這個頁面僅作為一個中轉提示頁
    // 真正的訂單狀態更新依賴後端的 Webhook
    // 所以我們在這裡不需要做複雜的邏輯判斷
    
    const messageEl = document.getElementById('result-message');
    const descriptionEl = document.getElementById('result-description');
    
    // 我們可以簡單地根據 URL 是否包含 transactionId 來顯示一個初步的訊息
    // 但這並不可靠，僅供參考
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('transactionId')) {
        messageEl.textContent = '付款請求已送出';
        descriptionEl.textContent = '系統正在後端確認中，請稍後到您的 LINE 查看由官方帳號發送的最終付款結果通知。';
    } else {
        messageEl.textContent = '付款已取消或失敗';
        descriptionEl.textContent = '您已取消付款，或是付款過程中發生錯誤。訂單尚未成立，您可以回到「我的訂單」頁面查看狀態或重新預訂。';
    }
});