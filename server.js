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
const pdfParse = require("pdf-parse");

const CONFIG = {
    PORT: process.env.PORT || 10000,
    MAX_FILE_SIZE: process.env.MAX_FILE_SIZE || 10 * 1024 * 1024,
    CACHE_TTL: process.env.CACHE_TTL || 7200,
    CACHE_CHECK_PERIOD: process.env.CACHE_CHECK_PERIOD || 300,
    REQUEST_TIMEOUT: process.env.REQUEST_TIMEOUT || 30000,
    BODY_LIMIT: process.env.BODY_LIMIT || "10mb",
    DB_POOL: {
        max: process.env.DB_POOL_MAX || 50,
        min: process.env.DB_POOL_MIN || 5,
    },
    MONGODB_URI: process.env.MONGODB_URI || throwConfigError("MONGODB_URI"),
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || throwConfigError("OPENAI_API_KEY"),
    EMAILJS_SERVICE_ID: process.env.EMAILJS_SERVICE_ID || throwConfigError("EMAILJS_SERVICE_ID"),
    EMAILJS_TEMPLATE_ID: process.env.EMAILJS_TEMPLATE_ID || throwConfigError("EMAILJS_TEMPLATE_ID"),
    EMAILJS_PUBLIC_KEY: process.env.EMAILJS_PUBLIC_KEY || throwConfigError("EMAILJS_PUBLIC_KEY"),
    SURPRISE_GRANITE_PHONE: process.env.SURPRISE_GRANITE_PHONE || "(602) 833-3189",
};

const app = express();
app.set("trust proxy", 1);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CONFIG.MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "application/pdf", "text/plain"];
        cb(null, allowedTypes.includes(file.mimetype));
    },
});

const openai = new OpenAI({ apiKey: CONFIG.OPENAI_API_KEY });
const cache = new NodeCache({ stdTTL: CONFIG.CACHE_TTL, checkperiod: CONFIG.CACHE_CHECK_PERIOD });

let laborData = [];
let materialsData = [];
let db = null;
let mongoClient;

EmailJS.init({ publicKey: CONFIG.EMAILJS_PUBLIC_KEY });

// Middleware
app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: CONFIG.BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: CONFIG.BODY_LIMIT }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, keyGenerator: (req) => req.ip }));
app.use((req, res, next) => {
    req.setTimeout(CONFIG.REQUEST_TIMEOUT);
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
        const data = await fs.readFile(laborJsonPath, "utf8");
        laborData = JSON.parse(data || "[]");
        console.log("Loaded labor.json:", laborData.length, "entries");
    } catch (err) {
        logError("Failed to load labor.json", err);
        if (err.code === "ENOENT") {
            console.warn("labor.json not found, using defaults");
        }
        laborData = [
            { type: "countertop_installation", rate_per_sqft: 15, hours: 1, confidence: 1 },
            { type: "tile_installation", rate_per_sqft: 12, hours: 1.5, confidence: 1 },
            { type: "cabinet_installation", rate_per_unit: 75, hours: 2, confidence: 1 },
            { type: "demolition", rate_per_sqft: 5, hours: 0.5, confidence: 1 },
        ];
    }
}

async function loadMaterialsData() {
    try {
        const materialsJsonPath = path.join(__dirname, "data", "materials.json");
        const data = await fs.readFile(materialsJsonPath, "utf8");
        materialsData = JSON.parse(data || "[]");
        console.log("Loaded materials.json:", materialsData.length, "entries");
    } catch (err) {
        logError("Failed to load materials.json", err);
        if (err.code === "ENOENT") {
            console.warn("materials.json not found, using defaults");
        }
        materialsData = [
            { type: "Granite", cost_per_sqft: 50, confidence: 1 },
            { type: "Quartz", cost_per_sqft: 60, confidence: 1 },
            { type: "Porcelain Tile", cost_per_sqft: 15, confidence: 1 },
            { type: "Wood (Cabinet)", cost_per_unit: 100, confidence: 1 },
            { type: "Acrylic or Fiberglass", cost_per_sqft: 20, confidence: 1 },
        ];
    }
}

