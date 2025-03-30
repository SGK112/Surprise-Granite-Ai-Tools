require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const { createHash } = require("crypto");
const OpenAI = require("openai");
const EmailJS = require("@emailjs/nodejs");
const NodeCache = require("node-cache");

// Constants
const PORT = process.env.PORT || 10000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || throwError("OPENAI_API_KEY is required");
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || throwError("EMAILJS_SERVICE_ID is required");
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || throwError("EMAILJS_TEMPLATE_ID is required");
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || throwError("EMAILJS_PUBLIC_KEY is required");
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";

// App Setup
const app = express();
app.set("trust proxy", 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// Middleware
const compression = require("compression");
const rateLimit = require("express-rate-limit");
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Utility Functions
function throwError(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

function logError(message, err) {
  console.error(`${message}: ${err ? err.message : "Unknown error"}`, err?.stack || "");
}

// Routes
app.get("/api/health", (req, res) => {
  res.json({ status: "Server is running", port: PORT });
});

app.post("/api/contractor-estimate", upload.single("image"), async (req, res, next) => {
  console.log("POST /api/contractor-estimate");
  try {
    if (!req.file) throwError("No image uploaded", 400);

    const imageBuffer = req.file.buffer;
    const fileContent = imageBuffer.toString("base64");
    const customerNeeds = (req.body.customer_needs || "").trim();
    const cacheKey = `estimate_${createHash("sha256").update(fileContent + customerNeeds).digest("hex")}`;

    let estimate = cache.get(cacheKey);
    if (!estimate) {
      estimate = await estimateProject(fileContent, customerNeeds);
      cache.set(cacheKey, estimate);
    }

    const costEstimate = enhanceCostEstimate(estimate);
    const audioBuffer = await generateTTS(estimate, customerNeeds);

    res.status(201).json({
      message: "Estimate generated successfully",
      projectScope: estimate.project_scope,
      materialType: estimate.material_type,
      colorAndPattern: estimate.color_and_pattern,
      dimensions: estimate.dimensions,
      additionalFeatures: estimate.additional_features.join(", ") || "None",
      condition: estimate.condition,
      costEstimate,
      reasoning: estimate.reasoning,
      contact: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a full evaluation.`,
      audioBase64: audioBuffer.toString("base64"),
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/send-email", async (req, res, next) => {
  console.log("POST /api/send-email", req.body);
  try {
    const { name, email, phone, message, stone_type, analysis_summary } = req.body;
    if (!name || !email || !message) throwError("Missing required fields: name, email, and message", 400);

    const templateParams = {
      from_name: name,
      from_email: email,
      phone: phone || "Not provided",
      message,
      stone_type: stone_type || "N/A",
      analysis_summary: analysis_summary || "No estimate provided",
      contact_phone: SURPRISE_GRANITE_PHONE,
    };

    const emailResponse = await EmailJS.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams, {
      publicKey: EMAILJS_PUBLIC_KEY,
    });
    console.log("Email sent successfully:", emailResponse);

    res.status(200).json({ message: "Email sent successfully" });
  } catch (err) {
    logError("Email sending error", err);
    res.status(err.status || 500).json({ error: "Failed to send email", details: err.message });
  }
});

// Analysis Functions
async function estimateProject(fileContent, customerNeeds) {
  const prompt = `You are CARI Contractor at Surprise Granite. Analyze this countertop image and customer needs ("${customerNeeds}") for a quick estimate:
  - Project scope: New installation, replacement, or repair (use customer needs or infer; default "replacement").
  - Material type: Identify material (e.g., "Quartz", "Granite") from image.
  - Color and pattern: Describe briefly from image.
  - Dimensions: Use customer needs (e.g., "25 sq ft") or assume 25 sq ft for kitchen, 5 sq ft for vanity.
  - Additional features: List extras (e.g., "sink cutout") as an array from customer needs or image; default to [].
  - Condition: For repairs, detect damage (e.g., "crack") and severity (None, Low, Moderate, Severe); default { damage_type: "No visible damage", severity: "None" }.
  - Cost estimate: Provide material_cost ($/sq ft), labor_cost ($/sq ft), additional_features_cost, total_cost range. Use $50/sq ft material, $30/sq ft labor for non-repairs, adjust for repairs.
  - Reasoning: Explain concisely, note assumptions.
  Respond in JSON with: project_scope, material_type, color_and_pattern, dimensions, additional_features (array), condition (object), cost_estimate (object), reasoning.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileContent}` } }] },
      ],
      max_tokens: 1500,
      temperature: 0.5,
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(response.choices[0].message.content);
    result.additional_features = Array.isArray(result.additional_features) ? result.additional_features : [];
    result.condition = result.condition || { damage_type: "No visible damage", severity: "None" };
    return result;
  } catch (err) {
    logError("OpenAI estimate failed", err);
    return {
      project_scope: "Replacement",
      material_type: "Unknown",
      color_and_pattern: "Not identified",
      dimensions: "25 sq ft (assumed)",
      additional_features: [],
      condition: { damage_type: "No visible damage", severity: "None" },
      cost_estimate: { material_cost: "$1250", labor_cost: "$750", additional_features_cost: "$0", total_cost: "$2000" },
      reasoning: "Estimate failed: " + err.message + ". Assumed 25 sq ft kitchen countertop.",
    };
  }
}

async function generateTTS(estimate, customerNeeds) {
  const narrationText = `Your Surprise Granite estimate: 
    Project: ${estimate.project_scope || "Replacement"}. 
    Material: ${estimate.material_type || "Unknown"}. 
    Dimensions: ${estimate.dimensions || "25 sq ft"}. 
    Features: ${estimate.additional_features.length ? estimate.additional_features.join(", ") : "None"}. 
    Condition: ${estimate.condition.damage_type}, ${estimate.condition.severity}. 
    Total cost: ${estimate.cost_estimate.total_cost || "Contact for estimate"}. 
    ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
    Contact us at ${SURPRISE_GRANITE_PHONE} for more details.`;

  try {
    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: narrationText.slice(0, 4096), // Limit to OpenAI max
    });
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    logError("TTS generation failed", err);
    return Buffer.from(""); // Empty buffer as fallback
  }
}

function enhanceCostEstimate(estimate) {
  const sqFt = parseFloat(estimate.dimensions) || 25;
  const materialCost = estimate.cost_estimate.material_cost || `$${(50 * sqFt).toFixed(2)}`;
  const laborCost = estimate.cost_estimate.labor_cost || `$${(30 * sqFt).toFixed(2)}`;
  const featuresCost = estimate.cost_estimate.additional_features_cost || "$0";
  const totalCost = estimate.cost_estimate.total_cost || `$${(parseFloat(materialCost.slice(1)) + parseFloat(laborCost.slice(1)) + parseFloat(featuresCost.slice(1))).toFixed(2)}`;
  return { materialCost, laborCost: { total: laborCost }, additionalFeaturesCost: featuresCost, totalCost };
}

// Error Middleware
app.use((err, req, res, next) => {
  logError(`Unhandled error in ${req.method} ${req.path}`, err);
  res.status(err.status || 500).json({ error: "Internal server error", details: err.message });
});

// Startup
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
