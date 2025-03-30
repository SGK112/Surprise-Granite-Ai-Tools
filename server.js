require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs").promises;
const path = require("path");
const { MongoClient, Binary, ObjectId } = require("mongodb");
const OpenAI = require("openai");
const { createHash } = require("crypto");
const EmailJS = require("@emailjs/nodejs");

// Constants
const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI || throwError("MONGODB_URI is required");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || throwError("OPENAI_API_KEY is required");
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || throwError("EMAILJS_SERVICE_ID is required");
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || throwError("EMAILJS_TEMPLATE_ID is required");
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || throwError("EMAILJS_PUBLIC_KEY is required");

// App Setup
const app = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 10 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Global Variables
let laborData = [];
let db = null;

// Utility Functions
function throwError(message) {
  throw new Error(message);
}

function logError(message, err) {
  console.error(`${message}: ${err.message}`, err.stack);
}

// Load Labor Data
async function loadLaborData() {
  try {
    const laborJsonPath = path.join(__dirname, "data", "labor.json");
    laborData = JSON.parse(await fs.readFile(laborJsonPath, "utf8"));
    console.log("Loaded labor.json:", laborData.length, "entries");
  } catch (err) {
    logError("Failed to load labor.json", err);
    laborData = [
      { type: "crack", rate_per_sqft: 10, hours: 2 },
      { type: "chip", rate_per_sqft: 8, hours: 1 },
      { type: "stain", rate_per_sqft: 6, hours: 1.5 },
      { type: "scratch", rate_per_sqft: 5, hours: 0.5 },
      { type: "installation", rate_per_sqft: 15, hours: 1 },
      { type: "cutout", rate_per_unit: 50, hours: 0.5 },
      { type: "edge_profile", rate_per_linear_ft: 20, hours: 0.25 },
    ];
    console.log("Using default labor data:", laborData.length, "entries");
  }
}

// MongoDB Connection
async function connectToMongoDB() {
  try {
    const client = new MongoClient(MONGODB_URI, { useUnifiedTopology: true });
    await client.connect();
    db = client.db("countertops");
    console.log("Connected to MongoDB Atlas");
  } catch (err) {
    logError("MongoDB connection failed", err);
    db = null;
  }
}

