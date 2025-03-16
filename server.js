/**
 * server.js
 *
 * Node.js/Express server for Surprise Granite Chatbot Backend with OpenAI integration.
 * 
 * This version loads pricing data from local JSON files (materials.json and labor.json),
 * uses Fuse.js for fuzzy searching over materials data, and now supports:
 *   - Serving two PDF documents (Quality Assurance and Minimum Workmanship Standards).
 *   - A form-based scheduling endpoint conforming to Thryv Zapier parameters.
 *   - Image uploads with placeholder image analysis logic.
 *   - Consultative chat responses with extra context.
 *   - Shopify API integration using the Admin API token (SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_TOKEN).
 *
 * Additionally, a Machine Learning Integration Document is appended at the bottom.
 */

require("dotenv").config();
const express = require("express");
const axios = require("axios");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const { Configuration, OpenAIApi } = require("openai");
const fs = require("fs");
const path = require("path");

// Require Fuse.js for fuzzy searching
const Fuse = require("fuse.js");

// Require Shopify API client
const Shopify = require("shopify-api-node");

// TOS URL (Google Doc)
const TOS_URL =
  "https://docs.google.com/document/d/e/2PACX-1vQh9AFnt8idWXCl9kFBruaZYhZfPokPBjuFla8aebX5CzPhrEkVLV_iKqv49rQJbIcNypQRAvJLwLHB/pub";

// Google Business Page URL
const GOOGLE_BUSINESS_PAGE = "https://g.co/kgs/Y9XGbpd";

// Thryv Zapier Token – copy this token to Zapier.com.
const THRYV_ZAPIER_TOKEN =
  "3525b8f45f2822007b06b67d39a8b48aae9e9b3b67c3071569048d6850ba341d";

// EmailJS configuration
const EMAILJS_SERVICE_ID = "service_jmjjix9";
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || "template_chatHistory";
const EMAILJS_USER_ID = process.env.EMAILJS_USER_ID || "user_placeholder";

// OpenAI Configuration
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.warn("Warning: OPENAI_API_KEY is not set. The /api/chat endpoint will fail.");
}
const openaiConfig = new Configuration({ apiKey: OPENAI_API_KEY });
const openai = new OpenAIApi(openaiConfig);

// Shopify Integration: Use the Admin API token & shop domain from environment
const shopify = new Shopify({
  shopName: process.env.SHOPIFY_SHOP_DOMAIN, // e.g., "myshop.myshopify.com"
  accessToken: process.env.SHOPIFY_ADMIN_TOKEN // The "shpat_..." token
});

// Global data storage for local pricing data
let laborData = [];
let materialsData = [];

// Fuse.js instance
let fuse;

/**
 * Initialize Fuse.js with materialsData.
 */
function initFuse() {
  const options = {
    keys: ["Color Name", "Vendor Name", "Material"],
    threshold: 0.3, // Adjust threshold for matching sensitivity
  };
  fuse = new Fuse(materialsData, options);
  console.log("Fuse.js initialized for materials search.");
}

// Create Express app
const app = express();

