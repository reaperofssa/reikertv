const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
app.use(bodyParser.json());

const dataFile = path.join(__dirname, "data.json");
const frontendDir = path.join(__dirname, "../frontend");

// Default data for `data.json`
const defaultData = {
    showing_now: {
        name: "No Movie Playing",
        video_url: ""
    },
    up_next: {
        name: "No Movie Scheduled",
        video_url: ""
    },
    start_time: new Date().toISOString()
};

// Ensure `data.json` exists
if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify(defaultData, null, 2));
    console.log("Created default data.json");
}

// Serve static files from the frontend directory
app.use(express.static(frontendDir));

// API endpoint to get the current movie and up-next data
app.get("/api/get-current", (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        res.json({
            showing_now: {
                name: data.showing_now.name || "No Movie Playing",
                video_url: data.showing_now.video_url || ""
            },
            up_next: {
                name: data.up_next.name || "No Movie Scheduled",
                video_url: data.up_next.video_url || ""
            },
            start_time: data.start_time || new Date().toISOString()
        });
    } catch (error) {
        console.error("Error reading data file:", error);
        res.status(500).json({ error: "Error reading data file" });
    }
});

// Telegram bot integration
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot("7959925413:AAEu7lYqzo05fY_VEotLRe3SZXJV03IVN6Q", { polling: true });

bot.onText(/\/play (.+) (.+)/, (msg, match) => {
    const name = match[1];
    const videoUrl = match[2];

    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        data.showing_now = { name, video_url: videoUrl };
        data.start_time = new Date().toISOString(); // Reset start time
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
