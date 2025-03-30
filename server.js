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

let pdfParse;
try {
    pdfParse = require("pdf-parse");
} catch (err) {
    console.warn("pdf-parse not available; PDF support disabled:", err.message);
}

const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI ||basics || throwConfigError("MONGODB_URI");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || throwConfigError("OPENAI_API_KEY");
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || throwConfigError("EMAILJS_SERVICE_ID");
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || throwConfigError("EMAILJS_TEMPLATE_ID");
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || throwConfigError("EMAILJS_PUBLIC_KEY");
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";

const app = express();
app.set("trust proxy", 1);
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "application/pdf", "text/plain"];
        cb(null, allowedTypes.includes(file.mimetype));
    }
});
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const cache = new NodeCache({ stdTTL: 7200, checkperiod: 300 });

let laborData = [];
let materialsData = [];
let db = null;
let mongoClient;

EmailJS.init({ publicKey: EMAILJS_PUBLIC_KEY });

// Middleware
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, keyGenerator: (req) => req.ip }));
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip}`);
    next();
});

// Utility Functions
function throwConfigError(key) {
    throw new Error(`${key} is required in environment variables`);
}

function throwError(message, status = 500) {
    const err = new Error(message);
    err.status = status;
    throw err;
}

function logError(message, err) {
    console.error(`${message}: ${err?.message || "Unknown error"}`, err?.stack || err);
}

async function loadLaborData() {
    try {
        const laborJsonPath = path.join(__dirname, "data", "labor.json");
        laborData = JSON.parse(await fs.readFile(laborJsonPath, "utf8"));
        console.log("Loaded labor.json:", laborData.length, "entries");
    } catch (err) {
        logError("Failed to load labor.json, using defaults", err);
        laborData = [
            { type: "countertop_installation", rate_per_sqft: 15, hours: 1, confidence: 1 },
            { type: "tile_installation", rate_per_sqft: 12, hours: 1.5, confidence: 1 },
            { type: "cabinet_installation", rate_per_unit: 75, hours: 2, confidence: 1 },
            { type: "demolition", rate_per_sqft: 5, hours: 0.5, confidence: 1 }
        ];
    }
}

async function loadMaterialsData() {
    try {
        const materialsJsonPath = path.join(__dirname, "data", "materials.json");
        materialsData = JSON.parse(await fs.readFile(materialsJsonPath, "utf8"));
        console.log("Loaded materials.json:", materialsData.length, "entries");
    } catch (err) {
        logError("Failed to load materials.json, using defaults", err);
        materialsData = [
            { type: "Granite", cost_per_sqft: 50, confidence: 1 },
            { type: "Quartz", cost_per_sqft: 60, confidence: 1 },
            { type: "Porcelain Tile", cost_per_sqft: 15, confidence: 1 },
            { type: "Wood (Cabinet)", cost_per_unit: 100, confidence: 1 }
        ];
    }
}

async function connectToMongoDB() {
    try {
        mongoClient = new MongoClient(MONGODB_URI, {
            maxPoolSize: 50,
            minPoolSize: 5,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 30000
        });
        await mongoClient.connect();
        db = mongoClient.db("countertops");
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        logError("MongoDB connection failed", err);
        throw err;
    }
}

async function ensureMongoDBConnection() {
    if (!db) await connectToMongoDB();
}

// Routes
app.get("/", (req, res) => {
    res.status(200).send("CARI Server is running");
});

app.get("/api/health", async (req, res) => {
    const health = {
        status: "Server is running",
        port: PORT,
        dbStatus: db ? "Connected" : "Disconnected",
        openaiStatus: "Unknown",
        emailjsStatus: "Unknown",
        pdfParseStatus: pdfParse ? "Available" : "Unavailable"
    };
    try {
        await openai.models.list();
        health.openaiStatus = "Connected";
    } catch (err) {
        health.openaiStatus = "Disconnected";
    }
    try {
        await EmailJS.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, { test: "health" });
        health.emailjsStatus = "Connected";
    } catch (err) {
        health.emailjsStatus = "Disconnected";
    }
    res.json(health);
});

app.post("/api/contractor-estimate", upload.single("file"), async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        if (!req.file) throwError("No file uploaded", 400);

        const fileData = await extractFileContent(req.file);
        const customerNeeds = (req.body.customer_needs || "").trim();
        const fileHash = createHash("sha256").update(fileData.content).digest("hex");
        const cacheKey = `estimate_${fileHash}_${customerNeeds.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '')}`;

        let estimate = cache.get(cacheKey);
        if (!estimate) {
            estimate = await estimateProject(fileData, customerNeeds);
            cache.set(cacheKey, estimate);
        }

        const imagesCollection = db.collection("countertop_images");
        const fileDoc = {
            fileHash,
            fileData: new Binary(req.file.buffer),
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
        const insertResult = await imagesCollection.insertOne(fileDoc);
        estimate.imageId = insertResult.insertedId;

        const costEstimate = enhanceCostEstimate(estimate) || {
            materialCost: "Contact for estimate",
            laborCost: { total: "Contact for estimate" },
            additionalFeaturesCost: "$0",
            totalCost: "Contact for estimate"
        };

        const audioBuffer = await generateTTS(estimate, customerNeeds);

        const responseData = {
            imageId: estimate.imageId.toString(),
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
            contact: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a FREE quote!`,
            audioBase64: audioBuffer.toString("base64"),
            shareUrl: `${req.protocol}://${req.get("host")}/api/get-countertop/${estimate.imageId}`,
            likes: 0,
            dislikes: 0,
        };
        res.status(201).json(responseData);
    } catch (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size exceeds 10MB limit" });
        }
        next(err);
    }
});

