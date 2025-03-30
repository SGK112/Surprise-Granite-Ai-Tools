require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs").promises;
const { createHash } = require("crypto");
const { MongoClient, Binary, ObjectId } = require("mongodb");
const OpenAI = require("openai");
const EmailJS = require("@emailjs/nodejs");
const NodeCache = require("node-cache");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI || throwConfigError("MONGODB_URI");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || throwConfigError("OPENAI_API_KEY");
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || throwConfigError("EMAILJS_SERVICE_ID");
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || throwConfigError("EMAILJS_TEMPLATE_ID");
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || throwConfigError("EMAILJS_PUBLIC_KEY");
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";

const app = express();
app.set("trust proxy", 1);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

let laborData = [];
let materialsData = [];
let db = null;
let mongoClient;

EmailJS.init({ publicKey: EMAILJS_PUBLIC_KEY });

// Middleware
app.use(compression());
app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, keyGenerator: (req) => req.ip }));

// Utility Functions
function throwConfigError(key) {
    throw new Error(`${key} is required in environment variables`);
}

function throwError(message, status = 500) {
    const err = new Error(message);
    err.status = status;
    throw err;
}

function logError(message, err, req = {}) {
    console.error(`[${req.requestId || 'NO_ID'}] ${message}: ${err?.message || "Unknown error"}`, err?.stack || err);
}

async function loadLaborData() {
    try {
        const laborJsonPath = path.join(__dirname, "data", "labor.json");
        console.log("Attempting to load labor.json from:", laborJsonPath);
        laborData = JSON.parse(await fs.readFile(laborJsonPath, "utf8"));
        console.log("Loaded labor.json:", laborData.length, "entries");
    } catch (err) {
        logError("Failed to load labor.json, using expanded defaults", err);
        laborData = [
            { type: "crack_repair", rate_per_sqft: 10, hours: 2, confidence: 1 },
            { type: "chip_repair", rate_per_sqft: 8, hours: 1, confidence: 1 },
            { type: "stain_removal", rate_per_sqft: 6, hours: 1.5, confidence: 1 },
            { type: "scratch_repair", rate_per_sqft: 5, hours: 0.5, confidence: 1 },
            { type: "countertop_installation", rate_per_sqft: 15, hours: 1, confidence: 1 },
            { type: "sink_cutout", rate_per_unit: 50, hours: 0.5, confidence: 1 },
            { type: "edge_profile", rate_per_linear_ft: 20, hours: 0.25, confidence: 1 },
            { type: "cabinet_installation", rate_per_unit: 75, hours: 2, confidence: 1 },
            { type: "cabinet_repair", rate_per_unit: 40, hours: 1, confidence: 1 },
            { type: "tile_installation", rate_per_sqft: 12, hours: 1.5, confidence: 1 },
            { type: "shower_pan_installation", rate_per_unit: 150, hours: 3, confidence: 1 },
            { type: "plumbing_installation", rate_per_unit: 100, hours: 2, confidence: 1 },
            { type: "demolition", rate_per_sqft: 5, hours: 0.5, confidence: 1 }
        ];
        console.log("Using default labor data:", laborData.length, "entries");
    }
}

async function loadMaterialsData() {
    try {
        const materialsJsonPath = path.join(__dirname, "data", "materials.json");
        console.log("Attempting to load materials.json from:", materialsJsonPath);
        materialsData = JSON.parse(await fs.readFile(materialsJsonPath, "utf8"));
        console.log("Loaded materials.json:", materialsData.length, "entries");
    } catch (err) {
        logError("Failed to load materials.json, using expanded defaults", err);
        materialsData = [
            { type: "Granite", cost_per_sqft: 50, confidence: 1 },
            { type: "Quartz", cost_per_sqft: 60, confidence: 1 },
            { type: "Marble", cost_per_sqft: 70, confidence: 1 },
            { type: "Soapstone", cost_per_sqft: 80, confidence: 1 },
            { type: "Concrete", cost_per_sqft: 65, confidence: 1 },
            { type: "Acrylic or Fiberglass", cost_per_sqft: 20, confidence: 1 },
            { type: "Ceramic Tile", cost_per_sqft: 10, confidence: 1 },
            { type: "Porcelain Tile", cost_per_sqft: 15, confidence: 1 },
            { type: "Wood (Cabinet)", cost_per_unit: 100, confidence: 1 },
            { type: "Stainless Steel (Sink)", cost_per_unit: 200, confidence: 1 },
            { type: "PVC Pipe", cost_per_linear_ft: 2, confidence: 1 }
        ];
        console.log("Using default materials data:", materialsData.length, "entries");
    }
}

