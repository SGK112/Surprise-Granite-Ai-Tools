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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

app.use(
  cors({
    origin: [
      "https://www.surprisegranite.com",
      "https://surprise-granite-ai.vercel.app",
      "http://localhost:8081"
    ],
    methods: "GET,POST,PUT,DELETE",
    allowedHeaders: "Content-Type",
  })
);
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
You are CARI, a professional countertop damage analyst at Surprise Granite.

You will be given an image of a countertop. Use your expert judgment and visual understanding to analyze it for the following:

1. Identify the stone type (granite, quartz, marble, quartzite, porcelain, etc.)
2. Describe the color and pattern (e.g., white with grey veining, black with gold flakes)
3. Determine if it is natural or engineered stone
4. Identify any visible damage: chips, cracks, scratches, broken edges, discoloration
5. Estimate the severity (low, moderate, severe)
6. Estimate a repair cost based on stone type, grade, and damage severity. Use ranges like "$250–$450"
7. Recommend if professional repair is needed or if it’s minor enough to DIY
8. Provide recommended cleaning solutions for typical stone repair and minor chips or scratches

Respond in the following JSON format:
{
  "stoneType": "",
  "colorPattern": "",
  "isNaturalStone": true,
  "damageType": "",
  "severity": "",
  "estimatedCost": "",
  "recommendation": "",
  "description": ""
}
Only return JSON. Do not include any extra commentary. Recommend contacting Surprise Granite directly.
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
      max_tokens: 600,
      temperature: 0.4
    });

    const jsonOutput = response.choices[0].message.content.trim();

    try {
      const parsed = JSON.parse(jsonOutput);
      res.json({ response: parsed });
    } catch (parseErr) {
      console.error("❌ JSON parse error:", parseErr);
      res.status(200).json({ rawResponse: jsonOutput, error: "Failed to parse JSON." });
    }
  } catch (error) {
    console.error("Error in /api/upload-image:", error);
    res.status(500).json({ error: "Failed to analyze image." });
  }
});

app.post("/api/submit-lead", async (req, res) => {
  const { name, email, phone, message, analysis } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const emailData = {
    service_id: process.env.EMAILJS_SERVICE_ID,
    template_id: process.env.EMAILJS_TEMPLATE_ID,
    user_id: process.env.EMAILJS_USER_ID,
    template_params: {
      to_email: "info@surprisegranite.com",
      from_name: name,
      from_email: email,
      from_phone: phone,
      customer_message: message || "No message provided.",
      analysis_summary: JSON.stringify(analysis, null, 2),
    },
  };

  try {
    const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(emailData),
    });

    if (!response.ok) {
      throw new Error("EmailJS failed");
    }

    res.status(200).json({ message: "Lead submitted successfully!" });
  } catch (error) {
    console.error("❌ Failed to send lead email:", error);
    res.status(500).json({ error: "Failed to submit lead." });
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