// ... (rest of the routes remain unchanged: /api/get-countertop/:id, /api/like-countertop/:id, /api/dislike-countertop/:id, /api/send-email)

function updatePricingConfidence(estimate, adjustment) {
    const material = materialsData.find(m => m.type.toLowerCase() === (estimate.material_type || "").toLowerCase());
    if (material) material.confidence = Math.min(1, Math.max(0, (material.confidence || 1) + adjustment));

    if ((estimate.project_scope || "").toLowerCase() === "repair" && estimate.condition?.damage_type !== "No visible damage") {
        const labor = laborData.find(l => l.type === estimate.condition.damage_type.toLowerCase());
        if (labor) labor.confidence = Math.min(1, Math.max(0, (labor.confidence || 1) + adjustment));
    }
    (estimate.additional_features || []).forEach(feature => {
        const labor = laborData.find(l => feature.toLowerCase().includes(l.type));
        if (labor) labor.confidence = Math.min(1, Math.max(0, (labor.confidence || 1) + adjustment));
    });
}

async function extractFileContent(file) {
    if (file.mimetype.startsWith("image/")) {
        return { type: "image", content: file.buffer.toString("base64") };
    } else if (file.mimetype === "application/pdf" && pdfParse) {
        const data = await pdfParse(file.buffer);
        return { type: "text", content: data.text };
    } else if (file.mimetype === "text/plain") {
        return { type: "text", content: file.buffer.toString("utf8") };
    }
    return { type: "image", content: file.buffer.toString("base64") }; // Fallback to image
}

async function withRetry(fn, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxAttempts || !err.status || err.status < 500) throw err;
            console.log(`Retry ${attempt}/${maxAttempts} after error: ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        }
    }
}

async function estimateProject(fileData, customerNeeds) {
    try {
        await ensureMongoDBConnection();
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
            .limit(5)
            .toArray();

        const pastData = pastEstimates.map(img => ({
            material_type: img.metadata.estimate.material_type || "Unknown",
            project_scope: img.metadata.estimate.project_scope || "Replacement",
            condition: img.metadata.estimate.condition || { damage_type: "No visible damage", severity: "None" },
            additional_features: Array.isArray(img.metadata.estimate.additional_features) ? img.metadata.estimate.additional_features : [],
            solutions: img.metadata.estimate.solutions || "Professional evaluation required",
            cost: enhanceCostEstimate(img.metadata.estimate)?.totalCost || "Contact for estimate",
            likes: img.metadata.likes || 0,
            dislikes: img.metadata.dislikes || 0,
        })).slice(0, 3);

        const prompt = `You are CARI, an expert AI general contractor at Surprise Granite, specializing in remodeling estimates as of March 2025. Analyze this ${fileData.type === "image" ? "image" : "document text"} and customer needs ("${customerNeeds}") with:

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData)}
        - Materials: ${JSON.stringify(materialsData)}

        **Historical Estimates**: ${JSON.stringify(pastData)}

        Estimate:
        - Project scope (e.g., "countertop installation", "repair")
        - Material type (e.g., "Quartz", "Tile")
        - Color and pattern
        - Dimensions (extract from needs or assume: 25 sq ft countertops, 10 sq ft showers, 5 units cabinets, 100 sq ft flooring)
        - Additional features (array, e.g., ["sink cutout"])
        - Condition (for repairs, { damage_type, severity })
        - Solutions (detailed, modern techniques)
        - Reasoning (explain estimate)

        Respond in JSON with: project_scope, material_type, color_and_pattern, dimensions, additional_features, condition, solutions, reasoning.`;

        const messages = [
            { role: "system", content: prompt },
            { role: "user", content: fileData.type === "image" ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileData.content}` } }] : fileData.content }
        ];
        const response = await withRetry(() => openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: 2000,
            temperature: 0.5,
            response_format: { type: "json_object" },
        }));
        const result = JSON.parse(response.choices[0].message.content);
        return {
            project_scope: result.project_scope || "Replacement",
            material_type: result.material_type || "Unknown",
            color_and_pattern: result.color_and_pattern || "Not identified",
            dimensions: result.dimensions || "25 sq ft (assumed)",
            additional_features: Array.isArray(result.additional_features) ? result.additional_features : [],
            condition: result.condition || { damage_type: "No visible damage", severity: "None" },
            solutions: result.solutions || "Contact for professional evaluation.",
            reasoning: result.reasoning || "Based on default assumptions."
        };
    } catch (err) {
        logError("Estimate generation failed", err);
        return {
            project_scope: "Replacement",
            material_type: "Unknown",
            color_and_pattern: "Not identified",
            dimensions: customerNeeds.includes("cabinet") ? "5 units (assumed)" : "25 sq ft (assumed)",
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: "Contact for professional evaluation.",
            reasoning: `Estimate failed: ${err.message}.`
        };
    }
}

