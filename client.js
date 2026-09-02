const API_URL = "https://special-education-platform-production.up.railway.app";
let currentUser = null;
let token = localStorage.getItem("token");
let socket = null;
let calendar = null;

const APP_SECTIONS = [
    'login-section',
    'dashboard-section',
    'content-area',
    'section-records',
    'section-iep',
    'section-messages',
    'section-questions',
    'section-calendar',
    'section-home-log'
];

const safeCall = (fn) => typeof fn === 'function' && fn();
const hasElement = (id) => !!document.getElementById(id);

const getUserRoleLabel = (role) => {
    if (role === 'teacher') return '教師';
    if (role === 'therapist') return '治療師';
    return '家長';
};

const normalizeRoleLabel = (label = '') => {
    if (!label) return '家長';
    const clean = String(label)
        .replace(/老師\s*\(教師\)|教師\s*\(老師\)|治療師\s*\(治療師\)|家長\s*\(家長\)/g, match => {
            if (match.includes('老師') || match.includes('教師')) return '教師';
            if (match.includes('治療師')) return '治療師';
            return '家長';
        })
        .replace(/\s*\((教師|治療師|家長|老師)\)\s*/g, '')
        .replace(/老師/g, '教師');

    return clean || '家長';
};

const formatHomeAuthor = (author = '') => {
    const parts = String(author).split(/[|｜]/).map(part => part.trim()).filter(Boolean);
    if (parts.length < 2) return author;

    const role = normalizeRoleLabel(parts.pop());
    let name = parts.join(' | ');
    const roleSuffix = role === '教師' ? '(?:教師|老師)' : role;
    name = name
        .replace(new RegExp(`\\s*[（(]\\s*${roleSuffix}\\s*[)）]\\s*$`), '')
        .replace(new RegExp(`${roleSuffix}$`), '')
        .trim();

    return `${name} | ${role}`;
};

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

    socket.on("calendar_update", (evt) => {
        addNotification('calendar', '新增新排程/刪除排程');
        if (calendar) calendar.refetchEvents();
    });

    socket.on("iep_update", () => {
        addNotification('iep', '新IEP檔案已上傳');
        const section = document.getElementById('section-iep');
        if (section && !section.classList.contains('d-none')) loadIepFiles();
    });

    socket.on("record_update", () => {
        addNotification('record', '新治療紀錄已上傳');
        const rSection = document.getElementById('section-records');
        if (rSection && !rSection.classList.contains('d-none')) loadRecords();
    });

    socket.on("message_update", (msg) => {
        if (currentUser && msg && msg.username !== currentUser.username) {
            addNotification('message', '留言板有新訊息');
        }
        const chatBox = document.getElementById('chat-box');
        if (chatBox && !document.getElementById('section-messages').classList.contains('d-none')) {
            loadMessages();
        }
    });

    socket.on("question_update", (q) => {
        if (currentUser && q && q.target_role && q.target_role.includes(currentUser.role)) {
            addNotification('question', '提問回覆有一則提問提及了您');
        }
        const qSection = document.getElementById('section-questions');
        if (qSection && !qSection.classList.contains('d-none')) loadQuestions();
    });
}