// Middleware
app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Routes
app.get("/", async (req, res) => {
  const filePath = path.join(__dirname, "public", "index.html");
  console.log("GET / - Serving:", filePath);
  try {
    await fs.access(filePath);
    res.sendFile(filePath);
  } catch (err) {
    logError("Failed to serve index.html", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

app.get("/api/health", (req, res) => {
  console.log("GET /api/health");
  res.json({ status: "Server is running", port: PORT, dbStatus: db ? "Connected" : "Disconnected" });
});

app.post("/api/upload-countertop", upload.single("image"), async (req, res) => {
  console.log("POST /api/upload-countertop");
  try {
    if (!req.file) throw new Error("No image uploaded");

    const filePath = req.file.path;
    const imageBuffer = await fs.readFile(filePath);
    const imageBase64 = imageBuffer.toString("base64");
    const imageHash = createHash("sha256").update(imageBase64).digest("hex");

    const analysis = await analyzeImage(imageBase64);
    console.log("OpenAI Repair Analysis complete:", analysis);

    const imagesCollection = db?.collection("countertop_images");
    if (imagesCollection && analysis.stone_type) {
      const stoneTypeLower = analysis.stone_type.toLowerCase();
      if (stoneTypeLower.includes("granite")) {
        const colorKeywords = (analysis.color_and_pattern || "").toLowerCase().split(" ");
        const mongoMatches = await imagesCollection
          .find({
            "metadata.analysis.stone_type": { $regex: /granite/i },
            $or: colorKeywords.map((keyword) => ({
              "metadata.analysis.color_and_pattern": { $regex: keyword, $options: "i" },
            })),
          })
          .limit(5)
          .toArray();

        analysis.mongo_matches = mongoMatches.map((match) => ({
          stone_type: match.metadata.analysis.stone_type,
          color_and_pattern: match.metadata.analysis.color_and_pattern,
          imageBase64: match.imageData.buffer.toString("base64"),
        }));
      } else {
        analysis.mongo_matches = [];
      }
    } else {
      analysis.mongo_matches = [];
    }

    const imageDoc = {
      imageHash,
      imageData: new Binary(imageBuffer),
      metadata: {
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        uploadDate: new Date(),
        analysis,
        likes: 0,
      },
    };

    let result = { insertedId: new ObjectId().toString() };
    if (imagesCollection) {
      result = await imagesCollection.insertOne(imageDoc);
      console.log("Image inserted, ID:", result.insertedId);
    }

    await fs.unlink(filePath);
    res.status(201).json({ imageId: result.insertedId, message: "Image uploaded successfully", metadata: imageDoc.metadata });
  } catch (err) {
    logError("Upload error", err);
    if (req.file && fs.existsSync(req.file.path)) await fs.unlink(req.file.path).catch(() => {});
    res.status(err.message === "No image uploaded" ? 400 : 500).json({ error: "Upload processing failed", details: err.message });
  }
});

app.post("/api/contractor-estimate", upload.single("image"), async (req, res) => {
  console.log("POST /api/contractor-estimate");
  try {
    if (!req.file) throw new Error("No file uploaded");

    const filePath = req.file.path;
    let fileContent;
    if (req.file.mimetype.startsWith("image/")) {
      fileContent = (await fs.readFile(filePath)).toString("base64");
    } else if (["application/pdf", "text/plain"].includes(req.file.mimetype)) {
      fileContent = await fs.readFile(filePath, "utf8");
    } else {
      throw new Error(`Unsupported file type: ${req.file.mimetype}`);
    }

    const estimate = await estimateProject(fileContent, req.file.mimetype);
    console.log("OpenAI Contractor Estimate complete:", estimate);

    const imagesCollection = db?.collection("countertop_images");
    let imageId = new ObjectId().toString();
    if (imagesCollection && req.file.mimetype.startsWith("image/")) {
      const imageHash = createHash("sha256").update(fileContent).digest("hex");
      const imageDoc = {
        imageHash,
        imageData: new Binary(Buffer.from(fileContent, "base64")),
        metadata: {
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadDate: new Date(),
          estimate,
          likes: 0,
        },
      };
      const result = await imagesCollection.insertOne(imageDoc);
      imageId = result.insertedId;
      console.log("Image inserted, ID:", imageId);
    }

    await fs.unlink(filePath);
    const costEstimate = enhanceCostEstimate(estimate, laborData);
    res.status(201).json({ imageId, message: "Estimate generated successfully", ...estimate, cost_estimate: costEstimate });
  } catch (err) {
    logError("Contractor estimate error", err);
    if (req.file && fs.existsSync(req.file.path)) await fs.unlink(req.file.path).catch(() => {});
    res.status(err.message === "No file uploaded" ? 400 : 500).json({ error: "Estimate processing failed", details: err.message });
  }
});

app.get("/api/get-countertop/:id", async (req, res) => {
  console.log("GET /api/get-countertop/", req.params.id);
  try {
    if (!db) throw new Error("Database unavailable");
    const imagesCollection = db.collection("countertop_images");
    const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!countertop) throw new Error("Countertop not found");

    res.json({
      id: countertop._id,
      imageBase64: countertop.imageData.buffer.toString("base64"),
      metadata: countertop.metadata || {},
    });
  } catch (err) {
    logError("Fetch countertop error", err);
    res.status(err.message === "Database unavailable" ? 503 : err.message === "Countertop not found" ? 404 : 500).json({
      error: "Failed to fetch countertop",
      details: err.message,
    });
  }
});

app.post("/api/like-countertop/:id", async (req, res) => {
  console.log("POST /api/like-countertop/", req.params.id);
  try {
    if (!db) throw new Error("Database unavailable");
    const imagesCollection = db.collection("countertop_images");
    const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!countertop) throw new Error("Countertop not found");

    const newLikes = (countertop.metadata.likes || 0) + 1;
    await imagesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { "metadata.likes": newLikes } }
    );
    res.status(200).json({ message: "Like added", likes: newLikes });
  } catch (err) {
    logError("Like error", err);
    res.status(err.message === "Database unavailable" ? 503 : err.message === "Countertop not found" ? 404 : 500).json({
      error: "Failed to like countertop",
      details: err.message,
    });
  }
});

