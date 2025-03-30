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
const NodeCache = require("node-cache");

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
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

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
    const client = new MongoClient(MONGODB_URI, {
      useUnifiedTopology: true,
      maxPoolSize: 10,
      minPoolSize: 2,
    });
    await client.connect();
    db = client.db("countertops");
    console.log("Connected to MongoDB Atlas with pooling");
  } catch (err) {
    logError("MongoDB connection failed", err);
    db = null;
  }
}

// Middleware
const compression = require("compression");
const rateLimit = require("express-rate-limit");
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
  })
);

// Routes
app.get("/", async (req, res) => {
  const filePath = path.join(__dirname, "public", "index.html");
  console.log("GET / - Serving:", filePath);
  try {
    res.sendFile(filePath, { maxAge: "1d" });
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
  let filePath;
  try {
    if (!req.file) throw new Error("No image uploaded");

    filePath = req.file.path;
    const imageBuffer = await fs.readFile(filePath);
    const imageBase64 = imageBuffer.toString("base64");
    const imageHash = createHash("sha256").update(imageBase64).digest("hex");

    const cacheKey = `analysis_${imageHash}`;
    let analysis = cache.get(cacheKey);
    if (!analysis) {
      analysis = await analyzeImage(imageBase64);
      cache.set(cacheKey, analysis);
      console.log("OpenAI Repair Analysis complete:", analysis);
    } else {
      console.log("Served analysis from cache");
    }

    const imagesCollection = db?.collection("countertop_images");
    let mongoMatches = [];
    if (imagesCollection && analysis.stone_type) {
      const stoneTypeLower = analysis.stone_type.toLowerCase();
      if (stoneTypeLower.includes("granite")) {
        const colorKeywords = (analysis.color_and_pattern || "").toLowerCase().split(" ");
        mongoMatches = await imagesCollection
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
        dislikes: 0,
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
    if (req.file && filePath) await cleanupFile(filePath);
    res.status(err.message === "No image uploaded" ? 400 : 500).json({ error: "Upload processing failed", details: err.message });
  }
});

app.post("/api/contractor-estimate", upload.single("image"), async (req, res) => {
  console.log("POST /api/contractor-estimate");
  let filePath;
  try {
    if (!req.file) throw new Error("No image uploaded");

    filePath = req.file.path;
    const imageBuffer = await fs.readFile(filePath);
    const fileContent = imageBuffer.toString("base64");
    const imageHash = createHash("sha256").update(fileContent).digest("hex");
    const customerNeeds = req.body.customer_needs || "";

    const cacheKey = `estimate_${imageHash}_${customerNeeds}`;
    let estimate = cache.get(cacheKey);
    if (!estimate) {
      estimate = await estimateProject(fileContent, req.file.mimetype, customerNeeds);
      cache.set(cacheKey, estimate);
      console.log("OpenAI Contractor Estimate complete:", estimate);
    } else {
      console.log("Served estimate from cache");
    }

    const imagesCollection = db?.collection("countertop_images");
    let imageId = new ObjectId().toString();
    if (imagesCollection && req.file.mimetype.startsWith("image/")) {
      const imageDoc = {
        imageHash,
        imageData: new Binary(imageBuffer),
        metadata: {
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          size: req.file.size,
          uploadDate: new Date(),
          estimate,
          likes: 0,
          dislikes: 0,
        },
      };
      const result = await imagesCollection.insertOne(imageDoc);
      imageId = result.insertedId;
      console.log("Image inserted, ID:", imageId);
    }

    await fs.unlink(filePath);
    const costEstimate = enhanceCostEstimate(estimate);

    const cleanedResponse = {
      imageId,
      message: "Estimate generated successfully",
      projectScope: estimate.project_scope,
      materialType: estimate.material_type,
      colorAndPattern: estimate.color_and_pattern,
      dimensions: estimate.dimensions,
      additionalFeatures: Array.isArray(estimate.additional_features)
        ? estimate.additional_features.join(", ")
        : estimate.additional_features || "None",
      condition: estimate.condition,
      costEstimate: {
        materialCost: costEstimate.material_cost,
        laborCost: costEstimate.labor_cost,
        additionalFeaturesCost: costEstimate.additional_features_cost || "$0",
        totalCost: costEstimate.total_cost,
      },
      reasoning: estimate.reasoning,
    };

    res.status(201).json(cleanedResponse);
  } catch (err) {
    logError("Contractor estimate error", err);
    if (req.file && filePath) await cleanupFile(filePath);
    res.status(err.message === "No image uploaded" ? 400 : 500).json({ error: "Estimate processing failed", details: err.message });
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
      metadata: {
        ...countertop.metadata,
        likes: countertop.metadata.likes || 0,
        dislikes: countertop.metadata.dislikes || 0,
        shareDescription: `Countertop Estimate: ${countertop.metadata.estimate?.material_type || "Unknown"}, ${countertop.metadata.estimate?.project_scope || "Project"}`,
        shareUrl: `${req.protocol}://${req.get("host")}/api/get-countertop/${countertop._id}`,
      },
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
    res.status(200).json({ message: "Like added", likes: newLikes, dislikes: countertop.metadata.dislikes || 0 });
  } catch (err) {
    logError("Like error", err);
    res.status(err.message === "Database unavailable" ? 503 : err.message === "Countertop not found" ? 404 : 500).json({
      error: "Failed to like countertop",
      details: err.message,
    });
  }
});

app.post("/api/dislike-countertop/:id", async (req, res) => {
  console.log("POST /api/dislike-countertop/", req.params.id);
  try {
    if (!db) throw new Error("Database unavailable");
    const imagesCollection = db.collection("countertop_images");
    const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!countertop) throw new Error("Countertop not found");

    const newDislikes = (countertop.metadata.dislikes || 0) + 1;
    await imagesCollection.updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { "metadata.dislikes": newDislikes } }
    );
    res.status(200).json({ message: "Dislike added", likes: countertop.metadata.likes || 0, dislikes: newDislikes });
  } catch (err) {
    logError("Dislike error", err);
    res.status(err.message === "Database unavailable" ? 503 : err.message === "Countertop not found" ? 404 : 500).json({
      error: "Failed to dislike countertop",
      details: err.message,
    });
  }
});

