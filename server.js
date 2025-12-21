const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { google } = require("googleapis");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

// 載入環境變數
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 設定 CORS (允許前端連線)
app.use(cors());
app.use(express.json());

// 設定 Socket.io (即時通知用)
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// --- Google Sheets 設定 ---
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const KEY_FILE = process.env.GOOGLE_KEY_FILE;

// 自動判斷金鑰路徑
const KEY_PATH = path.join(__dirname, KEY_FILE);

const auth = new google.auth.GoogleAuth({
    keyFile: KEY_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// --- 工具函式：讀取工作表資料 ---
const getSheetData = async (sheetName) => {
    try {
        const res = await sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `${sheetName}!A:Z`,
        });
        
        const rows = res.data.values;
        if (!rows || rows.length === 0) return [];

        const headers = rows[0];
        const data = rows.slice(1).map(row => {
            let obj = {};
            headers.forEach((header, index) => {
                obj[header] = row[index] || "";
            });
            return obj;
        });
        return data;
    } catch (error) {
        console.error(`讀取 ${sheetName} 失敗:`, error.message);
        return [];
    }
};

// --- API 路由 ---
app.get("/", (req, res) => {
    res.send("特教平台後端伺服器運作中！🚀");
});

// 登入 API
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

    res.json({
        message: "登入成功",
        token,
        user: { username: user.username, role: user.role, name: user.name }
    });
});

// --- 啟動伺服器 ---
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    if(!SHEET_ID) console.warn("⚠️ 警告：未偵測到 GOOGLE_SHEET_ID，請檢查 .env 檔案");
});