app.post("/api/send-email", async (req, res) => {
  console.log("POST /api/send-email", req.body);
  try {
    const { name, email, phone, message, stone_type, analysis_summary } = req.body;
    if (!name || !email || !message) throw new Error("Missing required fields: name, email, and message");

    const templateParams = {
      from_name: name,
      from_email: email,
      phone: phone || "Not provided",
      message,
      stone_type: stone_type || "N/A",
      analysis_summary: analysis_summary || "No analysis provided",
    };

    const emailResponse = await EmailJS.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams, { publicKey: EMAILJS_PUBLIC_KEY });
    console.log("Email sent:", emailResponse);
    res.status(200).json({ message: "Email sent successfully" });
  } catch (err) {
    logError("Email sending error", err);
    res.status(err.message === "Missing required fields: name, email, and message" ? 400 : 500).json({
      error: "Failed to send email",
      details: err.message,
    });
  }
});

app.post("/api/tts", async (req, res) => {
  console.log("POST /api/tts");
  try {
    const { text } = req.body;
    if (!text) throw new Error("No text provided");

    const response = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: text,
    });

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    res.set({ "Content-Type": "audio/mpeg", "Content-Length": audioBuffer.length });
    res.send(audioBuffer);
  } catch (err) {
    logError("TTS error", err);
    res.status(err.message === "No text provided" ? 400 : 500).json({ error: "Failed to generate audio", details: err.message });
  }
});

