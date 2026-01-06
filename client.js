const API_URL = "https://special-education-platform.zeabur.app";
const socket = io(API_URL);
let currentUser = null;

// --- 1. 網頁載入時檢查登入狀態 ---
document.addEventListener("DOMContentLoaded", () => {
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");
    
    if (token && userStr) {
        currentUser = JSON.parse(userStr);
        showDashboard(); // 如果有存過 Token，直接進主畫面
    }
});

// --- 2. 登入功能 ---
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
                text: `歡迎回來！，${roleName(currentUser.role)} ${currentUser.name}`,
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
        document.getElementById(`section-${id}`).classList.add("d-none");
    });
    // 顯示目標分頁
    document.getElementById(`section-${sectionId}`).classList.remove("d-none");
    if (sectionId === 'questions') {
        loadQuestions();
    }

    if (sectionId === 'messages') loadMessages();
    if (sectionId === 'records') loadRecords();
    if (sectionId === 'iep') loadIepFiles();
}

// --- 功能 A: 留言板 (包含 AI) ---
// --- 工具: Fetch 封裝 (自動判斷是否為檔案上傳) ---
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem("token");
    const headers = {
        "Authorization": `Bearer ${token}`,
        ...options.headers
    };

    // 關鍵修正：如果 body 是 FormData (檔案)，就不要手動加 Content-Type
    // 瀏覽器會自動處理 boundary，加了反而會壞掉
    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }

    return fetch(url, { ...options, headers });
}

function renderMessage(msg) {
    const chatBox = document.getElementById("chat-box");
    
    let cssClass = "msg-teacher";
    if (msg.role === "parents") cssClass = "msg-parents";
    if (msg.role === "therapist") cssClass = "msg-therapist";

    const div = document.createElement("div");
    div.className = `message-item ${cssClass}`;
    div.innerHTML = `
        <span class="msg-role-label">${roleName(msg.role)} - ${msg.user_name}</span>
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

// AI 摘要功能
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

// --- 功能 B: 專業紀錄 ---
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
            // 老師的回覆區塊
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

// --- 工具: Fetch 封裝 (已修正檔案上傳問題) ---
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem("token");
    
    // 1. 基本 Header 只有 Authorization
    const headers = {
        "Authorization": `Bearer ${token}`,
        ...options.headers
    };

    // 2. 關鍵判斷：只有當 body "不是" 檔案 (FormData) 時，才加入 json 設定
    // 如果是檔案，瀏覽器會自動幫你加 Content-Type 並附上 boundary，千萬不能自己加！
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
    // 只有當使用者正在看留言板時，才自動更新畫面
    const msgSection = document.getElementById("section-messages");
    if (!msgSection.classList.contains("d-none")) {
        renderMessage(msg);
        const chatBox = document.getElementById("chat-box");
        chatBox.scrollTop = chatBox.scrollHeight;
    }
});

// ==========================================
// 功能 C: IEP 檔案管理
// ==========================================

// 1. 載入檔案列表
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
            // 產生漂亮的檔案卡片
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

// 2. 開啟上傳視窗
async function openIepUpload() {
    // 使用 SweetAlert 顯示上傳表單
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
        // 顯示 Loading
        Swal.fire({ title: '檔案上傳中...', text: '請稍候，正在傳送至雲端', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

        // 建立 FormData 物件
        const formData = new FormData();
        formData.append("file", formValues.file);
        formData.append("comments", formValues.comment);

        try {
            const res = await fetchWithAuth(`${API_URL}/api/iep`, { method: "POST", body: formData });
            
            if (res.ok) {
                Swal.fire("成功", "IEP 檔案已上傳！", "success");
                loadIepFiles(); // 重新整理列表
            } else {
                const errData = await res.json();
                throw new Error(errData.message);
            }
        } catch (error) {
            Swal.fire("失敗", "上傳失敗：" + error.message, "error");
        }
    }
}

// 1. 載入問題列表
async function loadQuestions() {
    const list = document.getElementById("questions-list");
    list.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-info"></div></div>';

    try {
        const res = await fetch(`${API_URL}/api/questions`, {
            headers: { "Authorization": `Bearer ${token}` }
        });
        const json = await res.json();
        renderQuestions(json.data);
    } catch (err) {
        console.error(err);
        list.innerHTML = '<p class="text-center text-danger">載入失敗</p>';
    }
}

// 2. 渲染問題卡片 (顯示在畫面上)
function renderQuestions(data) {
    const list = document.getElementById("questions-list");
    list.innerHTML = "";

    if (!data || data.length === 0) {
        list.innerHTML = '<div class="alert alert-light text-center w-100">目前沒有任何提問</div>';
        return;
    }

    // 依照日期排序 (新的在上面)
    data.reverse().forEach(q => {
        // 設定身分標籤顏色
        let roleBadge = '';
        if (q.asker_role === 'teacher') roleBadge = '<span class="badge bg-primary">教師</span>';
        else if (q.asker_role === 'therapist') roleBadge = '<span class="badge bg-success">治療師</span>';
        else roleBadge = '<span class="badge bg-warning text-dark">家長</span>';

        // 判斷狀態顏色
        const statusColor = q.status === '已回覆' ? 'success' : 'secondary';

        // 判斷是否有回覆
        let replyHtml = '';
        if (q.reply) {
            // 有回覆：顯示回覆內容
            replyHtml = `
                <div class="mt-3 p-3 bg-light rounded border-start border-4 border-success">
                    <div class="d-flex justify-content-between">
                        <small class="fw-bold text-success"><i class="fas fa-check-circle"></i> ${q.replier_name} 的回覆：</small>
                    </div>
                    <p class="mb-0 mt-1 text-dark">${q.reply}</p>
                </div>
            `;
        } else {
            // 沒回覆：顯示回覆按鈕 (大家都可以按)
            replyHtml = `
                <div class="mt-3 text-end">
                    <button class="btn btn-outline-secondary btn-sm" onclick="replyQuestion('${q.id}')">
                        <i class="fas fa-reply"></i> 點此回覆
                    </button>
                </div>
            `;
        }

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
                        
                        <h5 class="card-text mt-2 text-dark" style="white-space: pre-wrap;">${q.question}</h5>
                        
                        ${replyHtml}
                    </div>
                </div>
            </div>
        `;
        list.innerHTML += html;
    });
}

