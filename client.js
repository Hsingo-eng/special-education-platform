const API_URL = "https://special-education-platform.zeabur.app"; // 請確認這是您的正確網址
let currentUser = null;
let token = localStorage.getItem("token");
let socket = null;
let calendar = null;

// ==========================================
// 🔔 1. 通知系統邏輯 (Notification System)
// ==========================================
const NOTIF_STORAGE_KEY = 'app_notifications';

// 讀取通知
function getStoredNotifications() {
    const stored = localStorage.getItem(NOTIF_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

// 渲染通知列表
function renderNotificationList() {
    const list = document.getElementById('notification-list');
    const btn = document.getElementById('btn-notification');
    if (!list || !btn) return;

    const notifications = getStoredNotifications();
    const hasUnread = notifications.some(n => !n.read);

    // 控制鈴鐺亮燈與搖晃
    if (hasUnread) {
        btn.classList.add('has-notification');
    } else {
        btn.classList.remove('has-notification');
    }

    if (notifications.length === 0) {
        list.innerHTML = `
            <div class="notif-empty">
                <i class="far fa-bell-slash fa-2x mb-2" style="color:#cbd5e1;"></i>
                <p class="mb-0 small">目前沒有新通知</p>
            </div>`;
        return;
    }

    let html = '';
    notifications.forEach(n => {
        // 定義圖示樣式
        let iconClass = 'message';
        let iconName = 'fas fa-bell';
        
        if (n.type === 'calendar') { iconClass = 'calendar'; iconName = 'fas fa-calendar-alt'; }
        else if (n.type === 'record') { iconClass = 'record'; iconName = 'fas fa-file-medical'; }
        else if (n.type === 'iep') { iconClass = 'iep'; iconName = 'fas fa-folder-open'; }
        else if (n.type === 'message') { iconClass = 'message'; iconName = 'fas fa-comments'; }
        else if (n.type === 'question') { iconClass = 'question'; iconName = 'fas fa-question-circle'; }

        // 時間格式化
        const date = new Date(n.time);
        const timeStr = `${date.getMonth()+1}/${date.getDate()} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;

        html += `
            <li class="notif-item" onclick="markAsRead(${n.id})">
                <div class="notif-icon-box ${iconClass}">
                    <i class="${iconName}"></i>
                </div>
                <div class="notif-content">
                    <div class="notif-text">${n.text}</div>
                    <div class="notif-time">${timeStr}</div>
                </div>
                ${!n.read ? '<span style="width:8px;height:8px;background:#EF4444;border-radius:50%;margin-top:6px;"></span>' : ''}
            </li>
        `;
    });
    list.innerHTML = html;
}

// 新增通知 (核心函式)
function addNotification(type, text) {
    const notifications = getStoredNotifications();
    const newNotif = {
        id: Date.now(),
        type: type,
        text: text,
        time: new Date().toISOString(),
        read: false
    };
    notifications.unshift(newNotif);
    if (notifications.length > 20) notifications.pop(); // 只留20筆
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifications));
    renderNotificationList();
}

// 切換選單顯示
function toggleNotificationMenu() {
    const menu = document.getElementById('notification-menu');
    if(menu) menu.classList.toggle('show');
}

// 標記單一已讀 (這裡簡化為點選就重繪)
function markAsRead(id) {
    const notifications = getStoredNotifications();
    const target = notifications.find(n => n.id === id);
    if (target) {
        target.read = true;
        localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifications));
        renderNotificationList();
    }
}

// 清除全部
function clearAllNotifications() {
    localStorage.removeItem(NOTIF_STORAGE_KEY);
    renderNotificationList();
}

// 點擊外部關閉選單
document.addEventListener('click', function(e) {
    const menu = document.getElementById('notification-menu');
    const btn = document.getElementById('btn-notification');
    if (menu && menu.classList.contains('show') && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('show');
    }
});

// ==========================================
// 🔗 2. Socket.io 與 初始化
// ==========================================

// 初始化 Socket
if (typeof io !== 'undefined') {
    socket = io(API_URL);
    
    console.log("Socket initialized");

    // 1. 行事曆監聽
    socket.on("calendar_update", (evt) => {
        // 判斷是新增還是刪除 (需後端支援 action 欄位，若無則顯示通用訊息)
        const msg = (evt.action === 'delete') ? '新增新排程/刪除排程' : '新增新排程/刪除排程';
        addNotification('calendar', msg);
        if(calendar) calendar.refetchEvents();
    });

    // 2. IEP 上傳監聽
    socket.on("iep_update", () => {
        addNotification('iep', '新IEP檔案已上傳');
        const iepSection = document.getElementById('section-iep');
        if (iepSection && !iepSection.classList.contains('d-none')) loadIepFiles();
    });

    // 3. 治療紀錄監聽
    socket.on("record_update", () => {
        addNotification('record', '新治療紀錄已上傳');
        const recSection = document.getElementById('section-records');
        if (recSection && !recSection.classList.contains('d-none')) loadRecords();
    });

    // 4. 留言板監聽
    socket.on("message_update", (msg) => {
        if (currentUser && msg.username !== currentUser.username) {
            addNotification('message', '留言板有新訊息');
        }
        // 即時更新畫面
        const chatBox = document.getElementById('chat-box');
        if (chatBox && currentUser) {
            // 簡易附加，實際應呼叫 loadMessages 重新整理或 append
            // 這裡簡單呼叫 loadMessages 確保同步
            loadMessages(); 
        }
    });

    // 5. 提問回覆監聽
    socket.on("question_update", (q) => {
        // 假設 q.target_role 包含當前身分
        if (currentUser && q.target_role && q.target_role.includes(currentUser.role)) {
            addNotification('question', '提問回覆有一則提問提及了您');
        }
        const qSection = document.getElementById('section-questions');
        if (qSection && !qSection.classList.contains('d-none')) loadQuestions();
    });
}

// 頁面載入執行
document.addEventListener("DOMContentLoaded", async () => {
    // 初始化通知介面
    renderNotificationList();

    if (token) {
        await verifyToken();
    } else {
        showSection("login");
    }
});

// ==========================================
// 🛠️ 3. API 與 資料載入函式
// ==========================================

async function verifyToken() {
    try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            currentUser = await res.json();
            updateUI(currentUser);
            showSection("dashboard");
            
            // 載入初始資料
            initCalendar();
            loadMessages(); // 這行之前報錯，現在沒問題了
            // loadIepFiles(); // 視需求載入
        } else {
            logout();
        }
    } catch (err) {
        console.error("Token verify failed:", err);
        logout();
    }
}

function updateUI(user) {
    document.getElementById("nav-user-info").innerText = `${user.role} | ${user.username}`;
    const header = document.getElementById("main-nav");
    if(header) header.classList.remove("d-none");
    
    // 根據身分顯示/隱藏功能
    document.querySelectorAll(".role-restricted").forEach(el => {
        const deny = el.getAttribute("data-deny");
        if (deny && deny.includes(user.role)) {
            el.style.display = "none"; 
        }
    });
}

function showSection(sectionId) {
    if (sectionId === 'login') {
        document.getElementById("login-section").classList.remove("d-none");
        document.getElementById("dashboard-section").classList.add("d-none");
        document.getElementById("main-nav").classList.add("d-none");
    } else if (sectionId === 'dashboard') {
        document.getElementById("login-section").classList.add("d-none");
        document.getElementById("dashboard-section").classList.remove("d-none");
        // 強制重繪行事曆，避免顯示問題
        setTimeout(() => { if(calendar) calendar.render(); }, 200);
    } else {
        // 切換子功能區塊
        document.getElementById("empty-state").classList.add("d-none");
        document.querySelectorAll("#content-area > div").forEach(div => {
            if (div.id !== "empty-state") div.classList.add("d-none");
        });
        const target = document.getElementById(`section-${sectionId}`);
        if (target) {
            target.classList.remove("d-none");
            target.classList.add("animate-fade"); // 確保有動畫 class
            
            // 根據切換的區塊載入資料
            if(sectionId === 'messages') loadMessages();
            if(sectionId === 'iep') loadIepFiles();
            if(sectionId === 'questions') loadQuestions();
            if(sectionId === 'records') loadRecords(); 
        }
    }
}

// --- 資料載入函式 (加上 try-catch 防止錯誤擴散) ---

async function loadMessages() {
    try {
        const res = await fetch(`${API_URL}/api/messages`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const json = await res.json();
        const chatBox = document.getElementById("chat-box");
        if (!chatBox) return;
        
        chatBox.innerHTML = "";
        json.data.forEach(msg => {
            const isSelf = msg.username === currentUser.username;
            const div = document.createElement("div");
            div.className = `msg-row ${isSelf ? "self" : "other"}`;
            div.innerHTML = `
                <div class="msg-avatar">
                    <img src="sticker${msg.role === 'teacher' ? '1' : msg.role === 'therapist' ? '2' : '3'}.png">
                </div>
                <div class="msg-bubble">
                    <span class="msg-role">${msg.role} (${msg.username})</span>
                    ${msg.text}
                </div>
            `;
            chatBox.appendChild(div);
        });
        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (err) { console.error("Load messages failed", err); }
}

async function loadIepFiles() {
    try {
        const res = await fetch(`${API_URL}/api/iep`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if(!res.ok) throw new Error("Server error");
        const json = await res.json();
        const list = document.getElementById("iep-list");
        if(!list) return;
        list.innerHTML = json.data.map(f => `
            <div class="col-md-4">
                <div class="card p-3 shadow-sm h-100 border-0 bg-light">
                    <div class="d-flex align-items-center mb-3">
                        <i class="fas fa-file-pdf fa-2x text-danger me-3"></i>
                        <h6 class="mb-0 fw-bold text-dark">${f.filename}</h6>
                    </div>
                    <small class="text-muted d-block mb-3">上傳者: ${f.uploader}</small>
                    <a href="${f.url}" target="_blank" class="btn btn-outline-danger btn-sm w-100 rounded-pill">
                        <i class="fas fa-download"></i> 下載檢閱
                    </a>
                </div>
            </div>
        `).join("");
    } catch (err) { 
        console.error("Load IEP failed", err); 
        // 這裡可以顯示錯誤訊息給使用者，而不是讓區塊空白
        const list = document.getElementById("iep-list");
        if(list) list.innerHTML = '<div class="col-12 text-center text-muted">暫無資料或載入失敗</div>';
    }
}

async function loadQuestions() {
    // 請依您的後端 API 實作
    console.log("Loading questions...");
}

async function loadRecords() {
    // 請依您的後端 API 實作
    console.log("Loading records...");
}

// --- 行事曆相關 ---

function initCalendar() {
    const el = document.getElementById('calendar');
    if (!el) return;

    calendar = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth',
        locale: 'zh-tw',
        headerToolbar: false, // 我們使用自訂的 header
        height: 'auto',
        events: async function(info, successCallback, failureCallback) {
            try {
                const res = await fetch(`${API_URL}/api/calendar`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if(!res.ok) throw new Error("Calendar fetch failed");
                const json = await res.json();
                
                // 轉換顏色
                const events = json.data.map(e => ({
                    id: e.id,
                    title: e.title,
                    start: e.start,
                    end: e.end,
                    // 根據建立者決定顏色
                    backgroundColor: e.role === 'teacher' ? '#F97316' : '#10B981', // 橘/綠
                    borderColor: 'transparent'
                }));
                successCallback(events);
            } catch (err) {
                console.error(err);
                failureCallback(err);
            }
        },
        eventClick: function(info) {
            // 點擊事件邏輯...
            Swal.fire({
                title: info.event.title,
                text: `時間: ${new Date(info.event.start).toLocaleString()}`,
                icon: 'info'
            });
        }
    });
    calendar.render();
    
    // 綁定自訂的月份選擇器
    const picker = document.getElementById('calendar-month-picker');
    if(picker) {
        picker.addEventListener('change', function() {
            calendar.gotoDate(this.value);
        });
    }
}

// --- 登入與登出 ---

async function login() {
    const u = document.getElementById("login-username").value;
    const p = document.getElementById("login-password").value;
    
    if(!u || !p) return Swal.fire("請輸入帳號密碼");

    try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        
        if (res.ok) {
            localStorage.setItem("token", data.token);
            token = data.token;
            location.reload(); // 重新整理以載入正確狀態
        } else {
            Swal.fire("登入失敗", data.message || "帳號或密碼錯誤", "error");
        }
    } catch (err) {
        console.error(err);
        Swal.fire("錯誤", "伺服器連線失敗", "error");
    }
}

function logout() {
    localStorage.removeItem("token");
    location.reload();
}

// 輔助：按 Enter 登入
document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && !document.getElementById('login-section').classList.contains('d-none')) {
        login();
    }
});