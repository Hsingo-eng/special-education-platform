const API_URL = "https://special-education-platform.zeabur.app";
const socket = io(API_URL);
let currentUser = null;

// --- 1. 網頁載入時檢查登入狀態 ---
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");
    
    if (token && userStr) {
        currentUser = JSON.parse(userStr);
        showDashboard(); 
        initCalendar();
    }
});

// --- 2. 登入功能 (包含除錯紀錄) ---
async function login() {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();

    // 🟢 抓鬼專用：印出輸入的帳密 (請看控制台)
    console.log("正在嘗試登入，帳號:", `"${username}"`, "密碼:", `"${password}"`);

    if(!username || !password) return Swal.fire("錯誤", "請輸入帳號密碼", "warning");

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        
        const data = await res.json();
        
        // 🟢 抓鬼專用：印出伺服器回應
        console.log("伺服器回應狀態:", res.status);
        console.log("伺服器回應資料:", data);
        
        if (res.ok) {
            localStorage.setItem("token", data.token);
            localStorage.setItem("user", JSON.stringify(data.user));
            currentUser = data.user;
            
            Swal.fire({
                icon: 'success',
                title: '登入成功',
                text: `歡迎回來！${roleName(currentUser.role)} ${currentUser.name}`,
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

// --- 3. 畫面切換與權限控制 ---
function showDashboard() {
    document.getElementById("login-section").classList.add("d-none");
    document.getElementById("dashboard-section").classList.remove("d-none");
    document.getElementById("main-nav").classList.remove("d-none");
    
    document.getElementById("nav-user-info").innerHTML = 
        `<i class="fas fa-user-circle"></i> ${currentUser.name} <span class="badge bg-secondary">${roleName(currentUser.role)}</span>`;

    // 權限隱藏 (例如家長看不到專業紀錄)
    document.querySelectorAll(".role-restricted").forEach(el => {
        if (el.dataset.deny === currentUser.role) {
            el.classList.add("d-none");
        }
    });

    // 只有特定角色看得到的按鈕
    document.querySelectorAll(".role-only").forEach(el => {
        if (el.dataset.allow !== currentUser.role) {
            el.classList.add("d-none");
        }
    });
}

function showSection(sectionId) {
    // 隱藏所有分頁
    ["records", "iep", "messages", "questions"].forEach(id => {
        const el = document.getElementById(`section-${id}`);
        if(el) el.classList.add("d-none");
    });
    // 顯示目標分頁
    const target = document.getElementById(`section-${sectionId}`);
    if(target) target.classList.remove("d-none");

    if (sectionId === 'questions') loadQuestions();
    if (sectionId === 'messages') loadMessages();
    if (sectionId === 'records') loadRecords();
    if (sectionId === 'iep') loadIepFiles();
}

// --- 工具: Fetch 封裝 (已修正檔案上傳問題，並刪除重複定義) ---
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem("token");
    
    // 1. 基本 Header 只有 Authorization
    const headers = {
        "Authorization": `Bearer ${token}`,
        ...options.headers
    };

    // 2. 關鍵判斷：只有當 body "不是" 檔案 (FormData) 時，才加入 json 設定
    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    return fetch(url, { ...options, headers });
}

function roleName(role) {
    const map = { "teacher": "教師", "therapist": "治療師", "parents": "家長" };
    return map[role] || role;
}

// --- Socket 即時監聽 ---
socket.on("message_update", (msg) => {
    const msgSection = document.getElementById("section-messages");
    if (msgSection && !msgSection.classList.contains("d-none")) {
        renderMessage(msg);
        const chatBox = document.getElementById("chat-box");
        if(chatBox) chatBox.scrollTop = chatBox.scrollHeight;
    }
});

// ==========================================
// 功能 A: 留言板 (包含 AI)
// ==========================================

async function loadMessages() {
    const chatBox = document.getElementById("chat-box");
    chatBox.innerHTML = '<div class="text-center py-3"><div class="spinner-border text-primary"></div></div>';
    
    try {
        const res = await fetchWithAuth(`${API_URL}/api/messages`);
        const json = await res.json();
        chatBox.innerHTML = "";
        
        if (!json.data || json.data.length === 0) {
            chatBox.innerHTML = "<div class='text-center text-muted'>目前沒有留言</div>";
            return;
        }
        json.data.forEach(msg => renderMessage(msg));
        chatBox.scrollTop = chatBox.scrollHeight;
    } catch (err) {
        console.error(err);
    }
}

function renderMessage(msg) {
    const chatBox = document.getElementById("chat-box");
    
    // 1. 判斷這則訊息是不是「我自己」發的
    // 我們比對訊息裡的 user_name 和現在登入者的 name
    const isMe = (msg.user_name === currentUser.name);

    // 2. 決定對齊方向的 class (msg-self 靠右, msg-other 靠左)
    const alignClass = isMe ? "msg-self" : "msg-other";

    // 3. 決定顏色的 class (保持原本的角色顏色)
    let colorClass = "msg-teacher";
    if (msg.role === "parents") colorClass = "msg-parents";
    if (msg.role === "therapist") colorClass = "msg-therapist";

    const div = document.createElement("div");
    // 同時加上「對齊樣式」和「顏色樣式」
    div.className = `message-item ${alignClass} ${colorClass}`;
    
    const label = isMe ? "我" : `${roleName(msg.role)} - ${msg.user_name}`;

    div.innerHTML = `
        <span class="msg-role-label">${label}</span>
        <div>${msg.message}</div>
    `;
    chatBox.appendChild(div);
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
    Swal.fire({ 
        title: "AI 正在閱讀對話紀錄...", 
        text: "請稍候，Gemini 正在分析重點",
        allowOutsideClick: false, 
        didOpen: () => Swal.showLoading() 
    });
    
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
            list.innerHTML = "<div class='alert alert-danger'>⚠️ 您沒有權限查看此區域 (僅限專業人員)</div>";
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
                ? `<div class="mt-3 p-3 bg-light border-start border-4 border-primary rounded">
                    <strong>👩‍🏫 老師回覆：</strong> ${rec.teacher_reply}
                   </div>` 
                : (currentUser.role === 'teacher' 
                    ? `<button class="btn btn-sm btn-outline-primary mt-2" onclick="replyRecord('${rec.id}')"><i class="fas fa-reply"></i> 回覆此紀錄</button>` 
                    : `<div class="mt-2 text-muted fst-italic text-sm">等待老師回覆...</div>`);

            const item = `
                <div class="list-group-item list-group-item-action mb-3 border-0 shadow-sm rounded p-4">
                    <div class="d-flex w-100 justify-content-between border-bottom pb-2 mb-2">
                        <h5 class="mb-1 text-dark fw-bold"><i class="fas fa-calendar-alt text-success"></i> ${rec.date} 治療紀錄</h5>
                        <small class="text-muted"><i class="fas fa-user-md"></i> ${rec.therapist_name}</small>
                    </div>
                    <p class="mb-1 lead fs-6">${rec.content}</p>
                    ${replyHtml}
                </div>
            `;
            list.innerHTML += item;
        });

    } catch (err) {
        list.innerHTML = "<div class='alert alert-danger'>載入失敗</div>";
    }
}

