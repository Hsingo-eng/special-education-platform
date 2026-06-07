const API_URL = "https://special-education-platform-production.up.railway.app";
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
        const timeStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;

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
    if (menu) menu.classList.toggle('show');
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

document.addEventListener('click', function (e) {
    const menu = document.getElementById('notification-menu');
    const btn = document.getElementById('btn-notification');
    if (menu && menu.classList.contains('show') && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.remove('show');
    }
});

// ==========================================
// 🔗 2. Socket.io 初始化與精準通知
// ==========================================

if (typeof io !== 'undefined') {
    socket = io(API_URL);

    // 1. 行事曆
    socket.on("calendar_update", (evt) => {
        addNotification('calendar', '新增新排程/刪除排程');
        if (calendar) calendar.refetchEvents();
    });

    // 2. IEP
    socket.on("iep_update", () => {
        addNotification('iep', '新IEP檔案已上傳');
        const section = document.getElementById('section-iep');
        if (section && !section.classList.contains('d-none')) loadIepFiles();
    });

    // 3. 治療紀錄
    socket.on("record_update", () => {
        addNotification('record', '新治療紀錄已上傳');
        const rSection = document.getElementById('section-records');
        if (rSection && !rSection.classList.contains('d-none')) loadRecords();
    });

    // 4. 留言板
    socket.on("message_update", (msg) => {
        // 如果是別人發的訊息才通知
        if (currentUser && msg && msg.username !== currentUser.username) {
            addNotification('message', '留言板有新訊息');
        }
        const chatBox = document.getElementById('chat-box');
        if (chatBox && !document.getElementById('section-messages').classList.contains('d-none')) {
            loadMessages();
        }
    });

    // 5. 提問回覆 (🟢 精準提及判斷)
    socket.on("question_update", (q) => {
        // 只有當傳過來的對象包含當前登入者身分時，才跳通知
        if (currentUser && q && q.target_role && q.target_role.includes(currentUser.role)) {
            addNotification('question', '提問回覆有一則提問提及了您');
        }
        const qSection = document.getElementById('section-questions');
        if (qSection && !qSection.classList.contains('d-none')) loadQuestions();
    });
}

// ==========================================
// 🛠️ 3. 頁面邏輯與登入驗證 (含自動排版修復)
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    renderNotificationList();

    // 🟢 任務一：徹底刪除舊版多餘的「空白大框框」
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.remove();

    // 🟢 任務二：神奇修復術（自動搬家、增加內縮邊距、加上返回按鈕）
    const dashboard = document.getElementById('dashboard-section');
    const sections = ['section-records', 'section-iep', 'section-messages', 'section-questions'];

    if (dashboard) {
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                // 1. 自動搬家，並加上「內縮邊距(container)」防止文字貼齊邊緣
                if (dashboard.contains(el)) {
                    dashboard.parentElement.appendChild(el);
                    // 加入 Bootstrap 專屬的容器與安全留白，讓畫面置中且不貼邊
                    el.classList.add('container', 'mt-4', 'mb-5', 'px-3', 'px-md-4');
                }

                // 2. 幫每個功能畫面加上「返回首頁」的實體按鈕
                if (!el.querySelector('.back-btn')) {
                    const backBtn = document.createElement('div');
                    // 增加底部的 margin (mb-4) 讓按鈕和下方的標題有點呼吸空間
                    backBtn.className = 'back-btn mb-4 mt-2 text-start';
                    backBtn.innerHTML = `
                        <button class="btn btn-outline-secondary rounded-pill px-3 shadow-sm" onclick="showSection('dashboard')" style="border-width: 2px; font-weight: bold; background-color: #f8f9fa;">
                            <i class="fas fa-arrow-left me-1"></i> 返回首頁
                        </button>
                    `;
                    el.prepend(backBtn); // 插入到畫面的最上方
                }
            }
        });
    }

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
    if (header) header.classList.remove("d-none");

    // 4. 權限控制 (隱藏無權限的按鈕)
    document.querySelectorAll(".role-restricted").forEach(el => {
        const deny = el.getAttribute("data-deny");
        if (deny && deny.includes(user.role)) {
            el.style.display = "none";
        }
    });
}

