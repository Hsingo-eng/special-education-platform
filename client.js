const API_URL = "http://localhost:3000"; 
let currentUser = null;
let token = localStorage.getItem("token");
let socket = null;
let calendar = null;

// ==========================================
// 🔔 1. 通知系統邏輯
// ==========================================
const NOTIF_STORAGE_KEY = 'app_notifications';

function getStoredNotifications() {
    const stored = localStorage.getItem(NOTIF_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function renderNotificationList() {
    const list = document.getElementById('notification-list');
    const btn = document.getElementById('btn-notification');
    if (!list || !btn) return;

    const notifications = getStoredNotifications();
    const hasUnread = notifications.some(n => !n.read);

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
        let iconClass = 'message';
        let iconName = 'fas fa-bell';
        
        if (n.type === 'calendar') { iconClass = 'calendar'; iconName = 'fas fa-calendar-alt'; }
        else if (n.type === 'record') { iconClass = 'record'; iconName = 'fas fa-file-medical'; }
        else if (n.type === 'iep') { iconClass = 'iep'; iconName = 'fas fa-folder-open'; }
        else if (n.type === 'message') { iconClass = 'message'; iconName = 'fas fa-comments'; }
        else if (n.type === 'question') { iconClass = 'question'; iconName = 'fas fa-question-circle'; }

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
    if (notifications.length > 20) notifications.pop();
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifications));
    renderNotificationList();
}

function toggleNotificationMenu() {
    const menu = document.getElementById('notification-menu');
    if(menu) menu.classList.toggle('show');
}

function markAsRead(id) {
    const notifications = getStoredNotifications();
    const target = notifications.find(n => n.id === id);
    if (target) {
        target.read = true;
        localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifications));
        renderNotificationList();
    }
}

function clearAllNotifications() {
    localStorage.removeItem(NOTIF_STORAGE_KEY);
    renderNotificationList();
}

document.addEventListener('click', function(e) {
    const menu = document.getElementById('notification-menu');
    const btn = document.getElementById('btn-notification');
    if (menu && menu.classList.contains('show') && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('show');
    }
});

// ==========================================
// 🔗 2. Socket.io 初始化
// ==========================================

if (typeof io !== 'undefined') {
    socket = io(API_URL);
    
    socket.on("calendar_update", (evt) => {
        addNotification('calendar', '新增新排程/刪除排程');
        if(calendar) calendar.refetchEvents();
    });

    socket.on("iep_update", () => {
        addNotification('iep', '新IEP檔案已上傳');
        const section = document.getElementById('section-iep');
        if(section && !section.classList.contains('d-none')) loadIepFiles();
    });

    socket.on("record_update", () => {
        addNotification('record', '新治療紀錄已上傳');
    });

    socket.on("message_update", (msg) => {
        if (currentUser && msg.username !== currentUser.username) {
            addNotification('message', '留言板有新訊息');
        }
        const chatBox = document.getElementById('chat-box');
        if (chatBox && !document.getElementById('section-messages').classList.contains('d-none')) {
            loadMessages();
        }
    });

    socket.on("question_update", (q) => {
        addNotification('question', '提問回覆有一則提問提及了您');
        const qSection = document.getElementById('section-questions');
        if(qSection && !qSection.classList.contains('d-none')) loadQuestions();
    });
}

// ==========================================
// 🛠️ 3. 頁面邏輯與登入驗證
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    renderNotificationList();

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
    // 1. 判斷中文身分與對應的小怪獸頭貼
    let roleName = '家長';
    let avatarSrc = 'sticker3.png'; // 預設家長怪獸
    
    if (user.role === 'teacher') {
        roleName = '教師';
        avatarSrc = 'sticker1.png'; // 教師怪獸
    } else if (user.role === 'therapist') {
        roleName = '治療師';
        avatarSrc = 'sticker2.png'; // 治療師怪獸
    }

    // 2. 更新右上角的文字與頭貼
    document.getElementById("nav-user-info").innerText = `${roleName} | ${user.username}`;
    document.getElementById("header-user-avatar").src = avatarSrc;

    // 3. 顯示 Header
    const header = document.getElementById("main-nav");
    if(header) header.classList.remove("d-none");
    
    // 4. 權限控制 (隱藏無權限的按鈕)
    document.querySelectorAll(".role-restricted").forEach(el => {
        const deny = el.getAttribute("data-deny");
        if (deny && deny.includes(user.role)) {
            el.style.display = "none"; 
        }
    });
}

