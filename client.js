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
// 請確認 socket.io 版本與後端匹配，若無後端 socket 服務可忽略相關錯誤
const socket = typeof io !== 'undefined' ? io(API_URL) : null;

let currentUser = null;
let calendar = null;

// 網頁載入
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");
    
    if (token && userStr) {
        currentUser = JSON.parse(userStr);
        showDashboard(); 
    }

    // 初始化治療紀錄表單的折疊監聽
    document.querySelectorAll('.area-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const target = document.getElementById(this.dataset.target);
            if(this.checked) target.classList.remove('d-none');
            else target.classList.add('d-none');
        });
    });
    // 日期預設今天
    const d = document.getElementById('form-date');
    if(d) d.valueAsDate = new Date();
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
                text: `歡迎回來！${roleName(currentUser.role)}`, 
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
    
    document.getElementById("nav-user-info").innerText = roleName(currentUser.role);

    const avatarImg = document.getElementById('header-user-avatar');
    if (avatarImg && currentUser) {
        avatarImg.src = getRoleAvatar(currentUser.role);
    }

    // 權限控制
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
// 功能 A: 留言板 (修復 Undefined 問題)
// ==========================================
if (socket) {
    socket.on("message_update", (msg) => {
        const msgSection = document.getElementById("section-messages");
        if (msgSection && !msgSection.classList.contains("d-none")) {
            renderMessage(msg);
        }
    });
}