async function connectToMongoDB() {
    try {
        mongoClient = new MongoClient(CONFIG.MONGODB_URI, {
            maxPoolSize: CONFIG.DB_POOL.max,
            minPoolSize: CONFIG.DB_POOL.min,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 30000,
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
        port: CONFIG.PORT,
        dbStatus: db ? "Connected" : "Disconnected",
        openaiStatus: "Unknown",
        emailjsStatus: "Unknown",
        pdfParseStatus: "Available",
    };
    try {
        await openai.models.list();
        health.openaiStatus = "Connected";
    } catch (err) {
        health.openaiStatus = "Disconnected";
    }
    try {
        await EmailJS.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_TEMPLATE_ID, { test: "health" });
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
        const cacheKey = `estimate_${fileHash}_${customerNeeds.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "")}`;

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
            totalCost: "Contact for estimate",
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
            contact: `Contact Surprise Granite at ${CONFIG.SURPRISE_GRANITE_PHONE} for a full evaluation.`,
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

app.get("/api/get-countertop/:id", async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        res.json({
            id: countertop._id.toString(),
            fileBase64: countertop.fileData.buffer.toString("base64"),
            metadata: {
                ...countertop.metadata.estimate,
                likes: countertop.metadata.likes || 0,
                dislikes: countertop.metadata.dislikes || 0,
                shareDescription: `Estimate: ${countertop.metadata.estimate.material_type || "Unknown"}, ${countertop.metadata.estimate.project_scope || "Project"}. Total: ${enhanceCostEstimate(countertop.metadata.estimate)?.totalCost || "Contact for estimate"}`,
                shareUrl: `${req.protocol}://${req.get("host")}/api/get-countertop/${countertop._id}`,
            },
        });
    } catch (err) {
        next(err);
    }
});

app.post("/api/like-countertop/:id", async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        const newLikes = (countertop.metadata.likes || 0) + 1;
        await imagesCollection.updateOne({ _id: objectId }, { $set: { "metadata.likes": newLikes } });
        updatePricingConfidence(countertop.metadata.estimate, 0.05);
        res.status(200).json({ message: "Like added", likes: newLikes, dislikes: countertop.metadata.dislikes || 0 });
    } catch (err) {
        next(err);
    }
});

app.post("/api/dislike-countertop/:id", async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        const newDislikes = (countertop.metadata.dislikes || 0) + 1;
        await imagesCollection.updateOne({ _id: objectId }, { $set: { "metadata.dislikes": newDislikes } });
        updatePricingConfidence(countertop.metadata.estimate, -0.05);
        res.status(200).json({ message: "Dislike added", likes: countertop.metadata.likes || 0, dislikes: newDislikes });
    } catch (err) {
        next(err);
    }
});

app.post("/api/send-email", async (req, res, next) => {
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
            contact_phone: CONFIG.SURPRISE_GRANITE_PHONE,
        };

        const emailResponse = await EmailJS.send(CONFIG.EMAILJS_SERVICE_ID, CONFIG.EMAILJS_TEMPLATE_ID, templateParams);
        res.status(200).json({ message: "Email sent successfully", emailResponse });
    } catch (err) {
        logError("Error sending email", err);
        res.status(err.status || 500).json({
            error: "Failed to send email",
            details: err.message || "Unknown error",
            emailjsError: err.response?.data || "No additional error details",
        });
    }
});

// Learning and Analysis Functions
function updatePricingConfidence(estimate, adjustment) {
    if (!estimate || typeof estimate !== "object") {
        console.warn("Invalid estimate object in updatePricingConfidence:", estimate);
        return;
    }
    const materialType = typeof estimate.material_type === "string" ? estimate.material_type : "Unknown";
    const material = materialsData.find((m) => m.type.toLowerCase() === materialType.toLowerCase());
    if (material) material.confidence = Math.min(1, Math.max(0, (material.confidence || 1) + adjustment));

    const projectScope = typeof estimate.project_scope === "string" ? estimate.project_scope : "replacement";
    if (projectScope.toLowerCase() === "repair" && estimate.condition?.damage_type && estimate.condition.damage_type !== "No visible damage") {
        const labor = laborData.find((l) => l.type.toLowerCase() === (estimate.condition.damage_type || "").toLowerCase());
        if (labor) labor.confidence = Math.min(1, Math.max(0, (labor.confidence || 1) + adjustment));
    }
    (estimate.additional_features || []).forEach((feature) => {
        const labor = laborData.find((l) => (feature || "").toLowerCase().includes(l.type.toLowerCase()));
        if (labor) labor.confidence = Math.min(1, Math.max(0, (labor.confidence || 1) + adjustment));
    });
}

async function extractFileContent(file) {
    if (file.mimetype.startsWith("image/")) {
        return { type: "image", content: file.buffer.toString("base64") };
    } else if (file.mimetype === "application/pdf") {
        const data = await pdfParse(file.buffer);
        return { type: "text", content: data.text };
    } else if (file.mimetype === "text/plain") {
        return { type: "text", content: file.buffer.toString("utf8") };
    }
    throwError("Unsupported file type", 400);
}