// ==========================================
// 🟢 4. 畫面切換控制功能
// ==========================================
function showSection(sectionId) {
    if (sectionId === 'login') {
        document.getElementById('login-section').classList.remove('d-none');
        document.getElementById('dashboard-section').classList.add('d-none');
        return;
    } 
    if (sectionId === 'dashboard') {
        document.getElementById('login-section').classList.add('d-none');
        document.getElementById('dashboard-section').classList.remove('d-none');
        return;
    }

    document.getElementById('empty-state').classList.add('d-none');
    document.getElementById('section-records').classList.add('d-none');
    document.getElementById('section-iep').classList.add('d-none');
    document.getElementById('section-messages').classList.add('d-none');
    document.getElementById('section-questions').classList.add('d-none');

    const targetSection = document.getElementById('section-' + sectionId);
    if (targetSection) {
        targetSection.classList.remove('d-none');
    }

    if (sectionId === 'messages' && typeof loadMessages === 'function') loadMessages();
    if (sectionId === 'questions' && typeof loadQuestions === 'function') loadQuestions();
    if (sectionId === 'records' && typeof loadRecords === 'function') loadRecords();
    if (sectionId === 'iep' && typeof loadIepFiles === 'function') loadIepFiles();
}

// ==========================================
// 🟢 5. 四大功能資料載入 (已對齊您的 Excel 欄位)
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
                            <span class="badge bg-light text-dark mb-2">To: ${q.target_role || '所有人'}</span>
                            <small class="text-muted">${q.date}</small>
                        </div>
                        <h5 class="card-title">${q.asker_name} 問：</h5>
                        <p class="card-text">${q.question}</p>
                        ${q.reply ? `
                            <div class="bg-light rounded p-3 mt-3">
                                <small class="fw-bold text-success"><i class="fas fa-check-circle"></i> ${q.replier_name || '回覆者'} 回覆：</small>
                                <p class="mb-0 mt-1 text-secondary">${q.reply}</p>
                            </div>
                        ` : `<span class="badge bg-warning text-dark mt-2">待回覆</span>`}
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
                <div class="d-flex w-100 justify-content-between mb-3">
                    <h5 class="mb-1 fw-bold text-success"><i class="fas fa-notes-medical me-2"></i>治療紀錄 (${r.session_Type || '未分類'})</h5>
                    <span class="badge bg-light text-dark border">${r.date}</span>
                </div>
                <div class="mb-3 text-dark" style="font-size: 0.95rem; line-height: 1.6;">
                    ${r.comp_content ? `<div><strong class="text-primary">語言理解：</strong>${r.comp_content} <span class="text-muted">(${r.comp_perf})</span></div>` : ''}
                    ${r.exp_content ? `<div><strong class="text-success">語言表達：</strong>${r.exp_content} <span class="text-muted">(${r.exp_perf})</span></div>` : ''}
                    ${r.art_content ? `<div><strong class="text-warning">構音練習：</strong>${r.art_content} <span class="text-muted">(${r.art_perf})</span></div>` : ''}
                    ${r.comm_content ? `<div><strong class="text-info">溝通互動：</strong>${r.comm_content} <span class="text-muted">(${r.comm_perf})</span></div>` : ''}
                </div>
                <div class="d-flex gap-2 mb-2">
                    <span class="badge bg-secondary">參與度: ${r.participation || '無'}</span>
                    <span class="badge bg-secondary">策略: ${r.strategies || '無'}</span>
                </div>
                ${r.remarks ? `
                    <div class="mt-3 p-3 bg-light rounded border-start border-4 border-secondary">
                        <small class="fw-bold text-secondary">補充事項：</small>
                        <p class="mb-0 mt-1">${r.remarks}</p>
                    </div>
                ` : ''}
            </div>
        `).join("");
    } catch (err) { console.error("Load records failed:", err); }
}

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
            const isSelf = msg.user_name === currentUser.username; 
            const div = document.createElement("div");
            div.className = `msg-row ${isSelf ? "self" : "other"}`;
            
            let sticker = 'sticker3.png'; 
            if (msg.role === 'teacher') sticker = 'sticker1.png';
            if (msg.role === 'therapist') sticker = 'sticker2.png';

            div.innerHTML = `
                <div class="msg-avatar"><img src="${sticker}"></div>
                <div class="msg-bubble">
                    <span class="msg-role">${msg.role} (${msg.user_name})</span>
                    ${msg.message}
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
            list.innerHTML = '<div class="col-12 text-center text-muted py-5">暫無檔案</div>';
            return;
        }

        list.innerHTML = json.data.map(f => `
            <div class="col-md-4">
                <div class="card p-3 shadow-sm h-100 border-0 bg-light">
                    <div class="d-flex align-items-center mb-3">
                        <i class="fas fa-file-pdf fa-2x text-danger me-3"></i>
                        <h6 class="mb-0 fw-bold text-dark text-truncate" title="${f.filename}">${f.filename}</h6>
                    </div>
                    <small class="text-muted d-block mb-1">上傳者: ${f.uploaded_by}</small>
                    <small class="text-muted d-block mb-3">日期: ${f.upload_date}</small>
                    <a href="${f.file_link}" target="_blank" class="btn btn-outline-danger btn-sm w-100 rounded-pill">
                        <i class="fas fa-download"></i> 下載檢閱
                    </a>
                </div>
            </div>
        `).join("");
    } catch (err) { console.error(err); }
}

