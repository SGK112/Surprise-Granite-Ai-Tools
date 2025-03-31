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
const nodemailer = require("nodemailer");
const NodeCache = require("node-cache");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const pdfParse = require("pdf-parse");

const app = express();
const PORT = process.env.PORT || 10000;
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";

app.set("trust proxy", 1);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "application/pdf", "text/plain"];
        cb(null, allowedTypes.includes(file.mimetype));
    }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const cache = new NodeCache({ stdTTL: 7200, checkperiod: 300 });

let laborData = [];
let materialsData = [];
let db = null;
let mongoClient;

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

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
            { type: "countertop_installation", rate_per_sqft: 20, hours: 1, confidence: 1 },
            { type: "tile_installation", rate_per_sqft: 12, hours: 1.5, confidence: 1 },
            { type: "cabinet_installation", rate_per_unit: 75, hours: 2, confidence: 1 },
            { type: "demolition", rate_per_sqft: 5, hours: 0.5, confidence: 1 },
            { type: "sink cutout", rate_per_sqft: 10, hours: 0.5, confidence: 1 },
            { type: "shower remodel", rate_per_sqft: 12, hours: 1.5, confidence: 1 },
            { type: "grab bar installation", rate_per_sqft: 5, hours: 0.5, confidence: 1 }
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
            { type: "Wood (Cabinet)", cost_per_unit: 100, confidence: 1 },
            { type: "Acrylic or Fiberglass", cost_per_sqft: 20, confidence: 1 },
            { type: "Tile", cost_per_sqft: 15, confidence: 1 }
        ];
    }
}