async function connectToMongoDB() {
    try {
        mongoClient = new MongoClient(MONGODB_URI, { maxPoolSize: 10, minPoolSize: 2 });
        await mongoClient.connect();
        db = mongoClient.db("countertops");
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        logError("MongoDB connection failed", err);
        throw err;
    }
}

async function ensureMongoDBConnection() {
    if (!db) {
        await connectToMongoDB();
        if (!db) throwError("Database connection failed after retry", 503);
    }
}

// Routes
app.get("/", (req, res) => {
    console.log("GET / - Health check");
    res.status(200).send("CARI Server is running");
});

app.get("/api/health", (req, res) => {
    console.log("GET /api/health");
    res.json({ status: "Server is running", port: PORT, dbStatus: db ? "Connected" : "Disconnected" });
});

app.post("/api/contractor-estimate", upload.single("image"), async (req, res, next) => {
    console.log("POST /api/contractor-estimate - Starting estimate process");
    try {
        await ensureMongoDBConnection();
        if (!req.file) throwError("No image uploaded", 400);

        const imageBuffer = req.file.buffer;
        const fileContent = imageBuffer.toString("base64");
        const customerNeeds = (req.body.customer_needs || "").trim();
        const imageHash = createHash("sha256").update(fileContent).digest("hex");
        const safeCustomerNeeds = customerNeeds.replace(/[^a-zA-Z0-9]/g, '').slice(0, 50);
        const cacheKey = `estimate_${imageHash}_${safeCustomerNeeds}`;

        console.log("Checking cache for estimate:", cacheKey);
        let estimate = cache.get(cacheKey);
        if (!estimate) {
            console.log("Cache miss, generating new estimate");
            estimate = await estimateProject(fileContent, customerNeeds);
            cache.set(cacheKey, estimate);
        } else {
            console.log("Cache hit, using cached estimate");
        }

        console.log("Storing estimate in MongoDB");
        const imagesCollection = db.collection("countertop_images");
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
        const insertResult = await imagesCollection.insertOne(imageDoc);
        estimate.imageId = insertResult.insertedId;
        console.log("Estimate stored, imageId:", estimate.imageId);

        console.log("Calculating cost estimate");
        const costEstimate = enhanceCostEstimate(estimate) || {
            materialCost: "Contact for estimate",
            laborCost: { total: "Contact for estimate" },
            additionalFeaturesCost: "$0",
            totalCost: "Contact for estimate"
        };

        console.log("Generating TTS");
        const audioBuffer = await generateTTS(estimate, customerNeeds);

        const responseData = {
            imageId: estimate.imageId,
            message: "Estimate generated successfully",
            projectScope: estimate.project_scope,
            materialType: estimate.material_type,
            colorAndPattern: estimate.color_and_pattern,
            dimensions: estimate.dimensions,
            additionalFeatures: estimate.additional_features.join(", ") || "None",
            condition: estimate.condition,
            costEstimate,
            reasoning: estimate.reasoning,
            solutions: estimate.solutions,
            contact: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a full evaluation.`,
            audioBase64: audioBuffer.toString("base64"),
            shareUrl: `${req.protocol}://${req.get("host")}/api/get-countertop/${estimate.imageId}`,
            likes: 0,
            dislikes: 0,
        };
        console.log("Sending response:", responseData);
        res.status(201).json(responseData);
    } catch (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size exceeds 5MB limit" });
        }
        next(err);
    }
});

