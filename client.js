const API_URL = "http://localhost:3000"; 
let currentUser = null;
let token = localStorage.getItem("token");
let socket = null;
let calendar = null;

// ==========================================
// 🔔 1. 通知系統邏輯 (新版)
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

// 標記單一已讀
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
// 🔗 2. Socket.io 初始化 (事件監聽)
// ==========================================

if (typeof io !== 'undefined') {
    socket = io(API_URL);
    
    // 1. 行事曆
    socket.on("calendar_update", (evt) => {
        addNotification('calendar', '新增新排程/刪除排程');
        if(calendar) calendar.refetchEvents();
    });

    // 2. IEP
    socket.on("iep_update", () => {
        addNotification('iep', '新IEP檔案已上傳');
        const section = document.getElementById('section-iep');
        if(section && !section.classList.contains('d-none')) loadIepFiles();
    });

    // 3. 治療紀錄
    socket.on("record_update", () => {
        addNotification('record', '新治療紀錄已上傳');
        // 這裡您可以加上重新載入紀錄的函式
    });

    // 4. 留言板
    socket.on("message_update", (msg) => {
        if (currentUser && msg.username !== currentUser.username) {
            addNotification('message', '留言板有新訊息');
        }
        // 即時更新畫面 (如果正在看留言板)
        const chatBox = document.getElementById('chat-box');
        if (chatBox && !document.getElementById('section-messages').classList.contains('d-none')) {
            loadMessages();
        }
    });

    // 5. 提問回覆
    socket.on("question_update", (q) => {
        // 這裡簡化邏輯，只要有更新就通知
        addNotification('question', '提問回覆有一則提問提及了您');
        // 重新載入
        const qSection = document.getElementById('section-questions');
        if(qSection && !qSection.classList.contains('d-none')) loadQuestions();
    });
}

// ==========================================
// 🛠️ 3. 頁面邏輯與資料載入
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    renderNotificationList(); // 初始化通知介面

    if (token) {
        await verifyToken();
    } else {
        showSection("login");
    }
});

async function verifyToken() {
    try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.ok) {
            currentUser = await res.json();
            updateUI(currentUser);
            showSection("dashboard");
            
            // 登入成功後載入初始資料
            initCalendar();
            loadMessages(); 
        } else {
            logout();
        }
    } catch (err) {
        console.error("Auth check failed:", err);
        logout();
    }
}

function updateUI(user) {
    document.getElementById("nav-user-info").innerText = `${user.role} | ${user.username}`;
    const header = document.getElementById("main-nav");
    if(header) header.classList.remove("d-none");
    
    // 權限控制
    document.querySelectorAll(".role-restricted").forEach(el => {
        const deny = el.getAttribute("data-deny");
        if (deny && deny.includes(user.role)) {
            el.style.display = "none"; 
        }
    });
}


// ==========================================
// 🟢 畫面切換控制功能
// ==========================================
function showSection(sectionId) {
    // 1. 先把所有畫面都隱藏起來
    document.getElementById('empty-state').classList.add('d-none');
    document.getElementById('section-records').classList.add('d-none');
    document.getElementById('section-iep').classList.add('d-none');
    document.getElementById('section-messages').classList.add('d-none');
    document.getElementById('section-questions').classList.add('d-none');

    // 2. 把你要看的那個畫面顯示出來
    const targetSection = document.getElementById('section-' + sectionId);
    if (targetSection) {
        targetSection.classList.remove('d-none');
    }

    // 3. 切換過去時，順便跟後端要最新的資料
    if (sectionId === 'messages' && typeof loadMessages === 'function') loadMessages();
    if (sectionId === 'questions' && typeof loadQuestions === 'function') loadQuestions();
    if (sectionId === 'records' && typeof loadRecords === 'function') loadRecords();
    if (sectionId === 'iep' && typeof loadIepList === 'function') loadIepList();
}

// ==========================================
// 🟢 補齊：缺少的資料載入函式 (讓按鈕有反應)
// ==========================================