// ==========================================
// 🟢 4. 畫面切換控制與「上一頁」功能
// ==========================================

// 監聽手機或瀏覽器的「上一頁 / 下一頁」動作
window.addEventListener('popstate', function (event) {
    const section = event.state ? event.state.section : 'dashboard';
    executeShowSection(section);
});

// 這是綁定在所有按鈕上的主函式
function showSection(sectionId) {
    // 紀錄瀏覽歷史，這樣手機按「上一頁」或滑動返回才回得來！
    history.pushState({ section: sectionId }, '', '#' + sectionId);
    executeShowSection(sectionId);
}

// 真正負責切換畫面的隱藏/顯示邏輯
function executeShowSection(sectionId) {
    // 1. 先把所有畫面都「強制隱藏」，保持畫面乾淨
    const allSections = [
        'login-section',
        'dashboard-section',
        'section-records',
        'section-iep',
        'section-messages',
        'section-questions'
    ];
    allSections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('d-none');
    });

    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.classList.add('d-none');

    // 2. 根據指令，只顯示目標畫面
    if (sectionId === 'login') {
        document.getElementById('login-section').classList.remove('d-none');
    }
    else if (sectionId === 'dashboard') {
        document.getElementById('dashboard-section').classList.remove('d-none');
        // 行事曆從隱藏變顯示時，需要重新整理大小才不會破圖
        if (calendar) setTimeout(() => calendar.render(), 100);
    }
    else {
        // 顯示特定的功能區塊 (IEP, 治療紀錄等)
        const targetSection = document.getElementById('section-' + sectionId);
        if (targetSection) targetSection.classList.remove('d-none');

        // 載入該區塊的資料
        if (sectionId === 'messages' && typeof loadMessages === 'function') loadMessages();
        if (sectionId === 'questions' && typeof loadQuestions === 'function') loadQuestions();
        if (sectionId === 'records' && typeof loadRecords === 'function') loadRecords();
        if (sectionId === 'iep' && typeof loadIepFiles === 'function') loadIepFiles();
    }
}

// ==========================================
// 🟢 5. 四大功能資料載入 (已對齊您的 Excel 欄位)
// ==========================================

// ==========================================
// ❓ 載入提問列表 (終極多重回覆版)
// ==========================================
async function loadQuestions() {
    try {
        const res = await fetch(`${API_URL}/api/questions`, { headers: { "Authorization": `Bearer ${token}` } });
        const json = await res.json();
        const list = document.getElementById("questions-list");
        if (!list) return;

        if (!json.data || json.data.length === 0) {
            list.innerHTML = '<div class="col-12 text-center text-muted py-5">目前沒有提問資料</div>';
            return;
        }

        // 🟢 強制時間排序：最新日期在上
        const sortedQuestions = json.data.sort((a, b) => new Date(b.date) - new Date(a.date));
        list.innerHTML = sortedQuestions.map(q => {
            let targetStr = (q.target_role || '所有人')
                .replace(/teacher/g, '教師')
                .replace(/therapist/g, '治療師')
                .replace(/parents/g, '家長');

            let askerStr = q.asker_name.replace(/老師/g, '教師');

            // 安全編碼，以便傳遞給按鈕的 onclick 事件
            let safeReply = encodeURIComponent(q.reply || '');

            // 🟢 解析每一則回覆 (支援舊版與新版多重回覆)
            let replyHTML = '';
            if (q.reply && q.reply.trim() !== "") {
                // 用自訂的 [SPLIT] 分隔符號切開每一則回覆
                const replyList = q.reply.split('[SPLIT]');

                replyHTML = replyList.map(r => {
                    // 如果是新版帶有身分標籤的回覆
                    if (r.startsWith('[REPLY]')) {
                        const contentPart = r.replace('[REPLY]', '');
                        const parts = contentPart.split('|');
                        if (parts.length >= 3) {
                            const role = parts[0];
                            const name = parts[1];
                            const text = parts.slice(2).join('|'); // 重新組裝內容
                            return `
                                <div class="bg-light rounded p-2 mt-2 mb-2 text-start text-dark" style="border-left: 4px solid #10B981;">
                                    <div class="fw-bold text-success mb-1" style="font-size: 0.9rem;">
                                        <i class="fas fa-comment-dots"></i> ${name} 回覆：
                                    </div>
                                    <div style="white-space: pre-wrap; font-size: 0.95rem; padding-left: 2px;">${text}</div>
                                </div>
                            `;
                        }
                    }

                    // 如果是舊版，直接顯示
                    return `
                        <div class="bg-light rounded p-2 mt-2 mb-2 text-start text-dark" style="border-left: 4px solid #10B981;">
                            <div class="fw-bold text-success mb-1" style="font-size: 0.9rem;">
                                <i class="fas fa-comment-dots"></i> ${q.replier_name || '回覆者'} 回覆：
                            </div>
                            <div style="white-space: pre-wrap; font-size: 0.95rem; padding-left: 2px;">${r}</div>
                        </div>
                    `;
                }).join('');
            } else {
                replyHTML = `<div class="mt-2 mb-2"><span class="badge bg-warning text-dark">待回覆</span></div>`;
            }

            return `
            <div class="col-12 mb-3">
                <div class="card question-card h-100" data-role="${q.asker_role}">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <span class="badge bg-light text-dark mb-2">To: ${targetStr}</span>
                            <small class="text-muted">${q.date}</small>
                        </div>
                        <h5 class="card-title">${askerStr} 問：</h5>
                        <p class="card-text">${q.question}</p>
                        
                        ${replyHTML}
                        
                        <div class="text-end mt-2">
                            <button class="btn btn-sm btn-outline-primary rounded-pill" onclick="openReplyModal('${q.id}', '${safeReply}')">
                                <i class="fas fa-reply"></i> 我要回覆
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `}).join("");
    } catch (err) { console.error("Load questions failed:", err); }
}