async function openRecordModal() {
    const { value: text } = await Swal.fire({
        input: 'textarea',
        inputLabel: '新增治療紀錄',
        inputPlaceholder: '請輸入今日個案表現...',
        inputAttributes: { 'aria-label': 'Type your message here' },
        showCancelButton: true
    });

    if (text) {
        await fetchWithAuth(`${API_URL}/api/records`, {
            method: "POST",
            body: JSON.stringify({ content: text })
        });
        loadRecords();
    }
}

async function replyRecord(id) {
    const { value: text } = await Swal.fire({
        input: 'textarea',
        inputLabel: '回覆治療師',
        inputPlaceholder: '請輸入建議或觀察...',
        showCancelButton: true
    });

    if (text) {
        await fetchWithAuth(`${API_URL}/api/records/${id}`, {
            method: "PUT",
            body: JSON.stringify({ reply: text })
        });
        loadRecords();
    }
}

// ==========================================
// 功能 C: IEP 檔案管理
// ==========================================

async function loadIepFiles() {
    const list = document.getElementById("iep-list");
    list.innerHTML = '<div class="col-12 text-center py-5"><div class="spinner-border text-danger"></div><p>載入檔案中...</p></div>';

    try {
        const res = await fetchWithAuth(`${API_URL}/api/iep`);
        const json = await res.json();
        list.innerHTML = "";

        if (!json.data || json.data.length === 0) {
            list.innerHTML = `<div class="col-12 text-center text-muted py-5"><i class="fas fa-folder-open fa-3x mb-3"></i><p>目前沒有 IEP 檔案</p></div>`;
            return;
        }

        json.data.forEach(file => {
            list.innerHTML += `
                <div class="col-md-6 col-lg-4">
                    <div class="card h-100 shadow-sm border-0">
                        <div class="card-body">
                            <div class="d-flex align-items-center mb-3">
                                <div class="bg-light rounded-circle p-3 me-3 text-danger"><i class="fas fa-file-pdf fa-2x"></i></div>
                                <div class="text-truncate" style="max-width: 150px;">
                                    <h6 class="mb-0" title="${file.filename}">${file.filename}</h6>
                                    <small class="text-muted">${file.upload_date}</small>
                                </div>
                            </div>
                            <p class="small text-secondary">
                                <i class="fas fa-user"></i> ${file.uploaded_by}<br>
                                <i class="fas fa-comment"></i> ${file.comments || "無"}
                            </p>
                            <a href="${file.file_link}" target="_blank" class="btn btn-outline-danger w-100 btn-sm">檢視檔案</a>
                        </div>
                    </div>
                </div>`;
        });
    } catch (err) {
        console.error(err);
        list.innerHTML = "<div class='alert alert-danger'>無法載入檔案</div>";
    }
}

