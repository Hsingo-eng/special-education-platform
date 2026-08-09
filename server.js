const express = require("express");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const multer = require("multer");
const stream = require("stream");

// 載入環境變數
dotenv.config();
console.log("👉 程式讀到的 Sheet ID:", process.env.GOOGLE_SHEET_ID);

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({
    origin: "*", 
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST", "PUT"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    },
    allowEIO3: true 
});

// --- 設定 ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || "1EzFYhf4zzYslzJL3rcccQlLJTR7_Sguq"; 

// --- OAuth2 驗證 ---
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);

oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

const drive = google.drive({ version: "v3", auth: oauth2Client });
const sheets = google.sheets({ version: "v4", auth: oauth2Client });
const calendar = google.calendar({ version: "v3", auth: oauth2Client });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- 工具函式 ---
const getSheetData = async (sheetName) => {
    try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:Z` });
        const rows = res.data.values;
        if (!rows || rows.length === 0) return [];
        const headers = rows[0];
        return rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, index) => obj[header] = row[index] || "");
            return obj;
        });
    } catch (error) {
        console.error(`❌ 讀取 ${sheetName} 失敗:`, error.message);
        return [];
    }
};

const appendRow = async (sheetName, dataObj) => {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!1:1` });
    const headers = res.data.values[0];
    const row = headers.map(header => dataObj[header] || "");
    await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: sheetName, valueInputOption: "USER_ENTERED", requestBody: { values: [row] }
    });
};

const updateRow = async (sheetName, id, updateData) => {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:Z` });
    const rows = res.data.values;
    const headers = rows[0];
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === id) { rowIndex = i + 1; break; }
    }
    if (rowIndex === -1) throw new Error("找不到該筆 ID");
    let currentRowObj = {};
    headers.forEach((h, i) => currentRowObj[h] = rows[rowIndex - 1][i]);
    const finalData = { ...currentRowObj, ...updateData };
    const rowArray = headers.map(h => finalData[h] || "");
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID, range: `${sheetName}!A${rowIndex}`, valueInputOption: "USER_ENTERED", requestBody: { values: [rowArray] }
    });
};

// 刪除資料 (Google Sheet)
const deleteRow = async (sheetName, id) => {
    const res = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    const sheet = res.data.sheets.find(s => s.properties.title === sheetName);
    const sheetId = sheet.properties.sheetId;

    const dataRes = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${sheetName}!A:Z` });
    const rows = dataRes.data.values;
    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === id) { rowIndex = i; break; }
    }
    if (rowIndex === -1) throw new Error("找不到該筆 ID");

    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
            requests: [{
                deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: rowIndex, endIndex: rowIndex + 1 } }
            }]
        }
    });
};

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
        if (allowedRoles.includes(req.user.role)) next();
        else res.status(403).json({ message: "您的權限不足" });
    };
};

// --- API 路由 ---
app.get("/", (req, res) => res.send("特教平台後端伺服器運作中！🚀"));

app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    try {
        const users = await getSheetData("users");
        const user = users.find(u => u.username === username && u.password === password);
        if (!user) return res.status(401).json({ message: "帳號或密碼錯誤" });
        const token = jwt.sign({ username: user.username, role: user.role, name: user.name }, process.env.JWT_SECRET, { expiresIn: "7d" });
        res.json({ token, user: { name: user.name, role: user.role } });
    } catch (error) { res.status(500).json({ message: "伺服器內部錯誤" }); }
});

app.get("/api/auth/me", verifyToken, (req, res) => res.json(req.user));

// --- 📅 行事曆 API ---
app.get("/api/calendar", verifyToken, async (req, res) => {
    try {
        const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
        const response = await calendar.events.list({
            calendarId: CALENDAR_ID, timeMin: startOfMonth.toISOString(), maxResults: 50, singleEvents: true, orderBy: 'startTime',
        });
        const events = response.data.items.map(event => ({
            id: event.id, title: event.summary, start: event.start.dateTime || event.start.date, end: event.end.dateTime || event.end.date,
            description: event.description, role: event.description && event.description.includes("老師") ? 'teacher' : 'therapist'
        }));
        res.json({ data: events });
    } catch (error) { res.status(500).json({ message: "無法讀取行事曆" }); }
});

