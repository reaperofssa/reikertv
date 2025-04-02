const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");
const https = require("https");

const app = express();
app.use(bodyParser.json());

const dataFile = path.join(__dirname, "data.json");
const frontendDir = path.join(__dirname, "../frontend");

// Default data for `data.json`
const defaultData = {
    showing_now: {
        name: "No Movie Playing",
        video_url: "",
        current_time: 0 // Current playback time in seconds
    },
    up_next: {
        name: "No Movie Scheduled",
        video_url: ""
    },
    start_time: new Date().toISOString() // Timestamp when playback started
};

// Ensure `data.json` exists
if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
    console.log("Created default data.json");
}

// Prevent multiple bot instances
const lockFilePath = path.join(__dirname, ".bot-instance-lock");
if (fs.existsSync(lockFilePath)) {
    const existingPid = fs.readFileSync(lockFilePath, "utf-8");
    try {
        process.kill(existingPid, 0); // Check if the process is still running
        console.error("Another bot instance is already running. Exiting...");
        process.exit(1);
    } catch (err) {
        console.log("Stale lock file found. Starting new instance...");
        fs.unlinkSync(lockFilePath);
    }
}

// Create lock file
fs.writeFileSync(lockFilePath, process.pid.toString());

// Clean up lock file on exit
process.on("exit", () => {
    if (fs.existsSync(lockFilePath)) {
        fs.unlinkSync(lockFilePath);
    }
});

process.on("SIGINT", () => process.exit());
process.on("SIGTERM", () => process.exit());

// Serve static files from the frontend directory
app.use(express.static(frontendDir));

// Stream video from external URLs using HTTPS
app.get("/stream", async (req, res) => {
    const videoUrl = req.query.video_url;

    if (!videoUrl) {
        return res.status(400).send("Video URL is required.");
    }

    try {
        const response = await axios({
            method: "get",
            url: videoUrl,
            responseType: "stream",
        });

        res.writeHead(200, {
            "Content-Type": "video/mp4",
            "Content-Length": response.headers["content-length"],
        });

        response.data.pipe(res);
    } catch (error) {
        console.error("Error fetching video:", error.message);
        res.status(error.response?.status || 500).send("Failed to fetch video.");
    }
});

app.listen(3000, () => console.log("Server running on port 3000"));

// API endpoint to get the current movie and up-next data
app.get("/api/get-current", (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));

        // Calculate current playback time based on elapsed time since `start_time`
        const elapsedTime =
            (Date.now() - new Date(data.start_time).getTime()) / 1000; // in seconds
        const currentTime = Math.max(0, data.showing_now.current_time + elapsedTime);

        res.json({
            showing_now: {
                name: data.showing_now.name || "No Movie Playing",
                video_url: data.showing_now.video_url || ""
            },
            up_next: {
                name: data.up_next.name || "No Movie Scheduled",
                video_url: data.up_next.video_url || ""
            },
            start_time: data.start_time || new Date().toISOString(),
            current_time: currentTime // Send the calculated playback time
        });
    } catch (error) {
        console.error("Error reading data file:", error);
        res.status(500).json({ error: "Error reading data file" });
    }
});

// API endpoint to save video playback progress
app.post("/api/save-progress", (req, res) => {
    const { video_url, current_time } = req.body;

    if (!video_url || typeof current_time !== "number") {
        return res.status(400).json({ error: "Invalid data format" });
    }

    try {
        const data = JSON.parse(fs.readFileSync(dataFile));

        // Save progress only if the video matches the currently playing one
        if (data.showing_now.video_url === video_url) {
            data.showing_now.current_time = current_time;
            data.start_time = new Date().toISOString(); // Update start time to current time
            fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
            res.json({ message: "Playback progress saved" });
        } else {
            res.status(400).json({ error: "Video URL mismatch" });
        }
    } catch (error) {
        console.error("Error saving playback progress:", error);
        res.status(500).json({ error: "Error saving playback progress" });
    }
});

// Telegram bot integration
const bot = new TelegramBot("7860267122:AAEa-H806JRmHIGDkCWMotr6_y6fV4MxNwI", { polling: true });

bot.onText(/\/play (.+) (.+)/, (msg, match) => {
    const name = match[1];
    const videoUrl = match[2];

    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        data.showing_now = { name, video_url: videoUrl, current_time: 0 }; // Reset playback time
        data.start_time = new Date().toISOString(); // Set the start time
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

        bot.sendMessage(msg.chat.id, `Now playing: ${name}`);
    } catch (error) {
        console.error("Error updating current movie data:", error);
        bot.sendMessage(msg.chat.id, "Error updating current movie.");
    }
});

bot.onText(/\/upnext (.+) (.+)/, (msg, match) => {
    const name = match[1];
    const videoUrl = match[2];

    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        data.up_next = { name, video_url: videoUrl };
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

        bot.sendMessage(msg.chat.id, `Up next: ${name}`);
    } catch (error) {
        console.error("Error updating up-next movie data:", error);
        bot.sendMessage(msg.chat.id, "Error updating up-next movie.");
    }
});

// Handle bot polling errors
bot.on("polling_error", (error) => {
    console.error("Polling error:", error);
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Frontend available at http://localhost:${PORT}/index.html`);
});
