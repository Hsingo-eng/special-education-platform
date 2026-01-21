// ==========================================
// 1. 全域設定與初始化
// ==========================================
const roleMap = {
    'teacher': '教師',
    'therapist': '治療師',
    'parents': '家長'
};

// 輔助函式：取得角色中文名稱
function roleName(role) {
    return roleMap[role] || '訪客';
}

// 根據角色取得頭貼
function getRoleAvatar(role) {
    const roleAvatars = {
        'teacher': 'sticker1.png',
        'therapist': 'sticker2.png',
        'parents': 'sticker3.png'
    };
    return roleAvatars[role] || 'sticker1.png';
}

const API_URL = "https://special-education-platform.zeabur.app";
const socket = io(API_URL);
let currentUser = null;
let calendar = null;
let currentEditingEventId = null; // 用來記錄現在是否正在編輯排程

// 網頁載入
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");
    
    if (token && userStr) {
        currentUser = JSON.parse(userStr);
        showDashboard(); 
    }
});

// ==========================================
// 2. 登入與登出
// ==========================================
async function login() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if(!username || !password) return Swal.fire("錯誤", "請輸入帳號密碼", "warning");

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        if (res.ok) {
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));
            currentUser = data.user;
            
            Swal.fire({
                icon: 'success',
                title: '登入成功',
                text: `歡迎回來！${roleName(currentUser.role)}`, // 🟢 修正：只顯示身分
                timer: 1500,
                showConfirmButton: false
            });
            showDashboard(); 
        } else {
            Swal.fire("登入失敗", data.message, "error");
        }
    } catch (err) {
        console.error(err);
        Swal.fire("錯誤", "無法連線到伺服器", "error");
    }
}

function logout() {
    localStorage.clear();
    location.reload();
}

// ==========================================
// 3. 畫面切換與導覽列
// ==========================================
function showDashboard() {
    document.getElementById("login-section").classList.add("d-none");
    document.getElementById("dashboard-section").classList.remove("d-none");
    document.getElementById("main-nav").classList.remove("d-none");
    
    // 🟢 修正：導覽列只顯示身分中文名
    document.getElementById("nav-user-info").innerText = roleName(currentUser.role);

    // 設定右上角頭貼
    const avatarImg = document.getElementById('header-user-avatar');
    if (avatarImg && currentUser) {
        avatarImg.src = getRoleAvatar(currentUser.role);
    }

    // 權限控制 (顯示/隱藏按鈕)
    document.querySelectorAll(".role-restricted").forEach(el => {
        if (el.dataset.deny === currentUser.role) el.classList.add("d-none");
    });
    document.querySelectorAll(".role-only").forEach(el => {
        const allowed = el.dataset.allow.split(',');
        if (!allowed.includes(currentUser.role)) el.classList.add("d-none");
        else el.classList.remove("d-none");
    });

    setTimeout(() => { initCalendar(); }, 100);
}

function showSection(sectionId) {
    ["records", "iep", "messages", "questions"].forEach(id => {
        const el = document.getElementById(`section-${id}`);
        if(el) el.classList.add("d-none");
    });

    const emptyState = document.getElementById("empty-state");
    if(emptyState) emptyState.classList.add("d-none");

    const target = document.getElementById(`section-${sectionId}`);
    if(target) target.classList.remove("d-none");

    if (sectionId === 'questions') loadQuestions();
    if (sectionId === 'messages') loadMessages();
    if (sectionId === 'records') loadRecords();
    if (sectionId === 'iep') loadIepFiles();
}

// Fetch 封裝
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem("token");
    const headers = {
        "Authorization": `Bearer ${token}`,
        ...options.headers
    };
    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }
    return fetch(url, { ...options, headers });
}

// ==========================================
// 功能 A: 留言板 (修正身分顯示)
// ==========================================
socket.on("message_update", (msg) => {
    const msgSection = document.getElementById("section-messages");
    if (msgSection && !msgSection.classList.contains("d-none")) {
        renderMessage(msg);
    }
});