async function loadQuestions() {
    try {
        const res = await fetch(`${API_URL}/api/questions`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const json = await res.json();
        const list = document.getElementById("questions-list");
        if (!list) return;

        if (!json.data || json.data.length === 0) {
            list.innerHTML = '<div class="col-12 text-center text-muted py-5">目前沒有提問資料</div>';
            return;
        }

        list.innerHTML = json.data.map(q => `
            <div class="col-md-6">
                <div class="card question-card h-100" data-role="${q.asker_role}">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <span class="badge bg-light text-dark mb-2">${q.target_role === 'teacher' ? 'To: 老師' : 'To: 治療師'}</span>
                            <small class="text-muted">${q.date}</small>
                        </div>
                        <h5 class="card-title">${q.asker_name} 問：</h5>
                        <p class="card-text">${q.question}</p>
                        ${q.reply ? `
                            <div class="bg-light rounded p-3 mt-3">
                                <small class="fw-bold text-success"><i class="fas fa-check-circle"></i> ${q.replier_name} 回覆：</small>
                                <p class="mb-0 mt-1 text-secondary">${q.reply}</p>
                            </div>
                        ` : `<span class="badge bg-warning text-dark">待回覆</span>`}
                    </div>
                </div>
            </div>
        `).join("");
    } catch (err) { console.error("Load questions failed:", err); }
}

async function loadRecords() {
    try {
        const res = await fetch(`${API_URL}/api/records`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const json = await res.json();
        const list = document.getElementById("record-list");
        if (!list) return;

        if (!json.data || json.data.length === 0) {
            list.innerHTML = '<div class="text-center text-muted py-5">暫無治療紀錄</div>';
            return;
        }

        list.innerHTML = json.data.map(r => `
            <div class="list-group-item p-4 mb-3 border rounded-3 shadow-sm bg-white">
                <div class="d-flex w-100 justify-content-between mb-2">
                    <h5 class="mb-1 fw-bold text-primary"><i class="fas fa-notes-medical me-2"></i>治療紀錄</h5>
                    <small class="text-muted">${r.date}</small>
                </div>
                <p class="mb-1 text-dark" style="white-space: pre-line;">${r.content}</p>
                <small class="text-muted">治療師：${r.therapist_name}</small>
                ${r.teacher_reply ? `
                    <div class="mt-3 p-3 bg-light rounded border-start border-4 border-success">
                        <small class="fw-bold text-success">老師回覆：</small>
                        <p class="mb-0 mt-1">${r.teacher_reply}</p>
                    </div>
                ` : ''}
            </div>
        `).join("");
    } catch (err) { console.error("Load records failed:", err); }
}

// --- 資料載入 API (已移除 checkNotifications 呼叫) ---

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
            // 根據角色顯示不同頭像
            let sticker = 'sticker3.png'; // 預設家長
            if (msg.role === 'teacher') sticker = 'sticker1.png';
            if (msg.role === 'therapist') sticker = 'sticker2.png';

            div.innerHTML = `
                <div class="msg-avatar">
                    <img src="${sticker}">
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
        if(!res.ok) throw new Error("API Error");
        const json = await res.json();
        const list = document.getElementById("iep-list");
        if(!list) return;
        
        if (json.data.length === 0) {
            list.innerHTML = '<div class="col-12 text-center text-muted">暫無檔案</div>';
            return;
        }

        list.innerHTML = json.data.map(f => `
            <div class="col-md-4">
                <div class="card p-3 shadow-sm h-100 border-0 bg-light">
                    <div class="d-flex align-items-center mb-3">
                        <i class="fas fa-file-pdf fa-2x text-danger me-3"></i>
                        <h6 class="mb-0 fw-bold text-dark text-truncate">${f.filename}</h6>
                    </div>
                    <small class="text-muted d-block mb-3">上傳者: ${f.uploader || f.uploaded_by}</small>
                    <a href="${f.url || f.file_link}" target="_blank" class="btn btn-outline-danger btn-sm w-100 rounded-pill">
                        <i class="fas fa-download"></i> 下載檢閱
                    </a>
                </div>
            </div>
        `).join("");
    } catch (err) { console.error(err); }
}

// --- 行事曆功能 ---

function initCalendar() {
    const el = document.getElementById('calendar');
    if (!el) return;

    calendar = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth',
        locale: 'zh-tw',
        headerToolbar: false, 
        height: 'auto',
        events: async function(info, successCallback, failureCallback) {
            try {
                const res = await fetch(`${API_URL}/api/calendar`, {
                    headers: { "Authorization": `Bearer ${token}` }
                });
                if(!res.ok) throw new Error("Fetch failed");
                const json = await res.json();
                
                const events = json.data.map(e => ({
                    id: e.id,
                    title: e.title,
                    start: e.start,
                    end: e.end,
                    backgroundColor: e.role === 'teacher' ? '#F97316' : '#10B981',
                    borderColor: 'transparent'
                }));
                successCallback(events);
            } catch (err) { failureCallback(err); }
        },
        eventClick: function(info) {
            Swal.fire({
                title: info.event.title,
                text: `時間: ${new Date(info.event.start).toLocaleString()}`,
                icon: 'info'
            });
        }
    });
    calendar.render();
    
    // 綁定月份選擇器
    const picker = document.getElementById('calendar-month-picker');
    if(picker) {
        picker.addEventListener('change', function() {
            calendar.gotoDate(this.value);
        });
    }
}

// --- 登入/登出 ---

async function login() {
    const u = document.getElementById("login-username").value;
    const p = document.getElementById("login-password").value;
    
    if(!u || !p) return Swal.fire("請輸入帳號密碼");

    try {
        // 🟢 這裡已經修正為 /api/auth/login
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p })
        });
        
        // 處理非 JSON 回應 (例如 404 HTML)
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("伺服器回應錯誤 (可能是路徑不對)");
        }

        const data = await res.json();
        
        if (res.ok) {
            localStorage.setItem("token", data.token);
            token = data.token;
            location.reload(); 
        } else {
            Swal.fire("登入失敗", data.message || "帳號或密碼錯誤", "error");
        }
    } catch (err) {
        console.error(err);
        Swal.fire("錯誤", "伺服器連線失敗或路徑錯誤", "error");
    }
}

function logout() {
    localStorage.removeItem("token");
    location.reload();
}

// 綁定 Enter 鍵登入
document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && !document.getElementById('login-section').classList.contains('d-none')) {
        login();
    }
});
// ==========================================
// 補齊缺失的載入函式
// ==========================================

async function loadQuestions() {
    try {
        const res = await fetch(`${API_URL}/api/questions`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const json = await res.json();
        const list = document.getElementById("questions-list");
        if (!list) return;

        if (!json.data || json.data.length === 0) {
            list.innerHTML = '<div class="col-12 text-center text-muted">暫無提問</div>';
            return;
        }

        list.innerHTML = json.data.map(q => `
            <div class="col-md-6">
                <div class="card question-card h-100" data-role="${q.asker_role}">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <span class="badge bg-light text-dark mb-2">${q.target_role === 'teacher' ? 'To: 老師' : 'To: 治療師'}</span>
                            <small class="text-muted">${q.date}</small>
                        </div>
                        <h5 class="card-title">${q.asker_name} 問：</h5>
                        <p class="card-text">${q.question}</p>
                        ${q.reply ? `
                            <div class="bg-light rounded p-3 mt-3">
                                <small class="fw-bold text-success"><i class="fas fa-check-circle"></i> ${q.replier_name} 回覆：</small>
                                <p class="mb-0 mt-1 text-secondary">${q.reply}</p>
                            </div>
                        ` : `<span class="badge bg-warning text-dark">待回覆</span>`}
                    </div>
                </div>
            </div>
        `).join("");
    } catch (err) { console.error(err); }
}

async function loadRecords() {
    try {
        const res = await fetch(`${API_URL}/api/records`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const json = await res.json();
        const list = document.getElementById("record-list");
        if (!list) return;

        if (!json.data || json.data.length === 0) {
            list.innerHTML = '<div class="text-center text-muted py-4">暫無治療紀錄</div>';
            return;
        }

        list.innerHTML = json.data.map(r => `
            <div class="list-group-item p-4 mb-3 border rounded-3 shadow-sm bg-white">
                <div class="d-flex w-100 justify-content-between mb-2">
                    <h5 class="mb-1 fw-bold text-primary"><i class="fas fa-notes-medical me-2"></i>治療紀錄</h5>
                    <small class="text-muted">${r.date}</small>
                </div>
                <p class="mb-1 text-dark" style="white-space: pre-line;">${r.content}</p>
                <small class="text-muted">治療師：${r.therapist_name}</small>
                ${r.teacher_reply ? `
                    <div class="mt-3 p-3 bg-light rounded border-start border-4 border-success">
                        <small class="fw-bold text-success">老師回覆：</small>
                        <p class="mb-0 mt-1">${r.teacher_reply}</p>
                    </div>
                ` : ''}
            </div>
        `).join("");
    } catch (err) { console.error(err); }
}

// ==========================================
// 🟢 補齊：所有按鈕的互動功能與彈出視窗
// ==========================================

// 1. 開啟行事曆視窗 (正確連結到您的 HTML Modal)
function openEventModal() {
    document.getElementById('evt-id').value = '';
    document.getElementById('evt-title').value = '';
    document.getElementById('evt-start').value = '';
    document.getElementById('evt-end').value = '';
    document.getElementById('btn-del-evt').classList.add('d-none');
    new bootstrap.Modal(document.getElementById('eventModal')).show();
}

// 2. 開啟治療紀錄表單
function openTherapyForm() {
    new bootstrap.Modal(document.getElementById('therapyRecordModal')).show();
}

// 3. 以下為預留的按鈕功能 (避免點擊時出現 ReferenceError 當機)
function openIepUpload() { 
    Swal.fire('提示', '上傳功能準備中', 'info'); 
}
function getAiSummary() { 
    Swal.fire('提示', 'AI 摘要功能正在呼叫 Gemini...', 'info'); 
}
function sendMessage() { 
    Swal.fire('提示', '發送訊息功能準備中', 'info'); 
}
function handleEnter(e) { 
    if(e.key === 'Enter') sendMessage(); 
}
function openQuestionModal() { 
    Swal.fire('提示', '提問功能準備中', 'info'); 
}
function submitTherapyRecord() { 
    Swal.fire('提示', '新增紀錄準備中', 'info'); 
}
function saveEvent() { 
    Swal.fire('提示', '儲存事件準備中', 'info'); 
}
function deleteEvent() { 
    Swal.fire('提示', '刪除事件準備中', 'info'); 
}