// ==========================================
// 🛠️ 3. 頁面邏輯與登入驗證
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    renderNotificationList();

    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.remove();

    const sections = [
        'section-records', 
        'section-iep', 
        'section-messages', 
        'section-questions',
        'section-calendar',
        'section-home-log'
    ];
    
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.querySelector('.back-btn')) {
            const backBtn = document.createElement('div');
            backBtn.className = 'back-btn mb-4 mt-2 text-start';
            backBtn.innerHTML = `
                <button class="btn btn-outline-secondary rounded-pill px-3 shadow-sm" onclick="showSection('dashboard')" style="border-width: 2px; font-weight: bold; background-color: #f8f9fa;">
                    <i class="fas fa-arrow-left me-1"></i> 返回首頁
                </button>
            `;
            el.prepend(backBtn); 
        }
    });

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
    let roleName = '家長';
    let avatarSrc = 'sticker3.png';

    if (user.role === 'teacher') {
        roleName = '教師';
        avatarSrc = 'sticker1.png';
    } else if (user.role === 'therapist') {
        roleName = '治療師';
        avatarSrc = 'sticker2.png';
    }

    document.getElementById("nav-user-info").innerText = `${roleName} | ${user.username}`;
    document.getElementById("header-user-avatar").src = avatarSrc;

    const header = document.getElementById("main-nav");
    if (header) header.classList.remove("d-none");

    document.querySelectorAll(".role-restricted").forEach(el => {
        const deny = el.getAttribute("data-deny");
        if (deny && deny.includes(user.role)) {
            el.style.display = "none";
        }
    });
}

// ==========================================
// 🟢 4. 畫面切換控制
// ==========================================

const getAuthHeaders = (extraHeaders = {}) => ({
    Authorization: `Bearer ${token}`,
    ...extraHeaders
});

async function apiRequest(url, options = {}) {
    const { headers = {}, body, ...rest } = options;
    const isFormData = body instanceof FormData;
    const mergedHeaders = {
        ...headers,
        ...(isFormData ? {} : { 'Content-Type': headers['Content-Type'] || 'application/json' })
    };

    return fetch(url, {
        ...rest,
        body,
        headers: getAuthHeaders(mergedHeaders)
    });
}

const getSectionElement = (id) => document.getElementById(id);

const SECTION_LOADERS = {
    messages: () => safeCall(loadMessages),
    questions: () => safeCall(loadQuestions),
    records: () => safeCall(loadRecords),
    iep: () => safeCall(loadIepFiles),
    'home-log': () => safeCall(loadHomeLogs),
};

function loadSectionData(sectionId) {
    if (sectionId in SECTION_LOADERS) {
        SECTION_LOADERS[sectionId]?.();
    }

    if (sectionId === 'calendar' && calendar) {
        setTimeout(() => calendar.render(), 100);
    }
}

window.addEventListener('popstate', function (event) {
    const section = event.state ? event.state.section : 'dashboard';
    executeShowSection(section);
});

function showSection(sectionId) {
    history.pushState({ section: sectionId }, '', '#' + sectionId);
    executeShowSection(sectionId);
}

function executeShowSection(sectionId) {
    APP_SECTIONS.forEach(id => {
        const el = getSectionElement(id);
        if (el) el.classList.add('d-none');
    });

    if (sectionId === 'login') {
        const loginSection = getSectionElement('login-section');
        if (loginSection) loginSection.classList.remove('d-none');
        return;
    }

    if (sectionId === 'dashboard') {
        const dashboardSection = getSectionElement('dashboard-section');
        if (dashboardSection) dashboardSection.classList.remove('d-none');
        return;
    }

    const contentArea = getSectionElement('content-area');
    if (contentArea) contentArea.classList.remove('d-none');

    const targetSection = getSectionElement('section-' + sectionId);
    if (targetSection) targetSection.classList.remove('d-none');

    loadSectionData(sectionId);
}

// ==========================================
// 💡 提問與回覆：角色視覺對照輔助函數
// ==========================================
function getRoleVisuals(roleString) {
    let avatar = 'sticker3.png';
    let className = 'text-warning';
    if (roleString && roleString.includes('教師')) {
        avatar = 'sticker1.png';
        className = 'text-primary';
    } else if (roleString && roleString.includes('治療師')) {
        avatar = 'sticker2.png';
        className = 'text-success';
    }
    return {
        avatar: `<img src="${avatar}" class="role-avatar" alt="角色頭像">`,
        class: className
    };
}

