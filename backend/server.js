const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const https = require("https");
const axios = require("axios");
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { PassThrough } = require('stream');

const app = express();
app.use(bodyParser.json());

// Configure FFmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const dataFile = path.join(__dirname, "data.json");
const frontendDir = path.join(__dirname, "../frontend");
const lockFilePath = path.join(__dirname, ".bot-instance-lock");
const PORT = 7860;
const TELEGRAM_BOT_TOKEN = "7860267122:AAHYE8PmWsisJ11UumQmSmmLh33nP5PuvU0";

// Default data for `data.json`
const defaultData = {
    showing_now: {
        name: "No Movie Playing",
        video_url: "",
        current_time: 0,
        duration: 0,
        format: "mp4"
    },
    up_next: {
        name: "No Movie Scheduled",
        video_url: "",
        format: "mp4"
    },
    start_time: new Date().toISOString(),
    playback_history: [],
    settings: {
        max_bitrate: "5000k",
        buffer_size: "10000k",
        auto_play_next: true,
        allowed_formats: ["mp4", "mkv", "webm"]
    }
};

// Ensure data.json exists with default data
function initializeDataFile() {
    if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
        console.log("Created default data.json");
    } else {
        // Migrate old data format if needed
        const currentData = JSON.parse(fs.readFileSync(dataFile));
        if (!currentData.settings) {
            const migratedData = { ...defaultData, ...currentData };
            fs.writeFileSync(dataFile, JSON.stringify(migratedData, null, 2));
            console.log("Migrated data.json to new format");
        }
    }
}

// Prevent multiple bot instances
function checkForExistingInstance() {
    if (fs.existsSync(lockFilePath)) {
        const existingPid = fs.readFileSync(lockFilePath, "utf-8");
        try {
            process.kill(existingPid, 0);
            console.error("Another bot instance is already running. Exiting...");
            process.exit(1);
        } catch (err) {
            console.log("Stale lock file found. Starting new instance...");
            fs.unlinkSync(lockFilePath);
        }
    }
    fs.writeFileSync(lockFilePath, process.pid.toString());
}

// Clean up resources on exit
function setupProcessCleanup() {
    process.on("exit", () => {
        if (fs.existsSync(lockFilePath)) {
            fs.unlinkSync(lockFilePath);
        }
    });
    process.on("SIGINT", () => process.exit());
    process.on("SIGTERM", () => process.exit());
}

// Initialize the application
function initializeApp() {
    initializeDataFile();
    checkForExistingInstance();
    setupProcessCleanup();
    
    // Serve static files
    app.use(express.static(frontendDir));
    
    // Setup routes
    setupRoutes();
    
    // Initialize Telegram bot
    const bot = initializeTelegramBot();
    
    // Start server
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`Frontend available at http://localhost:${PORT}/index.html`);
    });
}

// Setup all API routes
function setupRoutes() {
    // Stream video with format support
    app.get("/stream", async (req, res) => {
        const videoUrl = req.query.video_url;
        const sessionId = req.query.session || 'default';
        const format = req.query.format || 'mp4';
        
        if (!videoUrl) {
            return res.status(400).send("Video URL is required.");
        }
        
        try {
            console.log(`Streaming ${format} video for session ${sessionId}`);
            
            if (format === 'mkv') {
                await streamMKV(videoUrl, res);
            } else {
                await streamStandardFormat(videoUrl, res, format);
            }
        } catch (error) {
            console.error("Streaming error:", error.message);
            res.status(500).send("Failed to stream video.");
        }
    });
    
    // API endpoints
    app.get("/api/get-current", handleGetCurrent);
    app.post("/api/save-progress", handleSaveProgress);
    app.get("/api/get-settings", handleGetSettings);
    app.post("/api/update-settings", handleUpdateSettings);
    app.get("/api/get-history", handleGetHistory);
}

// Stream MKV files with FFmpeg transcoding
async function streamMKV(videoUrl, res) {
    return new Promise((resolve, reject) => {
        const inputStream = axios({
            method: 'get',
            url: videoUrl,
            responseType: 'stream'
        }).then(response => response.data);
        
        const ffmpegCommand = ffmpeg()
            .input(inputStream)
            .inputFormat('matroska')
            .outputFormat('mp4')
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-movflags frag_keyframe+empty_moov',
                '-frag_duration 1000000',
                '-preset ultrafast',
                '-tune zerolatency'
            ])
            .on('start', (commandLine) => {
                console.log('FFmpeg command:', commandLine);
            })
            .on('error', (err) => {
                console.error('FFmpeg error:', err.message);
                reject(err);
            })
            .on('end', () => {
                console.log('FFmpeg processing finished');
                resolve();
            });
        
        res.writeHead(200, {
            'Content-Type': 'video/mp4',
            'Transfer-Encoding': 'chunked'
        });
        
        ffmpegCommand.pipe(res, { end: true });
    });
}

// Stream standard formats (MP4, WebM)
async function streamStandardFormat(videoUrl, res, format) {
    const response = await axios({
        method: "get",
        url: videoUrl,
        responseType: "stream",
    });
    
    const contentType = format === 'webm' ? 'video/webm' : 'video/mp4';
    
    res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": response.headers["content-length"],
    });
    
    response.data.pipe(res);
}