// Use explicit CORS options
const corsOptions = {
  origin: "https://www.surprisegranite.com",
  optionsSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(helmet());
app.use(express.json());

// Multer for file uploads (files stored in ./uploads)
const upload = multer({ dest: "uploads/" });

// Business info & system instructions.
const BUSINESS_INFO = {
  name: "Surprise Granite",
  address: "11560 N Dysart Rd. #112, Surprise, AZ 85379",
  phone: "(602) 833-3189",
  email: "info@surprisegranite.com",
  googleBusiness: GOOGLE_BUSINESS_PAGE,
};

const SYSTEM_INSTRUCTIONS = `
You are CARI, the Surprise Granite Design Assistant.
Your role is to provide consultative, personalized responses about countertops, remodeling, estimates, and scheduling.
Use principles inspired by Think and Grow Rich and How to Win Friends and Influence People.
Recall local materials, labor, and TOS data as needed.
Always address the customer by name if known; otherwise, respond in a friendly, professional, and quirky tone.
Surprise Granite Info:
  Name: ${BUSINESS_INFO.name}
  Address: ${BUSINESS_INFO.address}
  Phone: ${BUSINESS_INFO.phone}
  Email: ${BUSINESS_INFO.email}
  Google: ${BUSINESS_INFO.googleBusiness}
TOS is available at /api/get-tos.
`;

/**
 * Load local JSON data from materials.json and labor.json.
 */
function loadLocalData() {
  try {
    const rawMaterials = fs.readFileSync("./materials.json", "utf8");
    materialsData = JSON.parse(rawMaterials);
    console.log(`Materials data loaded: ${materialsData.length} entries`);
  } catch (err) {
    console.error("Error loading materials data:", err);
  }
  try {
    const rawLabor = fs.readFileSync("./labor.json", "utf8");
    laborData = JSON.parse(rawLabor);
    console.log(`Labor data loaded: ${laborData.length} entries`);
  } catch (err) {
    console.error("Error loading labor data:", err);
  }
}

/**
 * GET /api/get-tos
 */
app.get("/api/get-tos", async (req, res) => {
  try {
    const response = await axios.get(TOS_URL);
    res.json({ tosHtml: response.data });
  } catch (error) {
    console.error("Error fetching TOS:", error);
    res.status(500).json({ error: "Unable to fetch TOS." });
  }
});

/**
 * GET /api/get-business-info
 */
app.get("/api/get-business-info", (req, res) => {
  res.json(BUSINESS_INFO);
});

/**
 * GET /api/get-instructions
 */
app.get("/api/get-instructions", (req, res) => {
  res.json({ instructions: SYSTEM_INSTRUCTIONS });
});

/**
 * GET /api/quality-assurance
 * Serves the Quality Assurance PDF from the repository root.
 */
app.get("/api/quality-assurance", (req, res) => {
  res.sendFile(path.join(__dirname, "accreditation-quality assurance sample language-final.pdf"));
});

/**
 * GET /api/minimum-workmanship-standards
 * Serves the Minimum Workmanship Standards PDF from the repository root.
 */
app.get("/api/minimum-workmanship-standards", (req, res) => {
  res.sendFile(path.join(__dirname, "minimum_workmanship_standards_0.pdf"));
});

/**
 * POST /api/schedule
 * Form-based scheduling endpoint conforming to Thryv Zapier parameters.
 */
app.post("/api/schedule", (req, res) => {
  const { clientName, desiredDate, appointmentType, additionalInfo } = req.body;
  if (!clientName || !desiredDate || !appointmentType) {
    return res.status(400).json({ error: "Missing required fields: clientName, desiredDate, or appointmentType." });
  }
  // Integration with Thryv Zapier can be added here using the THRYV_ZAPIER_TOKEN if needed.
  res.json({
    message: "Scheduling request received and processed!",
    clientName,
    desiredDate,
    appointmentType,
    additionalInfo: additionalInfo || null,
    zapToken: THRYV_ZAPIER_TOKEN,
  });
});

/**
 * POST /api/get-estimate
 */
app.post("/api/get-estimate", (req, res) => {
  try {
    const { material, lengthInches, widthInches, slabLengthInches, slabWidthInches, laborKey } = req.body;
    if (!material || !lengthInches || !widthInches) {
      return res.status(400).json({ error: "Missing 'material', 'lengthInches', or 'widthInches'." });
    }
    const lengthNum = parseFloat(lengthInches);
    const widthNum = parseFloat(widthInches);
    if (isNaN(lengthNum) || isNaN(widthNum) || lengthNum <= 0 || widthNum <= 0) {
      return res.status(400).json({ error: "Invalid 'lengthInches' or 'widthInches'. Must be positive numbers." });
    }
    const baseSqFt = (lengthNum * widthNum) / 144;
    const finalSqFt = baseSqFt * 1.2;
    let slabCount = 0;
    if (slabLengthInches && slabWidthInches) {
      const sLen = parseFloat(slabLengthInches);
      const sWid = parseFloat(slabWidthInches);
      if (!isNaN(sLen) && !isNaN(sWid) && sLen > 0 && sWid > 0) {
        const slabArea = (sLen * sWid) / 144;
        slabCount = Math.ceil(finalSqFt / slabArea);
      }
    }
    // Look up material in local JSON using the "Material" field.
    const matRow = materialsData.find(
      (row) => row.Material?.trim().toLowerCase() === material.trim().toLowerCase()
    );
    if (!matRow) {
      return res.status(404).json({ error: `Material '${material}' not found.` });
    }
    let slabSqFt = null;
    if (matRow["size"]) {
      const dims = matRow["size"].split("x").map(s => parseFloat(s.trim()));
      if (dims.length === 2 && !isNaN(dims[0]) && !isNaN(dims[1])) {
        slabSqFt = parseFloat(((dims[0] * dims[1]) / 144).toFixed(2));
      }
    }
    const baseCostStr = matRow["Cost/SqFt"] || "0";
    const baseCost = parseFloat(baseCostStr);
    if (isNaN(baseCost)) {
      return res.status(400).json({ error: `Invalid base cost for material: ${material}` });
    }
    const markedUpCost = baseCost * 1.35;
    let laborCost = 0;
    if (laborKey) {
      const laborRow = laborData.find(
        (row) => row.LaborKey?.trim().toLowerCase() === laborKey.trim().toLowerCase()
      );
      if (laborRow && laborRow.Cost) {
        laborCost = parseFloat(laborRow.Cost) || 0;
      }
    } else {
      const defaultLaborRow = laborData.find((row) => row.LaborKey === "Default");
      if (defaultLaborRow && defaultLaborRow.Cost) {
        laborCost = parseFloat(defaultLaborRow.Cost) || 0;
      }
    }
    const materialTotal = markedUpCost * finalSqFt;
    const totalEstimate = materialTotal + laborCost;
    return res.json({
      material,
      lengthInches,
      widthInches,
      slabLengthInches: slabLengthInches || null,
      slabWidthInches: slabWidthInches || null,
      slabCount,
      slabSqFt,
      baseSqFt: parseFloat(baseSqFt.toFixed(2)),
      finalSqFt: parseFloat(finalSqFt.toFixed(2)),
      baseCost,
      markedUpCost: parseFloat(markedUpCost.toFixed(2)),
      laborKey: laborKey || "Default",
      laborCost,
      totalEstimate: parseFloat(totalEstimate.toFixed(2)),
    });
  } catch (error) {
    console.error("Error in /api/get-estimate:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/upload-image
 * Accepts an image upload and uses placeholder code for image analysis (e.g., to detect color or stone texture).
 */
app.post("/api/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    // Read the file as a buffer and convert to base64 for analysis if desired.
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString("base64");

    // Example: If using Google Cloud Vision or another service, you'd call it here.

    fs.unlinkSync(req.file.path);
    return res.json({
      message: "Image received and analyzed!",
      fileName: req.file.filename,
      dominantColor: null // Replace with actual result from your analysis.
    });
  } catch (error) {
    console.error("Error in /api/upload-image:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/chat
 * Uses OpenAI to generate an AI-based response.
 * The payload includes extra context for consultative, fact-finding responses
 * referencing local materials, labor, TOS data, and principles from "Think and Grow Rich"
 * and "How to Win Friends and Influence People."
 */
app.post("/api/chat", async (req, res) => {
  try {
    const { userMessage } = req.body;
    if (!userMessage) {
      return res.status(400).json({ error: "No userMessage provided." });
    }
    if (!OPENAI_API_KEY) {
      return res.status(500).json({ error: "OpenAI API key not configured on server." });
    }

    let materialInjection = "";
    const lowerMsg = userMessage.toLowerCase();
    // Use Fuse.js for broad searching if the query might be material-related.
    if (lowerMsg.includes("frost") || lowerMsg.includes("tile") || lowerMsg.includes("granite") || lowerMsg.includes("quartz")) {
      const searchResults = fuse.search(userMessage);
      if (searchResults.length > 0) {
        const bestMatch = searchResults[0].item;
        let slabSqFt = "";
        if (bestMatch["size"]) {
          const dims = bestMatch["size"].split("x").map(s => parseFloat(s.trim()));
          if (dims.length === 2 && !isNaN(dims[0]) && !isNaN(dims[1])) {
            slabSqFt = ((dims[0] * dims[1]) / 144).toFixed(2);
          }
        }
        materialInjection = `\nLocal Material Info: ${bestMatch["Color Name"]} from ${bestMatch["Vendor Name"]} (${bestMatch.Material}) has a typical thickness of ${bestMatch.Thickness} and a slab size of ${bestMatch["size"]} (approx. ${slabSqFt} sq ft) with a cost of ${bestMatch["Cost/SqFt"]} per sq ft.`;
      }
    }

    const systemPromptFinal = SYSTEM_INSTRUCTIONS + materialInjection;
    const messages = [
      { role: "system", content: systemPromptFinal },
      { role: "user", content: userMessage }
    ];

    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
      max_tokens: 250,
      temperature: 0.7,
    });
    const aiReply = response.data.choices[0].message.content.trim();
    return res.json({ response: aiReply });
  } catch (error) {
    console.error("Error in /api/chat:", error?.response?.data || error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/email-history
 * Emails the chat history using EmailJS.
 */
app.post("/api/email-history", async (req, res) => {
  const { email, chatHistory } = req.body;
  if (!email || !chatHistory) {
    return res.status(400).json({ error: "Missing 'email' or 'chatHistory'." });
  }
  try {
    const payload = {
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_USER_ID,
      template_params: { email, chat_history: chatHistory },
    };
    const response = await axios.post(
      "https://api.emailjs.com/api/v1.0/email/send",
      payload,
      { headers: { "Content-Type": "application/json" } }
    );
    return res.json({ message: "Chat history sent!", response: response.data });
  } catch (err) {
    console.error("Error sending email via EmailJS:", err);
    return res.status(500).json({ error: "Failed to send email." });
  }
});

/**
 * GET / (Test Route)
 */
app.get("/", (req, res) => {
  res.send(`
    <h1>Surprise Granite Chatbot Backend (OpenAI Integrated)</h1>
    <p>Available Endpoints:</p>
    <ul>
      <li><strong>POST</strong> /api/get-estimate</li>
      <li><strong>POST</strong> /api/upload-image</li>
      <li><strong>POST</strong> /api/chat</li>
      <li><strong>POST</strong> /api/schedule</li>
      <li><strong>POST</strong> /api/email-history</li>
      <li><strong>GET</strong> /api/get-tos</li>
      <li><strong>GET</strong> /api/get-business-info</li>
      <li><strong>GET</strong> /api/get-instructions</li>
      <li><strong>GET</strong> /api/quality-assurance</li>
      <li><strong>GET</strong> /api/minimum-workmanship-standards</li>
    </ul>
  `);
});

// Start the server after loading local JSON data.
const PORT = process.env.PORT || 5000;
loadLocalData();
initFuse();  // Initialize Fuse.js after loading data.
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

/**
 * =============================================================================
 * Machine Learning Integration Document for Surprise Granite Chatbot
 * =============================================================================
 *
 * This document outlines steps to enhance chatbot intelligence:
 *
 * 1. Name Recognition Without Explicit Prompts:
 *    - Integrate a Named Entity Recognition (NER) module (e.g., using spaCy's Matcher)
 *      to automatically extract user names even from single-word responses.
 *    - Since spaCy is a Python library, implement a separate Python service that exposes an API
 *      endpoint your Node.js server can call.
 *
 * 2. Example of spaCy Matcher Integration (Python Code Sample):
 *
 *    # Install spaCy: pip install spacy
 *    # Download the model: python -m spacy download en_core_web_sm
 *
 *    import spacy
 *    from spacy.matcher import Matcher
 *
 *    nlp = spacy.load("en_core_web_sm")
 *    matcher = Matcher(nlp.vocab)
 *
 *    # Create a pattern that matches two tokens: "iPhone" and "X"
 *    pattern = [{"TEXT": "iPhone"}, {"TEXT": "X"}]
 *    matcher.add("IPHONE_X", [pattern])
 *
 *    def match_text(text):
 *        doc = nlp(text)
 *        matches = matcher(doc)
 *        results = []
 *        for match_id, start, end in matches:
 *            span = doc[start:end]
 *            results.append(span.text)
 *        return results
 *
 *    # Example usage:
 *    print(match_text("I recently bought an iPhone X"))
 *
 * 3. Contextual Prompt Engineering:
 *    - Each /api/chat request includes extra context instructing the assistant to be consultative,
 *      recall local data (materials, labor, TOS), and ask clarifying questions.
 *
 * 4. Image Analysis:
 *    - In /api/upload-image, integrate an image recognition API (or your custom ML model)
 *      to analyze stone countertop images, extract dominant colors or textures, and map them to your
 *      materials data for matching suggestions.
 *
 * 5. Continuous Improvement:
 *    - Log conversation data (with user consent) to fine-tune models over time.
 *
 * =============================================================================
 */
