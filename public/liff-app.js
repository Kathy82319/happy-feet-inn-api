document.addEventListener('DOMContentLoaded', () => {
    // LIFF ID 會在下一步從 LINE Developers Console 取得
    const LIFF_ID = "2008032417-DPqYdL7p"; 

    // 頁面元素
    const loadingSpinner = document.getElementById('loading-spinner');
    const userProfileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    const userPictureImg = document.getElementById('user-picture');
    const mainContent = document.getElementById('main-content');

    // 初始化 LIFF
    liff.init({
        liffId: LIFF_ID
    }).then(() => {
        console.log("LIFF 初始化成功");
        if (!liff.isLoggedIn()) {
            // 如果使用者沒登入，引導他們登入
            liff.login();
        } else {
            // 如果已登入，就取得使用者資料
            getUserProfile();
        }
    }).catch((err) => {
        console.error("LIFF 初始化失敗", err);
        alert("LIFF 初始化失敗，請稍後再試。");
    });

    function getUserProfile() {
        liff.getProfile().then((profile) => {
            // 成功取得資料
            console.log("成功取得使用者資料", profile);

            // 將資料顯示在畫面上
            userNameSpan.textContent = profile.displayName;
            userPictureImg.src = profile.pictureUrl;

            // 隱藏讀取畫面，顯示主內容和使用者資訊
            loadingSpinner.classList.add('hidden');
            userProfileDiv.classList.remove('hidden');
            mainContent.classList.remove('hidden');

        }).catch((err) => {
            console.error("取得使用者資料失敗", err);
            alert("無法取得您的 LINE 資料，請允許相關權限後再試。");
        });
    }
});