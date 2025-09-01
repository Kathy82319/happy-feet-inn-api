document.addEventListener('DOMContentLoaded', () => {
    const LIFF_ID = "2008032417-DPqYdL7p";
    // 【新增】定義後端 API 的網址
    const API_BASE_URL = "https://happy-feet-inn-api.pages.dev";

    // 頁面元素
    const loadingSpinner = document.getElementById('loading-spinner');
    const userProfileDiv = document.getElementById('user-profile');
    const userNameSpan = document.getElementById('user-name');
    const userPictureImg = document.getElementById('user-picture');
    const mainContent = document.getElementById('main-content');
    const roomListDiv = document.getElementById('room-list');

    liff.init({ liffId: LIFF_ID })
        .then(() => {
            if (!liff.isLoggedIn()) {
                liff.login();
            } else {
                getUserProfile();
            }
        })
        .catch((err) => {
            console.error("LIFF 初始化失敗", err);
            alert("LIFF 初始化失敗，請稍後再試。");
        });

    function getUserProfile() {
        liff.getProfile().then((profile) => {
            userNameSpan.textContent = profile.displayName;
            userPictureImg.src = profile.pictureUrl;
            userProfileDiv.classList.remove('hidden');

            fetchRooms();
        }).catch((err) => {
            console.error("取得使用者資料失敗", err);
            loadingSpinner.classList.add('hidden');
            alert("無法取得您的 LINE 資料。");
        });
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