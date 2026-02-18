const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const multer = require("multer");
const stream = require("stream");

// 載入環境變數
dotenv.config();
console.log("👉 程式讀到的 Sheet ID:", process.env.GOOGLE_SHEET_ID);

const app = express();
const PORT = process.env.PORT || 8080;

// ==========================================
// 🟢 1. 修正 Express 的 CORS 設定 (API)
// ==========================================
app.use(cors({
    origin: "*", // 允許所有來源 (這對本機開發至關重要)
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

// ==========================================
// 🟢 2. 修正 Socket.io 的 CORS 設定
// ==========================================
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // 允許所有來源連線
        methods: ["GET", "POST", "PUT"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    },
    allowEIO3: true // 增加相容性
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

oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

// 建立服務
const drive = google.drive({ version: "v3", auth: oauth2Client });
const sheets = google.sheets({ version: "v4", auth: oauth2Client });
const calendar = google.calendar({ version: "v3", auth: oauth2Client });

// Multer 設定
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 } 
});

// AI 連線
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// --- 工具函式 ---

// 讀取資料
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
        console.error(`❌ 讀取 ${sheetName} 失敗:`, error.message);
        return [];
    }
};

// 寫入新資料
const appendRow = async (sheetName, dataObj) => {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!1:1`,
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

// 更新資料
const updateRow = async (sheetName, id, updateData) => {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A:Z`,
    });
    const rows = res.data.values;
    const headers = rows[0];

    let rowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === id) {
            rowIndex = i + 1;
            break;
        }
    }

    if (rowIndex === -1) throw new Error("找不到該筆 ID");

    let currentRowObj = {};
    headers.forEach((h, i) => currentRowObj[h] = rows[rowIndex - 1][i]);

    const finalData = { ...currentRowObj, ...updateData };
    const rowArray = headers.map(h => finalData[h] || "");

    const range = `${sheetName}!A${rowIndex}`;
    await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [rowArray] },
    });
};

// Middleware: 驗證 Token
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

// Middleware: 檢查權限
const checkRole = (allowedRoles) => {
    return (req, res, next) => {
        if (allowedRoles.includes(req.user.role)) {
            next();
        } else {
            res.status(403).json({ message: "您的權限不足" });
        }
    };
};

// --- API 路由 ---

// 首頁 (確認存活)
app.get("/", (req, res) => {
    res.send("特教平台後端伺服器運作中！🚀");
});

// 登入
app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;

    try {
        console.log("收到登入請求:", username);
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

    } catch (error) {
        console.error("登入錯誤:", error);
        res.status(500).json({ message: "伺服器內部錯誤" });
    }
});

// 驗證 Token 路由
app.get("/api/auth/me", verifyToken, (req, res) => {
    res.json(req.user);
});

// --- 📅 行事曆 API ---

app.get("/api/calendar", verifyToken, async (req, res) => {
    try {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const response = await calendar.events.list({
            calendarId: CALENDAR_ID,
            timeMin: startOfMonth.toISOString(), 
            maxResults: 50,
            singleEvents: true,
            orderBy: 'startTime',
        });
        const events = response.data.items.map(event => ({
            id: event.id,
            title: event.summary,
            start: event.start.dateTime || event.start.date,
            end: event.end.dateTime || event.end.date,
            description: event.description,
            role: event.description && event.description.includes("老師") ? 'teacher' : 'therapist'
        }));
        res.json({ data: events });
    } catch (error) {
        console.error("讀取行事曆失敗:", error);
        res.status(500).json({ message: "無法讀取行事曆" });
    }
});

app.post("/api/calendar", verifyToken, checkRole(['teacher', 'therapist']), async (req, res) => {
    try {
        const { title, date, time, description } = req.body;
        const startDateTime = `${date}T${time}:00+08:00`;
        const startDateObj = new Date(startDateTime);
        const endDateObj = new Date(startDateObj.getTime() + 60 * 60 * 1000); 
        
        const event = {
            summary: title,
            description: `${description || ""} (由 ${req.user.name} 新增)`,
            start: { dateTime: startDateTime, timeZone: 'Asia/Taipei' },
            end: { dateTime: endDateObj.toISOString(), timeZone: 'Asia/Taipei' },
        };

        const response = await calendar.events.insert({
            calendarId: CALENDAR_ID,
            resource: event,
        });

        io.emit('calendar_update', { action: 'add', user: req.user.name, title: title });
        res.json({ message: "新增成功", data: response.data });
    } catch (error) {
        console.error("新增活動失敗:", error);
        res.status(500).json({ message: "新增失敗" });
    }
});

