const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require("multer");
const { Stream } = require("stream");

// 載入環境變數
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// 設定 Socket.io
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [
            "http://localhost:5500",       // 本機測試用
            "http://127.0.0.1:5500",       // 本機測試用
            "https://hsingo-eng.github.io" // GitHub Pages 網址
        ],
        methods: ["GET", "POST"]
    }
});

// --- 設定 ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// ✅ 這裡定義一次就好 (使用你提供的 ID)
const DRIVE_FOLDER_ID = "1EzFYhf4zzYslzJL3rcccQlLJTR7_Sguq"; 

// --- 新版 OAuth2 驗證 (使用個人帳號空間) ---
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// ✅ 建立服務 (整份檔案只宣告這一次！)
const drive = google.drive({ version: "v3", auth: oauth2Client });
const sheets = google.sheets({ version: "v4", auth: oauth2Client });

// Multer 設定 (設定上傳限制 15MB)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } 
});

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

// --- 中介軟體 (Middleware) ---
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ message: "未登入" });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ message: "憑證無效" });
        req.user = user;
        next();
    });
};

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

// 1. 登入系統
app.post("/auth/login", async (req, res) => {
    const { username, password } = req.body;
    const users = await getSheetData("users");
    const user = users.find(u => u.username === username && u.password === password);

    if (!user) {
        return res.status(401).json({ message: "帳號或密碼錯誤" });
    }

    const token = jwt.sign(
        { username: user.username, role: user.role, name: user.name },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
    res.json({ token, user: { name: user.name, role: user.role } });
});

// 2. 專業紀錄 API
app.get("/api/records", verifyToken, async (req, res) => {
    if (req.user.role === 'parents') {
        return res.status(403).json({ message: "家長權限無法查看專業治療紀錄" });
    }
    const data = await getSheetData("records");
    res.json({ data });
});

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

app.put("/api/records/:id", verifyToken, checkRole(['teacher']), async (req, res) => {
    try {
        const { id } = req.params;
        const { reply } = req.body; 
        await updateRow("records", id, { teacher_reply: reply });
        io.emit("record_update", { msg: "老師已回覆紀錄" });
        res.json({ message: "回覆成功" });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// 3. 留言板 API
app.get("/api/messages", verifyToken, async (req, res) => {
    const data = await getSheetData("messages");
    res.json({ data });
});

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
        io.emit("message_update", newMsg); 
        res.json({ message: "留言成功" });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.get("/api/messages/summary", verifyToken, async (req, res) => {
    try {
        const allMessages = await getSheetData("messages");
        const recentMsgs = allMessages.slice(-10);
        if (recentMsgs.length === 0) return res.json({ summary: "目前沒有留言可總結。" });

        const promptText = recentMsgs.map(m => `${m.role} ${m.user_name} 說: ${m.message}`).join("\n");
        const finalPrompt = `
            請扮演一位專業的特教個案管理師。
            以下是親師與治療師的最近溝通紀錄：
            ---
            ${promptText}
            ---
            請幫我用條列式摘要以上溝通的重點 (100字以內)：
        `;

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

// 4. IEP 檔案上傳 API
app.get("/api/iep", verifyToken, async (req, res) => {
    const data = await getSheetData("iep_files");
    res.json({ data });
});

app.post("/api/iep", verifyToken, checkRole(['teacher']), upload.single('file'), async (req, res) => {
    try {
        const file = req.file; 
        if (!file) return res.status(400).json({ message: "未選擇檔案" });

        console.log(`開始上傳: ${file.originalname}`);

        const bufferStream = new Stream.PassThrough();
        bufferStream.end(file.buffer);

        // 使用新版 OAuth2 Client 上傳
        const driveRes = await drive.files.create({
            requestBody: {
                name: file.originalname,
                parents: [DRIVE_FOLDER_ID], // 確保這裡使用的是上面定義好的變數
            },
            media: {
                mimeType: file.mimetype,
                body: bufferStream,
            },
            fields: 'id, name, webViewLink', 
        });

        const { id, name, webViewLink } = driveRes.data;

        const newRecord = {
            id: `iep-${Date.now()}`,
            filename: name,
            drive_file_id: id,
            uploaded_by: req.user.name,
            role: req.user.role,
            file_link: webViewLink,
            upload_date: new Date().toISOString().split('T')[0],
            comments: req.body.comments || ""
        };

        await appendRow("iep_files", newRecord);
        res.json({ message: "上傳成功", data: newRecord });

    } catch (error) {
        console.error("上傳失敗:", error);
        res.status(500).json({ message: "上傳失敗: " + error.message });
    }
});

app.get("/", (req, res) => {
    res.send("特教平台後端伺服器運作中！🚀 請前往前端網頁進行操作。");
});

// --- 啟動 ---
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// 啟動伺服器
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});