// ==========================================
// 📅 6. 行事曆功能
// ==========================================

function initCalendar() {
    const el = document.getElementById('calendar');
    if (!el) return;

    calendar = new FullCalendar.Calendar(el, {
        initialView: 'dayGridMonth',
        locale: 'zh-tw',
        // 🟢 把隱藏的工具列打開，左邊放切換箭頭，中間放月份標題！
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek'
        },
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
    
    const picker = document.getElementById('calendar-month-picker');
    if(picker) {
        picker.addEventListener('change', function() {
            calendar.gotoDate(this.value);
        });
    }
}

// ==========================================
// 🔑 7. 登入/登出
// ==========================================

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
        
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error("伺服器回應錯誤");
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

document.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && !document.getElementById('login-section').classList.contains('d-none')) {
        login();
    }
});

// ==========================================
// 🔘 8. 所有按鈕的互動功能與彈出視窗 (真實運作版)
// ==========================================

// 1️⃣ 開啟行事曆視窗 (已完成)
function openEventModal() {
    document.getElementById('evt-id').value = '';
    document.getElementById('evt-title').value = '';
    document.getElementById('evt-start').value = '';
    document.getElementById('evt-end').value = '';
    document.getElementById('btn-del-evt').classList.add('d-none');
    new bootstrap.Modal(document.getElementById('eventModal')).show();
}

// 📅 儲存行事曆事件
async function saveEvent() { 
    const title = document.getElementById('evt-title').value;
    const start = document.getElementById('evt-start').value;
    const end = document.getElementById('evt-end').value;

    if(!title || !start) return Swal.fire('提示', '請填寫標題與開始時間', 'warning');

    try {
        const res = await fetch(`${API_URL}/api/calendar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ title, start, end })
        });
        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            Swal.fire('成功', '事件已新增', 'success');
            if(calendar) calendar.refetchEvents(); // 刷新行事曆
        } else throw new Error('伺服器錯誤');
    } catch(e) { Swal.fire('錯誤', '儲存失敗，請檢查後端設定', 'error'); }
}

// 2️⃣ 發送留言板訊息
async function sendMessage() { 
    const input = document.getElementById('msg-input');
    const text = input.value.trim();
    if (!text) return; 

    try {
        const res = await fetch(`${API_URL}/api/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ message: text }) 
        });
        if (res.ok) {
            input.value = ''; 
            loadMessages(); // 刷新留言板
        } else throw new Error('發送失敗');
    } catch (err) { Swal.fire('錯誤', '無法連線到伺服器', 'error'); }
}

function handleEnter(e) { 
    if(e.key === 'Enter') {
        e.preventDefault();
        sendMessage(); 
    }
}