// API handler for current playback info
function handleGetCurrent(req, res) {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        const elapsedTime = (Date.now() - new Date(data.start_time).getTime()) / 1000;
        const currentTime = Math.max(0, data.showing_now.current_time + elapsedTime);
        
        res.json({
            showing_now: {
                name: data.showing_now.name || "No Movie Playing",
                video_url: data.showing_now.video_url || "",
                format: data.showing_now.format || "mp4",
                duration: data.showing_now.duration || 0,
                current_time: currentTime
            },
            up_next: {
                name: data.up_next.name || "No Movie Scheduled",
                video_url: data.up_next.video_url || "",
                format: data.up_next.format || "mp4"
            },
            start_time: data.start_time,
            settings: data.settings
        });
    } catch (error) {
        console.error("Error reading data file:", error);
        res.status(500).json({ error: "Error reading data file" });
    }
}

// API handler for saving playback progress
function handleSaveProgress(req, res) {
    const { video_url, current_time, duration } = req.body;
    
    if (!video_url || typeof current_time !== "number") {
        return res.status(400).json({ error: "Invalid data format" });
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        
        if (data.showing_now.video_url === video_url) {
            data.showing_now.current_time = current_time;
            if (duration) data.showing_now.duration = duration;
            data.start_time = new Date().toISOString();
            
            // Add to playback history
            data.playback_history.unshift({
                video_url,
                position: current_time,
                duration: duration || 0,
                timestamp: new Date().toISOString()
            });
            
            // Keep only last 50 history items
            if (data.playback_history.length > 50) {
                data.playback_history = data.playback_history.slice(0, 50);
            }
            
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
            res.json({ message: "Playback progress saved" });
        } else {
            res.status(400).json({ error: "Video URL mismatch" });
        }
    } catch (error) {
        console.error("Error saving playback progress:", error);
        res.status(500).json({ error: "Error saving playback progress" });
    }
}

// API handler for getting settings
function handleGetSettings(req, res) {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        res.json(data.settings || defaultData.settings);
    } catch (error) {
        console.error("Error reading settings:", error);
        res.status(500).json({ error: "Error reading settings" });
    }
}

// API handler for updating settings
function handleUpdateSettings(req, res) {
    const newSettings = req.body;
    
    if (!newSettings) {
        return res.status(400).json({ error: "Settings data required" });
    }
    
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        data.settings = { ...data.settings, ...newSettings };
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
        res.json({ message: "Settings updated", settings: data.settings });
    } catch (error) {
        console.error("Error updating settings:", error);
        res.status(500).json({ error: "Error updating settings" });
    }
}

// API handler for playback history
function handleGetHistory(req, res) {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        res.json(data.playback_history || []);
    } catch (error) {
        console.error("Error reading history:", error);
        res.status(500).json({ error: "Error reading history" });
    }
}

// Initialize and configure Telegram bot
function initializeTelegramBot() {
    const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    
    bot.onText(/\/play (.+) (.+) (.+)/, (msg, match) => {
        const name = match[1];
        const videoUrl = match[2];
        const format = match[3] || 'mp4';
        
        try {
            const data = JSON.parse(fs.readFileSync(dataFile));
            
            // Add current to history before changing
            if (data.showing_now.video_url) {
                data.playback_history.unshift({
                    video_url: data.showing_now.video_url,
                    position: data.showing_now.current_time,
                    duration: data.showing_now.duration || 0,
                    timestamp: new Date().toISOString()
                });
            }
            
            data.showing_now = { 
                name, 
                video_url: videoUrl, 
                current_time: 0,
                duration: 0,
                format
            };
            data.start_time = new Date().toISOString();
            
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
            bot.sendMessage(msg.chat.id, `Now playing: ${name} (${format})`);
        } catch (error) {
            console.error("Error updating current movie:", error);
            bot.sendMessage(msg.chat.id, "Error updating current movie.");
        }
    });
    
    bot.onText(/\/upnext (.+) (.+) (.+)/, (msg, match) => {
        const name = match[1];
        const videoUrl = match[2];
        const format = match[3] || 'mp4';
        
        try {
            const data = JSON.parse(fs.readFileSync(dataFile));
            data.up_next = { name, video_url: videoUrl, format };
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
            bot.sendMessage(msg.chat.id, `Up next: ${name} (${format})`);
        } catch (error) {
            console.error("Error updating up-next:", error);
            bot.sendMessage(msg.chat.id, "Error updating up-next movie.");
        }
    });
    
    bot.onText(/\/settings/, (msg) => {
        try {
            const data = JSON.parse(fs.readFileSync(dataFile));
            const settings = data.settings || {};
            
            let message = "Current Settings:\n";
            message += `Max Bitrate: ${settings.max_bitrate || '5000k'}\n`;
            message += `Buffer Size: ${settings.buffer_size || '10000k'}\n`;
            message += `Auto Play Next: ${settings.auto_play_next ? 'Yes' : 'No'}\n`;
            message += `Allowed Formats: ${settings.allowed_formats ? settings.allowed_formats.join(', ') : 'mp4, mkv, webm'}`;
            
            bot.sendMessage(msg.chat.id, message);
        } catch (error) {
            console.error("Error reading settings:", error);
            bot.sendMessage(msg.chat.id, "Error reading settings.");
        }
    });
    
    bot.on("polling_error", (error) => {
        console.error("Polling error:", error);
    });
    
    return bot;
}

// Start the application
initializeApp();