async function generateTTS(estimate, customerNeeds) {
    const costEstimate = enhanceCostEstimate(estimate) || {
        materialCost: "Contact for estimate",
        laborCost: { total: "Contact for estimate" },
        additionalFeaturesCost: "$0",
        totalCost: "Contact for estimate"
    };
    const narrationText = `Your Surprise Granite estimate: 
        Project: ${estimate.project_scope || "Replacement"}. 
        Material: ${estimate.material_type || "Unknown"}. 
        Dimensions: ${estimate.dimensions || "Not specified"}. 
        Features: ${estimate.additional_features.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition?.damage_type || "No visible damage"}, ${estimate.condition?.severity || "None"}. 
        Total cost: ${costEstimate.totalCost || "Contact for estimate"}. 
        Solutions: ${estimate.solutions}. 
        ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
        Call ${SURPRISE_GRANITE_PHONE} NOW for your FREE quote!`;
    const chunks = chunkText(narrationText, 4096);

    try {
        const audioBuffers = await Promise.all(chunks.map(chunk =>
            withRetry(() => openai.audio.speech.create({
                model: "tts-1",
                voice: "alloy",
                input: chunk,
            }))
        ));
        return Buffer.concat(await Promise.all(audioBuffers.map(res => res.arrayBuffer())));
    } catch (err) {
        logError("TTS generation failed", err);
        return Buffer.from(`Estimate available! Call ${SURPRISE_GRANITE_PHONE} for details and your FREE quote!`);
    }
}

function chunkText(text, maxLength) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.slice(i, i + maxLength));
    }
    return chunks;
}

function enhanceCostEstimate(estimate) {
    if (!laborData.length || !materialsData.length || !estimate) return null;

    const dimensions = estimate.dimensions || "25 sq ft";
    const sqFtMatch = dimensions.match(/(\d+)-?(\d+)?\s*sq\s*ft/i);
    const unitMatch = dimensions.match(/(\d+)\s*units?/i);
    let sqFt = sqFtMatch ? (sqFtMatch[2] ? (parseInt(sqFtMatch[1], 10) + parseInt(sqFtMatch[2], 10)) / 2 : parseInt(sqFtMatch[1], 10)) : 25;
    let units = unitMatch ? parseInt(unitMatch[1], 10) : 0;

    const material = materialsData.find(m => m.type.toLowerCase() === (estimate.material_type || "").toLowerCase()) || { cost_per_sqft: 50, cost_per_unit: 0, confidence: 1 };
    const materialCost = ((material.cost_per_sqft || 0) * sqFt + (material.cost_per_unit || 0) * units) * 1.3;

    let laborCost = 0;
    const projectScope = (estimate.project_scope || "replacement").toLowerCase();
    if (projectScope.includes("repair") && estimate.condition?.damage_type !== "No visible damage") {
        const laborEntry = laborData.find(entry => entry.type.toLowerCase() === estimate.condition.damage_type.toLowerCase()) || { rate_per_sqft: 15, hours: 1, confidence: 1 };
        const severityMultiplier = { None: 0, Low: 1, Moderate: 2, Severe: 3 }[estimate.condition.severity] || 1;
        laborCost = (laborEntry.rate_per_sqft || 0) * sqFt * laborEntry.hours * severityMultiplier * (laborEntry.confidence || 1);
    } else {
        const laborEntry = laborData.find(entry => projectScope.includes(entry.type.toLowerCase())) || { rate_per_sqft: 15, rate_per_unit: 0, hours: 1, confidence: 1 };
        laborCost = ((laborEntry.rate_per_sqft || 0) * sqFt + (laborEntry.rate_per_unit || 0) * units) * laborEntry.hours * (laborEntry.confidence || 1);
    }

    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        const laborEntry = laborData.find(entry => feature.toLowerCase().includes(entry.type.toLowerCase())) || { rate_per_sqft: 0, confidence: 1 };
        return sum + (laborEntry.rate_per_sqft * sqFt * (laborEntry.confidence || 1) || 0);
    }, 0);

    const totalCost = materialCost + laborCost + featuresCost;
    return {
        materialCost: `$${materialCost.toFixed(2)}`,
        laborCost: { total: `$${laborCost.toFixed(2)}` },
        additionalFeaturesCost: `$${featuresCost.toFixed(2)}`,
        totalCost: `$${totalCost.toFixed(2)}`
    };
}

// Error Middleware
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || "Unknown server error";
    const details = status === 429 ? "Too many requests. Please wait and try again." : `Call ${SURPRISE_GRANITE_PHONE} if this persists.`;
    logError(`Unhandled error in ${req.method} ${req.path}`, err);
    res.status(status).json({ error: message, details });
});

// Startup and Shutdown
async function startServer() {
    try {
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
        cache.flushAll();
        process.exit(0);
    } catch (err) {
        logError("Shutdown error", err);
        process.exit(1);
    }
});

startServer();