// ==========================================
// 💬 提問與回覆：載入與渲染功能 (強烈區塊設計版)
// ==========================================
async function loadQuestions() {
    try {
        const res = await apiRequest(`${API_URL}/api/questions`);
        const json = await res.json();
        const list = document.getElementById("questions-list");
        if (!list) return;

        if (!json.data || json.data.length === 0) {
            list.innerHTML = '<div class="text-center py-5 text-muted"><i class="far fa-comments fa-3x mb-3"></i><p>目前尚無任何提問紀錄</p></div>';
            return;
        }

        // 依日期排序 (最新在上)
        const sortedQuestions = json.data.sort((a, b) => new Date(b.date) - new Date(a.date));
        
        list.innerHTML = sortedQuestions.map(q => {
            let targetStr = (q.target_role || '所有人').replace(/teacher/g, '教師').replace(/therapist/g, '治療師').replace(/parents/g, '家長');
            let askerStr = normalizeRoleLabel(q.asker_name || '').includes('教師') ? q.asker_name.replace(/老師/g, '教師') : q.asker_name;
            let safeReply = encodeURIComponent(q.reply || '');

            const askerVis = getRoleVisuals(askerStr);
            const targetVis = getRoleVisuals(targetStr);

            // ========================================
            // 1. 卡片外框與表頭區塊 (灰色底, 清楚的邊框)
            // ========================================
            let html = `
            <div class="card mb-4 shadow-sm" style="border: 1px solid #cbd5e1; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
                
                <div class="card-header d-flex justify-content-between align-items-center" style="background-color: #f8fafc; border-bottom: 1px solid #cbd5e1; padding: 12px 20px;">
                    <div class="fw-bold" style="font-size: 1rem; color: #334155;">
                        <span class="${askerVis.class}">${askerVis.avatar} ${askerStr}</span>
                        <i class="fas fa-arrow-right mx-2 text-muted"></i>
                        <span class="${targetVis.class}">${targetVis.avatar} ${targetStr}</span>
                    </div>
                    <div class="text-muted small">${q.date}</div>
                </div>

                <div class="card-body" style="padding: 24px;">
                    
                    <!-- ======================================== -->
                    <!-- 2. 提問區塊 (淺藍色底, 左側藍色粗框)       -->
                    <!-- ======================================== -->
                    <div style="background-color: #f0f9ff; border: 1px solid #bae6fd; border-left: 6px solid #0ea5e9; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
                        <div class="d-flex align-items-center mb-2" style="font-size: 0.9rem; font-weight: 600; color: #475569;">
                            ${askerVis.avatar} ${askerStr} <span class="ms-2 text-muted fw-normal">提出問題</span>
                        </div>
                        <div style="color: #0f172a; font-size: 1.05rem; white-space: pre-wrap; line-height: 1.6;">${q.question}</div>
                    </div>
            `;

            // ========================================
            // 3. 回覆區塊 (若有回覆)
            // ========================================
            if (q.reply && q.reply.trim() !== "") {
                const replyList = q.reply.split('[SPLIT]');
                let repliesHtml = replyList.map(r => {
                    let roleName = '回覆者'; let replyName = q.replier_name || '回覆者'; let replyText = r;
                    let rVis = getRoleVisuals(replyName);

                    if (r.startsWith('[REPLY]')) {
                        const contentPart = r.replace('[REPLY]', '');
                        const parts = contentPart.split('|');
                        if (parts.length >= 3) {
                            roleName = parts[0]; replyName = parts[1]; replyText = parts.slice(2).join('|');
                            rVis = getRoleVisuals(roleName);
                        }
                    }

                    return `
                    <div class="text-center text-muted my-3"><i class="fas fa-arrow-down" style="color: #94a3b8;"></i></div>
                    
                    <!-- 淺綠色底, 左側綠色粗框 -->
                    <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-left: 6px solid #10b981; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
                        <div class="d-flex align-items-center mb-2" style="font-size: 0.9rem; font-weight: 600; color: #475569;">
                            ${rVis.avatar} ${replyName} <span class="ms-2 text-muted fw-normal">回覆</span>
                        </div>
                        <div style="color: #0f172a; font-size: 1.05rem; white-space: pre-wrap; line-height: 1.6;">${replyText}</div>
                    </div>`;
                }).join('');
                
                html += repliesHtml;
                
                html += `
                </div>
                <!-- ======================================== -->
                <!-- 4. 底部狀態列 (已回覆狀態)                 -->
                <!-- ======================================== -->
                <div class="card-footer d-flex justify-content-between align-items-center" style="background-color: #f8fafc; border-top: 1px solid #cbd5e1; padding: 14px 20px;">
                    <span class="badge rounded-pill" style="background-color: #d1fae5; color: #065f46; font-size: 0.9rem; padding: 8px 16px; border: 1px solid #a7f3d0;">
                        <i class="fas fa-check-circle me-1"></i> 已回覆
                    </span>
                    <button class="btn btn-outline-secondary btn-sm rounded-pill px-4 fw-bold" onclick="openReplyModal('${q.id}', '${safeReply}')">
                        <i class="fas fa-reply me-1"></i> 補充回覆
                    </button>
                </div>`;
            } else {
                html += `
                </div>
                <!-- ======================================== -->
                <!-- 4. 底部狀態列 (等待回覆狀態)               -->
                <!-- ======================================== -->
                <div class="card-footer d-flex justify-content-between align-items-center" style="background-color: #f8fafc; border-top: 1px solid #cbd5e1; padding: 14px 20px;">
                    <span class="badge rounded-pill" style="background-color: #fef3c7; color: #b45309; font-size: 0.9rem; padding: 8px 16px; border: 1px solid #fde68a;">
                        <i class="fas fa-hourglass-half me-1"></i> 等待 ${targetStr} 回覆
                    </span>
                    <button class="btn btn-primary btn-sm rounded-pill px-4 fw-bold shadow-sm" onclick="openReplyModal('${q.id}', '${safeReply}')">
                        <i class="fas fa-reply me-1"></i> 回覆此問題
                    </button>
                </div>`;
            }

            html += `</div>`; // 結束整張卡片
            return html;
        }).join('');
        
    } catch (err) { 
        console.error("Load questions failed:", err); 
    }
}