async function openIepUpload() {
    const { value: formValues } = await Swal.fire({
        title: '上傳 IEP 檔案',
        html: `
            <input type="file" id="swal-file" class="form-control mb-3">
            <input type="text" id="swal-comment" class="form-control" placeholder="備註 (選填)">
        `,
        showCancelButton: true,
        confirmButtonText: '開始上傳',
        preConfirm: () => {
            const fileInput = document.getElementById('swal-file');
            if (!fileInput.files.length) return Swal.showValidationMessage('請選擇檔案');
            return { file: fileInput.files[0], comment: document.getElementById('swal-comment').value };
        }
    });

    if (formValues) {
        Swal.fire({ title: '檔案上傳中...', text: '請稍候，正在傳送至雲端', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        const formData = new FormData();
        formData.append("file", formValues.file);
        formData.append("comments", formValues.comment);

        try {
            const res = await fetchWithAuth(`${API_URL}/api/iep`, { method: "POST", body: formData });
            
            if (res.ok) {
                Swal.fire("成功", "IEP 檔案已上傳！", "success");
                loadIepFiles();
            } else {
                const errData = await res.json();
                throw new Error(errData.message);
            }
        } catch (error) {
            Swal.fire("失敗", "上傳失敗：" + error.message, "error");
        }
    }
}

// ==========================================
// 功能 D: 提問與回覆
// ==========================================

async function loadQuestions() {
    const list = document.getElementById("questions-list");
    list.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-info"></div></div>';
    
    // 這裡使用 fetchWithAuth，它會自動處理 token
    try {
        const res = await fetchWithAuth(`${API_URL}/api/questions`);
        const json = await res.json();
        renderQuestions(json.data);
    } catch (err) {
        console.error(err);
        list.innerHTML = '<p class="text-center text-danger">載入失敗</p>';
    }
}

// 2. 渲染問題卡片 (顯示在畫面上) - 已新增 @對象 功能
function renderQuestions(data) {
    const list = document.getElementById("questions-list");
    list.innerHTML = "";

    if (!data || data.length === 0) {
        list.innerHTML = '<div class="alert alert-light text-center w-100">目前沒有任何提問</div>';
        return;
    }

    data.reverse().forEach(q => {
        // --- 1. 處理發問者身分 ---
        let roleBadge = '';
        if (q.asker_role === 'teacher') roleBadge = '<span class="badge bg-primary">教師</span>';
        else if (q.asker_role === 'therapist') roleBadge = '<span class="badge bg-success">治療師</span>';
        else roleBadge = '<span class="badge bg-warning text-dark">家長</span>';

        // --- 2.新增：處理「被提問對象」標籤 (@xxx) ---
        let targetHtml = '';
        if (q.target_role) {
            const roles = q.target_role.split(','); // 把 "teacher,parents" 切割開來
            const nameMap = { "teacher": "教師", "therapist": "治療師", "parents": "家長" };
            
            targetHtml = roles.map(r => {
                return `<span class="badge rounded-pill bg-secondary bg-opacity-75 text-white me-1" style="font-size: 0.8em;">@${nameMap[r] || r}</span>`;
            }).join('');
        }

        // --- 3. 處理狀態顏色 ---
        const statusColor = q.status === '已回覆' ? 'success' : 'secondary';

        // --- 4. 處理回覆內容 ---
        let replyHtml = '';
        if (q.reply) {
            replyHtml = `
                <div class="mt-3 p-3 bg-light rounded border-start border-4 border-success">
                    <div class="d-flex justify-content-between">
                        <small class="fw-bold text-success"><i class="fas fa-check-circle"></i> ${q.replier_name} 的回覆：</small>
                    </div>
                    <p class="mb-0 mt-1 text-dark">${q.reply}</p>
                </div>
            `;
        } else {
            replyHtml = `
                <div class="mt-3 text-end">
                    <button class="btn btn-outline-secondary btn-sm" onclick="replyQuestion('${q.id}')">
                        <i class="fas fa-reply"></i> 點此回覆
                    </button>
                </div>
            `;
        }

        // --- 5. 組合 HTML ---
        const html = `
            <div class="col-md-12">
                <div class="card shadow-sm border-0 h-100">
                    <div class="card-body">
                        <div class="d-flex justify-content-between align-items-start mb-2">
                            <div>
                                ${roleBadge} <span class="fw-bold ms-1">${q.asker_name}</span>
                                <small class="text-muted ms-2"><i class="far fa-clock"></i> ${q.date}</small>
                            </div>
                            <span class="badge bg-${statusColor}-subtle text-${statusColor} border border-${statusColor}">${q.status}</span>
                        </div>
                        
                        <div class="mb-2">${targetHtml}</div>

                        <h5 class="card-text mt-2 text-dark" style="white-space: pre-wrap;">${q.question}</h5>
                        
                        ${replyHtml}
                    </div>
                </div>
            </div>
        `;
        list.innerHTML += html;
    });
}

// 3. 開啟提問視窗 (已新增：勾選對象功能)
async function openQuestionModal() {
    const { value: formValues } = await Swal.fire({
        title: '我要提問',
        // 這裡改用 html 來放入「複選框」和「輸入框」
        html: `
            <div class="text-start mb-2 fw-bold text-secondary">請問您想詢問的對象是？(可複選)</div>
            <div class="d-flex gap-3 mb-3 justify-content-center">
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="target-teacher" value="teacher">
                    <label class="form-check-label" for="target-teacher">教師</label>
                </div>
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="target-therapist" value="therapist">
                    <label class="form-check-label" for="target-therapist">治療師</label>
                </div>
                <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="target-parents" value="parents">
                    <label class="form-check-label" for="target-parents">家長</label>
                </div>
            </div>
            <textarea id="swal-question" class="form-control" rows="4" placeholder="請輸入您的問題..."></textarea>
        `,
        showCancelButton: true,
        confirmButtonText: '發布',
        cancelButtonText: '取消',
        confirmButtonColor: '#17a2b8',
        preConfirm: () => {
            // 1. 抓取問題內容
            const question = document.getElementById('swal-question').value;
            
            // 2. 抓取勾選的對象
            const targets = [];
            if (document.getElementById('target-teacher').checked) targets.push('teacher');
            if (document.getElementById('target-therapist').checked) targets.push('therapist');
            if (document.getElementById('target-parents').checked) targets.push('parents');

            if (!question) return Swal.showValidationMessage('請輸入問題內容');
            if (targets.length === 0) return Swal.showValidationMessage('請至少選擇一個詢問對象');

            // 回傳給下面的 then 使用
            return { question: question, target_role: targets.join(',') };
        }
    });

    if (formValues) {
        try {
            // 使用 fetchWithAuth 發送資料 (包含 target_role)
            const res = await fetchWithAuth(`${API_URL}/api/questions`, {
                method: "POST",
                body: JSON.stringify({ 
                    question: formValues.question,
                    target_role: formValues.target_role 
                })
            });
            
            if (!res.ok) throw new Error(res.statusText);
            
            Swal.fire('成功', '您的提問已發布', 'success');
            loadQuestions();
            
        } catch (error) {
            Swal.fire('發布失敗', error.message, 'error');
        }
    }
}

function replyQuestion(id) {
    Swal.fire({
        title: '回覆問題',
        input: 'textarea',
        inputLabel: '請輸入您的回覆',
        inputPlaceholder: '輸入內容...',
        showCancelButton: true,
        confirmButtonText: '送出回覆',
        confirmButtonColor: '#28a745',
        showLoaderOnConfirm: true,
        preConfirm: async (reply) => {
            if (!reply) return Swal.showValidationMessage('請輸入內容');

            try {
                const res = await fetchWithAuth(`${API_URL}/api/questions/${id}`, {
                    method: "PUT",
                    body: JSON.stringify({ reply: reply })
                });
                if (!res.ok) throw new Error(res.statusText);
                return await res.json();
            } catch (error) {
                Swal.showValidationMessage(`回覆失敗: ${error}`);
            }
        }
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire('成功', '已送出回覆', 'success');
            loadQuestions();
        }
    });
}

// ==========================================
// 功能 E: 行事曆 (FullCalendar)
// ==========================================
let calendar; // 全域變數

function initCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    // 顯示區塊
    document.getElementById("calendar-section").classList.remove("d-none");

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth', // 月視圖
        locale: 'zh-tw', // 中文
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,listMonth' // 可切換列表
        },
        height: 450, // 高度適中
        events: async function(info, successCallback, failureCallback) {
            try {
                // 使用 fetchWithAuth 抓取後端資料
                const res = await fetchWithAuth(`${API_URL}/api/calendar`);
                const json = await res.json();
                if(json.data) {
                    successCallback(json.data);
                } else {
                    successCallback([]);
                }
            } catch (error) {
                console.error(error);
                failureCallback(error);
            }
        },
        eventClick: function(info) {
            // 點擊事件顯示詳情
            Swal.fire({
                title: info.event.title,
                text: info.event.extendedProps.description || "無備註",
                icon: 'info',
                footer: `<small>時間: ${info.event.start.toLocaleString()}</small>`
            });
        }
    });
    calendar.render();
}