async function connectToMongoDB() {
    if (!process.env.MONGODB_URI) {
        console.warn("MONGODB_URI not set; skipping MongoDB connection.");
        return;
    }
    try {
        mongoClient = new MongoClient(process.env.MONGODB_URI, {
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
        db = null;
    }
}

async function ensureMongoDBConnection() {
    if (!db && process.env.MONGODB_URI) await connectToMongoDB();
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

async function extractFileContent(file) {
    try {
        if (file.mimetype.startsWith("image/")) {
            return { type: "image", content: file.buffer.toString("base64") };
        } else if (file.mimetype === "application/pdf") {
            const data = await pdfParse(file.buffer);
            return { type: "text", content: data.text };
        } else if (file.mimetype === "text/plain") {
            return { type: "text", content: file.buffer.toString("utf8") };
        }
        throwError("Unsupported file type", 400);
    } catch (err) {
        logError("Error extracting file content", err);
        throw err;
    }
}

function extractDimensionsFromNeeds(customerNeeds) {
    const dimensionMatch = customerNeeds.match(/(\d+\.?\d*)\s*(?:x|by|\*)\s*(\d+\.?\d*)/i);
    if (dimensionMatch) {
        const [_, width, length] = dimensionMatch;
        const sqFt = parseFloat(width) * parseFloat(length);
        return `${sqFt.toFixed(2)} sq ft`;
    }
    const sqFtMatch = customerNeeds.match(/(\d+\.?\d*)\s*(?:sq\s*ft|sft|square\s*feet)/i);
    if (sqFtMatch) {
        return `${parseFloat(sqFtMatch[1]).toFixed(2)} sq ft`;
    }
    return null;
}

async function estimateProject(fileData, customerNeeds) {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = db?.collection("countertop_images") || { find: () => ({ sort: () => ({ limit: () => ({ allowDiskUse: () => ({ toArray: async () => [] }) }) }) }) };
        const pastEstimates = await imagesCollection
            .find({ "metadata.estimate.material_type": { $exists: true } })
            .sort({ "metadata.uploadDate": -1 })
            .limit(3)
            .allowDiskUse(true)
            .toArray();
        console.log("Fetched past estimates:", pastEstimates.length);

        const pastData = pastEstimates.map(img => {
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
        - Project scope (e.g., "countertop installation", "repair", "shower remodel")
        - Material type (e.g., "Quartz", "Tile")
        - Color and pattern
        - Dimensions (extract from image or needs; if unclear, estimate realistically: 25 sq ft for countertops, 48 sq ft for showers, 5 units for cabinets, 100 sq ft for flooring)
        - Additional features (array, e.g., ["sink cutout"])
        - Condition (for repairs, { damage_type, severity })
        - Solutions (detailed, modern techniques)
        - Reasoning (explain estimate, including dimension assumptions)

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

        let result;
        try {
            result = JSON.parse(response.choices[0].message.content || '{}');
        } catch (parseErr) {
            logError("Failed to parse OpenAI response", parseErr);
            result = {};
        }

        const extractedDimensions = extractDimensionsFromNeeds(customerNeeds);
        const isShower = customerNeeds.toLowerCase().includes("shower") || result.project_scope?.toLowerCase().includes("shower");

        const estimate = {
            project_scope: typeof result.project_scope === "string" ? result.project_scope : "Replacement",
            material_type: typeof result.material_type === "string" ? result.material_type : "Unknown",
            color_and_pattern: typeof result.color_and_pattern === "string" ? result.color_and_pattern : "Not identified",
            dimensions: extractedDimensions || (typeof result.dimensions === "string" ? result.dimensions : (isShower ? "48 sq ft (assumed)" : "25 sq ft (assumed)")),
            additional_features: Array.isArray(result.additional_features) ? result.additional_features : [],
            condition: result.condition && typeof result.condition === "object" ? result.condition : { damage_type: "No visible damage", severity: "None" },
            solutions: typeof result.solutions === "string" ? result.solutions : "Contact for professional evaluation.",
            reasoning: typeof result.reasoning === "string" ? result.reasoning : "Based on default assumptions."
        };
        console.log("Generated estimate:", JSON.stringify(estimate, null, 2));
        return estimate;
    } catch (err) {
        logError("Estimate generation failed", err);
        const isShower = customerNeeds.toLowerCase().includes("shower");
        const assumedDimensions = isShower ? "48 sq ft (assumed)" : "25 sq ft (assumed)";
        const fallbackEstimate = {
            project_scope: "Replacement",
            material_type: "Unknown",
            color_and_pattern: "Not identified",
            dimensions: assumedDimensions,
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: "Contact for professional evaluation.",
            reasoning: `Estimate failed: ${err.message}. Assumed default dimensions based on context.`
        };
        console.log("Fallback estimate:", JSON.stringify(fallbackEstimate, null, 2));
        return fallbackEstimate;
    }
}

function enhanceCostEstimate(estimate) {
    if (!estimate || typeof estimate !== "object" || !laborData.length || !materialsData.length) {
        logError("Invalid inputs in enhanceCostEstimate", { laborData, materialsData, estimate });
        return null;
    }

    const materialType = typeof estimate.material_type === "string" ? estimate.material_type : "Unknown";
    const projectScope = typeof estimate.project_scope === "string" ? estimate.project_scope : "replacement";
    console.log("Enhancing cost estimate for:", { materialType, projectScope });

    const dimensions = typeof estimate.dimensions === "string" ? estimate.dimensions : "25 sq ft";
    const sqFtMatch = dimensions.match(/(\d+\.?\d*)-?(\d+\.?\d*)?\s*sq\s*ft/i);
    const unitMatch = dimensions.match(/(\d+\.?\d*)\s*units?/i);
    const sqFt = sqFtMatch ? (sqFtMatch[2] ? (parseFloat(sqFtMatch[1]) + parseFloat(sqFtMatch[2])) / 2 : parseFloat(sqFtMatch[1])) : 25;
    const units = unitMatch ? parseFloat(unitMatch[1]) : 0;
    console.log(`Calculated sq ft: ${sqFt}, units: ${units}`);

    // Material cost
    const material = materialsData.find(m => (m.type || "").toLowerCase() === materialType.toLowerCase()) || { cost_per_sqft: 50, cost_per_unit: 0, confidence: 1 };
    const materialCost = ((material.cost_per_sqft || 0) * sqFt + (material.cost_per_unit || 0) * units) * 1.3;

    // Labor cost
    const laborEntry = laborData.find(entry => (entry.type || "").toLowerCase() === projectScope.toLowerCase()) || 
                      laborData.find(entry => projectScope.toLowerCase().includes((entry.type || "").toLowerCase())) || 
                      { rate_per_sqft: 15, hours: 1, confidence: 1 };
    console.log("Selected labor entry:", laborEntry);
    const laborCost = (laborEntry.rate_per_sqft || 0) * sqFt * (laborEntry.hours || 1) * (laborEntry.confidence || 1);
    
    if (projectScope.toLowerCase().includes("repair") && estimate.condition?.damage_type && estimate.condition.damage_type !== "No visible damage") {
        const damageType = typeof estimate.condition.damage_type === "string" ? estimate.condition.damage_type : "";
        const repairLaborEntry = laborData.find(entry => (entry.type || "").toLowerCase() === damageType.toLowerCase()) || laborEntry;
        const severityMultiplier = { None: 0, Low: 1, Moderate: 2, Severe: 3 }[estimate.condition.severity || "None"] || 1;
        laborCost = (repairLaborEntry.rate_per_sqft || 0) * sqFt * (repairLaborEntry.hours || 1) * severityMultiplier * (repairLaborEntry.confidence || 1);
    }

    // Features cost
    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        const featureStr = typeof feature === "string" ? feature.toLowerCase() : "";
        const featureLaborEntry = laborData.find(entry => (entry.type || "").toLowerCase() === featureStr) || 
                                 laborData.find(entry => featureStr.includes((entry.type || "").toLowerCase())) || 
                                 { rate_per_sqft: 0, hours: 1, confidence: 1 };
        const featureCost = (featureLaborEntry.rate_per_sqft || 0) * sqFt * (featureLaborEntry.hours || 1) * (featureLaborEntry.confidence || 1);
        console.log(`Feature "${featureStr}" cost: $${featureCost}, using entry:`, featureLaborEntry);
        return sum + featureCost;
    }, 0);

    const totalCost = materialCost + laborCost + featuresCost;
    const costEstimate = {
        materialCost: `$${materialCost.toFixed(2)}`,
        laborCost: { total: `$${laborCost.toFixed(2)}` },
        additionalFeaturesCost: `$${featuresCost.toFixed(2)}`,
        totalCost: `$${totalCost.toFixed(2)}`
    };
    console.log("Cost estimate generated:", JSON.stringify(costEstimate, null, 2));
    return costEstimate;
}

async function generateTTS(estimate, customerNeeds) {
    if (!estimate || typeof estimate !== "object") {
        logError("Invalid estimate object in generateTTS", estimate);
        return Buffer.from(`Estimate unavailable. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for details.`);
    }
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
        Features: ${estimate.additional_features?.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition?.damage_type || "No visible damage"}, ${estimate.condition?.severity || "None"}. 
        Total cost: ${costEstimate.totalCost || "Contact for estimate"}. 
        Solutions: ${estimate.solutions || "Contact for evaluation"}. 
        ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
        Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a full evaluation.`;
    const chunks = chunkText(narrationText, 4096);

    try {
        const audioBuffers = await Promise.all(chunks.map(chunk =>
            withRetry(async () => {
                const response = await openai.audio.speech.create({
                    model: "tts-1",
                    voice: "alloy",
                    input: chunk,
                });
                const arrayBuffer = await response.arrayBuffer();
                return Buffer.from(arrayBuffer);
            })
        ));
        return Buffer.concat(audioBuffers);
    } catch (err) {
        logError("TTS generation failed", err);
        return Buffer.from(`Error generating audio: ${err.message}. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`);
    }
}

function chunkText(text, maxLength) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.slice(i, i + maxLength));
    }
    return chunks;
}

app.get("/", (req, res) => {
    res.status(200).send("CARI Server is running");
});

app.get("/api/health", async (req, res) => {
    const health = {
        status: "Server is running",
        port: PORT,
        dbStatus: db ? "Connected" : "Disconnected",
        openaiStatus: "Unknown",
        emailStatus: "Unknown",
        pdfParseStatus: "Available"
    };
    try {
        await openai.models.list();
        health.openaiStatus = "Connected";
    } catch (err) {
        logError("OpenAI health check failed", err);
        health.openaiStatus = "Disconnected";
    }
    try {
        console.log("Nodemailer credentials - USER:", process.env.EMAIL_USER ? "Set" : "Not set", "PASS:", process.env.EMAIL_PASS ? "Set" : "Not set");
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) throw new Error("Email credentials not configured");
        await transporter.verify();
        health.emailStatus = "Connected";
    } catch (err) {
        logError("Email health check failed", err);
        health.emailStatus = "Disconnected";
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

        const imagesCollection = db?.collection("countertop_images");
        if (imagesCollection) {
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
        } else {
            console.warn("MongoDB not available; skipping image storage.");
            estimate.imageId = null;
        }

        const costEstimate = enhanceCostEstimate(estimate) || {
            materialCost: "Contact for estimate",
            laborCost: { total: "Contact for estimate" },
            additionalFeaturesCost: "$0",
            totalCost: "Contact for estimate"
        };

        const audioBuffer = await generateTTS(estimate, customerNeeds);

        const responseData = {
            imageId: estimate.imageId?.toString() || null,
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
            shareUrl: estimate.imageId ? `${req.protocol}://${req.get("host")}/api/get-countertop/${estimate.imageId}` : null,
            likes: 0,
            dislikes: 0,
        };
        res.status(201).json(responseData);
    } catch (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size exceeds 10MB limit" });
        }
        logError("Error in /api/contractor-estimate", err);
        next(err);
    }
});