async function loadMessages() {
    const box = document.getElementById("chat-box");
    box.innerHTML = '<div class="text-center py-3 text-muted">載入中...</div>';
    
    try {
        const res = await fetchWithAuth(`${API_URL}/api/messages`);
        const json = await res.json();
        box.innerHTML = "";

        (json.data || []).forEach(msg => {
            const isMe = (msg.user_name === currentUser.name);
            const rowClass = isMe ? 'self' : 'other';
            const imageUrl = getRoleAvatar(msg.role);
            const roleLabel = roleName(msg.role); // 取得中文身分

            // 🟢 修正：移除 msg.user_name，只顯示 roleLabel (身分)
            const html = `
                <div class="msg-row ${rowClass}">
                    <div class="msg-avatar" title="${roleLabel}">
                        <img src="${imageUrl}" alt="${roleLabel}">
                    </div>
                    <div class="msg-bubble">
                        <span class="msg-role">${roleLabel}</span>
                        ${msg.message}
                    </div>
                </div>
            `;
            box.innerHTML += html;
        });
        
        box.scrollTop = box.scrollHeight;
    } catch (e) {
        console.error(e);
        box.innerHTML = '<div class="text-center text-danger">載入失敗</div>';
    }
}

function renderMessage(msg) {
    const chatBox = document.getElementById("chat-box");
    if (!chatBox) return;

    const isSelf = (msg.username === currentUser.username);
    const roleLabel = roleName(msg.role); // 🟢 修正：只顯示身分
    const avatarSrc = getRoleAvatar(msg.role);

    const msgHtml = `
        <div class="msg-row ${isSelf ? 'self' : 'other'}">
            <div class="msg-avatar">
                <img src="${avatarSrc}" alt="${roleLabel}">
            </div>
            <div class="msg-bubble">
                <span class="msg-role">${roleLabel}</span>
                <div>${msg.text}</div>
            </div>
        </div>
    `;
    chatBox.insertAdjacentHTML('beforeend', msgHtml);
    chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendMessage() {
    const input = document.getElementById("msg-input");
    const text = input.value.trim();
    if (!text) return;

    await fetchWithAuth(`${API_URL}/api/messages`, {
        method: "POST",
        body: JSON.stringify({ message: text })
    });
    input.value = ""; 
}

function handleEnter(e) {
    if (e.key === 'Enter') sendMessage();
}

async function getAiSummary() {
    Swal.fire({ title: "AI 分析中...", didOpen: () => Swal.showLoading() });
    try {
        const res = await fetchWithAuth(`${API_URL}/api/messages/summary`);
        const data = await res.json();
        document.getElementById("ai-summary-box").classList.remove("d-none");
        document.getElementById("ai-summary-content").innerText = data.summary;
        Swal.close();
    } catch (err) {
        Swal.fire("失敗", "AI 目前忙碌中", "error");
    }
}

// ==========================================
// 功能 B: 專業紀錄
// ==========================================
async function loadRecords() {
    const list = document.getElementById("record-list");
    list.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-secondary"></div></div>';
    
    try {
        const res = await fetchWithAuth(`${API_URL}/api/records`);
        if (res.status === 403) {
            list.innerHTML = "<div class='alert alert-danger'>權限不足</div>";
            return;
        }
        const json = await res.json();
        list.innerHTML = "";

        if (!json.data || json.data.length === 0) {
            list.innerHTML = "<div class='text-center text-muted p-4'>目前還沒有治療紀錄</div>";
            return;
        }

        json.data.forEach(rec => {
            const replyHtml = rec.teacher_reply 
                ? `<div class="mt-3 p-3 bg-light border-start border-4 border-primary rounded"><strong>教師回覆：</strong> ${rec.teacher_reply}</div>` 
                : (currentUser.role === 'teacher' ? `<button class="btn btn-sm btn-outline-primary mt-2" onclick="replyRecord('${rec.id}')">回覆</button>` : `<div class="mt-2 text-muted text-sm">等待回覆...</div>`);

            list.innerHTML += `
                <div class="list-group-item mb-3 border-0 shadow-sm rounded p-4">
                    <div class="d-flex w-100 justify-content-between border-bottom pb-2 mb-2">
                        <h5 class="mb-1 fw-bold text-dark">${rec.date} 紀錄</h5>
                        <small class="text-muted">治療師</small> 
                    </div>
                    <p class="mb-1 fs-6">${rec.content}</p>
                    ${replyHtml}
                </div>`;
        });
    } catch (err) {
        list.innerHTML = "<div class='alert alert-danger'>載入失敗</div>";
    }
}

async function openRecordModal() {
    const { value: text } = await Swal.fire({
        input: 'textarea',
        inputLabel: '新增治療紀錄',
        showCancelButton: true
    });
    if (text) {
        await fetchWithAuth(`${API_URL}/api/records`, { method: "POST", body: JSON.stringify({ content: text }) });
        loadRecords();
    }
}

async function replyRecord(id) {
    const { value: text } = await Swal.fire({
        input: 'textarea',
        inputLabel: '回覆內容',
        showCancelButton: true
    });
    if (text) {
        await fetchWithAuth(`${API_URL}/api/records/${id}`, { method: "PUT", body: JSON.stringify({ reply: text }) });
        loadRecords();
    }
}

// ==========================================
// 功能 C: IEP 檔案
// ==========================================
async function loadIepFiles() {
    const list = document.getElementById("iep-list");
    list.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border"></div></div>';
    try {
        const res = await fetchWithAuth(`${API_URL}/api/iep`);
        const json = await res.json();
        list.innerHTML = "";
        if (!json.data || json.data.length === 0) {
            list.innerHTML = `<div class="col-12 text-center text-muted py-5">無 IEP 檔案</div>`;
            return;
        }
        json.data.forEach(file => {
            list.innerHTML += `
                <div class="col-md-6 col-lg-4">
                    <div class="card h-100 shadow-sm border-0">
                        <div class="card-body">
                            <h6 class="mb-2 text-truncate" title="${file.filename}">${file.filename}</h6>
                            <p class="small text-secondary mb-3">
                                上傳者：${roleName(file.uploaded_by_role) || '教師'}<br>
                                備註：${file.comments || "無"}
                            </p>
                            <a href="${file.file_link}" target="_blank" class="btn btn-outline-danger w-100 btn-sm">檢視檔案</a>
                        </div>
                    </div>
                </div>`;
        });
    } catch (err) {
        list.innerHTML = "<div class='alert alert-danger'>無法載入</div>";
    }
}

async function openIepUpload() {
    const { value: formValues } = await Swal.fire({
        title: '上傳 IEP',
        html: `<input type="file" id="swal-file" class="form-control mb-3"><input type="text" id="swal-comment" class="form-control" placeholder="備註">`,
        showCancelButton: true,
        preConfirm: () => {
            const fileInput = document.getElementById('swal-file');
            if (!fileInput.files.length) return Swal.showValidationMessage('請選擇檔案');
            return { file: fileInput.files[0], comment: document.getElementById('swal-comment').value };
        }
    });

    if (formValues) {
        const formData = new FormData();
        formData.append("file", formValues.file);
        formData.append("comments", formValues.comment);
        await fetchWithAuth(`${API_URL}/api/iep`, { method: "POST", body: formData });
        Swal.fire("成功", "檔案已上傳", "success");
        loadIepFiles();
    }
}

// ==========================================
// 功能 D: 提問與回覆 (修正身分顯示)
// ==========================================
async function loadQuestions() {
    const list = document.getElementById("questions-list");
    list.innerHTML = '<div class="text-center py-5"><div class="spinner-border"></div></div>';
    try {
        const res = await fetchWithAuth(`${API_URL}/api/questions`);
        const json = await res.json();
        renderQuestions(json.data);
    } catch (err) {
        list.innerHTML = '<p class="text-center text-danger">載入失敗</p>';
    }
}

function renderQuestions(data) {
    const list = document.getElementById("questions-list");
    list.innerHTML = "";
    if (!data || data.length === 0) {
        list.innerHTML = '<div class="alert alert-light text-center w-100">沒有提問</div>';
        return;
    }

    data.reverse().forEach(q => {
        let roleBadge = '';
        if (q.asker_role === 'teacher') roleBadge = '<span class="badge bg-primary">教師</span>';
        else if (q.asker_role === 'therapist') roleBadge = '<span class="badge bg-success">治療師</span>';
        else roleBadge = '<span class="badge bg-warning text-dark">家長</span>';

        // 🟢 修正：移除 q.asker_name，只顯示 roleBadge
        const html = `
            <div class="col-md-12">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>${roleBadge} <small class="text-muted ms-2">${q.date}</small></div>
                            <span class="badge bg-${q.status === '已回覆' ? 'success' : 'secondary'}-subtle text-dark">${q.status}</span>
                        </div>
                        <h5 class="card-text mt-2" style="white-space: pre-wrap;">${q.question}</h5>
                        ${q.reply ? `<div class="mt-3 p-3 bg-light border-start border-4 border-success"><strong>回覆：</strong> ${q.reply}</div>` : `<div class="mt-3 text-end"><button class="btn btn-sm btn-outline-secondary" onclick="replyQuestion('${q.id}')">回覆</button></div>`}
                    </div>
                </div>
            </div>`;
        list.innerHTML += html;
    });
}

// 提問/回覆 Modal 邏輯維持不變，省略以節省篇幅...
// (openQuestionModal, replyQuestion 函式請保留原樣)
async function openQuestionModal() {
    // ... (維持原樣)
    const { value: formValues } = await Swal.fire({
        title: '我要提問',
        html: `
            <div class="text-start mb-2 fw-bold text-secondary">對象：</div>
            <div class="d-flex gap-3 mb-3 justify-content-center">
                <div class="form-check"><input class="form-check-input" type="checkbox" id="target-teacher" value="teacher"><label class="form-check-label" for="target-teacher">教師</label></div>
                <div class="form-check"><input class="form-check-input" type="checkbox" id="target-therapist" value="therapist"><label class="form-check-label" for="target-therapist">治療師</label></div>
                <div class="form-check"><input class="form-check-input" type="checkbox" id="target-parents" value="parents"><label class="form-check-label" for="target-parents">家長</label></div>
            </div>
            <textarea id="swal-question" class="form-control" rows="4" placeholder="問題內容..."></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: '發布',
        preConfirm: () => {
            const question = document.getElementById('swal-question').value;
            const targets = [];
            if (document.getElementById('target-teacher').checked) targets.push('teacher');
            if (document.getElementById('target-therapist').checked) targets.push('therapist');
            if (document.getElementById('target-parents').checked) targets.push('parents');
            if (!question || targets.length === 0) return Swal.showValidationMessage('請填寫完整');
            return { question: question, target_role: targets.join(',') };
        }
    });

    if (formValues) {
        await fetchWithAuth(`${API_URL}/api/questions`, { method: "POST", body: JSON.stringify(formValues) });
        Swal.fire('成功', '提問已發布', 'success');
        loadQuestions();
    }
}

function replyQuestion(id) {
    Swal.fire({
        title: '回覆問題',
        input: 'textarea',
        showCancelButton: true,
        confirmButtonText: '送出',
        preConfirm: async (reply) => {
            if (!reply) return Swal.showValidationMessage('請輸入內容');
            await fetchWithAuth(`${API_URL}/api/questions/${id}`, { method: "PUT", body: JSON.stringify({ reply }) });
        }
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire('成功', '已回覆', 'success');
            loadQuestions();
        }
    });
}

// ==========================================
// 功能 E: 行事曆 (編輯功能 + 修正監聽器)
// ==========================================
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    document.getElementById("calendar-section").classList.remove("d-none");

    const monthPicker = document.getElementById('calendar-month-picker');

    // 🟢 修正：移除重複的 monthPicker 監聽器，只保留一個
    if (monthPicker) {
        // 先移除舊的 listener (如果有的話)，避免重複綁定
        const newPicker = monthPicker.cloneNode(true);
        monthPicker.parentNode.replaceChild(newPicker, monthPicker);
        
        newPicker.addEventListener('change', function() {
            if (this.value) calendar.gotoDate(this.value);
        });
    }

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'zh-tw',
        height: 'auto',
        contentHeight: 'auto',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth'
        },
        datesSet: function(info) {
            const current = info.view.currentStart;
            const year = current.getFullYear();
            const month = String(current.getMonth() + 1).padStart(2, '0');
            const picker = document.getElementById('calendar-month-picker');
            if(picker) picker.value = `${year}-${month}`;
        },
        events: async function(info, successCallback, failureCallback) {
             try {
                const res = await fetchWithAuth(`${API_URL}/api/calendar`);
                const json = await res.json();
                const eventsWithColor = (json.data || []).map((evt, index) => {
                    const colorClass = (index % 2 === 0) ? 'evt-orange' : 'evt-green';
                    return { ...evt, classNames: [colorClass] };
                });
                successCallback(eventsWithColor);
            } catch (e) { failureCallback(e); }
        },
        eventClick: function(info) {
             const isOwner = ['teacher', 'therapist'].includes(currentUser.role);
             const desc = info.event.extendedProps.description || "無詳細內容";
             
             if (!isOwner) {
                 Swal.fire({ title: info.event.title, text: desc, icon: 'info', confirmButtonColor: '#2563EB' });
             } else {
                 // 🟢 教師/治療師：顯示編輯與刪除按鈕
                 Swal.fire({
                     title: info.event.title,
                     html: `
                        <p class="text-secondary mb-4">${desc}</p>
                        <div class="d-flex gap-2 justify-content-center">
                            <button id="btn-swal-edit" class="btn btn-primary flex-grow-1"><i class="fas fa-edit"></i> 編輯</button>
                            <button id="btn-swal-del" class="btn btn-outline-danger flex-grow-1"><i class="fas fa-trash-alt"></i> 刪除</button>
                        </div>
                     `,
                     showConfirmButton: false, 
                     showCloseButton: true,
                     didOpen: () => {
                         document.getElementById('btn-swal-edit').onclick = () => {
                             Swal.close();
                             openEventModal(info.event); // 打開編輯視窗
                         };
                         document.getElementById('btn-swal-del').onclick = () => {
                             Swal.close();
                             deleteEvent(info.event.id);
                         };
                     }
                 });
             }
        }
    });
    calendar.render();
}

// 開啟視窗 (新增或編輯)
function openEventModal(eventData = null) {
    const modal = new bootstrap.Modal(document.getElementById('eventModal'));
    const titleInput = document.getElementById('event-title');
    const dateInput = document.getElementById('event-date');
    const descInput = document.getElementById('event-desc');
    const modalTitle = document.getElementById('eventModalLabel');
    
    if (eventData) {
        // 編輯模式
        currentEditingEventId = eventData.id;
        titleInput.value = eventData.title;
        dateInput.value = eventData.startStr;
        descInput.value = eventData.extendedProps.description || '';
        if(modalTitle) modalTitle.innerText = "編輯排程";
    } else {
        // 新增模式
        currentEditingEventId = null;
        titleInput.value = '';
        dateInput.value = '';
        descInput.value = '';
        if(modalTitle) modalTitle.innerText = "新增排程";
    }
    modal.show();
}

// 儲存事件 (支援 POST 新增 與 PUT 更新)
async function saveEvent() {
    const title = document.getElementById('event-title').value;
    const date = document.getElementById('event-date').value;
    const desc = document.getElementById('event-desc').value;

    if (!title || !date) {
        Swal.fire('欄位未填', '請輸入標題與日期', 'warning');
        return;
    }

    const payload = { title, date, description: desc };

    try {
        let url = `${API_URL}/api/calendar`;
        let method = 'POST';

        if (currentEditingEventId) {
            url = `${API_URL}/api/calendar/${currentEditingEventId}`;
            method = 'PUT';
        }

        const res = await fetchWithAuth(url, {
            method: method,
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const modalEl = document.getElementById('eventModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            modal.hide();
            calendar.refetchEvents();
            Swal.fire('成功', currentEditingEventId ? '排程已更新' : '排程已新增', 'success');
        } else {
            throw new Error('儲存失敗');
        }
    } catch (error) {
        Swal.fire('錯誤', '無法儲存排程', 'error');
    }
}

async function deleteEvent(id) {
    const result = await Swal.fire({
        title: '確定刪除?',
        text: "刪除後無法復原",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: '刪除'
    });

    if (result.isConfirmed) {
        await fetchWithAuth(`${API_URL}/api/calendar/${id}`, { method: "DELETE" });
        calendar.refetchEvents();
        Swal.fire('已刪除', '排程已移除', 'success');
    }
}