async function withRetry(fn, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxAttempts || !err.status || err.status < 500) throw err;
            console.log(`Retry ${attempt}/${maxAttempts} after error: ${err.message}`);
            await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        }
    }
}

async function estimateProject(fileData, customerNeeds) {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = db.collection("countertop_images");
        const pastEstimates = await imagesCollection
            .find({ "metadata.estimate.material_type": { $exists: true } })
            .sort({ "metadata.uploadDate": -1 })
            .limit(3)
            .allowDiskUse(true)
            .toArray();
        console.log("Fetched past estimates:", pastEstimates.length);

        const pastData = pastEstimates.map((img) => {
            const estimate = img.metadata?.estimate || {};
            return {
                material_type: typeof estimate.material_type === "string" ? estimate.material_type : "Unknown",
                project_scope: typeof estimate.project_scope === "string" ? estimate.project_scope : "Replacement",
                condition: estimate.condition || { damage_type: "No visible damage", severity: "None" },
                additional_features: Array.isArray(estimate.additional_features) ? estimate.additional_features : [],
                solutions: typeof estimate.solutions === "string" ? estimate.solutions : "Professional evaluation required",
                cost: enhanceCostEstimate(estimate)?.totalCost || "Contact for estimate",
                likes: img.metadata.likes || 0,
                dislikes: img.metadata.dislikes || 0,
            };
        });

        const prompt = `You are CARI, an expert AI general contractor at Surprise Granite, specializing in remodeling estimates as of March 2025. Analyze this ${fileData.type === "image" ? "image" : "document text"} and customer needs ("${customerNeeds}") with:

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData.slice(0, 10))} (limited sample)
        - Materials: ${JSON.stringify(materialsData.slice(0, 10))} (limited sample)

        **Historical Estimates (sample)**: ${JSON.stringify(pastData)}

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
            { role: "user", content: fileData.type === "image" ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileData.content}` } }] : fileData.content },
        ];
        const response = await withRetry(() =>
            openai.chat.completions.create({
                model: "gpt-4o",
                messages,
                max_tokens: 2000,
                temperature: 0.5,
                response_format: { type: "json_object" },
            })
        );

        const result = JSON.parse(response.choices[0].message.content || "{}");
        return {
            project_scope: typeof result.project_scope === "string" ? result.project_scope : "Replacement",
            material_type: typeof result.material_type === "string" ? result.material_type : "Unknown",
            color_and_pattern: typeof result.color_and_pattern === "string" ? result.color_and_pattern : "Not identified",
            dimensions: typeof result.dimensions === "string" ? result.dimensions : (customerNeeds.includes("shower") ? "10 sq ft (assumed)" : "25 sq ft (assumed)"),
            additional_features: Array.isArray(result.additional_features) ? result.additional_features : [],
            condition: result.condition || { damage_type: "No visible damage", severity: "None" },
            solutions: typeof result.solutions === "string" ? result.solutions : "Contact for professional evaluation.",
            reasoning: typeof result.reasoning === "string" ? result.reasoning : "Based on default assumptions.",
        };
    } catch (err) {
        logError("Estimate generation failed", err);
        const assumedDimensions = customerNeeds.includes("shower") ? "10 sq ft (assumed)" : "25 sq ft (assumed)";
        return {
            project_scope: "Replacement",
            material_type: "Unknown",
            color_and_pattern: "Not identified",
            dimensions: assumedDimensions,
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: "Contact for professional evaluation.",
            reasoning: `Estimate failed: ${err.message}. Assumed default dimensions based on context.`,
        };
    }
}