app.post("/api/like-countertop/:id", async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        if (!db) throwError("Database not connected", 500);
        const imagesCollection = db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        const newLikes = (countertop.metadata.likes || 0) + 1;
        await imagesCollection.updateOne({ _id: objectId }, { $set: { "metadata.likes": newLikes } });
        console.log(`Liked countertop ${req.params.id}: ${newLikes} likes`);
        res.status(200).json({ message: "Like added", likes: newLikes, dislikes: countertop.metadata.dislikes || 0 });
    } catch (err) {
        logError("Error in /api/like-countertop", err);
        next(err);
    }
});

app.post("/api/dislike-countertop/:id", async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        if (!db) throwError("Database not connected", 500);
        const imagesCollection = db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        const newDislikes = (countertop.metadata.dislikes || 0) + 1;
        await imagesCollection.updateOne({ _id: objectId }, { $set: { "metadata.dislikes": newDislikes } });
        console.log(`Disliked countertop ${req.params.id}: ${newDislikes} dislikes`);
        res.status(200).json({ message: "Dislike added", likes: countertop.metadata.likes || 0, dislikes: newDislikes });
    } catch (err) {
        logError("Error in /api/dislike-countertop", err);
        next(err);
    }
});

app.post("/api/send-email", async (req, res, next) => {
    try {
        const { name, email, phone, message, stone_type, analysis_summary } = req.body;
        if (!name || !email || !message) throwError("Missing required fields: name, email, and message", 400);

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: "recipient@example.com", // Replace with your receiving email
            subject: `New Quote Request from ${name}`,
            text: `
                Name: ${name}
                Email: ${email}
                Phone: ${phone || "Not provided"}
                Message: ${message}
                Stone Type: ${stone_type || "N/A"}
                Analysis Summary: ${analysis_summary || "No estimate provided"}
                Contact Phone: ${SURPRISE_GRANITE_PHONE}
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully from ${email}`);
        res.status(200).json({ message: "Email sent successfully" });
    } catch (err) {
        logError("Error sending email", err);
        res.status(500).json({ error: "Failed to send email", details: err.message });
    }
});

app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || "Unknown server error";
    const details = status === 429 ? "Too many requests. Please wait and try again." : `Call ${SURPRISE_GRANITE_PHONE} if this persists.`;
    logError(`Unhandled error in ${req.method} ${req.path}`, err);
    res.status(status).json({ error: message, details });
});

async function startServer() {
    try {
        console.log("Starting server initialization");
        await Promise.all([loadLaborData(), loadMaterialsData()]);
        await connectToMongoDB();
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    } catch (err) {
        logError("Server startup failed", err);
        app.listen(PORT, () => console.log(`Server running on port ${PORT} with limited functionality`));
    }
}

process.on("SIGINT", async () => {
    try {
        if (mongoClient) await mongoClient.close();
        cache.flushAll();
        console.log("Server shut down gracefully");
        process.exit(0);
    } catch (err) {
        logError("Shutdown error", err);
        process.exit(1);
    }
});

process.on("uncaughtException", (err) => {
    logError("Uncaught Exception", err);
});

process.on("unhandledRejection", (reason, promise) => {
    logError("Unhandled Rejection at", reason);
});

startServer();
