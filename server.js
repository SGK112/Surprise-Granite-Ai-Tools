require("dotenv").config();
const express = require("express");
const axios = require("axios");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const { Configuration, OpenAIApi } = require("openai");
const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");
const Shopify = require("shopify-api-node");

// Setup Express App
const app = express();
const upload = multer({ dest: "uploads/" });

// OpenAI API Configuration
const openaiConfig = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(openaiConfig);

// Shopify API Integration
const shopify = new Shopify({
  shopName: process.env.SHOPIFY_SHOP_DOMAIN,
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN
});

// Business Info
const BUSINESS_INFO = {
  name: "Surprise Granite",
  address: "11560 N Dysart Rd. #112, Surprise, AZ 85379",
  phone: "(602) 833-3189",
  email: "info@surprisegranite.com",
  googleBusiness: "https://g.co/kgs/Y9XGbpd",
};

// Global Data Storage
let laborData = [];
let materialsData = [];
let conversationHistory = [];

// Fuse.js for Fuzzy Searching
let fuse;
function initFuse() {
  const options = {
    keys: ["Color Name", "Vendor Name", "Material"],
    threshold: 0.3,
  };
  fuse = new Fuse(materialsData, options);
}

// System Instructions for AI
const SYSTEM_INSTRUCTIONS = `
You are CARI, the Surprise Granite Design Assistant. 
Your role is to provide expert responses about countertops, remodeling, estimates, and scheduling. 
Use professional and engaging language. Keep responses concise and clear.

Surprise Granite Info:
- Name: ${BUSINESS_INFO.name}
- Address: ${BUSINESS_INFO.address}
- Phone: ${BUSINESS_INFO.phone}
- Email: ${BUSINESS_INFO.email}
- Google Business: ${BUSINESS_INFO.googleBusiness}
`;

// Middleware
app.use(cors({ origin: "https://www.surprisegranite.com" }));
app.use(helmet());
app.use(express.json());

/**
 * 📞 POST /api/chat
 * Handles user chatbot responses using OpenAI GPT-4 with context retention.
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { userMessage } = req.body;
    if (!userMessage) {
      return res.status(400).json({ error: "User message is required" });
    }

    // Append user message to conversation history
    conversationHistory.push({ role: "user", content: userMessage });

    const messages = [
      { role: "system", content: SYSTEM_INSTRUCTIONS },
      ...conversationHistory
    ];

    const response = await openai.createChatCompletion({
      model: "gpt-4-turbo",
      messages,
      max_tokens: 250,
      temperature: 0.7,
    });

    const aiReply = response.data.choices[0].message.content.trim();
    conversationHistory.push({ role: "assistant", content: aiReply });

    res.json({ response: aiReply });
  } catch (error) {
    console.error("❌ Error in /api/chat:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 📸 POST /api/upload-image
 * Handles image uploads and processes countertop images using OpenAI Vision API.
 */
app.post("/api/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    const imageBase64 = fs.readFileSync(req.file.path, "base64");
    fs.unlinkSync(req.file.path);

    console.log("📸 Image received, sending to OpenAI...");

    const response = await openai.createChatCompletion({
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
    console.error("❌ Error in /api/upload-image:", error);
    res.status(500).json({ error: "Failed to analyze image." });
  }
});

/**
 * 📂 GET /api/materials
 * Fetches countertop materials from a local JSON file.
 */
app.get("/api/materials", (req, res) => {
  res.json(materialsData);
});

/**
 * 📂 GET /api/business-info
 * Fetches Surprise Granite business details.
 */
app.get("/api/business-info", (req, res) => {
  res.json(BUSINESS_INFO);
});

/**
 * 📂 GET /api/get-instructions
 * Provides chatbot system instructions for debugging.
 */
app.get("/api/get-instructions", (req, res) => {
  res.json({ instructions: SYSTEM_INSTRUCTIONS });
});

/**
 * ✅ GET /
 * Default endpoint to confirm API is live.
 */
app.get("/", (req, res) => {
  res.send("✅ Surprise Granite Chatbot API is running! 🚀");
});

// Load Local Data
function loadLocalData() {
  try {
    const rawMaterials = fs.readFileSync("./materials.json", "utf8");
    materialsData = JSON.parse(rawMaterials);
    console.log(`✅ Loaded ${materialsData.length} materials.`);
  } catch (err) {
    console.error("❌ Error loading materials:", err);
  }

  try {
    const rawLabor = fs.readFileSync("./labor.json", "utf8");
    laborData = JSON.parse(rawLabor);
    console.log(`✅ Loaded ${laborData.length} labor records.`);
  } catch (err) {
    console.error("❌ Error loading labor data:", err);
  }
}

// Start Server
const PORT = process.env.PORT || 5000;
loadLocalData();
initFuse();
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