// Analysis Functions
async function analyzeImage(imageBase64) {
  console.log("Analyzing image with OpenAI for repair...");
  const prompt = `You are CARI, an expert countertop analyst at Surprise Granite with advanced vision and reasoning capabilities. Perform an exhaustive, detailed analysis of this countertop image, focusing on repair needs:

  - Stone type: Identify the material with maximum accuracy (e.g., "Quartz", "Marble", "Granite", "Quartzite", "Dekton", "Porcelain", "Limestone", "Soapstone") by examining texture, sheen, grain, edge profiles, polish level, and visual cues. Differentiate natural stones (e.g., Granite, Marble, Quartzite, Limestone, Soapstone) from engineered materials (e.g., Quartz, Dekton, Porcelain) based on pattern uniformity, veining irregularity, and surface finish. Include a confidence level (e.g., "95% Quartz") and exhaustive reasoning. If uncertain, cross-reference with "www.surprisegranite.com/materials/all-countertops" and hypothesize based on visual evidence.
  - Color and pattern: Deliver a vivid, precise description of colors (e.g., "matte ivory with golden undertones") and patterns (e.g., "swirling white veins with subtle blue streaks"). Note variations, transitions, edge details, or unique surface features.
  - Damage type: Detect and describe all visible damage with precision (e.g., "crack," "chip," "stain," "scratch," "discoloration," "wear"), specifying exact location (e.g., "1-inch crack along the left edge near the sink") and extent (e.g., "spanning 3 inches diagonally"). Identify subtle issues like micro-fractures, pitting, or fading. Use simple terms ("crack," "chip") for cost estimation compatibility. If no damage, state "No visible damage."
  - Severity: Evaluate damage severity with detailed, actionable context:
    - None: "No damage detected, the surface is pristine and flawless!"
    - Low: "Minor imperfection, easily repairable with minimal effort (e.g., light sanding)."
    - Moderate: "Noticeable damage, repair advised to prevent progression (e.g., sealing or patching)."
    - Severe: "Significant structural damage, immediate professional attention recommended."
  - Reasoning: Provide a thorough, evidence-based explanation of your findings, referencing specific visual clues (e.g., "The uniform sheen and consistent veining suggest engineered Quartz").

  Respond strictly in JSON format with keys: stone_type, color_and_pattern, damage_type, severity, reasoning. Ensure the response is a valid JSON object.`;

  let result;
  try {
    console.log("Sending request to OpenAI API for repair analysis...");
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] },
      ],
      max_tokens: 4000,
      temperature: 0.5,
      response_format: { type: "json_object" }, // Enforce JSON response
    });

    console.log("OpenAI response received:", JSON.stringify(response, null, 2));
    const content = response.choices[0].message.content;
    console.log("Raw content from OpenAI:", content);

    result = JSON.parse(content); // Parse directly since response_format ensures JSON
    if (result.error) throw new Error(result.error);
  } catch (err) {
    logError("OpenAI repair analysis failed", err);
    result = {
      stone_type: "Unknown",
      color_and_pattern: "Not identified",
      damage_type: "No visible damage",
      severity: "None",
      reasoning: "Repair analysis failed: " + err.message,
    };
  }

  const imagesCollection = db?.collection("countertop_images");
  let materialsFromDB = [];
  if (imagesCollection) {
    try {
      materialsFromDB = await imagesCollection.find({ "metadata.analysis": { $exists: true } }).toArray();
      console.log("Loaded materials from MongoDB:", materialsFromDB.length, "entries");
    } catch (err) {
      logError("Failed to load materials from MongoDB", err);
    }
  }

  const identifiedColor = (result.color_and_pattern || "").toLowerCase();
  const identifiedMaterial = (result.stone_type || "").toLowerCase();

  const bestMatch = materialsFromDB.find((item) =>
    item.metadata?.analysis?.stone_type?.toLowerCase() === identifiedMaterial &&
    identifiedColor.includes(item.metadata.analysis.color_and_pattern?.toLowerCase().split(" ")[0] || "")
  );

  result.color_match_suggestion = bestMatch?.metadata.analysis.color_and_pattern || "Not identified";
  result.estimated_cost = calculateRepairCost(result.damage_type || "none", result.severity || "None");
  result.material_composition = result.stone_type
    ? `${result.stone_type} (${result.natural_stone ? "Natural" : "Engineered"})`
    : "Not identified";
  result.natural_stone = result.stone_type && ["marble", "granite", "quartzite", "limestone", "soapstone"].includes(identifiedMaterial);
  result.professional_recommendation =
    result.severity === "Severe"
      ? "Contact a professional for repair or replacement."
      : result.severity === "Moderate"
      ? "Consider professional repair."
      : "No action required.";
  result.cleaning_recommendation =
    identifiedMaterial === "marble" ? "Use a pH-neutral cleaner and avoid acidic substances." : "Clean with mild soap and water.";
  result.repair_recommendation =
    result.severity === "Severe" || result.severity === "Moderate" ? "Professional repair recommended." : "No repairs needed.";
  result.possible_matches = materialsFromDB
    .filter((item) => item.metadata?.analysis?.stone_type && item.metadata?.analysis?.color_and_pattern)
    .map((item) => ({
      color_name: item.metadata.analysis.color_and_pattern,
      material: item.metadata.analysis.stone_type,
    }))
    .slice(0, 5);

  console.log("Final repair analysis result:", result);
  return result;
}