// Other routes (get-countertop, like-countertop, dislike-countertop, send-email) remain unchanged...

// Learning and Analysis Functions
function updatePricingConfidence(estimate, adjustment) {
    const material = materialsData.find(m => m.type.toLowerCase() === (estimate.material_type || "").toLowerCase());
    if (material) {
        material.confidence = Math.min(1, Math.max(0, (material.confidence || 1) + adjustment));
        console.log(`Updated confidence for ${material.type}: ${material.confidence}`);
    }

    if ((estimate.project_scope || "").toLowerCase() === "repair" && estimate.condition?.damage_type !== "No visible damage") {
        const labor = laborData.find(l => l.type === estimate.condition.damage_type.toLowerCase());
        if (labor) {
            labor.confidence = Math.min(1, Math.max(0, (labor.confidence || 1) + adjustment));
            console.log(`Updated confidence for ${labor.type}: ${labor.confidence}`);
        }
    }
    (estimate.additional_features || []).forEach(feature => {
        const labor = laborData.find(l => feature.toLowerCase().includes(l.type));
        if (labor) {
            labor.confidence = Math.min(1, Math.max(0, (labor.confidence || 1) + adjustment));
            console.log(`Updated confidence for ${labor.type}: ${labor.confidence}`);
        }
    });
}

async function estimateProject(fileContent, customerNeeds) {
    console.log("Starting estimateProject with customerNeeds:", customerNeeds);
    try {
        await ensureMongoDBConnection();
        console.log("Fetching past estimates from MongoDB");
        const imagesCollection = db.collection("countertop_images");

        const pastEstimates = await imagesCollection
            .find({ "metadata.estimate.material_type": { $exists: true } })
            .project({
                "metadata.estimate.material_type": 1,
                "metadata.estimate.project_scope": 1,
                "metadata.estimate.condition": 1,
                "metadata.estimate.additional_features": 1,
                "metadata.estimate.solutions": 1,
                "metadata.uploadDate": 1,
                "metadata.likes": 1,
                "metadata.dislikes": 1
            })
            .sort({ "metadata.uploadDate": -1 })
            .limit(10)
            .allowDiskUse(true)
            .toArray();
        console.log("Fetched past estimates:", pastEstimates.length);

        const pastData = pastEstimates.map(img => ({
            material_type: img.metadata.estimate.material_type || "Unknown",
            project_scope: img.metadata.estimate.project_scope,
            condition: img.metadata.estimate.condition,
            additional_features: img.metadata.estimate.additional_features,
            solutions: img.metadata.estimate.solutions || "Professional evaluation required",
            cost: enhanceCostEstimate(img.metadata.estimate)?.totalCost || "Contact for estimate",
            likes: img.metadata.likes || 0,
            dislikes: img.metadata.dislikes || 0,
        }));
        console.log("Past data prepared:", pastData);

        const prompt = `You are CARI, an advanced AI estimator at Surprise Granite, optimized for accurate estimates across various remodeling projects (countertops, cabinets, showers, repairs, etc.) using our pricing data as of March 2025. Analyze this image and customer needs ("${customerNeeds}") with:

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData)} (use rate_per_sqft, rate_per_unit, or rate_per_linear_ft; confidence indicates reliability).
        - Materials: ${JSON.stringify(materialsData)} (use cost_per_sqft, cost_per_unit, or cost_per_linear_ft; confidence indicates reliability).

        **Historical Estimates**: ${JSON.stringify(pastData)} (use to refine estimates, prioritize high-liked, low-disliked entries).

        Estimate:
        - Project scope: Identify the job type (e.g., "countertop installation", "cabinet replacement", "shower remodel", "repair") from customer needs or image; default "replacement".
        - Material type: Identify primary material (e.g., "Quartz", "Tile", "Wood") from image or needs; default "Unknown" if uncertain.
        - Color and pattern: Describe from image or infer from needs.
        - Dimensions: Extract from customer needs (e.g., "25 sq ft") or estimate based on context (25 sq ft for countertops, 10 sq ft for showers, 5 units for cabinets).
        - Additional features: List as array (e.g., "sink cutout", "plumbing", "demolition") from needs or image; default [].
        - Condition: For repairs, detect damage (e.g., "crack_repair") and severity (None, Low, Moderate, Severe); default { damage_type: "No visible damage", severity: "None" }.
        - Solutions: Propose based on scope, condition, and past data; suggest modern techniques where applicable.
        - Reasoning: Explain estimate, referencing pricing data, past estimates, and feedback.

        Respond in JSON with: project_scope, material_type, color_and_pattern, dimensions, additional_features (array), condition (object), solutions (string), reasoning.`;

        console.log("Sending request to OpenAI");
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
        console.log("Received OpenAI response:", response.choices[0].message.content);

        const result = JSON.parse(response.choices[0].message.content);
        result.material_type = result.material_type || "Unknown";
        result.additional_features = Array.isArray(result.additional_features) ? result.additional_features : [];
        result.condition = result.condition || { damage_type: "No visible damage", severity: "None" };
        result.solutions = result.solutions || "Contact for professional evaluation.";
        console.log("Estimate result:", result);
        return result;
    } catch (err) {
        logError("Estimate generation failed", err);
        const fallback = {
            project_scope: "Replacement",
            material_type: "Unknown",
            color_and_pattern: "Not identified",
            dimensions: "25 sq ft (assumed)",
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: "Contact for professional evaluation.",
            reasoning: `Estimate failed: ${err.message}. Assumed 25 sq ft kitchen countertop.`,
        };
        console.log("Returning fallback estimate:", fallback);
        return fallback;
    }
}

