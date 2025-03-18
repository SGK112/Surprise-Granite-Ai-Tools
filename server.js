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
 *   - Consultative chat responses with extra context and conversation history to avoid repeated greetings.
 *   - Shopify API integration using the Admin API token (SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_TOKEN).
 *   - A new /api/materials endpoint for front-end vendor/stone population.
 *   - An enhanced /api/get-estimate endpoint that can handle demoCost, edgeType, sinkCuts, and backsplashLinearFt for more accurate quotes.
 *   - A new /api/professional-estimate endpoint that uses OpenAI to produce a full professional estimate summary.
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
 * In-memory conversation history.
 * NOTE: For production, store conversation per user session in a DB or session store.
 */
let conversationHistory = [];

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
Avoid reintroducing yourself after the initial greeting.
Always address the customer by name if known.
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
 * GET /api/materials
 * Returns the entire materialsData array so the front end can populate vendor & stone color.
 */
app.get("/api/materials", (req, res) => {
  res.json(materialsData);
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
 * Enhanced to handle optional fields: demoCost, edgeType, sinkCuts, backsplashLinearFt.
 */
app.post("/api/get-estimate", (req, res) => {
  try {
    const {
      material,
      lengthInches,
      widthInches,
      slabLengthInches,
      slabWidthInches,
      laborKey,
      demoCost,           // optional
      edgeType,           // optional
      sinkCuts,           // optional
      backsplashLinearFt, // optional
    } = req.body;

    // Basic validation
    if (!material || !lengthInches || !widthInches) {
      return res.status(400).json({ error: "Missing 'material', 'lengthInches', or 'widthInches'." });
    }
    const lengthNum = parseFloat(lengthInches);
    const widthNum = parseFloat(widthInches);
    if (isNaN(lengthNum) || isNaN(widthNum) || lengthNum <= 0 || widthNum <= 0) {
      return res.status(400).json({ error: "Invalid 'lengthInches' or 'widthInches'. Must be positive numbers." });
    }

    // Base area with 20% waste
    const baseSqFt = (lengthNum * widthNum) / 144;
    const finalSqFt = baseSqFt * 1.2;

    // Slab count logic
    let slabCount = 0;
    if (slabLengthInches && slabWidthInches) {
      const sLen = parseFloat(slabLengthInches);
      const sWid = parseFloat(slabWidthInches);
      if (!isNaN(sLen) && !isNaN(sWid) && sLen > 0 && sWid > 0) {
        const slabArea = (sLen * sWid) / 144;
        slabCount = Math.ceil(finalSqFt / slabArea);
      }
    }

    // Look up material in materialsData
    const matRow = materialsData.find(
      (row) => row.Material?.trim().toLowerCase() === material.trim().toLowerCase()
    );
    if (!matRow) {
      return res.status(404).json({ error: `Material '${material}' not found.` });
    }

    // Parse base cost from JSON
    const baseCostStr = matRow["Cost/SqFt"] || "0";
    const baseCost = parseFloat(baseCostStr);
    if (isNaN(baseCost)) {
      return res.status(400).json({ error: `Invalid base cost for material: ${material}` });
    }

    // Markup (35% markup)
    const markedUpCost = baseCost * 1.35;

    // Labor cost logic
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

    // Material total cost
    let materialTotal = markedUpCost * finalSqFt;

    // Additional cost logic
    let extraCosts = 0;
    if (demoCost) {
      const demoFloat = parseFloat(demoCost);
      if (!isNaN(demoFloat) && demoFloat > 0) {
        extraCosts += demoFloat * baseSqFt;
      }
    }
    if (edgeType) {
      if (edgeType.toLowerCase() === "bullnose") {
        extraCosts += 2 * finalSqFt;
      } else if (edgeType.toLowerCase() === "eased") {
        extraCosts += 1.5 * finalSqFt;
      }
    }
    if (sinkCuts) {
      const sinks = parseInt(sinkCuts, 10);
      if (!isNaN(sinks) && sinks > 0) {
        extraCosts += sinks * 50;
      }
    }
    if (backsplashLinearFt) {
      const bsf = parseFloat(backsplashLinearFt);
      if (!isNaN(bsf) && bsf > 0) {
        extraCosts += bsf * 5;
      }
    }

    const totalEstimate = materialTotal + laborCost + extraCosts;

    // Calculate slab size for reference, if available.
    let slabSqFt = null;
    if (matRow["size"]) {
      const dims = matRow["size"].split("x").map(s => parseFloat(s.trim()));
      if (dims.length === 2 && !isNaN(dims[0]) && !isNaN(dims[1])) {
        slabSqFt = parseFloat(((dims[0] * dims[1]) / 144).toFixed(2));
      }
    }

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
      demoCost: demoCost || 0,
      edgeType: edgeType || "Standard",
      sinkCuts: sinkCuts || 0,
      backsplashLinearFt: backsplashLinearFt || 0,
      extraCosts: parseFloat(extraCosts.toFixed(2)),
      totalEstimate: parseFloat(totalEstimate.toFixed(2)),
      // Include individual cost components for AI integration if needed
      materialTotal,
    });
  } catch (error) {
    console.error("Error in /api/get-estimate:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/professional-estimate
 * This endpoint computes the numeric estimate (using /api/get-estimate logic)
 * then uses OpenAI to generate a professional, natural‑language estimate summary.
 */
app.post("/api/professional-estimate", async (req, res) => {
  try {
    // First, compute the numerical estimate using the same fields as /api/get-estimate.
    const estimateResponse = await new Promise((resolve, reject) => {
      // We simulate an internal call by reusing the logic from /api/get-estimate.
      // (Alternatively, you could refactor the estimation logic into a separate function.)
      const reqClone = { body: req.body };
      const resClone = {
        json: (data) => resolve(data),
        status: (code) => ({ json: (data) => reject(data) })
      };
      app._router.handle(reqClone, resClone, () => {});
    });

    if (estimateResponse.error) {
      return res.status(400).json({ error: estimateResponse.error });
    }

    // Build a professional prompt that includes the numerical breakdown.
    const prompt = `
Please create a detailed, professional estimate summary for a countertop project using the following details:

Material: ${estimateResponse.material}
Dimensions: ${req.body.lengthInches} inches by ${req.body.widthInches} inches
Base Area (sq ft): ${estimateResponse.baseSqFt}
Final Area with Waste (sq ft): ${estimateResponse.finalSqFt}
Material Cost (after 35% markup): $${estimateResponse.markedUpCost} per sq ft, Total Material Cost: $${estimateResponse.materialTotal.toFixed(2)}
Labor Cost: $${estimateResponse.laborCost}
Additional Costs: $${estimateResponse.extraCosts}
Total Estimate: $${estimateResponse.totalEstimate}

Please write the estimate in a clear, professional tone that includes recommendations for next steps and any important notes.
`;

    // Use OpenAI to generate the professional summary.
    const messages = [
      { role: "system", content: "You are a professional estimator." },
      { role: "user", content: prompt }
    ];

    const aiResponse = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
      max_tokens: 300,
      temperature: 0.7,
    });
    const professionalEstimate = aiResponse.data.choices[0].message.content.trim();

    return res.json({ 
      professionalEstimate,
      calculation: estimateResponse
    });
  } catch (error) {
    console.error("Error in /api/professional-estimate:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/upload-image
 * Accepts an image upload and uses placeholder code for image analysis.
 */
app.post("/api/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    const imageBuffer = fs.readFileSync(req.file.path);
    const base64Image = imageBuffer.toString("base64");

    // Insert image recognition logic here (e.g., Google Cloud Vision API)

    fs.unlinkSync(req.file.path);
    return res.json({
      message: "Image received and analyzed!",
      fileName: req.file.filename,
      dominantColor: null // Replace with actual analysis result.
    });
  } catch (error) {
    console.error("Error in /api/upload-image:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/chat
 * Uses OpenAI to generate a response, including conversation context.
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

    // Append user message to conversation history
    conversationHistory.push({ role: "user", content: userMessage });

    // Construct full conversation with system prompt and history
    const messages = [
      { role: "system", content: SYSTEM_INSTRUCTIONS },
      ...conversationHistory
    ];

    const response = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
      max_tokens: 250,
      temperature: 0.7,
    });
    const aiReply = response.data.choices[0].message.content.trim();

    // Append assistant response to conversation history
    conversationHistory.push({ role: "assistant", content: aiReply });

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
      <li><strong>GET</strong> /api/materials</li>
      <li><strong>POST</strong> /api/professional-estimate</li>
    </ul>
  `);
});

// Start the server after loading local JSON data.
const PORT = process.env.PORT || 5000;
loadLocalData();
initFuse();
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

/**
 * =============================================================================
 * Machine Learning Integration Document for Surprise Granite Chatbot
 * =============================================================================
 *
 * 1. Name Recognition Without Explicit Prompts:
 *    - Integrate a Named Entity Recognition (NER) module (using spaCy’s Matcher) in a separate Python service.
 *
 * 2. Example of spaCy Matcher Integration (Python Code Sample):
 *
 *    import spacy
 *    from spacy.matcher import Matcher
 *
 *    nlp = spacy.load("en_core_web_sm")
 *    matcher = Matcher(nlp.vocab)
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
 * 3. Contextual Prompt Engineering:
 *    - Include conversation history and directives in the system prompt.
 *
 * 4. Image Analysis:
 *    - Integrate an image recognition API (e.g., Google Cloud Vision) in /api/upload-image.
 *
 * 5. Continuous Improvement:
 *    - Log conversation data (with user consent) for future fine-tuning.
 *
 * =============================================================================
 */