function openReplyModal(questionId, encodedExistingReply) {
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
            const roleName = getUserRoleLabel(currentUser?.role);
            const newReplyBlock = `[REPLY]${roleName}|${currentUser.name || currentUser.username}|${result.value}`;
            const finalReply = existingReply ? (existingReply + '[SPLIT]' + newReplyBlock) : newReplyBlock;

            try {
                const res = await apiRequest(`${API_URL}/api/questions/${questionId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
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

async function loadRecords() {
    try {
        const res = await apiRequest(`${API_URL}/api/records`);
        const json = await res.json();
        const list = document.getElementById("record-list");
        if (!list) return;

        if (!json.data || json.data.length === 0) {
            list.innerHTML = '<div class="text-center text-muted py-5">暫無治療紀錄</div>';
            return;
        }

        const sortedRecords = json.data.sort((a, b) => new Date(b.date) - new Date(a.date));
        list.innerHTML = sortedRecords.map(r => {
            let learningContent = [];
            if (r.comp_content) learningContent.push(`語言理解`);
            if (r.exp_content) learningContent.push(`語言表達`);
            if (r.art_content) learningContent.push(`構音練習`);
            if (r.comm_content) learningContent.push(`溝通互動`);
            let learningStr = learningContent.length > 0 ? learningContent.join(' / ') : '無';

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

async function loadMessages() {
    try {
        const res = await apiRequest(`${API_URL}/api/messages`);
        const json = await res.json();
        const chatBox = document.getElementById("chat-box");
        if (!chatBox) return;

        chatBox.innerHTML = "";
        json.data.forEach(msg => {
            // 🟢 修正靠右判斷：比對發言帳號或是使用者全名，更加精準
            const isSelf = (currentUser && (msg.username === currentUser.username || msg.user_name === currentUser.name));
            const div = document.createElement("div");
            div.className = `msg-row ${isSelf ? "self" : "other"}`;

            let sticker = 'sticker3.png';
            let displayRole = getUserRoleLabel(msg.role || 'parents');

            if (msg.role === 'teacher') {
                sticker = 'sticker1.png';
            } else if (msg.role === 'therapist') {
                sticker = 'sticker2.png';
            }

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
        const res = await apiRequest(`${API_URL}/api/iep`);
        if (!res.ok) throw new Error("API Error");
        const json = await res.json();
        const list = document.getElementById("iep-list");
        if (!list) return;

        if (json.data.length === 0) {
            list.innerHTML = '<div class="col-12 text-center text-muted py-5">暫無檔案</div>';
            return;
        }

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
                const json = await res.json();
                
                const parsedEvents = json.data.map(e => {
                    let startDT = e.start || (e.date && e.time ? `${e.date}T${e.time}` : e.date);
                    let creatorRole = '未知';
                    if (e.role === 'teacher') creatorRole = '教師';
                    else if (e.role === 'therapist') creatorRole = '治療師';
                    else if (e.role === 'parents') creatorRole = '家長';

                    return {
                        id: e.id,
                        title: e.title,
                        start: startDT,
                        end: e.end || null,
                        backgroundColor: e.role === 'teacher' ? '#F97316' : '#10B981', 
                        borderColor: 'transparent',
                        textColor: '#ffffff',
                        display: 'block',
                        extendedProps: { creator: creatorRole }
                    };
                });
                successCallback(parsedEvents);
            } catch (err) {
                console.error("載入排程失敗:", err);
                failureCallback(err);
            }
        },

        dateClick: function(info) {
            document.getElementById('eventForm').reset();
            document.getElementById('evt-id').value = '';
            
            document.getElementById('evt-start').value = `${info.dateStr}T08:00`;
            document.getElementById('evt-end').value = `${info.dateStr}T09:00`;
            
            const delBtn = document.getElementById('btn-del-evt');
            if (delBtn) delBtn.classList.add('d-none');
            
            new bootstrap.Modal(document.getElementById('eventModal')).show();
        },

        eventClick: function(info) {
            const evt = info.event;
            
            const formatForInput = (dateObj) => {
                if (!dateObj) return '';
                const localDate = new Date(dateObj.getTime() - (dateObj.getTimezoneOffset() * 60000));
                return localDate.toISOString().slice(0, 16);
            };

            document.getElementById('evt-id').value = evt.id || '';
            document.getElementById('evt-title').value = evt.title || '';
            document.getElementById('evt-start').value = formatForInput(evt.start);
            document.getElementById('evt-end').value = formatForInput(evt.end);

            const delBtn = document.getElementById('btn-del-evt');
            if (delBtn) delBtn.classList.remove('d-none');

            new bootstrap.Modal(document.getElementById('eventModal')).show();
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
// 🔘 8. 互動功能與彈窗
// ==========================================

window.openEventModal = function () {
    document.getElementById('eventForm').reset();
    document.getElementById('evt-id').value = '';
    document.getElementById('evt-title').value = '';
    document.getElementById('evt-start').value = '';
    document.getElementById('evt-end').value = '';
    document.getElementById('btn-del-evt').classList.add('d-none');
    new bootstrap.Modal(document.getElementById('eventModal')).show();
};

window.saveEvent = async function () {
    const id = document.getElementById('evt-id').value;
    const title = document.getElementById('evt-title').value;
    let start = document.getElementById('evt-start').value;
    let end = document.getElementById('evt-end').value;

    if (!title || !start) return Swal.fire('錯誤', '標題與開始時間為必填', 'error');

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
            if (calendar) calendar.refetchEvents();
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
                if (calendar) calendar.refetchEvents();
            } else {
                throw new Error('刪除失敗');
            }
        } catch (err) {
            Swal.fire('錯誤', err.message, 'error');
        }
    }
};

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
            loadMessages();
        } else throw new Error('發送失敗');
    } catch (err) { Swal.fire('錯誤', '無法連線到伺服器', 'error'); }
}

function handleEnter(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        sendMessage();
    }
}

function openQuestionModal() {
    Swal.fire({
        title: '新增提問',
        html: `
            <div class="mb-3 text-start" style="width: 80%; margin: 0 auto;">
                <label class="form-label text-secondary small fw-bold mb-2">選擇提問對象 (可複選)：</label>
                <div class="d-flex justify-content-start gap-4 mb-3">
                    <div class="form-check">
                        <!-- value 改為統一的中文名稱 -->
                        <input class="form-check-input q-target-cb" type="checkbox" value="教師" id="q-tgt-teacher">
                        <label class="form-check-label" for="q-tgt-teacher" style="cursor: pointer;"><img src="sticker1.png" class="role-avatar" alt="教師頭像">教師</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input q-target-cb" type="checkbox" value="治療師" id="q-tgt-therapist">
                        <label class="form-check-label" for="q-tgt-therapist" style="cursor: pointer;"><img src="sticker2.png" class="role-avatar" alt="治療師頭像">治療師</label>
                    </div>
                    <div class="form-check">
                        <input class="form-check-input q-target-cb" type="checkbox" value="家長" id="q-tgt-parents">
                        <label class="form-check-label" for="q-tgt-parents" style="cursor: pointer;"><img src="sticker3.png" class="role-avatar" alt="家長頭像">家長</label>
                    </div>
                </div>
            </div>
            <textarea id="swal-q-text" class="swal2-textarea mt-0" placeholder="請輸入您的問題..." style="width: 80%; border-radius: 12px;"></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: '<i class="fas fa-paper-plane me-1"></i> 送出提問',
        cancelButtonText: '取消',
        // 套用與主畫面一致的圓角按鈕風格
        customClass: {
            confirmButton: 'btn btn-primary rounded-pill px-4',
            cancelButton: 'btn btn-light rounded-pill px-4'
        },
        buttonsStyling: false,
        preConfirm: () => {
            const checkedBoxes = document.querySelectorAll('.q-target-cb:checked');
            // 將複選的對象用逗號隔開 (例如："教師, 治療師")
            const targets = Array.from(checkedBoxes).map(cb => cb.value).join(', ');
            const question = document.getElementById('swal-q-text').value.trim();

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
                    // 送出成功後，顯示簡短的成功提示並自動關閉
                    Swal.fire({ icon: 'success', title: '成功', text: '提問已送出！', timer: 1500, showConfirmButton: false });
                    loadQuestions(); // 重新載入對話串
                } else throw new Error('伺服器錯誤');
            } catch (err) { 
                Swal.fire('錯誤', '送出失敗，請檢查後端設定', 'error'); 
            }
        }
    });
}

