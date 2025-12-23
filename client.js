const API_URL = "http://special-education-platform.zeabur.app";
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
                text: `歡迎回來，${roleName(currentUser.role)} ${currentUser.name}`,
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

    if (sectionId === 'messages') loadMessages();
    if (sectionId === 'records') loadRecords();
}

// --- 功能 A: 留言板 (包含 AI) ---
async function loadMessages() {
    try {
        const res = await fetchWithAuth(`${API_URL}/api/messages`);
        const json = await res.json();
        const chatBox = document.getElementById("chat-box");
        chatBox.innerHTML = ""; 

        if(json.data) {
            json.data.forEach(msg => renderMessage(msg));
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    } catch (e) { console.error(e); }
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

// --- 工具: Fetch 封裝 (自動帶 Token) ---
async function fetchWithAuth(url, options = {}) {
    const token = localStorage.getItem("token");
    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        ...options.headers
    };
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