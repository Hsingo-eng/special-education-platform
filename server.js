const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai"); // 引入 AI 套件

// 載入環境變數
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 設定 Socket.io
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- 設定 ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let auth;

auth = new google.auth.GoogleAuth({
    credentials: {
        client_email: 'sheet-editor@platform-project-481912.iam.gserviceaccount.com',
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: "v4", auth });

// Google Gemini AI 連線
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- 工具函式區域 ---

// 1. 讀取資料
const getSheetData = async (sheetName) => {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${sheetName}!A:Z`,
        });
        const rows = res.data.values;
        if (!rows || rows.length === 0) return [];
        const headers = rows[0];
        return rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, index) => obj[header] = row[index] || "");
            return obj;
        });
    } catch (error) {
        console.error(`讀取 ${sheetName} 失敗:`, error.message);
        return [];
    }
};

// 2. 寫入新資料 (Append)
const appendRow = async (sheetName, dataObj) => {
    // 先讀取標題列，確保寫入順序正確
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!1:1`, // 只讀第一列標題
    });
    const headers = res.data.values[0];
    const row = headers.map(header => dataObj[header] || "");

    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: sheetName,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [row] },
    });
};

// 3. 更新資料 (Update) - 用於老師回覆
const updateRow = async (sheetName, id, updateData) => {
    // 1. 先讀所有資料找出行數
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A:Z`,
    });
    const rows = res.data.values;
    const headers = rows[0];

    // 尋找 ID 所在的行 (假設 ID 都在第一欄)
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === id) {
            rowIndex = i + 1; // Google Sheet 行數從 1 開始
            break;
        }
    }

    if (rowIndex === -1) throw new Error("找不到該筆 ID");

    // 2. 準備要更新的整行資料
    // 先把舊資料轉成物件，再合併新資料
    let currentRowObj = {};
    headers.forEach((h, i) => currentRowObj[h] = rows[rowIndex - 1][i]);

    const finalData = { ...currentRowObj, ...updateData };
    const rowArray = headers.map(h => finalData[h] || "");

    // 3. 寫回 Google Sheet
    const range = `${sheetName}!A${rowIndex}`; // 例如 records!A2
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowArray] },
    });
};

// --- 中介軟體 (Middleware)：保護 API 用 ---
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // 格式通常是 "Bearer TOKEN"

    if (!token) return res.status(401).json({ message: "未登入" });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: "憑證無效" });
        req.user = user; // 把解密後的使用者資料 (含 role) 存入 req
        next();
    });
};

// 檢查角色權限
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        if (allowedRoles.includes(req.user.role)) {
            next();
        } else {
            res.status(403).json({ message: "您的權限不足，無法執行此動作" });
        }
    };
};

// --- API 路由 ---

// 1. 登入系統 (改為讀取 Google Sheet)
app.post("/auth/login", async (req, res) => {
    const { username, password } = req.body;

    // 從 Google Sheet 'users' 分頁讀取使用者清單
    const users = await getSheetData("users");

    // 這是抓鬼用的除錯訊息，會印在終端機
    console.log("【除錯監控】從 Sheet 讀到的資料:", JSON.stringify(users, null, 2));
    console.log("【除錯監控】前端傳來的帳密:", username, password);

    // 比對帳號密碼
    const user = users.find(u => u.username === username && u.password === password);

    if (!user) {
        console.log("【除錯監控】比對結果: 找不到使用者或密碼錯誤");
        return res.status(401).json({ message: "帳號或密碼錯誤" });
    }

    console.log("【除錯監控】比對結果: 登入成功！使用者是", user.name);

    const token = jwt.sign(
        { username: user.username, role: user.role, name: user.name },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
    res.json({ token, user: { name: user.name, role: user.role } });
});

// ==========================================
// 功能 1：專業紀錄 (Records)
// ==========================================

// 讀取紀錄 (教師、治療師可看全部) - *家長其實也可以看，但只能看自己的(這邊先簡化為全部)*
app.get("/api/records", verifyToken, async (req, res) => {
    // 如果是家長，這裡可以做過濾邏輯，目前先假設家長不能看專業紀錄
    if (req.user.role === 'parents') {
        return res.status(403).json({ message: "家長權限無法查看專業治療紀錄" });
    }
    const data = await getSheetData("records");
    res.json({ data });
});

// 新增紀錄 (只有治療師)
app.post("/api/records", verifyToken, checkRole(['therapist']), async (req, res) => {
    try {
        const newRecord = {
            id: `rec-${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            therapist_name: req.user.name,
            content: req.body.content,
            teacher_reply: "",
            created_at: new Date().toISOString()
        };
        await appendRow("records", newRecord);
        io.emit("record_update", { msg: "治療師新增了一筆紀錄" });
        res.json({ message: "新增成功", data: newRecord });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// 教師回覆 (只有教師)
app.put("/api/records/:id", verifyToken, checkRole(['teacher']), async (req, res) => {
    try {
        const { id } = req.params;
        const { reply } = req.body; // 前端傳來的回覆內容

        await updateRow("records", id, { teacher_reply: reply });
        io.emit("record_update", { msg: "老師已回覆紀錄" });
        res.json({ message: "回覆成功" });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// ==========================================
// 功能 2：留言板 + AI (Messages)
// ==========================================

// 讀取留言
app.get("/api/messages", verifyToken, async (req, res) => {
    const data = await getSheetData("messages");
    res.json({ data });
});

// 新增留言 (大家都可以)
app.post("/api/messages", verifyToken, async (req, res) => {
    try {
        const newMsg = {
            id: `msg-${Date.now()}`,
            user_name: req.user.name,
            role: req.user.role,
            message: req.body.message,
            timestamp: new Date().toISOString()
        };
        await appendRow("messages", newMsg);
        io.emit("message_update", newMsg); // 即時廣播
        res.json({ message: "留言成功" });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// ✨ AI 總結功能 (亮點)
app.get("/api/messages/summary", verifyToken, async (req, res) => {
    try {
        // 1. 抓取最近 10 筆留言
        const allMessages = await getSheetData("messages");
        const recentMsgs = allMessages.slice(-10); // 取最後 10 筆

        if (recentMsgs.length === 0) return res.json({ summary: "目前沒有留言可總結。" });

        // 2. 組合給 AI 的提示詞 (Prompt)
        const promptText = recentMsgs.map(m => `${m.role} ${m.user_name} 說: ${m.message}`).join("\n");
        const finalPrompt = `
            請扮演一位專業的特教個案管理師。
            以下是親師與治療師的最近溝通紀錄：
            ---
            ${promptText}
            ---
            請幫我用條列式摘要以上溝通的重點 (100字以內)：
        `;

        // 3. 呼叫 Gemini AI
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        const text = response.text();

        res.json({ summary: text });

    } catch (error) {
        console.error("AI 錯誤:", error);
        res.status(500).json({ message: "AI 總結失敗", error: error.message });
    }
});

// --- 啟動 ---
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});