// 3️⃣ 提問功能 (彈出精美輸入框)
function openQuestionModal() { 
    Swal.fire({
        title: '新增提問',
        html: `
            <select id="swal-q-target" class="swal2-select" style="width: 80%; font-size: 16px;">
                <option value="teacher">問老師</option>
                <option value="therapist">問治療師</option>
                <option value="parents">問家長</option>
            </select>
            <textarea id="swal-q-text" class="swal2-textarea" placeholder="請輸入您的問題..." style="width: 80%;"></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: '送出提問',
        cancelButtonText: '取消',
        preConfirm: () => {
            const target = document.getElementById('swal-q-target').value;
            const question = document.getElementById('swal-q-text').value.trim();
            if (!question) Swal.showValidationMessage('問題內容不能為空白！');
            return { target_role: target, question: question };
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            try {
                const res = await fetch(`${API_URL}/api/questions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(result.value)
                });
                if (res.ok) {
                    Swal.fire('成功', '提問已送出！', 'success');
                    loadQuestions(); // 刷新提問列表
                } else throw new Error('伺服器錯誤');
            } catch (err) { Swal.fire('錯誤', '送出失敗，請檢查後端設定', 'error'); }
        }
    });
}

// 4️⃣ 開啟治療紀錄表單
function openTherapyForm() {
    new bootstrap.Modal(document.getElementById('therapyRecordModal')).show();
}

// 📝 提交治療紀錄表單
async function submitTherapyRecord() { 
    const date = document.getElementById('form-date').value;
    if(!date) return Swal.fire('提示', '請至少填寫課程日期', 'warning');

    // 自動收集表單內容
    const payload = {
        date: date,
        session_Type: document.querySelector('input[name="form-type"]:checked')?.value || '',
        duration: document.getElementById('form-duration')?.value || '',
        comp_content: document.getElementById('input-comp-content')?.value || '',
        comp_perf: document.getElementById('select-comp-perf')?.value || '',
        exp_content: document.getElementById('input-exp-content')?.value || '',
        exp_perf: document.getElementById('select-exp-perf')?.value || '',
        art_content: document.getElementById('input-art-content')?.value || '',
        art_perf: document.getElementById('select-art-perf')?.value || '',
        comm_content: document.getElementById('input-comm-content')?.value || '',
        comm_perf: document.getElementById('select-comm-perf')?.value || '',
        remarks: document.getElementById('input-remarks')?.value || ''
    };

    try {
        const res = await fetch(`${API_URL}/api/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('therapyRecordModal')).hide();
            Swal.fire('成功', '治療紀錄已新增', 'success');
            loadRecords(); // 刷新紀錄列表
        } else throw new Error('錯誤');
    } catch(e) { Swal.fire('錯誤', '儲存失敗，請檢查後端設定', 'error'); }
}

// 5️⃣ 上傳 IEP 檔案
function openIepUpload() { 
    Swal.fire({
        title: '上傳 IEP 檔案',
        input: 'file',
        inputAttributes: {
            'accept': '.pdf,.doc,.docx',
            'aria-label': '請選擇您的檔案'
        },
        showCancelButton: true,
        confirmButtonText: '確定上傳',
        cancelButtonText: '取消',
        showLoaderOnConfirm: true,
        preConfirm: (file) => {
            if (!file) return Swal.showValidationMessage('請選擇一個檔案');
            const formData = new FormData();
            formData.append('file', file);
            
            return fetch(`${API_URL}/api/iep`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }, // 檔案上傳不需設定 Content-Type，瀏覽器會自動處理
                body: formData
            }).then(res => {
                if (!res.ok) throw new Error('伺服器錯誤');
                return res.json();
            }).catch(error => Swal.showValidationMessage(`上傳失敗，請確認後端是否支援檔案上傳`));
        },
        allowOutsideClick: () => !Swal.isLoading()
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire('成功', '檔案已成功上傳', 'success');
            loadIepFiles(); // 刷新檔案列表
        }
    });
}

// 6️⃣ AI 重點摘要 (保留骨架，待後端 Gemini 介接)
function getAiSummary() { 
    Swal.fire('提示', '前台已經呼叫，需確認後端 server.js 是否有寫好 Gemini API 路由', 'info'); 
}

// ❌ 刪除事件 (暫留空)
function deleteEvent() { 
    Swal.fire('提示', '刪除事件功能準備中', 'info'); 
}