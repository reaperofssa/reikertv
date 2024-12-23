const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const path = require("path");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(bodyParser.json());

const dataFile = path.join(__dirname, "data.json");
const videosDir = path.join(__dirname, "videos"); // Directory to store video files
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

// Serve static files from the frontend directory
app.use(express.static(frontendDir));

// API endpoint to serve video with HTTP Range support
app.get("/video/:filename", (req, res) => {
    const filePath = path.join(videosDir, req.params.filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
        return res.status(404).send("Video file not found");
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        // Parse Range header
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
            return res.status(416).send("Requested range not satisfiable");
        }

        const chunkSize = end - start + 1;
        const file = fs.createReadStream(filePath, { start, end });
        const headers = {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunkSize,
            "Content-Type": "video/mp4",
        };

        res.writeHead(206, headers);
        file.pipe(res);
    } else {
        // Send full video
        const headers = {
            "Content-Length": fileSize,
            "Content-Type": "video/mp4",
        };

        res.writeHead(200, headers);
        fs.createReadStream(filePath).pipe(res);
    }
});

// API endpoint to get the current movie and up-next data
app.get("/api/get-current", (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        const elapsedTime = (Date.now() - new Date(data.start_time).getTime()) / 1000; // in seconds
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

// Telegram bot integration
const bot = new TelegramBot("7860267122:AAEa-H806JRmHIGDkCWMotr6_y6fV4MxNwI", { polling: true });

bot.onText(/\/play (.+) (.+)/, (msg, match) => {
    const name = match[1];
    const videoFilename = match[2];

    try {
        const videoPath = path.join(videosDir, videoFilename);

        if (!fs.existsSync(videoPath)) {
            return bot.sendMessage(msg.chat.id, "Video file not found.");
        }

        const data = JSON.parse(fs.readFileSync(dataFile));
        data.showing_now = { name, video_url: `/video/${videoFilename}`, current_time: 0 }; // Reset playback time
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
    const videoFilename = match[2];

    try {
        const videoPath = path.join(videosDir, videoFilename);

        if (!fs.existsSync(videoPath)) {
            return bot.sendMessage(msg.chat.id, "Video file not found.");
        }

        const data = JSON.parse(fs.readFileSync(dataFile));
        data.up_next = { name, video_url: `/video/${videoFilename}` };
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