// 3. 開啟提問視窗
function openQuestionModal() {
    Swal.fire({
        title: '我要提問',
        input: 'textarea',
        inputLabel: '請輸入您想詢問的問題或是觀察到的狀況',
        inputPlaceholder: '例如：請問小明最近在家裡的情緒狀況如何？...',
        showCancelButton: true,
        confirmButtonText: '發布',
        cancelButtonText: '取消',
        confirmButtonColor: '#17a2b8',
        showLoaderOnConfirm: true,
        preConfirm: async (question) => {
            if (!question) return Swal.showValidationMessage('請輸入內容');
            
            try {
                const res = await fetch(`${API_URL}/api/questions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    body: JSON.stringify({ question: question })
                });
                if (!res.ok) throw new Error(res.statusText);
                return await res.json();
            } catch (error) {
                Swal.showValidationMessage(`發布失敗: ${error}`);
            }
        }
    }).then((result) => {
        if (result.isConfirmed) {
            Swal.fire('成功', '您的提問已發布', 'success');
            loadQuestions(); // 重新載入列表
        }
    });
}

// 4. 回覆問題
function replyQuestion(id) {
    Swal.fire({
        title: '回覆問題',
        input: 'textarea',
        inputLabel: '請輸入您的回覆',
        inputPlaceholder: '輸入內容...',
        showCancelButton: true,
        confirmButtonText: '送出回覆',
        cancelButtonText: '取消',
        confirmButtonColor: '#28a745',
        showLoaderOnConfirm: true,
        preConfirm: async (reply) => {
            if (!reply) return Swal.showValidationMessage('請輸入內容');

            try {
                const res = await fetch(`${API_URL}/api/questions/${id}`, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
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
            loadQuestions(); // 重新載入列表
        }
    });
}