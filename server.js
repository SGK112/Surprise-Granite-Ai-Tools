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
const { exec } = require("child_process");
const { ChatbotController } = require('./chatbotController'); // Importing the Chatbot Controller

// OpenAI Configuration
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// File paths
const COLORS_FILE = path.join(__dirname, "colors.json");
const MATERIALS_FILE = path.join(__dirname, "materials.json");
const LABOR_FILE = path.join(__dirname, "labor.json");

// Business Info
const BUSINESS_INFO = {
  name: "Surprise Granite",
  address: "11560 N Dysart Rd. #112, Surprise, AZ 85379",
  phone: "(602) 833-3189",
  email: "info@surprisegranite.com",
  googleBusiness: "https://g.co/kgs/Y9XGbpd",
};

// Load materials, labor, and color data
let colorsData = [];
let materialsData = [];
let laborData = [];

function loadData() {
  // Load colors from file
  if (fs.existsSync(COLORS_FILE)) {
    try {
      colorsData = JSON.parse(fs.readFileSync(COLORS_FILE, "utf-8"));
      if (colorsData.length === 0) {
        console.log("📂 colors.json is empty. Scraping new colors...");
        scrapeColors();
      } else {
        console.log(`✅ Loaded ${colorsData.length} colors from colors.json`);
      }
    } catch (error) {
      console.error("❌ Error reading colors.json:", error.message);
      scrapeColors();
    }
  } else {
    console.log("📂 colors.json not found. Running scraper...");
    scrapeColors();
  }

  // Load materials from file
  if (fs.existsSync(MATERIALS_FILE)) {
    try {
      materialsData = JSON.parse(fs.readFileSync(MATERIALS_FILE, "utf-8"));
      console.log(`✅ Loaded ${materialsData.length} materials from materials.json`);
    } catch (error) {
      console.error("❌ Error reading materials.json:", error.message);
    }
  }

  // Load labor pricing from file
  if (fs.existsSync(LABOR_FILE)) {
    try {
      laborData = JSON.parse(fs.readFileSync(LABOR_FILE, "utf-8"));
      console.log(`✅ Loaded ${laborData.length} labor pricing entries from labor.json`);
    } catch (error) {
      console.error("❌ Error reading labor.json:", error.message);
    }
  }
}

// Function to run the scraper
function scrapeColors() {
  exec("node scraper.js", (error, stdout, stderr) => {
    if (error) {
      console.error(`❌ Scraping failed: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`⚠️ Scraper warnings: ${stderr}`);
    }
    console.log(`✅ Scraper output: ${stdout}`);
  });
}

// Load all data when the server starts
loadData();

// Express App Setup
const app = express();
app.use(cors({ origin: "*" })); // Allow all origins
app.use(helmet());
app.use(express.json());
const upload = multer({ dest: "uploads/" });

/**
 * 📜 GET /api/materials
 * Returns the entire materialsData array.
 */
app.get("/api/materials", (req, res) => {
  res.json(materialsData);
});

/**
 * 📜 GET /api/labor
 * Returns the laborData array.
 */
app.get("/api/labor", (req, res) => {
  res.json(laborData);
});

/**
 * 📂 GET /api/quality-assurance
 * Serves the Quality Assurance PDF.
 */
app.get("/api/quality-assurance", (req, res) => {
  res.sendFile(path.join(__dirname, "accreditation-quality assurance sample language-final.pdf"));
});

/**
 * 📂 GET /api/workmanship-standards
 * Serves the Minimum Workmanship Standards PDF.
 */
app.get("/api/workmanship-standards", (req, res) => {
  res.sendFile(path.join(__dirname, "minimum_workmanship_standards_0.pdf"));
});

/**
 * 📸 POST /api/upload-image
 * Uses OpenAI Vision API to analyze countertops and match them to real colors.
 */
app.post("/api/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const imageBase64 = fs.readFileSync(req.file.path, "base64");
    fs.unlinkSync(req.file.path); // Delete image after encoding

    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { 
          role: "system", 
          content: `You are an expert in countertop materials and provide professional remodeling suggestions. 
          Analyze images to identify countertop type, color, texture, and pattern. 
          Match the color to known granite or quartz shades and suggest complementary design choices.
          
          Known Colors:
          ${colorsData.map(c => `- ${c.name}: ${c.description}`).join("\n")}

          If an exact match is unclear, describe the color and suggest the closest known option.` 
        },
        { 
          role: "user", 
          content: [
            { type: "text", text: "Here is the image to analyze:" },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
          ]
        }
      ],
      max_tokens: 500, 
    });

    res.json({ response: response.choices[0].message.content });
  } catch (error) {
    console.error("Error analyzing image:", error);
    res.status(500).json({ error: error.message || "Failed to analyze image." });
  }
});

/**
 * 📞 POST /api/chat
 * Handles user messages and provides chatbot responses using OpenAI.
 */
app.post("/api/chat", ChatbotController.handleChat);  // Chatbot route

/**
 * 🚀 Server Startup
 */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
