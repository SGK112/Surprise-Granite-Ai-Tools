/**
 * server.js
 *
 * Node.js/Express server for Surprise Granite Chatbot Backend with OpenAI integration.
 */

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");
const Shopify = require("shopify-api-node");

// OpenAI Configuration
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Business Info
const BUSINESS_INFO = {
  name: "Surprise Granite",
  address: "11560 N Dysart Rd. #112, Surprise, AZ 85379",
  phone: "(602) 833-3189",
  email: "info@surprisegranite.com",
  googleBusiness: "https://g.co/kgs/Y9XGbpd",
};

// System Instructions for AI
const SYSTEM_INSTRUCTIONS = `
You are CARI, the Surprise Granite Design Assistant.
You provide consultative, personalized responses about countertops, remodeling, estimates, and scheduling.
Avoid reintroducing yourself after the initial greeting.
Surprise Granite Info:
  Name: ${BUSINESS_INFO.name}
  Address: ${BUSINESS_INFO.address}
  Phone: ${BUSINESS_INFO.phone}
  Email: ${BUSINESS_INFO.email}
  Google: ${BUSINESS_INFO.googleBusiness}
`;

// Shopify API Configuration
const shopify = new Shopify({
  shopName: process.env.SHOPIFY_SHOP_DOMAIN,
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN,
});

// Data Storage for Pricing
let laborData = [];
let materialsData = [];
let conversationHistory = [];

// Initialize Fuse.js for material search
let fuse;
function initFuse() {
  fuse = new Fuse(materialsData, { keys: ["Color Name", "Vendor Name", "Material"], threshold: 0.3 });
  console.log("Fuse.js initialized for materials search.");
}

// Express App Setup
const app = express();
app.use(cors({ origin: "*" })); // Allow all origins
app.use(helmet());
app.use(express.json());
const upload = multer({ dest: "uploads/" });

/**
 * 📸 POST /api/upload-image
 * Uses OpenAI Vision API to analyze countertops and remodeling ideas.
 */
app.post("/api/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const imageBase64 = fs.readFileSync(req.file.path, "base64");
    fs.unlinkSync(req.file.path); // Delete image after encoding

    // OpenAI Vision API Call (Enhanced for Color Detection)
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are an expert in countertop materials and provide professional remodeling suggestions. Analyze images to identify countertop type, color, texture, pattern, and ideal design pairings." 
        },
        { 
          role: "user", 
          content: "Analyze this image and describe the countertop. Identify its material (granite, quartz, marble, etc.), color, pattern (solid, veined, speckled), and finish (matte, polished, leathered). Suggest complementary cabinet colors, backsplash, and flooring for a modern kitchen or bathroom." 
        },
        { 
          role: "user", 
          content: [
            { type: "text", text: "Here is the image to analyze:" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } } // ✅ Fixed Image Format
          ]
        }
      ],
      max_tokens: 500, // Increased response detail
    });

    res.json({ response: response.choices[0].message.content });
  } catch (error) {
    console.error("Error analyzing image:", error);
    res.status(500).json({ error: error.message || "Failed to analyze image." });
  }
});

/**
 * 🗣️ POST /api/chat
 * Handles AI-powered chat interactions.
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { userMessage } = req.body;
    if (!userMessage) return res.status(400).json({ error: "No userMessage provided." });

    conversationHistory.push({ role: "user", content: userMessage });

    const messages = [
      { role: "system", content: SYSTEM_INSTRUCTIONS },
      ...conversationHistory,
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages,
      max_tokens: 250,
    });

    const aiReply = response.choices[0].message.content.trim();
    conversationHistory.push({ role: "assistant", content: aiReply });

    res.json({ response: aiReply });
  } catch (error) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 📑 POST /api/professional-estimate
 * Uses OpenAI to generate a professional countertop estimate.
 */
app.post("/api/professional-estimate", async (req, res) => {
  try {
    const { material, lengthInches, widthInches } = req.body;
    if (!material || !lengthInches || !widthInches) return res.status(400).json({ error: "Missing required fields." });

    const prompt = `
      Please create a professional estimate summary for a countertop project with:
      - Material: ${material}
      - Dimensions: ${lengthInches} x ${widthInches} inches
      - Style suggestions & installation considerations
    `;

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [{ role: "system", content: "You are a professional estimator." }, { role: "user", content: prompt }],
      max_tokens: 400,
    });

    res.json({ estimate: response.choices[0].message.content.trim() });
  } catch (error) {
    console.error("Error in /api/professional-estimate:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * 🚀 Server Startup
 */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
