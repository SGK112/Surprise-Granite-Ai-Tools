require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const multer = require("multer");
const fs = require("fs");
const { OpenAI } = require("openai");

const app = express();
const upload = multer({ dest: "uploads/" }); // Temporary storage for uploaded images

// OpenAI Configuration
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(helmet());
app.use(express.json());

/**
 * ✅ Default Route
 * Used to confirm that the server is running.
 */
app.get("/", (req, res) => {
    res.send("✅ Surprise Granite Chatbot API is running! 🚀");
});

/**
 * 📞 POST /api/chat
 * Handles chatbot responses using OpenAI's GPT-4 API.
 */
app.post("/api/chat", async (req, res) => {
    try {
        console.log("📡 Received chat request:", req.body);
        const { message } = req.body;

        if (!message) {
            console.error("❌ Missing user message");
            return res.status(400).json({ error: "User message is required" });
        }

        console.log("📝 User Message:", message);

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [{ role: "user", content: message }],
            max_tokens: 250
        });

        if (!response || !response.choices || response.choices.length === 0) {
            console.error("❌ No response from OpenAI.");
            return res.status(500).json({ error: "AI response missing" });
        }

        const botReply = response.choices[0].message.content;
        console.log("✅ AI Response:", botReply);

        res.json({ response: botReply });
    } catch (error) {
        console.error("❌ API Error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * 📸 POST /api/upload-image
 * Allows users to upload images and sends them to OpenAI Vision for countertop analysis.
 */
app.post("/api/upload-image", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            console.error("❌ No file uploaded.");
            return res.status(400).json({ error: "No file uploaded." });
        }

        const imageBase64 = fs.readFileSync(req.file.path, "base64");
        fs.unlinkSync(req.file.path); // Delete the uploaded file

        console.log("📸 Image received, sending to OpenAI...");

        const response = await openai.chat.completions.create({
            model: "gpt-4-turbo",
            messages: [
                { role: "system", content: "Analyze this image and describe the countertop type, color, and material." },
                { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] }
            ],
            max_tokens: 500
        });

        if (!response || !response.choices || response.choices.length === 0) {
            return res.status(500).json({ error: "Image recognition failed." });
        }

        res.json({ response: response.choices[0].message.content });
    } catch (error) {
        console.error(`❌ Error analyzing image: ${error}`);
        res.status(500).json({ error: "Failed to analyze image." });
    }
});

// 🚀 Start the Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