async function estimateProject(fileContent, mimeType) {
  console.log("Estimating project with OpenAI...");
  const prompt = `You are CARI Contractor, an expert countertop contractor at Surprise Granite with advanced vision and reasoning capabilities. Analyze the provided input (image or document) to estimate a full countertop project as a contractor would. Provide a detailed breakdown:

  - Input type: Identify whether the input is an image (visual analysis) or document (text analysis).
  - Project scope: For images, determine if this is a new installation, replacement, or repair based on visual cues (e.g., existing countertop condition, surroundings). For documents, extract details like dimensions, material preferences, or special requests (e.g., sink cutouts, edge profiles). If unclear, make reasonable assumptions and explain them.
  - Material type: Identify the material (e.g., "Quartz", "Marble", "Granite", "Quartzite", "Dekton", "Porcelain", "Limestone", "Soapstone") with a confidence level (e.g., "95% Quartz"). Use texture, sheen, grain, edge profiles, and polish level for images; use text for documents. Differentiate natural vs. engineered materials and hypothesize if uncertain, referencing "www.surprisegranite.com/materials/all-countertops".
  - Color and pattern: Describe colors (e.g., "matte ivory") and patterns (e.g., "swirling white veins") vividly. For documents, use provided descriptions or suggest based on context.
  - Dimensions: Estimate square footage (e.g., "20 sq ft") from image scale or document specs. If not provided, assume a standard 25 sq ft kitchen countertop and note the assumption.
  - Additional features: Identify or suggest extras like sink cutouts, cooktop cutouts, edge profiles (e.g., "bullnose"), or backsplashes. Quantify (e.g., "2 sink cutouts").
  - Condition (for repairs): If repair is part of the scope, detect damage (e.g., "crack," "chip") with location and extent. Assess severity (None, Low, Moderate, Severe).
  - Cost estimate: Provide a detailed breakdown:
    - Material cost: Suggest a material cost per sq ft (e.g., $50/sq ft for Quartz) based on typical Surprise Granite pricing.
    - Labor cost: Estimate installation labor (per sq ft), repair labor (if applicable), and additional feature costs (per unit or linear ft).
    - Total cost: Sum all components with a range (e.g., "$1500 - $2000").
  - Reasoning: Explain all findings and cost assumptions thoroughly, referencing visual or textual evidence.

  Respond in JSON format with keys: input_type, project_scope, material_type, color_and_pattern, dimensions, additional_features, condition, cost_estimate, reasoning. Ensure a comprehensive, contractor-like estimate.`;

  let result;
  try {
    const messages = [
      { role: "system", content: prompt },
      {
        role: "user",
        content: mimeType.startsWith("image/")
          ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileContent}` } }]
          : [{ type: "text", text: fileContent }],
      },
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: 4000,
      temperature: 0.5,
      response_format: { type: "json_object" },
    });

    console.log("OpenAI response received:", JSON.stringify(response, null, 2));
    result = JSON.parse(response.choices[0].message.content);
    if (result.error) throw new Error(result.error);
  } catch (err) {
    logError("OpenAI contractor estimate failed", err);
    result = {
      input_type: mimeType.startsWith("image/") ? "image" : "document",
      project_scope: "Unknown",
      material_type: "Unknown",
      color_and_pattern: "Not identified",
      dimensions: "Not specified",
      additional_features: [],
      condition: { damage_type: "No visible damage", severity: "None" },
      cost_estimate: { material_cost: "Unknown", labor_cost: "Unknown", total_cost: "Contact for estimate" },
      reasoning: "Estimate failed: " + err.message,
    };
  }

  const imagesCollection = db?.collection("countertop_images");
  let materialsFromDB = [];
  if (imagesCollection) {
    try {
      materialsFromDB = await imagesCollection.find({ "metadata.analysis": { $exists: true } }).toArray();
      console.log("Loaded materials from MongoDB:", materialsFromDB.length, "entries");
    } catch (err) {
      logError("Failed to load materials from MongoDB", err);
    }
  }

  const identifiedColor = (result.color_and_pattern || "").toLowerCase();
  const identifiedMaterial = (result.material_type || "").toLowerCase();

  const bestMatch = materialsFromDB.find((item) =>
    item.metadata?.analysis?.stone_type?.toLowerCase() === identifiedMaterial &&
    identifiedColor.includes(item.metadata.analysis.color_and_pattern?.toLowerCase().split(" ")[0] || "")
  );

  result.material_match_suggestion = bestMatch?.metadata.analysis.color_and_pattern || "Not identified";
  result.possible_matches = materialsFromDB
    .filter((item) => item.metadata?.analysis?.stone_type && item.metadata?.analysis?.color_and_pattern)
    .map((item) => ({
      color_name: item.metadata.analysis.color_and_pattern,
      material: item.metadata.analysis.stone_type,
    }))
    .slice(0, 5);

  console.log("Final contractor estimate result:", result);
  return result;
}

function calculateRepairCost(damageType, severity) {
  if (!laborData.length) return "Contact for estimate";

  const simplifiedDamageType = (damageType || "none").toLowerCase();
  if (simplifiedDamageType.includes("none") || simplifiedDamageType.includes("pristine")) return "$0.00";

  const typeMap = { crack: "crack", chip: "chip", stain: "stain", discoloration: "stain", scratch: "scratch" };
  const matchedType = Object.keys(typeMap).find((key) => simplifiedDamageType.includes(key));
  if (!matchedType) return "Contact for estimate (unrecognized damage type)";

  const laborEntry = laborData.find((entry) => entry.type === typeMap[matchedType]);
  if (!laborEntry) return "Contact for estimate (labor data missing)";

  const severityMultiplier = { Low: 1, Moderate: 2, Severe: 3, None: 0 }[severity || "None"] || 1;
  const cost = laborEntry.rate_per_sqft * severityMultiplier * laborEntry.hours;
  return `$${cost.toFixed(2)}`;
}

function enhanceCostEstimate(estimate, laborData) {
  const materialCost = parseFloat(estimate.cost_estimate?.material_cost?.replace("$", "") || "50") * (parseFloat(estimate.dimensions) || 25);
  const laborCost = { installation: 0, cutouts: 0, edge_profile: 0, total: 0 };

  const area = parseFloat(estimate.dimensions) || 25;
  const installLabor = laborData.find((d) => d.type === "installation");
  laborCost.installation = installLabor ? installLabor.rate_per_sqft * area : 375;

  const cutouts = estimate.additional_features?.filter((f) => f.toLowerCase().includes("cutout")).length || 0;
  const cutoutLabor = laborData.find((d) => d.type === "cutout");
  laborCost.cutouts = cutoutLabor ? cutoutLabor.rate_per_unit * cutouts : 0;

  const edgeProfileLabor = laborData.find((d) => d.type === "edge_profile");
  const perimeter = estimate.dimensions ? (2 * (Math.sqrt(area * 144) + Math.sqrt(area * 144))) / 12 : 20;
  laborCost.edge_profile =
    edgeProfileLabor && estimate.additional_features?.some((f) => f.toLowerCase().includes("edge profile"))
      ? edgeProfileLabor.rate_per_linear_ft * perimeter
      : 0;

  laborCost.total = laborCost.installation + laborCost.cutouts + laborCost.edge_profile;
  const totalCost = materialCost + laborCost.total;

  return {
    material_cost: `$${materialCost.toFixed(2)}`,
    labor_cost: {
      installation: `$${laborCost.installation.toFixed(2)}`,
      cutouts: `$${laborCost.cutouts.toFixed(2)}`,
      edge_profile: `$${laborCost.edge_profile.toFixed(2)}`,
      total: `$${laborCost.total.toFixed(2)}`,
    },
    total_cost: `$${totalCost.toFixed(2)} - $${(totalCost + 125).toFixed(2)}`,
  };
}

// Startup
async function startServer() {
  try {
    await loadLaborData();
    await connectToMongoDB();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    logError("Server startup failed", err);
    process.exit(1);
  }
}

console.log(`Starting server on port ${PORT}...`);
startServer();