app.post("/api/calendar", verifyToken, checkRole(['teacher', 'therapist']), async (req, res) => {
    try {
        const { title, start, end, description } = req.body;
        const event = {
            summary: title, description: `${description || ""} (由 ${req.user.name} 新增)`,
            start: { dateTime: new Date(start).toISOString(), timeZone: 'Asia/Taipei' },
            end: { dateTime: end ? new Date(end).toISOString() : new Date(new Date(start).getTime() + 60*60*1000).toISOString(), timeZone: 'Asia/Taipei' },
        };
        const response = await calendar.events.insert({ calendarId: CALENDAR_ID, resource: event });
        io.emit('calendar_update', { action: 'add' });
        res.json({ message: "新增成功", data: response.data });
    } catch (error) { res.status(500).json({ message: "新增失敗" }); }
});

app.put("/api/calendar/:id", verifyToken, checkRole(['teacher', 'therapist']), async (req, res) => {
    try {
        const { id } = req.params; const { title, start, end, description } = req.body;
        const event = {
            summary: title, description: `${description || ""} (由 ${req.user.name} 編輯)`,
            start: { dateTime: new Date(start).toISOString(), timeZone: 'Asia/Taipei' },
            end: { dateTime: end ? new Date(end).toISOString() : new Date(new Date(start).getTime() + 60*60*1000).toISOString(), timeZone: 'Asia/Taipei' },
        };
        const response = await calendar.events.update({ calendarId: CALENDAR_ID, eventId: id, resource: event });
        io.emit('calendar_update', { action: 'update' });
        res.json({ message: "更新成功", data: response.data });
    } catch (error) { res.status(500).json({ message: "更新失敗" }); }
});

app.delete("/api/calendar/:id", verifyToken, checkRole(['teacher', 'therapist']), async (req, res) => {
    try {
        const { id } = req.params;
        await calendar.events.delete({ calendarId: CALENDAR_ID, eventId: id });
        io.emit('calendar_update', { action: 'delete' });
        res.json({ message: "刪除成功" });
    } catch (error) { res.status(500).json({ message: "刪除失敗" }); }
});

// --- 治療紀錄 API ---
app.get("/api/records", verifyToken, async (req, res) => {
    if (req.user.role === 'parents') return res.status(403).json({ message: "家長權限無法查看" });
    const data = await getSheetData("records"); res.json({ data });
});

app.post("/api/records", verifyToken, checkRole(['therapist']), async (req, res) => {
    try {
        const newRecord = {
            id: `rec-${Date.now()}`, date: new Date().toISOString().split('T')[0], therapist_name: req.user.name,
            content: req.body.content, teacher_reply: "", created_at: new Date().toISOString()
        };
        await appendRow("records", newRecord);
        io.emit("record_update", { action: 'add', user: req.user.name });
        res.json({ message: "新增成功", data: newRecord });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/records/:id", verifyToken, checkRole(['teacher']), async (req, res) => {
    try {
        const { id } = req.params; const { reply } = req.body;
        await updateRow("records", id, { teacher_reply: reply });
        io.emit("record_update", { action: 'reply', user: req.user.name });
        res.json({ message: "回覆成功" });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// ==========================================
// --- 留言板 API (讀取與新增) ---
// ==========================================
app.get("/api/messages", verifyToken, async (req, res) => {
    const data = await getSheetData("messages"); 
    res.json({ data });
});

app.post("/api/messages", verifyToken, async (req, res) => {
    try {
        const newMsg = {
            id: `msg-${Date.now()}`, user_name: req.user.name, username: req.user.username,
            role: req.user.role, message: req.body.message, timestamp: new Date().toISOString()
        };
        await appendRow("messages", newMsg);
        io.emit("message_update", newMsg);
        res.json({ message: "留言成功" });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

// ==========================================
// 🟢 留言板 AI 重點摘要 API（Railway 終極穩定版）
// ==========================================
app.get('/api/summary', verifyToken, async (req, res) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("❌ 找不到 GEMINI_API_KEY");
            return res.status(500).json({ error: "伺服器未設定 API 金鑰" });
        }

        // 1. 讀取留言
        const allMessages = await getSheetData("messages");

        if (!allMessages || allMessages.length === 0) {
            return res.json({ summary: "目前留言板尚無內容可以統整喔！" });
        }

        // 2. 組合留言內容
        const messageText = allMessages.map(m => {
            let roleName = m.role === 'teacher' ? '教師' : (m.role === 'therapist' ? '治療師' : '家長');
            return `${roleName} (${m.user_name || m.username || '匿名'}): ${m.message}`;
        }).join('\n');

        const { GoogleGenerativeAI } = require("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(apiKey);
        
        const prompt = `你是一個專業的特殊教育個案管理 AI 助手。請閱讀以下跨專業團隊與家長的留言紀錄，並用繁體中文以「條列式」寫出一份簡短、精準的「重點摘要」，幫助團隊快速掌握溝通重點，字數請盡量控制在 100 字以內。\n\n近期留言紀錄：\n${messageText}`;

        let text = "";
        let success = false;

        // 輪流嘗試 Railway 環境中最容易成功的模型名稱格式
        const candidateModels = ["gemini-1.5-flash", "models/gemini-1.5-flash", "gemini-pro"];

        for (const modelName of candidateModels) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                text = response.text();
                success = true;
                console.log(`✅ 使用模型 ${modelName} 成功生成摘要！`);
                break;
            } catch (err) {
                console.warn(`⚠️ 模型 ${modelName} 嘗試失敗，準備嘗試下一個... Error:`, err.message);
            }
        }

        if (!success) {
            throw new Error("所有 Gemini 模型呼叫皆失敗，請確認 GEMINI_API_KEY 是否有效。");
        }

        res.json({ summary: text });

    } catch (error) {
        console.error("❌ AI 摘要生成失敗:", error);
        res.status(500).json({ error: "AI 摘要生成失敗：" + error.message });
    }
});

// --- IEP API ---
app.get("/api/iep", verifyToken, async (req, res) => {
    const data = await getSheetData("iep_files"); res.json({ data });
});

app.post("/api/iep", verifyToken, checkRole(['teacher']), upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ message: "未選擇檔案" });

        let finalFileName = file.originalname;
        try { finalFileName = Buffer.from(file.originalname, 'latin1').toString('utf8'); } catch (e) {}

        // 🟢 終極穩定上傳串流
        const bufferStream = stream.Readable.from(file.buffer);

        const driveRes = await drive.files.create({
            requestBody: { name: finalFileName, parents: [DRIVE_FOLDER_ID] },
            media: { mimeType: file.mimetype, body: bufferStream },
            fields: 'id, name, webViewLink',
        });

        const { id, name, webViewLink } = driveRes.data;
        const newRecord = {
            id: `iep-${Date.now()}`, filename: name, drive_file_id: id, uploaded_by: req.user.name,
            uploader: req.user.name, role: req.user.role, file_link: webViewLink, url: webViewLink,
            upload_date: new Date().toISOString().split('T')[0], comments: req.body.comments || ""
        };

        await appendRow("iep_files", newRecord);
        io.emit("iep_update", newRecord);
        res.json({ message: "上傳成功", data: newRecord });
    } catch (error) {
        console.error("上傳失敗:", error);
        res.status(500).json({ message: "上傳失敗: " + error.message });
    }
});