// --- 治療紀錄 API ---

app.get("/api/records", verifyToken, async (req, res) => {
    if (req.user.role === 'parents') return res.status(403).json({ message: "家長權限無法查看" });
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
        io.emit("record_update", { action: 'add', user: req.user.name });
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
        io.emit("record_update", { action: 'reply', user: req.user.name });
        res.json({ message: "回覆成功" });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// --- 留言板 API ---

app.get("/api/messages", verifyToken, async (req, res) => {
    const data = await getSheetData("messages");
    res.json({ data });
});

app.post("/api/messages", verifyToken, async (req, res) => {
    try {
        const newMsg = {
            id: `msg-${Date.now()}`,
            user_name: req.user.name,
            username: req.user.username,
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

// --- AI 摘要 API ---

app.get("/api/messages/summary", verifyToken, async (req, res) => {
    try {
        const allMessages = await getSheetData("messages");
        const recentMsgs = allMessages.slice(-10);
        if (recentMsgs.length === 0) return res.json({ summary: "目前沒有留言可總結。" });

        const promptText = recentMsgs.map(m => `${m.role} ${m.user_name} 說: ${m.message}`).join("\n");
        const finalPrompt = `請扮演一位專業的特教個案管理師。以下是親師與治療師的最近溝通紀錄：\n---\n${promptText}\n---\n請幫我用條列式摘要以上溝通的重點 (100字以內)：`;

        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        res.json({ summary: response.text() });
    } catch (error) {
        console.error("AI 錯誤:", error);
        res.status(500).json({ message: "AI 總結失敗", error: error.message });
    }
});

// --- IEP API ---

app.get("/api/iep", verifyToken, async (req, res) => {
    const data = await getSheetData("iep_files");
    res.json({ data });
});

app.post("/api/iep", verifyToken, checkRole(['teacher']), upload.single('file'), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ message: "未選擇檔案" });

        const bufferStream = new stream.PassThrough();
        bufferStream.end(file.buffer);

        const driveRes = await drive.files.create({
            requestBody: {
                name: file.originalname,
                parents: [DRIVE_FOLDER_ID],
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
            uploader: req.user.name,
            role: req.user.role,
            file_link: webViewLink,
            url: webViewLink,
            upload_date: new Date().toISOString().split('T')[0],
            comments: req.body.comments || ""
        };

        await appendRow("iep_files", newRecord);
        io.emit("iep_update", newRecord);
        res.json({ message: "上傳成功", data: newRecord });
    } catch (error) {
        console.error("上傳失敗:", error);
        res.status(500).json({ message: "上傳失敗: " + error.message });
    }
});

// --- 提問回覆 API ---

app.get("/api/questions", verifyToken, async (req, res) => {
    const data = await getSheetData("questions");
    res.json({ data });
});

app.post("/api/questions", verifyToken, async (req, res) => {
    try {
        const newQuestion = {
            id: `q-${Date.now()}`,
            date: new Date().toISOString().split('T')[0],
            asker_name: req.user.name,
            asker_role: req.user.role,
            target_role: req.body.target_role,
            question: req.body.question,
            replier_name: "",
            reply: "",
            status: "待回覆"
        };
        await appendRow("questions", newQuestion);
        io.emit("question_update", { 
            action: 'ask',
            asker_name: req.user.name,
            target_role: req.body.target_role,
            question: req.body.question
        });
        res.json({ message: "提問成功", data: newQuestion });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

app.put("/api/questions/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { reply } = req.body;

        await updateRow("questions", id, { 
            reply: reply,
            replier_name: req.user.name,
            status: "已回覆"
        });
        
        io.emit("question_update", { action: 'reply', replier_name: req.user.name });
        res.json({ message: "回覆成功" });
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// 啟動伺服器
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});