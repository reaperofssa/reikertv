const express = require("express");
const fs = require("fs");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
app.use(bodyParser.json());

const dataFile = path.join(__dirname, "data.json");
const frontendDir = path.join(__dirname, "../frontend");

// Serve static files from the frontend directory
app.use(express.static(frontendDir));

// Serve current movie data
app.get("/api/get-current", (req, res) => {
    try {
        const data = JSON.parse(fs.readFileSync(dataFile));
        res.json(data);
    } catch (error) {
        res.status(500).send("Error reading data file");
    }
});

// Telegram bot integration
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot("7457208907:AAExyWaeB4im3x5tIdtr9DJo0ky8Bk2l8tY", { polling: true });

bot.onText(/\/play (.+) (.+)/, (msg, match) => {
    const name = match[1];
    const videoUrl = match[2];
    const data = JSON.parse(fs.readFileSync(dataFile));

    data.showing_now = { name, video_url: videoUrl };
    data.start_time = new Date().toISOString(); // Reset start time
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

    bot.sendMessage(msg.chat.id, `Now playing: ${name}`);
});

bot.onText(/\/upnext (.+) (.+)/, (msg, match) => {
    const name = match[1];
    const videoUrl = match[2];
    const data = JSON.parse(fs.readFileSync(dataFile));

    data.up_next = { name, video_url: videoUrl };
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));

    bot.sendMessage(msg.chat.id, `Up next: ${name}`);
});

// Handle errors
bot.on("polling_error", (error) => {
    console.error("Polling error:", error);
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Frontend available at http://localhost:${PORT}/index.html`);
});