async function loadMessages() {
    const box = document.getElementById("chat-box");
    box.innerHTML = '<div class="text-center py-3 text-muted">載入中...</div>';
    
    try {
        const res = await fetchWithAuth(`${API_URL}/api/messages`);
        const json = await res.json();
        box.innerHTML = "";

        (json.data || []).forEach(msg => {
            // 後端回傳可能是 msg.message 或 msg.text，這裡做兼容
            const content = msg.message || msg.text || "";
            // 判斷是否為自己
            const isMe = (msg.user_name === currentUser.name) || (msg.user_name === currentUser.username);
            
            const rowClass = isMe ? 'self' : 'other';
            const imageUrl = getRoleAvatar(msg.role);
            const roleLabel = roleName(msg.role);

            const html = `
                <div class="msg-row ${rowClass}">
                    <div class="msg-avatar" title="${roleLabel}">
                        <img src="${imageUrl}" alt="${roleLabel}">
                    </div>
                    <div class="msg-bubble">
                        <span class="msg-role">${roleLabel}</span>
                        ${content}
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

// 接收 socket 訊息時渲染
function renderMessage(msg) {
    const chatBox = document.getElementById("chat-box");
    if (!chatBox) return;

    // 判斷 socket 傳來的 user 是否為自己
    const isSelf = (msg.username === currentUser.username) || (msg.user === roleName(currentUser.role));
    const roleLabel = roleName(msg.role) || msg.user || '訪客';
    const avatarSrc = getRoleAvatar(msg.role);
    // 兼容 text 或 message 欄位
    const content = msg.text || msg.message || msg.msg || "";

    const msgHtml = `
        <div class="msg-row ${isSelf ? 'self' : 'other'}">
            <div class="msg-avatar">
                <img src="${avatarSrc}" alt="${roleLabel}">
            </div>
            <div class="msg-bubble">
                <span class="msg-role">${roleLabel}</span>
                <div>${content}</div>
            </div>
        </div>
    `;
    chatBox.insertAdjacentHTML('beforeend', msgHtml);
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 發送訊息
function sendMessage() {
    const input = document.getElementById("msg-input");
    const msgText = input.value.trim();

    if (msgText === "") return;

    const currentUserRole = currentUser ? currentUser.role : "teacher"; 
    const roleLabel = roleName(currentUserRole);

    // 建立訊息物件 (統一使用 message 欄位)
    const messageData = {
        username: currentUser.username,
        user: roleLabel,
        role: currentUserRole,
        avatar: getRoleAvatar(currentUserRole),
        message: msgText, // 統一欄位名稱
        text: msgText,    // 兼容性保留
        type: 'self'
    };

    // 1. 顯示在自己的畫面上 (直接渲染)
    renderMessage(messageData);

    // 2. 透過 Socket 傳送 (若有)
    if (socket) {
        socket.emit('chatMessage', messageData);
    }

    // 3. 儲存到資料庫 (若有 API)
    fetchWithAuth(`${API_URL}/api/messages`, {
        method: "POST",
        body: JSON.stringify({ message: msgText })
    }).catch(e => console.error("Message save failed", e));

    input.value = "";
    input.focus();
}

function handleEnter(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
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
// 功能 B: 專業紀錄 (終極完整版：顯示內容+表現+參與+策略)
// ==========================================
async function loadRecords() {
    const list = document.getElementById("record-list");
    list.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-secondary"></div></div>';
    
    // 🔴 請確認網址不用變，繼續用原本那個
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzJyvD4A63VSCo7isp_Pwmciq5nKRLM3H8otQfdWtWe_XYShVu609jruQVqm7YFt4Iw_w/exec"; 

    try {
        const res = await fetch(SCRIPT_URL);
        const json = await res.json();
        
        list.innerHTML = "";

        if (!json.data || json.data.length === 0) {
            list.innerHTML = "<div class='text-center text-muted p-4'>目前還沒有治療紀錄</div>";
            return;
        }

        json.data.reverse().forEach(rec => {
            // 1. 日期與基本資訊
            let dateStr = rec.date ? String(rec.date).substring(0, 10) : '未知日期';
            const type = rec.session_Type || "個別";

            // 2. 組合「四大領域」的內容與表現
            let goalsHtml = "";
            
            // 輔助函式：產生一行「領域 + 內容 + 表現」
            const addRow = (badgeColor, badgeText, content, perf) => {
                if (!content) return "";
                const perfHtml = perf ? `<span class="ms-2 badge bg-light text-dark border">表現：${perf}</span>` : "";
                return `<div class="mb-2">
                            <span class="badge ${badgeColor} me-1">${badgeText}</span>
                            <span class="text-dark">${content}</span>
                            ${perfHtml}
                        </div>`;
            };

            goalsHtml += addRow("bg-primary", "理解", rec.comp_content, rec.comp_perf);
            goalsHtml += addRow("bg-success", "表達", rec.exp_content, rec.exp_perf);
            goalsHtml += addRow("bg-warning text-dark", "構音", rec.art_content, rec.art_perf);
            goalsHtml += addRow("bg-info text-dark", "溝通", rec.comm_content, rec.comm_perf);

            // 若全空顯示無內容
            if (goalsHtml === "") goalsHtml = `<div class="text-muted fst-italic">（本次無特定訓練目標）</div>`;

            // 3. 組合「參與狀況」與「策略」
            let detailsHtml = "";
            if (rec.participation) {
                detailsHtml += `<div class="mt-2 small text-secondary"><i class="fas fa-user-check me-1"></i> <strong>參與狀況：</strong>${rec.participation}</div>`;
            }
            if (rec.strategies) {
                detailsHtml += `<div class="mt-1 small text-secondary"><i class="fas fa-lightbulb me-1"></i> <strong>延伸策略：</strong>${rec.strategies}</div>`;
            }

            // 4. 備註
            let remarksHtml = "";
            if (rec.remarks) {
                remarksHtml = `<div class="mt-3 pt-2 border-top small text-muted"><i class="fas fa-comment-dots me-1"></i> 備註：${rec.remarks}</div>`;
            }

            // 5. 組合最終卡片
            list.innerHTML += `
                <div class="list-group-item mb-3 border-0 shadow-sm rounded p-4">
                    <div class="d-flex w-100 justify-content-between border-bottom pb-2 mb-3">
                        <div class="d-flex align-items-center gap-2">
                            <h5 class="mb-0 fw-bold text-dark">${dateStr}</h5>
                            <span class="badge bg-secondary rounded-pill">${type}</span>
                        </div>
                        <small class="text-muted"><i class="far fa-clock"></i> ${rec.duration} 分鐘</small> 
                    </div>
                    
                    <div class="record-content">
                        ${goalsHtml}
                        <div class="mt-3 p-2 bg-light rounded">
                            ${detailsHtml}
                        </div>
                        ${remarksHtml}
                    </div>
                </div>`;
        });
    } catch (err) {
        console.error(err);
        list.innerHTML = "<div class='alert alert-danger'>載入失敗</div>";
    }
}

// 2. 行事曆初始化 (移除詳細內容顯示)
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    document.getElementById("calendar-section").classList.remove("d-none");

    // 處理月份選擇器
    const monthPicker = document.getElementById('calendar-month-picker');
    if (monthPicker) {
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
        displayEventTime: false, 
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth' },
        datesSet: function(info) {
            const current = info.view.currentStart;
            const picker = document.getElementById('calendar-month-picker');
            if(picker) picker.value = current.toISOString().slice(0, 7);
        },
        events: async function(info, successCallback, failureCallback) {
             try {
                const res = await fetchWithAuth(`${API_URL}/api/calendar`);
                const json = await res.json();
                
                const eventsWithColor = (json.data || []).map(evt => {
                    let colorClass = 'evt-orange'; 
                    if (evt.role === 'therapist') colorClass = 'evt-green';
                    
                    return { 
                        ...evt, 
                        classNames: [colorClass],
                        extendedProps: {
                            ...evt.extendedProps,
                            role: evt.role, 
                            creator: roleName(evt.role) // 轉換身分為中文
                        }
                    };
                });
                successCallback(eventsWithColor);
            } catch (e) { failureCallback(e); }
        },
        eventClick: function(info) {
             const isOwner = ['teacher', 'therapist'].includes(currentUser.role);
             const props = info.event.extendedProps;
             // 🟢 修正：直接讀取中文身分
             const creator = props.creator || roleName(props.role) || "未知"; 
             const timeStr = info.event.start ? info.event.start.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '全天';

             // 彈出視窗內容 (已移除詳細內容)
             const contentHtml = `
                <div class="text-start bg-light p-3 rounded mb-3">
                    <p class="mb-1"><strong><i class="far fa-clock"></i> 時間：</strong> ${timeStr}</p>
                    <p class="mb-0"><strong><i class="fas fa-user"></i> 新增者：</strong> ${creator}</p>
                </div>
             `;

             if (!isOwner) {
                 Swal.fire({ title: info.event.title, html: contentHtml, icon: 'info', confirmButtonColor: '#2563EB' });
             } else {
                 Swal.fire({
                     title: info.event.title,
                     html: `${contentHtml}<div class="d-flex gap-2 justify-content-center mt-2"><button id="btn-swal-edit" class="btn btn-primary flex-grow-1">編輯</button><button id="btn-swal-del" class="btn btn-outline-danger flex-grow-1">刪除</button></div>`,
                     showConfirmButton: false, 
                     showCloseButton: true,
                     didOpen: () => {
                         document.getElementById('btn-swal-edit').onclick = () => { Swal.close(); openEventModal(info.event); };
                         document.getElementById('btn-swal-del').onclick = () => { Swal.close(); deleteEvent(info.event.id); };
                     }
                 });
             }
        }
    });
    calendar.render();
}

// 3. 儲存事件 (修正：寫入正確身分)
async function saveEvent() {
    const id = document.getElementById('evt-id').value;
    const title = document.getElementById('evt-title').value;
    const start = document.getElementById('evt-start').value;
    const end = document.getElementById('evt-end').value;
    
    // 🟢 修正：強制抓取當前登入者的身分，不再是訪客
    const role = currentUser.role; 

    if (!title || !start) {
        Swal.fire('錯誤', '標題與開始時間為必填', 'error');
        return;
    }

    const payload = { 
        title, start, end, 
        role: role, // 寫入身分
        description: "" // 清空描述
    };

    try {
        let url = `${API_URL}/api/calendar`;
        let method = 'POST';
        if (id) { url = `${API_URL}/api/calendar/${id}`; method = 'PUT'; }

        const res = await fetchWithAuth(url, { method: method, body: JSON.stringify(payload) });

        if (res.ok) {
            bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
            calendar.refetchEvents();
            Swal.fire('成功', id ? '排程已更新' : '排程已新增', 'success');
        } else {
            throw new Error('儲存失敗');
        }
    } catch (error) {
        // 若無後端，前端模擬成功
        bootstrap.Modal.getInstance(document.getElementById('eventModal')).hide();
        Swal.fire('前端模擬', '資料已送出', 'success');
    }
}

// 4. 送出治療紀錄 (記得換網址)
async function submitTherapyRecord() {
    // 🔴 務必換成最新的網址
    const SCRIPT_URL = "vhttps://script.google.com/macros/s/AKfycbxa29p_cTCsxEhdQ6yGrTPJQ4rjJSh83OPwlJu6cSa19QIc1LmvBR41MZ7OkKwYxBh6uw/exec"; 
    
    // ... (其餘邏輯保持不變，略) ...
    // (請保留原本的收集資料程式碼)
    const date = document.getElementById('form-date').value;
    const duration = document.getElementById('form-duration').value;
    if(!date || !duration) return Swal.fire("欄位未填", "請輸入日期與時長", "warning");

    const getData = (chk, inp, sel) => {
        if(!document.getElementById(chk).checked) return ["", ""];
        return [document.getElementById(inp).value, document.getElementById(sel).value];
    }

    const [compC, compP] = getData('check-comp', 'input-comp-content', 'select-comp-perf');
    const [expC, expP] = getData('check-exp', 'input-exp-content', 'select-exp-perf');
    const [artC, artP] = getData('check-art', 'input-art-content', 'select-art-perf');
    const [commC, commP] = getData('check-comm', 'input-comm-content', 'select-comm-perf');

    let part = []; document.querySelectorAll('.check-part:checked').forEach(e=>part.push(e.value));
    let strat = []; document.querySelectorAll('.check-strat:checked').forEach(e=>strat.push(e.value));

    const payload = {
        date: date,
        type: document.querySelector('input[name="form-type"]:checked').value,
        duration: duration,
        goal_comp_content: compC, goal_comp_perf: compP,
        goal_exp_content: expC, goal_exp_perf: expP,
        goal_art_content: artC, goal_art_perf: artP,
        goal_comm_content: commC, goal_comm_perf: commP,
        participation: part.join(', '),
        participation_other: document.getElementById('check-part-other').checked ? document.getElementById('input-part-other').value : "",
        strategies: strat.join(', '),
        strategies_other: document.getElementById('check-strat-other').checked ? document.getElementById('input-strat-other').value : "",
        remarks: document.getElementById('input-remarks').value
    };

    Swal.fire({ title: '傳送中...', didOpen: () => Swal.showLoading() });

    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });
        
        Swal.fire('成功', '紀錄已儲存', 'success');
        bootstrap.Modal.getInstance(document.getElementById('therapyRecordModal')).hide();
        document.getElementById('therapyForm').reset();
        document.querySelectorAll('.area-toggle').forEach(el => {
             document.getElementById(el.dataset.target).classList.add('d-none');
        });
        // 重新載入列表以顯示新資料
        loadRecords(); 
        
    } catch(e) {
        Swal.fire('錯誤', '傳送失敗', 'error');
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
// 功能 D: 提問與回覆
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
        list.innerHTML = '<div class="alert alert-light text-center w-100">目前沒有任何提問</div>';
        return;
    }

    data.reverse().forEach(q => {
        let roleBadge = '';
        if (q.asker_role === 'teacher') roleBadge = '<span class="badge bg-primary">教師</span>';
        else if (q.asker_role === 'therapist') roleBadge = '<span class="badge bg-success">治療師</span>';
        else roleBadge = '<span class="badge bg-warning text-dark">家長</span>';

        let targetHtml = '';
        if (q.target_role) {
            const roles = q.target_role.split(','); 
            const nameMap = { "teacher": "教師", "therapist": "治療師", "parents": "家長" };
            targetHtml = roles.map(r => {
                const label = nameMap[r.trim()] || r;
                return `<span class="badge rounded-pill bg-light text-dark border me-1" style="font-size: 0.85em;">@${label}</span>`;
            }).join('');
        }

        const statusColor = q.status === '已回覆' ? 'success' : 'secondary';
        let replyHtml = q.reply 
            ? `<div class="mt-3 p-3 bg-light rounded border-start border-4 border-success">
                 <div class="d-flex justify-content-between"><small class="fw-bold text-success"><i class="fas fa-check-circle"></i> 回覆：</small></div>
                 <p class="mb-0 mt-1 text-dark">${q.reply}</p>
               </div>`
            : `<div class="mt-3 text-end"><button class="btn btn-outline-secondary btn-sm" onclick="replyQuestion('${q.id}')"><i class="fas fa-reply"></i> 點此回覆</button></div>`;

        const html = `
            <div class="col-md-12">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                                ${roleBadge} 
                                <span class="fw-bold ms-1">${q.asker_name}</span>
                                <small class="text-muted ms-2"><i class="far fa-clock"></i> ${q.date}</small>
                            </div>
                            <span class="badge bg-${statusColor}-subtle text-${statusColor} border border-${statusColor}">${q.status}</span>
                        </div>
                        <div class="mb-2">${targetHtml}</div>
                        <h5 class="card-text mt-2 text-dark" style="white-space: pre-wrap;">${q.question}</h5>
                        ${replyHtml}
                    </div>
                </div>
            </div>`;
        list.innerHTML += html;
    });
}

async function openQuestionModal() {
    const { value: formValues } = await Swal.fire({
        title: '我要提問',
        html: `
            <div class="text-start mb-2 fw-bold text-secondary">想要提問的對象：</div>
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
// 功能 E: 行事曆 (修復 ID 錯亂問題)
// ==========================================
// ==========================================
// 功能 E: 行事曆 (修正身分顯示 + 移除詳細內容)
// ==========================================
function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    document.getElementById("calendar-section").classList.remove("d-none");

    const monthPicker = document.getElementById('calendar-month-picker');
    if (monthPicker) {
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
        displayEventTime: false, 

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
                
                const eventsWithColor = (json.data || []).map(evt => {
                    let colorClass = 'evt-orange'; // 預設教師
                    if (evt.role === 'therapist') colorClass = 'evt-green';
                    
                    return { 
                        ...evt, 
                        classNames: [colorClass],
                        extendedProps: {
                            ...evt.extendedProps,
                            role: evt.role, 
                            creator: roleName(evt.role) // 這裡會將 role 轉為中文
                        }
                    };
                });
                successCallback(eventsWithColor);
            } catch (e) { failureCallback(e); }
        },
        eventClick: function(info) {
             const isOwner = ['teacher', 'therapist'].includes(currentUser.role);
             const props = info.event.extendedProps;
             // 🟢 修正：若 props.creator 為 undefined，則顯示當前使用者身分 (針對剛新增未重整的情況)
             const creator = props.creator || roleName(props.role) || "未知"; 
             const timeStr = info.event.start ? info.event.start.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : '全天';

             // 🟢 修正：移除詳細內容顯示
             const contentHtml = `
                <div class="text-start bg-light p-3 rounded mb-3">
                    <p class="mb-1"><strong><i class="far fa-clock"></i> 時間：</strong> ${timeStr}</p>
                    <p class="mb-0"><strong><i class="fas fa-user"></i> 新增者：</strong> ${creator}</p>
                </div>
             `;

             if (!isOwner) {
                 Swal.fire({ 
                     title: info.event.title, 
                     html: contentHtml, 
                     icon: 'info', 
                     confirmButtonColor: '#2563EB' 
                 });
             } else {
                 Swal.fire({
                     title: info.event.title,
                     html: `
                        ${contentHtml}
                        <div class="d-flex gap-2 justify-content-center mt-2">
                            <button id="btn-swal-edit" class="btn btn-primary flex-grow-1"><i class="fas fa-edit"></i> 編輯</button>
                            <button id="btn-swal-del" class="btn btn-outline-danger flex-grow-1"><i class="fas fa-trash-alt"></i> 刪除</button>
                        </div>
                     `,
                     showConfirmButton: false, 
                     showCloseButton: true,
                     didOpen: () => {
                         document.getElementById('btn-swal-edit').onclick = () => {
                             Swal.close();
                             openEventModal(info.event); 
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

function openEventModal(event = null) {
    document.getElementById('eventForm').reset();
    document.getElementById('evt-id').value = '';
    
    const btnDel = document.getElementById('btn-del-evt');
    if(btnDel) btnDel.classList.add('d-none');

    if (event) {
        document.getElementById('evt-id').value = event.id;
        document.getElementById('evt-title').value = event.title;
        
        if(event.start) document.getElementById('evt-start').value = toLocalISOString(event.start);
        if(event.end) document.getElementById('evt-end').value = toLocalISOString(event.end);
        
        if(btnDel) btnDel.classList.remove('d-none');
    } else {
        const now = new Date();
        now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
        document.getElementById('evt-start').value = now.toISOString().slice(0,16);
    }

    const modalEl = document.getElementById('eventModal');
    const modal = new bootstrap.Modal(modalEl);
    modal.show();
}

async function saveEvent() {
    const id = document.getElementById('evt-id').value;
    const title = document.getElementById('evt-title').value;
    const start = document.getElementById('evt-start').value;
    const end = document.getElementById('evt-end').value;
    
    // 🟢 修正：強制使用當前使用者的身分，解決顯示「訪客」的問題
    const role = currentUser.role; 

    if (!title || !start) {
        Swal.fire('錯誤', '標題與開始時間為必填', 'error');
        return;
    }

    const payload = { 
        title, start, end, 
        role: role, // 寫入正確身分
        description: "" // 清空詳細內容
    };

    try {
        let url = `${API_URL}/api/calendar`;
        let method = 'POST';

        if (id) {
            url = `${API_URL}/api/calendar/${id}`;
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
            Swal.fire('成功', id ? '排程已更新' : '排程已新增', 'success');
        } else {
            throw new Error('儲存失敗');
        }
    } catch (error) {
        // 若無後端，前端模擬成功
        const modalEl = document.getElementById('eventModal');
        const modal = bootstrap.Modal.getInstance(modalEl);
        modal.hide();
        Swal.fire('前端模擬', '資料已送出', 'success');
    }
}

async function deleteEvent(id = null) {
    if(!id) id = document.getElementById('evt-id').value;
    
    const result = await Swal.fire({
        title: '確定刪除?',
        text: "刪除後無法復原",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#d33',
        confirmButtonText: '刪除'
    });

    if (result.isConfirmed) {
        try {
            await fetchWithAuth(`${API_URL}/api/calendar/${id}`, { method: "DELETE" });
            calendar.refetchEvents();
            // 如果是在 Modal 裡點刪除，要關閉 Modal
            const modalEl = document.getElementById('eventModal');
            const modal = bootstrap.Modal.getInstance(modalEl);
            if(modal) modal.hide();
            
            Swal.fire('已刪除', '排程已移除', 'success');
        } catch(e) {
            Swal.fire('前端模擬', '刪除指令已發送', 'success');
        }
    }
}

// ==========================================
// 功能 F: 治療紀錄表單整合 (Google Sheets)
// ==========================================
function openTherapyForm() {
    new bootstrap.Modal(document.getElementById('therapyRecordModal')).show();
}

// ==========================================
// 功能 F: 治療紀錄表單整合 (Google Sheets)
// ==========================================
function openTherapyForm() {
    new bootstrap.Modal(document.getElementById('therapyRecordModal')).show();
}

async function submitTherapyRecord() {
    // 🔴 請確保此處網址是您最新的 Apps Script 部署網址 (結尾是 /exec)
    const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzJyvD4A63VSCo7isp_Pwmciq5nKRLM3H8otQfdWtWe_XYShVu609jruQVqm7YFt4Iw_w/exec"; 

    const date = document.getElementById('form-date').value;
    const duration = document.getElementById('form-duration').value;
    if(!date || !duration) return Swal.fire("欄位未填", "請輸入日期與時長", "warning");

    const getData = (chk, inp, sel) => {
        if(!document.getElementById(chk).checked) return ["", ""];
        return [document.getElementById(inp).value, document.getElementById(sel).value];
    }

    const [compC, compP] = getData('check-comp', 'input-comp-content', 'select-comp-perf');
    const [expC, expP] = getData('check-exp', 'input-exp-content', 'select-exp-perf');
    const [artC, artP] = getData('check-art', 'input-art-content', 'select-art-perf');
    const [commC, commP] = getData('check-comm', 'input-comm-content', 'select-comm-perf');

    let part = []; document.querySelectorAll('.check-part:checked').forEach(e=>part.push(e.value));
    let strat = []; document.querySelectorAll('.check-strat:checked').forEach(e=>strat.push(e.value));

    const payload = {
        date: date,
        type: document.querySelector('input[name="form-type"]:checked').value,
        duration: duration,
        goal_comp_content: compC, goal_comp_perf: compP,
        goal_exp_content: expC, goal_exp_perf: expP,
        goal_art_content: artC, goal_art_perf: artP,
        goal_comm_content: commC, goal_comm_perf: commP,
        participation: part.join(', '),
        participation_other: document.getElementById('check-part-other').checked ? document.getElementById('input-part-other').value : "",
        strategies: strat.join(', '),
        strategies_other: document.getElementById('check-strat-other').checked ? document.getElementById('input-strat-other').value : "",
        remarks: document.getElementById('input-remarks').value
    };

    Swal.fire({ title: '傳送中...', didOpen: () => Swal.showLoading() });

    try {
        await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            body: JSON.stringify(payload),
            headers: { 'Content-Type': 'application/json' }
        });
        
        // 🟢 修改：更改成功訊息文字
        Swal.fire('謝謝您的耐心填寫', '紀錄已儲存', 'success');
        
        bootstrap.Modal.getInstance(document.getElementById('therapyRecordModal')).hide();
        document.getElementById('therapyForm').reset();
        // 重置動態選單
        document.querySelectorAll('.area-toggle').forEach(el => {
             document.getElementById(el.dataset.target).classList.add('d-none');
        });
        // 重新載入列表以顯示新資料
        loadRecords(); 
        
    } catch(e) {
        Swal.fire('錯誤', '傳送失敗', 'error');
    }
}