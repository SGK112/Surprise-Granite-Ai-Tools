require("dotenv").config();
const express = require("express");
const axios = require("axios");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");
const Shopify = require("shopify-api-node");

const app = express();
const upload = multer({ dest: "uploads/" });

// OpenAI Initialization
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Shopify Integration (if needed)
const shopify = new Shopify({
  shopName: process.env.SHOPIFY_SHOP_DOMAIN,
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN
});

const BUSINESS_INFO = {
  name: "Surprise Granite",
  address: "11560 N Dysart Rd. #112, Surprise, AZ 85379",
  phone: "(602) 833-3189",
  email: "info@surprisegranite.com",
  googleBusiness: "https://g.co/kgs/Y9XGbpd",
};

let laborData = [];
let materialsData = [];
let colorsData = [];
let conversationHistory = [];

let fuse;
function initFuse() {
  const options = {
    keys: ["Color Name", "Vendor Name", "Material"],
    threshold: 0.3,
  };
  fuse = new Fuse(materialsData, options);
}

const SYSTEM_INSTRUCTIONS = `
You are CARI, the Surprise Granite Design Assistant.
Answer professionally and help users with estimates, materials, and design advice.
`;

app.use(cors({ origin: "https://www.surprisegranite.com" }));
app.use(helmet());
app.use(express.json());

app.post("/api/chat", async (req, res) => {
  try {
    const { userMessage } = req.body;
    if (!userMessage) return res.status(400).json({ error: "User message is required" });

    conversationHistory.push({ role: "user", content: userMessage });
    const messages = [{ role: "system", content: SYSTEM_INSTRUCTIONS }, ...conversationHistory];

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages,
      max_tokens: 300,
      temperature: 0.7,
    });

    const aiReply = response.choices[0].message.content.trim();
    conversationHistory.push({ role: "assistant", content: aiReply });

    res.json({ response: aiReply });
  } catch (error) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });
    const imageBase64 = fs.readFileSync(req.file.path, "base64");
    fs.unlinkSync(req.file.path);

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "system",
          content: `
You are a professional countertop designer and materials expert at Surprise Granite.

You will be given an image of a countertop. Do not guess wildly. Use your visual understanding and professional experience to:

1. Identify the likely material (granite, quartz, marble, quartzite, etc.)
2. Describe the color family (e.g., black speckled, white with veining, gold with movement)
3. Suggest a possible match based on known industry patterns (e.g., Calacatta Laza, Black Galaxy, Carrara Morro)
4. Indicate whether it's natural stone or engineered
5. Mention potential vendors (e.g., MSI, Daltile, Cambria) if relevant
6. Give a 3–5 sentence explanation like you're helping a customer choose slabs

Only name a match if you're confident. If you're not sure, say: "This resembles patterns like..." and give a few possibilities.
          `
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze the countertop image carefully." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }
      ],
      max_tokens: 500
    });

    res.json({ response: response.choices[0].message.content });
  } catch (error) {
    console.error("Error in /api/upload-image:", error);
    res.status(500).json({ error: "Failed to analyze image." });
  }
});

app.get("/api/materials", (req, res) => {
  res.json(materialsData);
});

app.get("/api/business-info", (req, res) => {
  res.json(BUSINESS_INFO);
});

app.get("/api/get-instructions", (req, res) => {
  res.json({ instructions: SYSTEM_INSTRUCTIONS });
});

app.get("/", (req, res) => {
  res.send("✅ Surprise Granite Chatbot API is running! 🚀");
});

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

  try {
    const rawColors = fs.readFileSync("./colors.json", "utf8");
    colorsData = JSON.parse(rawColors);
    console.log(`✅ Loaded ${colorsData.length} colors.`);
  } catch (err) {
    console.error("❌ Error loading colors:", err);
  }
}

const PORT = process.env.PORT || 5000;
loadLocalData();
initFuse();
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