function openTherapyForm() {
    new bootstrap.Modal(document.getElementById('therapyRecordModal')).show();
}

async function submitTherapyRecord() {
    const date = document.getElementById('form-date').value;
    if (!date) return Swal.fire('提示', '請至少填寫課程日期', 'warning');

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

        participation: partChecked.join('、'),
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
            loadRecords();
            document.getElementById('therapyForm').reset();
            document.querySelectorAll('[id^="area-"]').forEach(el => el.classList.add('d-none'));
            const partOtherInput = document.getElementById('input-part-other');
            if (partOtherInput) partOtherInput.disabled = true;
        } else throw new Error('錯誤');
    } catch (e) { Swal.fire('錯誤', '儲存失敗，請檢查後端設定', 'error'); }
}

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
                headers: { 'Authorization': `Bearer ${token}` },
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
            loadIepFiles();
        }
    });
}

// ==========================================
// 🤖 呼叫 AI 重點摘要功能 (精準除錯修正版)
// ==========================================
async function getAiSummary() {
    try {
        Swal.fire({
            title: '正在生成 AI 摘要...',
            text: 'Gemini 正在為您統整留言板重點，請稍候',
            allowOutsideClick: false,
            didOpen: () => Swal.showLoading()
        });

        const res = await apiRequest(`${API_URL}/api/summary`);

        const data = await res.json();

        if (res.ok) {
            Swal.close();

            const summaryBox = document.getElementById('ai-summary-box');
            const summaryContent = document.getElementById('ai-summary-content');
            if (summaryBox && summaryContent) {
                summaryBox.classList.remove('d-none');
                summaryContent.innerHTML = data.summary ? data.summary.replace(/\n/g, '<br>') : "無摘要資料";
            }
        } else {
            // 🟢 精準除錯：如果後端報錯，直接顯示後端的真正錯誤訊息（如 404 或 Key 錯誤）
            throw new Error(data.error || data.message || `後端回應錯誤 (Status: ${res.status})`);
        }
    } catch (err) {
        console.error("AI 摘要生成失敗:", err);
        Swal.fire({
            title: '摘要生成失敗',
            text: err.message || '無法連線至伺服器或後端發生錯誤',
            icon: 'error'
        });
    }
}

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
                loadIepFiles();
            } else {
                throw new Error('刪除失敗');
            }
        } catch (err) {
            Swal.fire('錯誤', err.message, 'error');
        }
    }
};