// ==========================================
// ↩️ 回覆問題 (終極多重回覆版)
// ==========================================
function openReplyModal(questionId, encodedExistingReply) {
    // 安全解碼舊的回覆紀錄
    const existingReply = encodedExistingReply ? decodeURIComponent(encodedExistingReply) : '';

    Swal.fire({
        title: '新增回覆',
        input: 'textarea',
        inputPlaceholder: '請輸入您的回覆內容...',
        showCancelButton: true,
        confirmButtonText: '送出回覆',
        cancelButtonText: '取消',
        preConfirm: (text) => {
            if (!text || !text.trim()) {
                Swal.showValidationMessage('回覆內容不能為空白！');
                return false;
            }
            return text.trim();
        }
    }).then(async (result) => {
        if (result.isConfirmed) {
            // 取得中文身分
            let roleName = '家長';
            if (currentUser.role === 'teacher') roleName = '教師';
            if (currentUser.role === 'therapist') roleName = '治療師';

            // 🟢 組合新的回覆內容格式： [REPLY]身分|姓名|內容
            const newReplyBlock = `[REPLY]${roleName}|${currentUser.name || currentUser.username}|${result.value}`;

            // 如果原本已經有回覆了，就用 [SPLIT] 接在舊回覆的後面
            const finalReply = existingReply ? (existingReply + '[SPLIT]' + newReplyBlock) : newReplyBlock;

            try {
                const res = await fetch(`${API_URL}/api/questions/${questionId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ reply: finalReply })
                });

                if (res.ok) {
                    Swal.fire('成功', '回覆已新增！', 'success');
                    loadQuestions();
                } else throw new Error('伺服器錯誤');
            } catch (err) {
                console.error(err);
                Swal.fire('錯誤', '送出失敗，請確認後端是否開啟', 'error');
            }
        }
    });
}

// ==========================================
// 📋 載入治療紀錄 (高質感視覺設計版)
// ==========================================
async function loadRecords() {
    try {
        const res = await fetch(`${API_URL}/api/records`, { headers: { "Authorization": `Bearer ${token}` } });
        const json = await res.json();
        const list = document.getElementById("record-list");
        if (!list) return;

        if (!json.data || json.data.length === 0) {
            list.innerHTML = '<div class="text-center text-muted py-5">暫無治療紀錄</div>';
            return;
        }

        // 🟢 強制時間排序：最新日期在上
        const sortedRecords = json.data.sort((a, b) => new Date(b.date) - new Date(a.date));
        list.innerHTML = sortedRecords.map(r => {
            // 整理學習內容 (只顯示有勾選的類別名稱)
            let learningContent = [];
            if (r.comp_content) learningContent.push(`語言理解`);
            if (r.exp_content) learningContent.push(`語言表達`);
            if (r.art_content) learningContent.push(`構音練習`);
            if (r.comm_content) learningContent.push(`溝通互動`);
            let learningStr = learningContent.length > 0 ? learningContent.join(' / ') : '無';

            // 🟢 全新卡片式視覺設計 (主題藍、白、灰)
            return `
            <div class="card border-0 shadow-sm mb-4" style="border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                <div class="card-header d-flex justify-content-between align-items-center py-3" style="background-color: #3b82f6; border-bottom: none;">
                    <div class="fw-bold text-white fs-6" style="letter-spacing: 1px;">
                        <i class="fas fa-file-medical me-2"></i>治療紀錄
                    </div>
                    <span class="badge bg-white text-primary rounded-pill px-3 py-1 shadow-sm" style="font-size: 0.85rem;">${r.date}</span>
                </div>
                
                <div class="card-body p-4">
                    
                    <div class="row mb-4">
                        <div class="col-6 border-end">
                            <div class="text-muted small fw-bold mb-1" style="letter-spacing: 1px;">形式</div>
                            <span class="badge rounded-pill px-3 py-2" style="background-color: #f1f5f9; color: #475569; font-weight: 600; font-size: 0.9rem;">
                                ${r.session_Type || '未填寫'}
                            </span>
                        </div>
                        <div class="col-6 ps-4">
                            <div class="text-muted small fw-bold mb-1" style="letter-spacing: 1px;">參與度</div>
                            <div class="text-dark fw-bold" style="font-size: 1.05rem;">${r.participation || '無'}</div>
                        </div>
                    </div>

                    <div class="mb-4 p-3 rounded" style="background-color: #f8fafc; border-left: 5px solid #3b82f6;">
                        <div class="text-muted small fw-bold mb-1" style="letter-spacing: 1px;">學習內容</div>
                        <div class="text-dark fw-bold fs-6" style="line-height: 1.6;">${learningStr}</div>
                    </div>

                    <div class="mb-3">
                        <div class="text-muted small fw-bold mb-1" style="letter-spacing: 1px;">
                            <i class="fas fa-lightbulb text-warning me-1"></i>延伸策略
                        </div>
                        <p class="text-dark mb-0 bg-white border rounded p-3" style="line-height: 1.6; border-color: #e2e8f0;">
                            ${r.strategies || '無'}
                        </p>
                    </div>
                    
                    <div class="mb-0">
                        <div class="text-muted small fw-bold mb-1" style="letter-spacing: 1px;">
                            <i class="fas fa-comment-dots text-secondary me-1"></i>補充事項
                        </div>
                        <p class="text-dark mb-0 bg-white border rounded p-3" style="line-height: 1.6; border-color: #e2e8f0;">
                            ${r.remarks || '無'}
                        </p>
                    </div>

                </div>
            </div>
            `}).join("");
    } catch (err) { console.error("Load records failed:", err); }
}

// ==========================================
// 💬 載入留言板 (修正靠右判斷與純中文身分)
// ==========================================
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
            // 🟢 強化判斷：只要角色一樣就當作自己發的，解決 teacher 與 老師 文字不對等的問題
            const isSelf = (msg.user_name === currentUser.username) || (msg.role === currentUser.role);
            const div = document.createElement("div");
            div.className = `msg-row ${isSelf ? "self" : "other"}`;

            let sticker = 'sticker3.png';
            let displayRole = '家長'; // 🟢 設定純中文身分

            if (msg.role === 'teacher') {
                sticker = 'sticker1.png';
                displayRole = '教師';
            } else if (msg.role === 'therapist') {
                sticker = 'sticker2.png';
                displayRole = '治療師';
            }

            // 🟢 移除了括號與英文，只顯示純中文身分
            div.innerHTML = `
                <div class="msg-avatar"><img src="${sticker}"></div>
                <div class="msg-bubble">
                    <span class="msg-role">${displayRole}</span>
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
        if (!res.ok) throw new Error("API Error");
        const json = await res.json();
        const list = document.getElementById("iep-list");
        if (!list) return;

        if (json.data.length === 0) {
            list.innerHTML = '<div class="col-12 text-center text-muted py-5">暫無檔案</div>';
            return;
        }

       // 🟢 強制時間排序：最新日期在上
        const sortedIep = json.data.sort((a, b) => new Date(b.upload_date) - new Date(a.upload_date));
        list.innerHTML = sortedIep.map(f => `
            <div class="col-md-4">
                <div class="card p-3 shadow-sm h-100 border-0 bg-light">
                    <div class="d-flex align-items-center mb-3">
                        <i class="fas fa-file-pdf fa-2x text-danger me-3"></i>
                        <h6 class="mb-0 fw-bold text-dark text-truncate" title="${f.filename}">${f.filename}</h6>
                    </div>
                    <small class="text-muted d-block mb-1">上傳者: ${f.uploaded_by}</small>
                    <small class="text-muted d-block mb-3">日期: ${f.upload_date}</small>
                    <a href="${f.file_link}" target="_blank" class="btn btn-outline-danger btn-sm w-100 rounded-pill mb-2">
                        <i class="fas fa-download"></i> 下載檢閱
                    </a>
                    ${currentUser.role === 'teacher' ? `
                    <button class="btn btn-outline-secondary btn-sm w-100 rounded-pill" onclick="deleteIep('${f.id}')">
                        <i class="fas fa-trash-alt"></i> 刪除檔案
                    </button>
                    ` : ''}
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
       // ==========================================
        // 📅 行事曆點擊事件核心控制
        // ==========================================
        events: `${API_URL}/api/calendar`,

        // 🟢 功能 A：點擊「日期空白處或數字」，直接彈出新增事件視窗
        dateClick: function(info) {
            // 先清空表單舊資料
            document.getElementById('eventForm').reset();
            document.getElementById('evt-id').value = '';
            
            // 自動填入點擊的日期 (預設早上 08:00 到 09:00)
            document.getElementById('evt-start').value = `${info.dateStr}T08:00`;
            document.getElementById('evt-end').value = `${info.dateStr}T09:00`;
            
            // 顯示新增彈出視窗
            new bootstrap.Modal(document.getElementById('eventModal')).show();
        },

        // 🟢 功能 B：點擊「已經設定好的事件」，恢復跳出原本的詳細通知視窗
        eventClick: function(info) {
            const formatTime = (date) => {
                if (!date) return '';
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            };
            const startStr = formatTime(info.event.start);
            const endStr = formatTime(info.event.end);
            const timeStr = endStr ? `${startStr} - ${endStr}` : startStr;
            
            // 安全地取得建立者名稱
            const creator = info.event.extendedProps && info.event.extendedProps.creator 
                            ? info.event.extendedProps.creator 
                            : '未知';

            // 彈出原本的詳細通知
            Swal.fire({
                title: info.event.title,
                html: `時間：${timeStr}<br><br><span style="color: #6c757d; font-size: 0.9em;">由 (${creator}) 新增</span>`,
                icon: 'info',
                confirmButtonText: 'OK'
            });
        }
    });
    calendar.render();

    const picker = document.getElementById('calendar-month-picker');
    if (picker) {
        picker.addEventListener('change', function () {
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

    if (!u || !p) return Swal.fire("請輸入帳號密碼");

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


// ==========================================
// 📅 儲存行事曆事件 (修正欄位名稱與後端對齊)
// ==========================================
async function saveEvent() {
    const title = document.getElementById('evt-title').value;
    const startInput = document.getElementById('evt-start').value;

    if (!title || !startInput) {
        return Swal.fire('提示', '請填寫標題與開始時間', 'warning');
    }

    // 🟢 HTML 的時間長這樣: "2026-02-21T11:02"
    // 我們把它一分為二，變成後端認識的 "date" 和 "time"
    const datePart = startInput.split('T')[0]; // 取得 2026-02-21
    const timePart = startInput.split('T')[1]; // 取得 11:02

    try {
        const res = await fetch(`${API_URL}/api/calendar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            // 🟢 恢復使用後端原本設定好的名稱：date 和 time
            body: JSON.stringify({
                title: title,
                date: datePart,
                time: timePart,
                description: ""
            })
        });

        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            Swal.fire('成功', '事件已順利新增！', 'success');
            if (calendar) calendar.refetchEvents(); // 自動重新載入行事曆畫面
        } else {
            throw new Error('伺服器錯誤');
        }
    } catch (e) {
        console.error(e);
        Swal.fire('錯誤', '儲存失敗，請檢查後端設定', 'error');
    }
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
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
}

// ==========================================
// ❓ 新增提問 (改為多選 checkbox)
// ==========================================
function openQuestionModal() {
    Swal.fire({
        title: '新增提問',
        html: `
            <div class="mb-3 text-start" style="width: 80%; margin: 0 auto;">
                <label class="form-label text-secondary small fw-bold mb-2">選擇提問對象 (可複選)：</label>
                <div class="d-flex justify-content-start gap-4 mb-3">
                    <div class="form-check">
                        <input class="form-check-input q-target-cb" type="checkbox" value="teacher" id="q-tgt-teacher">
                        <label class="form-check-label" for="q-tgt-teacher" style="cursor: pointer;">老師</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input q-target-cb" type="checkbox" value="therapist" id="q-tgt-therapist">
                        <label class="form-check-label" for="q-tgt-therapist" style="cursor: pointer;">治療師</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input q-target-cb" type="checkbox" value="parents" id="q-tgt-parents">
                        <label class="form-check-label" for="q-tgt-parents" style="cursor: pointer;">家長</label>
                    </div>
                </div>
            </div>
            <textarea id="swal-q-text" class="swal2-textarea mt-0" placeholder="請輸入您的問題..." style="width: 80%;"></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: '送出提問',
        cancelButtonText: '取消',
        preConfirm: () => {
            // 🟢 抓取所有被打勾的選項
            const checkedBoxes = document.querySelectorAll('.q-target-cb:checked');
            const targets = Array.from(checkedBoxes).map(cb => cb.value).join(',');
            const question = document.getElementById('swal-q-text').value.trim();

            // 阻擋未填寫狀態
            if (!targets) {
                Swal.showValidationMessage('請至少勾選一個提問對象！');
                return false;
            }
            if (!question) {
                Swal.showValidationMessage('問題內容不能為空白！');
                return false;
            }

            return { target_role: targets, question: question };
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
    if (!date) return Swal.fire('提示', '請至少填寫課程日期', 'warning');

    // 🟢 抓取「幼兒參與狀況」有打勾的項目，並包含「其他」輸入框內的文字
    let partChecked = Array.from(document.querySelectorAll('.check-part:checked')).map(cb => cb.value);
    const otherCheckbox = document.getElementById('check-part-other');
    if (otherCheckbox && otherCheckbox.checked) {
        const otherText = document.getElementById('input-part-other').value.trim();
        if (otherText) partChecked.push(otherText);
    }

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

        participation: partChecked.join('、'), // 🟢 用頓號串接所有勾選的狀況
        strategies: document.getElementById('input-strategies')?.value || '',
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
            document.getElementById('therapyForm').reset();
            document.querySelectorAll('[id^="area-"]').forEach(el => el.classList.add('d-none'));
            const partOtherInput = document.getElementById('input-part-other');
            if (partOtherInput) partOtherInput.disabled = true; // 鎖回輸入框
        } else throw new Error('錯誤');
    } catch (e) { Swal.fire('錯誤', '儲存失敗，請檢查後端設定', 'error'); }
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

// ==========================================
// 🤖 呼叫 AI 重點摘要功能
// ==========================================
async function getAiSummary() {
    try {
        // 1. 顯示載入中的動畫
        Swal.fire({
            title: '正在生成 AI 摘要...',
            text: 'Gemini 正在為您統整留言板重點，請稍候',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        // 2. 呼叫後端 API (假設後端路由設定為 /api/summary)
        const res = await fetch(`${API_URL}/api/summary`, {
            headers: { "Authorization": `Bearer ${token}` }
        });

        if (res.ok) {
            const data = await res.json();
            Swal.close(); // 關閉載入動畫

            // 3. 將資料填入畫面上隱藏的 AI 框塊，並顯示出來
            const summaryBox = document.getElementById('ai-summary-box');
            const summaryContent = document.getElementById('ai-summary-content');
            if (summaryBox && summaryContent) {
                summaryBox.classList.remove('d-none');
                // 將換行符號轉換成 HTML 的 <br> 讓排版整齊
                summaryContent.innerHTML = data.summary.replace(/\n/g, '<br>');
            }
        } else {
            throw new Error('無法取得摘要');
        }
    } catch (err) {
        console.error(err);
        Swal.fire({
            title: '提示',
            text: '前端已經準備好囉！但後端 (server.js) 似乎還沒接上 Gemini API 或是發生錯誤。',
            icon: 'info'
        });
    }
}

// ==========================================
// 📅 行事曆：新增/編輯/刪除操作
// ==========================================

window.openEventModal = function () {
    document.getElementById('eventForm').reset();
    document.getElementById('evt-id').value = '';
    document.getElementById('btn-del-evt').classList.add('d-none'); // 隱藏刪除按鈕

    // 預設開始時間為現在
    const now = new Date();
    const start = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    document.getElementById('evt-start').value = start;

    const eventModal = new bootstrap.Modal(document.getElementById('eventModal'));
    eventModal.show();
};

window.saveEvent = async function () {
    const id = document.getElementById('evt-id').value;
    const title = document.getElementById('evt-title').value;
    let start = document.getElementById('evt-start').value;
    let end = document.getElementById('evt-end').value;

    if (!title || !start) return Swal.fire('錯誤', '標題與開始時間為必填', 'error');

    // 🟢 時區修正魔法：強制加上台灣時區 (+08:00)，防止被當成 UTC 導致時間飄移 8 小時
    if (start && start.length === 16) start += ":00+08:00";
    if (end && end.length === 16) end += ":00+08:00";

    const method = id ? 'PUT' : 'POST';
    const url = id ? `${API_URL}/api/calendar/${id}` : `${API_URL}/api/calendar`;

    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ title, start, end })
        });
        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            Swal.fire('成功', id ? '事件已更新' : '事件已新增', 'success');
            initCalendar(); // 重新載入行事曆
        } else {
            throw new Error('儲存失敗');
        }
    } catch (err) {
        Swal.fire('錯誤', err.message, 'error');
    }
};

window.deleteEvent = async function () {
    const id = document.getElementById('evt-id').value;
    if (!id) return;

    const result = await Swal.fire({
        title: '確定要刪除嗎？',
        text: "刪除後將無法還原！",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: '是的，刪除！',
        cancelButtonText: '取消'
    });

    if (result.isConfirmed) {
        try {
            const res = await fetch(`${API_URL}/api/calendar/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
                Swal.fire('已刪除', '事件已成功刪除', 'success');
                initCalendar(); // 重新載入行事曆
            } else {
                throw new Error('刪除失敗');
            }
        } catch (err) {
            Swal.fire('錯誤', err.message, 'error');
        }
    }
};

// 🗑️ 刪除 IEP 檔案功能
window.deleteIep = async function (id) {
    const result = await Swal.fire({
        title: '確定要刪除嗎？',
        text: "檔案將從雲端硬碟徹底移除，無法還原喔！",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        cancelButtonColor: '#3085d6',
        confirmButtonText: '是的，刪除！',
        cancelButtonText: '取消'
    });

    if (result.isConfirmed) {
        try {
            const res = await fetch(`${API_URL}/api/iep/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                Swal.fire('已刪除', '檔案已成功刪除', 'success');
                loadIepFiles(); // 🟢 重新載入 IEP 列表
            } else {
                throw new Error('刪除失敗');
            }
        } catch (err) {
            Swal.fire('錯誤', err.message, 'error');
        }
    }
};