app.delete("/api/iep/:id", verifyToken, checkRole(['teacher']), async (req, res) => {
    try {
        const { id } = req.params;
        const data = await getSheetData("iep_files");
        const record = data.find(r => r.id === id);
        
        // 1. 先把 Google Drive 雲端硬碟上的檔案刪除
        if (record && record.drive_file_id) {
            try { await drive.files.delete({ fileId: record.drive_file_id }); } 
            catch (e) { console.warn("Google Drive 檔案已不存在，直接刪除紀錄"); }
        }
        
        // 2. 把 Google Sheet 裡的紀錄刪除
        await deleteRow("iep_files", id);
        io.emit("iep_update", { action: 'delete', id });
        res.json({ message: "刪除成功" });
    } catch (error) {
        console.error("刪除失敗:", error);
        res.status(500).json({ message: "刪除失敗" });
    }
});

// --- 提問回覆 API ---
app.get("/api/questions", verifyToken, async (req, res) => {
    const data = await getSheetData("questions"); res.json({ data });
});

app.post("/api/questions", verifyToken, async (req, res) => {
    try {
        const newQuestion = {
            id: `q-${Date.now()}`, date: new Date().toISOString().split('T')[0], asker_name: req.user.name,
            asker_role: req.user.role, target_role: req.body.target_role, question: req.body.question,
            replier_name: "", reply: "", status: "待回覆"
        };
        await appendRow("questions", newQuestion);
        io.emit("question_update", { action: 'ask', asker_name: req.user.name, target_role: req.body.target_role, question: req.body.question });
        res.json({ message: "提問成功", data: newQuestion });
    } catch (e) { res.status(500).json({ message: e.message }); }
});

app.put("/api/questions/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params; const { reply } = req.body;
        await updateRow("questions", id, { reply: reply, replier_name: req.user.name, status: "已回覆" });
        io.emit("question_update", { action: 'reply', replier_name: req.user.name });
        res.json({ message: "回覆成功" });
    } catch (e) { res.status(500).json({ message: e.message }); }
});


// 🟢 終極防呆版：直接在裡面寫死 process.env.PORT，不用管變數叫什麼了！
server.listen(process.env.PORT || 8080, "0.0.0.0", () => {
    console.log("伺服器成功啟動，正在監聽 Render 指定的 Port！");
});