// ==========================================
// 🏠 居家表現：圖片壓縮與發文視窗
// ==========================================

// 1. 開啟發文視窗並清空舊資料
function openHomeLogModal() {
    document.getElementById('homeLogForm').reset();
    document.getElementById('log-image-preview-container').classList.add('d-none');
    document.getElementById('log-image-base64').value = '';
    new bootstrap.Modal(document.getElementById('homeLogModal')).show();
}

// 2. 圖片選擇與壓縮處理
const logImageInput = document.getElementById('log-image-input');
if (logImageInput) {
    logImageInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                // 設定最高 400px 寬度，確保轉換後的字串能塞進 Google Sheet 單一格內
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 400;
                let width = img.width;
                let height = img.height;

                if (width > MAX_WIDTH) {
                    height = Math.round((height * MAX_WIDTH) / width);
                    width = MAX_WIDTH;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'medium';
                ctx.drawImage(img, 0, 0, width, height);

                // 輸出 JPEG，並將畫質調降至 0.6 (60%) 以大幅縮減字串長度
                const base64String = canvas.toDataURL('image/jpeg', 0.6);
                
                // 顯示預覽圖
                document.getElementById('log-image-base64').value = base64String;
                document.getElementById('log-image-preview').src = base64String;
                document.getElementById('log-image-preview-container').classList.remove('d-none');
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// 3. 收集資料準備送往後端
async function submitHomeLog() {
    const textContent = document.getElementById('log-text').value.trim();
    const imageBase64 = document.getElementById('log-image-base64').value;

    if (!textContent && !imageBase64) {
        return Swal.fire({ icon: 'warning', title: '內容不可空白', text: '請填寫文字或上傳照片！' });
    }

    try {
        Swal.fire({ title: '發佈中...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
        const res = await fetch(`${API_URL}/api/home_logs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ content: textContent, image: imageBase64 })
        });

        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('homeLogModal')).hide();
            Swal.fire({ icon: 'success', title: '發佈成功！', timer: 1500, showConfirmButton: false });
            loadHomeLogs();
        } else {
            throw new Error('伺服器錯誤');
        }
    } catch (err) {
        Swal.fire({ icon: 'error', title: '發佈失敗', text: '請檢查網路連線。' });
    }
}

// 載入貼文牆
async function loadHomeLogs() {
    const feedContainer = document.getElementById('home-log-feed');
    if (!feedContainer) return;
    feedContainer.innerHTML = '<div class="text-center text-secondary py-4"><i class="fas fa-spinner fa-spin fa-2x"></i></div>';

    try {
        const res = await apiRequest(`${API_URL}/api/home_logs`);
        const json = await res.json();
        
        if (!json.data || json.data.length === 0) {
            feedContainer.innerHTML = `
                <div class="text-center text-muted py-5">
                    <i class="fas fa-home fa-3x mb-3" style="color: #E5E7EB;"></i>
                    <p>目前尚無居家表現紀錄</p>
                </div>`;
            return;
        }

        // 渲染貼文
        feedContainer.innerHTML = json.data.map(log => {
            const dateStr = new Date(log.datetime).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            const imageHtml = log.image ? `<img src="${log.image}" class="img-fluid rounded-3 mb-3 border" style="max-height: 300px; object-fit: contain; width: 100%;">` : '';
            const authorDisplay = formatHomeAuthor(log.author);
            const authorAvatar = getRoleVisuals(authorDisplay).avatar;
            
            // 渲染回覆區塊
            const repliesHtml = log.replies.map(r => {
                const replyDisplay = formatHomeAuthor(r.author);
                const replyAvatar = getRoleVisuals(replyDisplay).avatar;
                return `
                <div class="bg-light p-3 rounded-3 mb-2 ms-4 border-start border-3 border-primary">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-bold small text-dark">${replyAvatar} ${replyDisplay}</span>
                        <span class="text-muted" style="font-size: 0.75rem;">${new Date(r.timestamp).toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p class="mb-0 small text-secondary">${r.text}</p>
                </div>
            `;
            }).join('');

            return `
                <div class="card border-0 shadow-sm rounded-4 mb-4">
                    <div class="card-body p-4">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h6 class="fw-bold mb-0 text-primary">${authorAvatar} ${authorDisplay}</h6>
                            <span class="text-muted small">${dateStr}</span>
                        </div>
                        <p class="text-dark mb-3" style="white-space: pre-wrap;">${log.content}</p>
                        ${imageHtml}
                        <hr class="text-muted opacity-25">
                        
                        <!-- 回覆列表 -->
                        <div class="replies-container mb-3">
                            ${repliesHtml}
                        </div>
                        
                        <!-- 新增回覆輸入框 -->
                        <div class="input-group input-group-sm mt-3">
                            <input type="text" id="reply-input-${log.id}" class="form-control rounded-pill-start bg-light border-0 px-3" placeholder="撰寫專業回饋或建議...">
                            <button class="btn btn-primary rounded-pill-end px-3" onclick="submitLogReply('${log.id}')">回覆</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        feedContainer.innerHTML = '<div class="text-center text-danger py-4">載入失敗，請稍後再試。</div>';
    }
}

// 發送回覆
async function submitLogReply(logId) {
    const inputEl = document.getElementById(`reply-input-${logId}`);
    const replyText = inputEl.value.trim();
    if (!replyText) return;

    try {
        inputEl.disabled = true;
        const res = await apiRequest(`${API_URL}/api/home_logs/reply`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logId, replyText })
        });
        
        if (res.ok) {
            loadHomeLogs(); // 重新載入以顯示最新回覆
        }
    } catch (err) {
        Swal.fire({ icon: 'error', title: '回覆失敗' });
        inputEl.disabled = false;
    }
}

// ⚠️ 請找到原本用來切換頁面的 showSection(sectionId) 函數
// 並在裡面加入判斷式，確保進入居家表現時會載入貼文
/*
function showSection(sectionId) {
    // ... 原本的切換邏輯 ...
    if (sectionId === 'home-log') {
        loadHomeLogs();
    }
}
*/