async function generateTTS(estimate, customerNeeds) {
    if (!estimate || typeof estimate !== "object") {
        logError("Invalid estimate object in generateTTS", estimate);
        return Buffer.from(`Estimate unavailable. Contact Surprise Granite at ${CONFIG.SURPRISE_GRANITE_PHONE} for details.`);
    }
    const costEstimate = enhanceCostEstimate(estimate) || {
        materialCost: "Contact for estimate",
        laborCost: { total: "Contact for estimate" },
        additionalFeaturesCost: "$0",
        totalCost: "Contact for estimate",
    };
    const narrationText = `Your Surprise Granite estimate: 
        Project: ${estimate.project_scope || "Replacement"}. 
        Material: ${estimate.material_type || "Unknown"}. 
        Dimensions: ${estimate.dimensions || "Not specified"}. 
        Features: ${estimate.additional_features?.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition?.damage_type || "No visible damage"}, ${estimate.condition?.severity || "None"}. 
        Total cost: ${costEstimate.totalCost || "Contact for estimate"}. 
        Solutions: ${estimate.solutions || "Contact for evaluation"}. 
        ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
        Contact Surprise Granite at ${CONFIG.SURPRISE_GRANITE_PHONE} for a full evaluation.`;
    const chunks = chunkText(narrationText, 4096);

    try {
        const audioBuffers = await Promise.all(
            chunks.map((chunk) =>
                withRetry(() =>
                    openai.audio.speech.create({
                        model: "tts-1",
                        voice: "alloy",
                        input: chunk,
                    })
                )
            )
        );
        return Buffer.concat(await Promise.all(audioBuffers.map((res) => res.arrayBuffer())));
    } catch (err) {
        logError("TTS generation failed", err);
        return Buffer.from(`Error generating audio: ${err.message}. Contact Surprise Granite at ${CONFIG.SURPRISE_GRANITE_PHONE}.`);
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
    if (!laborData.length || !materialsData.length || !estimate || typeof estimate !== "object") {
        logError("Invalid inputs in enhanceCostEstimate", { laborData, materialsData, estimate });
        return null;
    }

    const materialType = typeof estimate.material_type === "string" ? estimate.material_type : "Unknown";
    const dimensions = estimate.dimensions || "25 sq ft";
    const sqFtMatch = dimensions.match(/(\d+)-?(\d+)?\s*sq\s*ft/i);
    const unitMatch = dimensions.match(/(\d+)\s*units?/i);
    let sqFt = sqFtMatch ? (sqFtMatch[2] ? (parseInt(sqFtMatch[1], 10) + parseInt(sqFtMatch[2], 10)) / 2 : parseInt(sqFtMatch[1], 10)) : 25;
    let units = unitMatch ? parseInt(unitMatch[1], 10) : 0;

    const material = materialsData.find((m) => m.type.toLowerCase() === materialType.toLowerCase()) || { cost_per_sqft: 50, cost_per_unit: 0, confidence: 1 };
    const materialCost = ((material.cost_per_sqft || 0) * sqFt + (material.cost_per_unit || 0) * units) * 1.3;

    let laborCost = 0;
    const projectScope = typeof estimate.project_scope === "string" ? estimate.project_scope : "replacement";
    if (projectScope.toLowerCase().includes("repair") && estimate.condition?.damage_type && estimate.condition.damage_type !== "No visible damage") {
        const laborEntry = laborData.find((entry) => entry.type.toLowerCase() === (estimate.condition.damage_type || "").toLowerCase()) || {
            rate_per_sqft: 15,
            hours: 1,
            confidence: 1,
        };
        const severityMultiplier = { None: 0, Low: 1, Moderate: 2, Severe: 3 }[estimate.condition.severity || "None"] || 1;
        laborCost = (laborEntry.rate_per_sqft || 0) * sqFt * laborEntry.hours * severityMultiplier * (laborEntry.confidence || 1);
    } else {
        const laborEntry = laborData.find((entry) => projectScope.toLowerCase().includes(entry.type.toLowerCase())) || {
            rate_per_sqft: 15,
            rate_per_unit: 0,
            hours: 1,
            confidence: 1,
        };
        laborCost = ((laborEntry.rate_per_sqft || 0) * sqFt + (laborEntry.rate_per_unit || 0) * units) * laborEntry.hours * (laborEntry.confidence || 1);
    }

    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        const laborEntry = laborData.find((entry) => (feature || "").toLowerCase().includes(entry.type.toLowerCase())) || { rate_per_sqft: 0, confidence: 1 };
        return sum + (laborEntry.rate_per_sqft * sqFt * (laborEntry.confidence || 1) || 0);
    }, 0);

    const totalCost = materialCost + laborCost + featuresCost;
    return {
        materialCost: `$${materialCost.toFixed(2)}`,
        laborCost: { total: `$${laborCost.toFixed(2)}` },
        additionalFeaturesCost: `$${featuresCost.toFixed(2)}`,
        totalCost: `$${totalCost.toFixed(2)}`,
    };
}

// Error Middleware
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || "Unknown server error";
    const details = status === 429 ? "Too many requests. Please wait and try again." : `Call ${CONFIG.SURPRISE_GRANITE_PHONE} if this persists.`;
    logError(`Unhandled error in ${req.method} ${req.path}`, err);
    res.status(status).json({ error: message, details });
});

// Startup and Shutdown
async function startServer() {
    try {
        console.log("Starting server initialization");
        await Promise.all([loadLaborData(), loadMaterialsData(), connectToMongoDB()]);
        app.listen(CONFIG.PORT, () => console.log(`Server running on port ${CONFIG.PORT}`));
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