app.post("/api/send-email", async (req, res) => {
  console.log("POST /api/send-email", req.body);
  try {
    const { name, email, phone, message, stone_type, analysis_summary, image_id } = req.body;
    if (!name || !email || !message) throw new Error("Missing required fields: name, email, and message");

    const templateParams = {
      from_name: name,
      from_email: email,
      phone: phone || "Not provided",
      message,
      stone_type: stone_type || "N/A",
      analysis_summary: analysis_summary || "No estimate provided",
      image_url: image_id ? `${req.protocol}://${req.get("host")}/api/get-countertop/${image_id}` : "No image provided",
    };

    const emailResponse = await EmailJS.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams, { publicKey: EMAILJS_PUBLIC_KEY });
    console.log("Email sent:", emailResponse);

    if (db) {
      const leadsCollection = db.collection("leads");
      await leadsCollection.insertOne({
        name,
        email,
        phone,
        message,
        stone_type,
        analysis_summary,
        image_id,
        createdAt: new Date(),
      });
      console.log("Lead saved to MongoDB");
    }

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

    const cacheKey = `tts_${createHash("sha256").update(text).digest("hex")}`;
    let audioBuffer = cache.get(cacheKey);
    if (!audioBuffer) {
      const response = await openai.audio.speech.create({
        model: "tts-1",
        voice: "alloy",
        input: text,
      });
      audioBuffer = Buffer.from(await response.arrayBuffer());
      cache.set(cacheKey, audioBuffer);
      console.log("Generated TTS audio with OpenAI");
    } else {
      console.log("Served TTS audio from cache");
    }

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
  const cacheKey = `analysis_${createHash("sha256").update(imageBase64).digest("hex")}`;
  let result = cache.get(cacheKey);
  if (result) return result;

  const prompt = `You are CARI, an expert countertop analyst at Surprise Granite. Analyze this countertop image for repair needs:
  - Stone type: Identify material (e.g., "Quartz", "Granite") with confidence level.
  - Color and pattern: Describe colors and patterns briefly.
  - Damage type: Detect visible damage (e.g., "crack", "chip") or "No visible damage".
  - Severity: Rate damage as None, Low, Moderate, or Severe.
  - Reasoning: Explain findings concisely.
  Respond in JSON with keys: stone_type, color_and_pattern, damage_type, severity, reasoning.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] },
      ],
      max_tokens: 1000,
      temperature: 0.5,
      response_format: { type: "json_object" },
    });

    result = JSON.parse(response.choices[0].message.content);
    if (result.error) throw new Error(result.error);

    result.estimated_cost = calculateRepairCost(result.damage_type || "none", result.severity || "None");
    cache.set(cacheKey, result);
  } catch (err) {
    logError("OpenAI repair analysis failed", err);
    result = {
      stone_type: "Unknown",
      color_and_pattern: "Not identified",
      damage_type: "No visible damage",
      severity: "None",
      reasoning: "Analysis failed: " + err.message,
      estimated_cost: "Contact for estimate",
    };
  }

  console.log("Final repair analysis result:", result);
  return result;
}

async function estimateProject(fileContent, mimeType, customerNeeds = "") {
  console.log("Estimating project with OpenAI...");
  const cacheKey = `estimate_${createHash("sha256").update(fileContent + customerNeeds).digest("hex")}`;
  let result = cache.get(cacheKey);
  if (result) return result;

  const prompt = `You are CARI Contractor, an expert countertop contractor at Surprise Granite. Analyze the input (${mimeType.startsWith("image/") ? "image" : "document"}) and customer needs ("${customerNeeds}") to estimate a countertop project:
  - Project scope: New installation, replacement, or repair (use customer needs or infer).
  - Material type: Identify material (e.g., "Quartz", "Granite") with confidence.
  - Color and pattern: Describe briefly.
  - Dimensions: Use customer needs or estimate (default 25 sq ft).
  - Additional features: List extras (e.g., "sink cutout") as an array from customer needs or input.
  - Condition: For repairs, detect damage and severity (None, Low, Moderate, Severe).
  - Cost estimate: Provide material cost (per sq ft), labor cost (installation, features), additional features cost, and total cost range.
  - Reasoning: Explain concisely.
  Respond in JSON with keys: project_scope, material_type, color_and_pattern, dimensions, additional_features (array), condition, cost_estimate, reasoning.`;

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
      max_tokens: 1500,
      temperature: 0.5,
      response_format: { type: "json_object" },
    });

    result = JSON.parse(response.choices[0].message.content);
    if (!Array.isArray(result.additional_features)) {
      result.additional_features = result.additional_features ? [result.additional_features] : [];
    }
    cache.set(cacheKey, result);
  } catch (err) {
    logError("OpenAI contractor estimate failed", err);
    result = {
      project_scope: "Unknown",
      material_type: "Unknown",
      color_and_pattern: "Not identified",
      dimensions: "25 sq ft (assumed)",
      additional_features: [],
      condition: { damage_type: "No visible damage", severity: "None" },
      cost_estimate: { material_cost: "$1250.00", labor_cost: "$375.00", total_cost: "$1625.00 - $1750.00" },
      reasoning: "Estimate failed: " + err.message,
    };
  }

  console.log("Final contractor estimate result:", result);
  return result;
}

function calculateRepairCost(damageType, severity) {
  if (!laborData.length) return "Contact for estimate";

  const simplifiedDamageType = (damageType || "none").toLowerCase();
  if (simplifiedDamageType.includes("none")) return "$0.00";

  const typeMap = { crack: "crack", chip: "chip", stain: "stain", discoloration: "stain", scratch: "scratch" };
  const matchedType = Object.keys(typeMap).find((key) => simplifiedDamageType.includes(key));
  if (!matchedType) return "Contact for estimate (unrecognized damage type)";

  const laborEntry = laborData.find((entry) => entry.type === typeMap[matchedType]);
  if (!laborEntry) return "Contact for estimate (labor data missing)";

  const severityMultiplier = { Low: 1, Moderate: 2, Severe: 3, None: 0 }[severity || "None"] || 1;
  const cost = laborEntry.rate_per_sqft * severityMultiplier * laborEntry.hours;
  return `$${cost.toFixed(2)}`;
}

function enhanceCostEstimate(estimate) {
  return {
    material_cost: estimate.cost_estimate.material_cost || "Contact for estimate",
    labor_cost: {
      total: estimate.cost_estimate.labor_cost || "Contact for estimate"
    },
    additional_features_cost: estimate.cost_estimate.additional_features_cost || "$0",
    total_cost: estimate.cost_estimate.total_cost || "Contact for estimate",
  };
}

// Helper function for file cleanup
async function cleanupFile(filePath) {
  try {
    await fs.access(filePath);
    await fs.unlink(filePath);
  } catch (err) {
    console.error("Failed to delete file:", err.message);
  }
}

// Startup
async function startServer() {
  try {
    await Promise.all([loadLaborData(), connectToMongoDB()]);
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    logError("Server startup failed", err);
    process.exit(1);
  }
}

console.log(`Starting server on port ${PORT}...`);
startServer();