async function generateTTS(estimate, customerNeeds) {
    console.log("Generating TTS for estimate");
    const costEstimate = enhanceCostEstimate(estimate) || {
        materialCost: "Contact for estimate",
        laborCost: { total: "Contact for estimate" },
        additionalFeaturesCost: "$0",
        totalCost: "Contact for estimate"
    };
    const narrationText = `Your Surprise Granite estimate: 
        Project: ${estimate.project_scope || "Replacement"}. 
        Material: ${estimate.material_type || "Unknown"}. 
        Dimensions: ${estimate.dimensions || "25 sq ft"}. 
        Features: ${estimate.additional_features.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition?.damage_type || "No visible damage"}, ${estimate.condition?.severity || "None"}. 
        Total cost: ${costEstimate.totalCost || "Contact for estimate"}. 
        Solutions: ${estimate.solutions}. 
        ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
        Contact us at ${SURPRISE_GRANITE_PHONE} for more details.`;

    try {
        const response = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy",
            input: narrationText.slice(0, 4096),
        });
        console.log("TTS generated successfully");
        return Buffer.from(await response.arrayBuffer());
    } catch (err) {
        logError("TTS generation failed", err);
        return Buffer.from(`Error generating audio: ${err.message}. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`);
    }
}

function enhanceCostEstimate(estimate) {
    console.log("Enhancing cost estimate for:", estimate.material_type);
    if (!laborData.length || !materialsData.length) {
        console.log("No labor or materials data available");
        return null;
    }

    const dimensions = estimate.dimensions || "25 sq ft";
    const sqFtMatch = dimensions.match(/(\d+)-?(\d+)?\s*sq\s*ft/i);
    const unitMatch = dimensions.match(/(\d+)\s*units?/i);
    let sqFt = sqFtMatch ? (sqFtMatch[2] ? (parseInt(sqFtMatch[1], 10) + parseInt(sqFtMatch[2], 10)) / 2 : parseInt(sqFtMatch[1], 10)) : 25;
    let units = unitMatch ? parseInt(unitMatch[1], 10) : 0;
    if (isNaN(sqFt)) sqFt = 25;
    if (isNaN(units)) units = 0;
    console.log("Calculated sq ft:", sqFt, "units:", units);

    const materialType = estimate.material_type || "Unknown";
    const material = materialsData.find(m => m.type.toLowerCase() === materialType.toLowerCase()) || { cost_per_sqft: 50, confidence: 1 };
    const materialCostAdjustment = material.confidence || 1;
    const baseMaterialCost = (material.cost_per_sqft || 0) * sqFt + (material.cost_per_unit || 0) * units;
    const materialCostWithMargin = baseMaterialCost * 1.3; // 30% margin
    console.log("Material cost with margin:", materialCostWithMargin);

    let laborCost = 0;
    const projectScope = (estimate.project_scope || "replacement").toLowerCase();
    if (projectScope.includes("repair") && estimate.condition?.damage_type !== "No visible damage") {
        const damageType = estimate.condition.damage_type.toLowerCase();
        const laborEntry = laborData.find(entry => entry.type.toLowerCase() === damageType) || { rate_per_sqft: 15, hours: 1, confidence: 1 };
        const severityMultiplier = { None: 0, Low: 1, Moderate: 2, Severe: 3 }[estimate.condition.severity] || 1;
        laborCost = (laborEntry.rate_per_sqft || 0) * sqFt * laborEntry.hours * severityMultiplier * (laborEntry.confidence || 1);
        console.log("Repair labor cost:", laborCost);
    } else {
        const laborEntry = laborData.find(entry => projectScope.includes(entry.type.toLowerCase())) || { rate_per_sqft: 15, hours: 1, confidence: 1 };
        laborCost = ((laborEntry.rate_per_sqft || 0) * sqFt + (laborEntry.rate_per_unit || 0) * units) * laborEntry.hours * (laborEntry.confidence || 1);
        console.log("Installation labor cost:", laborCost);
    }

    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        const featureLower = feature.toLowerCase();
        const laborEntry = laborData.find(entry => featureLower.includes(entry.type.toLowerCase())) || { rate_per_unit: 0, rate_per_linear_ft: 0, rate_per_sqft: 0, confidence: 1 };
        const confidence = laborEntry.confidence || 1;
        if (laborEntry.rate_per_unit) return sum + laborEntry.rate_per_unit * confidence;
        if (laborEntry.rate_per_linear_ft) return sum + (laborEntry.rate_per_linear_ft * sqFt * confidence);
        return sum + (laborEntry.rate_per_sqft * sqFt * confidence || 0);
    }, 0);
    console.log("Features cost:", featuresCost);

    const totalCost = materialCostWithMargin + laborCost + featuresCost;
    const result = {
        materialCost: `$${materialCostWithMargin.toFixed(2)}`,
        laborCost: { total: `$${laborCost.toFixed(2)}` },
        additionalFeaturesCost: `$${featuresCost.toFixed(2)}`,
        totalCost: `$${totalCost.toFixed(2)}`,
    };
    console.log("Cost estimate result:", result);
    return result;
}

// Error Middleware
app.use((err, req, res, next) => {
    logError(`Unhandled error in ${req.method} ${req.path}`, err, req);
    res.status(err.status || 500).json({ error: "Internal server error", details: err.message });
});

// Startup and Shutdown
async function startServer() {
    try {
        console.log("Starting server initialization");
        await Promise.all([loadLaborData(), loadMaterialsData(), connectToMongoDB()]);
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    } catch (err) {
        logError("Server startup failed", err);
        process.exit(1);
    }
}

process.on("SIGINT", async () => {
    try {
        if (mongoClient) await mongoClient.close();
        console.log("MongoDB connection closed");
        cache.flushAll();
        console.log("Cache cleared");
        process.exit(0);
    } catch (err) {
        logError("Shutdown error", err);
        process.exit(1);
    }
});

startServer();