async function openEventModal() {
    const { value: formValues } = await Swal.fire({
        title: '新增行事曆',
        html: `
            <input type="text" id="swal-evt-title" class="form-control mb-3" placeholder="事件標題 (如: IEP會議)">
            <input type="date" id="swal-evt-date" class="form-control mb-3">
            <input type="time" id="swal-evt-time" class="form-control mb-3" value="09:00">
            <input type="text" id="swal-evt-desc" class="form-control" placeholder="備註 (選填)">
        `,
        showCancelButton: true,
        confirmButtonText: '新增',
        preConfirm: () => {
            return {
                title: document.getElementById('swal-evt-title').value,
                date: document.getElementById('swal-evt-date').value,
                time: document.getElementById('swal-evt-time').value,
                description: document.getElementById('swal-evt-desc').value
            };
        }
    });

    if (formValues) {
        if(!formValues.title || !formValues.date) return Swal.fire("請填寫完整");

        try {
            const res = await fetchWithAuth(`${API_URL}/api/calendar`, {
                method: "POST",
                body: JSON.stringify(formValues)
            });
            if(res.ok) {
                Swal.fire("成功", "行程已加入 Google Calendar", "success");
                calendar.refetchEvents(); // 重新抓取資料
            } else {
                throw new Error("新增失敗");
            }
        } catch (err) {
            Swal.fire("失敗", err.message, "error");
        }
    }
}