import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { MongoClient, Binary, ObjectId } from "mongodb";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import NodeCache from "node-cache";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import PDFParser from "pdf2json";
import Jimp from "jimp";
import stringSimilarity from "string-similarity";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";

// Ensure temp directory exists
const tempDir = path.join(__dirname, "temp");
await fs.mkdir(tempDir, { recursive: true }).catch(err => console.error("Failed to create temp dir:", err));

// Global Variables
let appState = { db: null, mongoClient: null };
const cache = new NodeCache({ stdTTL: 7200, checkperiod: 300 });
let laborData = [];
let materialsData = [];

// Multer Configuration
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 9 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "application/pdf", "text/plain"];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error("Invalid file type. Allowed: JPEG, PNG, PDF, TXT"), false);
        }
        cb(null, true);
    }
});

// OpenAI Initialization
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

// Email Transporter
const transporter = process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
          service: "gmail",
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      })
    : null;

// Middleware
app.use(compression());
app.use(cors({
    origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000", "https://surprise-granite-connections-dev.onrender.com"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
}));
app.use(helmet({ contentSecurityPolicy: false })); // Simplified for testing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests. Please try again later."
}));

// Request Logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip} - Headers:`, req.headers);
    next();
});

// Helper Functions
function throwError(message, status = 500) {
    const err = new Error(message);
    err.status = status;
    throw err;
}

function logError(message, err) {
    console.error(`[${new Date().toISOString()}] ${message}: ${err?.message || "Unknown error"}`, err?.stack || err);
}

function logMemoryUsage() {
    const used = process.memoryUsage();
    console.log(`[${new Date().toISOString()}] Memory Usage: RSS=${(used.rss / 1024 / 1024).toFixed(2)}MB, HeapTotal=${(used.heapTotal / 1024 / 1024).toFixed(2)}MB, HeapUsed=${(used.heapUsed / 1024 / 1024).toFixed(2)}MB`);
}

async function loadLaborData() {
    try {
        const laborJsonPath = path.join(__dirname, "data", "labor.json");
        const rawData = JSON.parse(await fs.readFile(laborJsonPath, "utf8"));
        laborData = rawData.map(item => ({
            code: item.Code,
            type: item.Service.toLowerCase().replace(/\s+/g, "_"),
            rate_per_sqft: item["U/M"] === "SQFT" ? item.Price : 0,
            rate_per_unit: ["EA", "LF", "Per Job"].includes(item["U/M"]) ? item.Price : 0,
            unit_measure: item["U/M"],
            hours: item["U/M"] === "SQFT" ? 1 : ["EA", "LF", "Per Job"].includes(item["U/M"]) ? 0 : 0.5,
            description: item.Description,
            confidence: 1
        }));
        console.log("Labor data loaded:", laborData.length, "entries");
    } catch (err) {
        logError("Failed to load labor.json", err);
        laborData = [
            { type: "countertop_installation", rate_per_sqft: 20, hours: 1, confidence: 1 },
            { type: "countertop_repair", rate_per_sqft: 15, hours: 0.5, confidence: 1 }
        ];
    }
}

async function loadMaterialsData() {
    try {
        const materialsJsonPath = path.join(__dirname, "data", "materials.json");
        const rawData = JSON.parse(await fs.readFile(materialsJsonPath, "utf8"));
        materialsData = rawData.map(item => ({
            type: item.Material,
            color: item["Color Name"],
            cost_per_sqft: item["Cost/SqFt"],
            thickness: item.Thickness || "N/A",
            vendor: item.Vendor || "Unknown",
            availability: item.Availability || "In Stock",
            confidence: 1
        }));
        console.log("Materials data loaded:", materialsData.length, "entries");
    } catch (err) {
        logError("Failed to load materials.json", err);
        materialsData = [
            { type: "Granite", color: "Generic", cost_per_sqft: 50, thickness: "N/A", vendor: "Unknown", availability: "In Stock", confidence: 1 },
            { type: "Quartz", color: "Generic", cost_per_sqft: 60, thickness: "N/A", vendor: "Unknown", availability: "In Stock", confidence: 1 }
        ];
    }
}

async function connectToMongoDB() {
    if (!process.env.MONGODB_URI) {
        console.warn("MONGODB_URI not set; running without MongoDB");
        return;
    }
    try {
        appState.mongoClient = new MongoClient(process.env.MONGODB_URI, {
            maxPoolSize: 50,
            minPoolSize: 2,
            connectTimeoutMS: 3000,
            socketTimeoutMS: 10000
        });
        await appState.mongoClient.connect();
        appState.db = appState.mongoClient.db("countertops");
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        logError("MongoDB connection failed", err);
        appState.db = null;
    }
}

async function ensureMongoDBConnection() {
    if (!appState.db && process.env.MONGODB_URI) await connectToMongoDB();
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
            const image = await Jimp.read(file.buffer);
            image.resize(100, Jimp.AUTO);
            const dominantColor = image.getPixelColor(Math.floor(image.bitmap.width / 2), Math.floor(image.bitmap.height / 2));
            const { r, g, b } = Jimp.intToRGBA(dominantColor);
            return {
                type: "image",
                content: (await image.getBase64Async(Jimp.MIME_JPEG)).split(",")[1],
                color: { r, g, b, hex: `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}` }
            };
        } else if (file.mimetype === "application/pdf") {
            const pdfParser = new PDFParser();
            return new Promise((resolve, reject) => {
                pdfParser.on("pdfParser_dataError", errData => reject(new Error(errData.parserError)));
                pdfParser.on("pdfParser_dataReady", pdfData => {
                    const text = pdfData.Pages.map(page => 
                        page.Texts.map(text => decodeURIComponent(text.R[0].T)).join(" ")
                    ).join("\n");
                    resolve({ type: "text", content: text });
                });
                pdfParser.parseBuffer(file.buffer);
            });
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
        return `${sqFt.toFixed(2)} Square Feet`;
    }
    const sqFtMatch = customerNeeds.match(/(\d+\.?\d*)\s*(?:sq\s*ft|sft|square\s*feet)/i);
    if (sqFtMatch) {
        return `${parseFloat(sqFtMatch[1]).toFixed(2)} Square Feet`;
    }
    return null;
}

async function estimateProject(fileDataArray, customerNeeds) {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = appState.db?.collection("countertop_images") || {
            find: () => ({ sort: () => ({ limit: () => ({ allowDiskUse: () => ({ toArray: async () => [] }) }) }) })
        };
        const pastEstimates = await imagesCollection
            .find({ "metadata.estimate.material_type": { $exists: true } })
            .sort({ "metadata.uploadDate": -1 })
            .limit(3)
            .allowDiskUse(true)
            .toArray();

        const pastData = pastEstimates.map(img => ({
            material_type: img.metadata?.estimate.material_type || "Unknown",
            project_scope: img.metadata?.estimate.project_scope || "Countertop Replacement",
            condition: img.metadata?.estimate.condition || { damage_type: "No visible damage", severity: "None" },
            additional_features: img.metadata?.estimate.additional_features || [],
            solutions: img.metadata?.estimate.solutions || "Professional evaluation required",
            cost: enhanceCostEstimate(img.metadata?.estimate)?.totalCost || 0,
            color: img.metadata?.estimate.color_and_pattern || "Not identified",
            likes: img.metadata.likes || 0,
            dislikes: img.metadata.dislikes || 0
        }));

        const needsLower = customerNeeds.toLowerCase();
        const keywords = {
            dimensions: extractDimensionsFromNeeds(customerNeeds),
            material: needsLower.match(/granite|quartz|marble|dekton|tile/i)?.[0],
            scope: needsLower.includes("repair") ? "repair" : needsLower.includes("replace") ? "replacement" : "installation",
            features: needsLower.match(/sink|edge|backsplash|demo|cutout|plumbing/i)?.map(f => f.toLowerCase()) || [],
            color: needsLower.match(/(black|white|gray|brown|pearl|mist)[\s-]*(pearl|mist)?/i)?.[0],
            thickness: needsLower.match(/(\d+\.?\d*)\s*(cm|mm)/i)?.[0]
        };

        if (!openai) {
            return {
                project_scope: keywords.scope === "repair" ? "Countertop Repair" : "Countertop Replacement",
                material_type: keywords.material || "Granite",
                color_and_pattern: keywords.color || "Not identified",
                thickness: keywords.thickness || "N/A",
                dimensions: keywords.dimensions || "25 Square Feet",
                edgeProfile: keywords.features.find(f => f.includes("edge")) || "Standard Edge",
                additional_features: keywords.features.filter(f => !f.includes("edge")),
                condition: { damage_type: "No visible damage", severity: "None" },
                solutions: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for evaluation.`,
                reasoning: "OpenAI unavailable; default estimate based on customer needs."
            };
        }

        const prompt = `You are CARI, an expert AI at Surprise Granite, specializing in countertop and tile remodeling estimates as of April 03, 2025. Analyze these ${fileDataArray.length} files and customer needs ("${customerNeeds}") to generate a precise estimate:

        **Instructions**:
        - Focus on countertops and tiles (repair, replacement, or installation).
        - For multiple files, aggregate findings (e.g., average damage, common material).
        - For images:
          - **Damage**: Detect cracks, stains, chips (type and severity: Low, Moderate, Severe).
          - **Material**: Identify likely material (e.g., Granite, Quartz) based on texture and sheen.
          - **Color/Pattern**: Match dominant color and veining to known styles (e.g., Black Pearl).
          - **Size Hints**: Estimate surface area if visible (adjust from 25 Square Feet if clear).
        - Cross-reference with customer needs:
          - Dimensions: Use "${keywords.dimensions || 'unknown'}" if provided, else assume 25 Square Feet or estimate from images.
          - Material: Use "${keywords.material || 'unknown'}" if specified, else infer from images, match to materials.json.
          - Scope: Match "${keywords.scope}" (repair/replacement/installation) with intent or damage.
          - Features: Include "${keywords.features.join(", ") || 'none'}" if mentioned, separate edge profile if specified.
          - Color: Use "${keywords.color || 'unknown'}" if specified, match to materials.json.
          - Thickness: Use "${keywords.thickness || 'unknown'}" if specified, match to materials.json.
        - **MANDATORY**: Use materials.json pricing FIRST—default only if no match. Log reasoning if defaulting.

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData)}
        - Materials: ${JSON.stringify(materialsData)}

        **Historical Estimates**: ${JSON.stringify(pastData)}

        Respond in JSON with:
        - project_scope: e.g., "Countertop Repair"
        - material_type: e.g., "Granite"
        - color_and_pattern: e.g., "Black Pearl"
        - thickness: e.g., "2cm"
        - dimensions: e.g., "25 Square Feet"
        - edgeProfile: e.g., "Bullnose Edge"
        - additional_features: array, e.g., ["sink cutout"]
        - condition: { damage_type: e.g., "Cracks", severity: e.g., "Moderate" }
        - solutions: e.g., "Seal cracks with epoxy"
        - reasoning: Detail analysis, customer needs integration, and pricing source
        `;

        const messages = [
            { role: "system", content: prompt },
            {
                role: "user",
                content: fileDataArray.length
                    ? fileDataArray.map(f => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.content}` } }))
                    : customerNeeds
            }
        ];
        const response = await withRetry(() =>
            openai.chat.completions.create({
                model: "gpt-4o",
                messages,
                max_tokens: 2000,
                temperature: 0.825,
                response_format: { type: "json_object" }
            })
        );

        let result = JSON.parse(response.choices[0].message.content || "{}");

        const estimate = {
            project_scope: result.project_scope || (keywords.scope === "repair" ? "Countertop Repair" : "Countertop Replacement"),
            material_type: result.material_type || keywords.material || "Granite",
            color_and_pattern: result.color_and_pattern || keywords.color || "Not identified",
            thickness: result.thickness || keywords.thickness || "N/A",
            dimensions: keywords.dimensions || (result.dimensions?.replace(/sqft|sft/i, "Square Feet") || "25 Square Feet"),
            edgeProfile: result.edgeProfile || keywords.features.find(f => f.includes("edge")) || "Standard Edge",
            additional_features: result.additional_features || keywords.features.filter(f => !f.includes("edge")),
            condition: result.condition || { damage_type: "No visible damage", severity: "None" },
            solutions: result.solutions || `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for evaluation.`,
            reasoning: result.reasoning || "Based on default assumptions and customer input."
        };

        if (appState.db) {
            const imagesCollection = appState.db.collection("countertop_images");
            const imageIds = await Promise.all(
                fileDataArray.map(async fileData => {
                    const insertResult = await imagesCollection.insertOne({
                        fileHash: createHash("sha256").update(fileData.content).digest("hex"),
                        fileData: new Binary(Buffer.from(fileData.content, "base64")),
                        metadata: { estimate, uploadDate: new Date(), likes: 0, dislikes: 0 }
                    });
                    return insertResult.insertedId.toString();
                })
            );
            estimate.imageIds = imageIds;
        }

        return estimate;
    } catch (err) {
        logError("Estimate generation failed", err);
        return {
            project_scope: "Countertop Replacement",
            material_type: "Granite",
            color_and_pattern: "Not identified",
            thickness: "N/A",
            dimensions: "25 Square Feet (assumed)",
            edgeProfile: "Standard Edge",
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for evaluation.`,
            reasoning: `Estimate failed: ${err.message}. Assumed defaults.`
        };
    }
}

function enhanceCostEstimate(estimate) {
    if (!estimate || !laborData.length || !materialsData.length) return null;

    const materialType = estimate.material_type.toLowerCase();
    const colorPattern = estimate.color_and_pattern.toLowerCase();
    const thickness = estimate.thickness?.toLowerCase() || "n/a";
    const projectScope = estimate.project_scope.toLowerCase().replace(/\s+/g, "_");
    const dimensions = estimate.dimensions || "25 Square Feet";
    const sqFt = parseFloat(dimensions.match(/(\d+\.?\d*)/)?.[1] || 25);

    const material = materialsData.reduce(
        (best, current) => {
            const similarity = Math.max(
                stringSimilarity.compareTwoStrings(materialType, current.type.toLowerCase()),
                stringSimilarity.compareTwoStrings(colorPattern, current.color.toLowerCase()),
                stringSimilarity.compareTwoStrings(thickness, current.thickness.toLowerCase())
            );
            return similarity > best.similarity ? { ...current, similarity } : best;
        },
        { similarity: 0 }
    ) || { type: "Granite", color: "Generic", cost_per_sqft: 50, thickness: "N/A", vendor: "Unknown", availability: "In Stock", confidence: 0.8 };

    const materialCost = projectScope.includes("repair") ? 0 : material.cost_per_sqft * sqFt * 1.3;

    const laborEntry = laborData.reduce(
        (best, current) => {
            const similarity = stringSimilarity.compareTwoStrings(projectScope, current.type);
            return similarity > best.similarity ? { ...current, similarity } : best;
        },
        { similarity: 0 }
    ) || { type: "default", rate_per_sqft: 15, rate_per_unit: 0, unit_measure: "SQFT", hours: 1, confidence: 0.5 };

    let laborCost = (laborEntry.rate_per_sqft || 15) * sqFt;
    if (projectScope.includes("repair")) {
        const severityMultiplier = { None: 0.5, Low: 0.75, Moderate: 1, Severe: 1.5 }[estimate.condition.severity] || 1;
        laborCost *= severityMultiplier;
    }

    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        return sum + (feature.toLowerCase().includes("sink") ? 150 : feature.toLowerCase().includes("edge") ? 100 : 0);
    }, 0);

    const totalCost = materialCost + laborCost + featuresCost;
    return {
        materialCost,
        laborCost: { total: laborCost },
        additionalFeaturesCost: featuresCost,
        totalCost
    };
}

async function generateTTS(estimate, customerNeeds) {
    if (!openai) {
        return Buffer.from(`Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for your estimate.`);
    }

    const costEstimate = enhanceCostEstimate(estimate) || {
        materialCost: 0,
        laborCost: { total: 0 },
        additionalFeaturesCost: 0,
        totalCost: 0
    };
    const narrationText = `Your Surprise Granite estimate: 
        Project: ${estimate.project_scope}. 
        Material: ${estimate.material_type}. 
        Color: ${estimate.color_and_pattern}. 
        Thickness: ${estimate.thickness}. 
        Dimensions: ${estimate.dimensions}. 
        Features: ${estimate.additional_features?.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition?.damage_type}, ${estimate.condition?.severity}. 
        Total cost: $${costEstimate.totalCost.toFixed(2)}. 
        Solutions: ${estimate.solutions}. 
        ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
        Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`;
    const chunks = narrationText.match(/.{1,4096}/g) || [narrationText];

    try {
        const audioBuffers = await Promise.all(
            chunks.map(chunk =>
                withRetry(async () => {
                    const response = await openai.audio.speech.create({
                        model: "tts-1",
                        voice: "alloy",
                        input: chunk
                    });
                    return Buffer.from(await response.arrayBuffer());
                })
            )
        );
        const audioBuffer = Buffer.concat(audioBuffers);
        const tempFilePath = path.join(tempDir, `tts-${Date.now()}.mp3`);
        await fs.writeFile(tempFilePath, audioBuffer);
        return tempFilePath;
    } catch (err) {
        logError("TTS generation failed", err);
        return Buffer.from(`Error generating audio. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`);
    }
}

// Routes
app.get("/health", (req, res) => {
    res.status(200).json({
        uptime: process.uptime(),
        mongoConnected: !!appState.db,
        openaiAvailable: !!openai,
        dataLoaded: laborData.length > 0 && materialsData.length > 0,
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
    });
});

app.post("/api/contractor-estimate", upload.array("files", 9), async (req, res) => {
    try {
        console.log(`[${new Date().toISOString()}] POST /api/contractor-estimate - Files: ${req.files?.length || 0}, Body:`, req.body);
        const customerNeeds = (req.body.customer_needs || "").trim();
        const files = req.files || [];
        const fileDataArray = await Promise.all(files.map(file => extractFileContent(file)));
        const leadData = {
            name: req.body.name || "Unknown",
            email: req.body.email || "Unknown",
            phone: req.body.phone || "Not provided"
        };

        const estimate = await estimateProject(fileDataArray, customerNeeds);
        const costEstimate = enhanceCostEstimate(estimate) || {
            materialCost: 0,
            laborCost: { total: 0 },
            additionalFeaturesCost: 0,
            totalCost: 0
        };
        const audioFilePath = await generateTTS(estimate, customerNeeds);

        if (appState.db) {
            const leadsCollection = appState.db.collection("leads");
            await leadsCollection.insertOne({
                ...leadData,
                customerNeeds,
                estimate,
                timestamp: new Date(),
                status: "new"
            });
        }

        const responseData = {
            imageIds: estimate.imageIds || [],
            message: "Estimate generated successfully",
            projectScope: estimate.project_scope,
            materialType: estimate.material_type,
            colorAndPattern: estimate.color_and_pattern,
            thickness: estimate.thickness,
            dimensions: estimate.dimensions,
            edgeProfile: estimate.edgeProfile,
            additionalFeatures: estimate.additional_features || [],
            condition: estimate.condition,
            costEstimate,
            reasoning: estimate.reasoning,
            solutions: estimate.solutions,
            contact: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a full evaluation.`,
            audioFilePath: audioFilePath.split(path.sep).pop(), // Send only filename
            shareUrl: estimate.imageIds?.[0] ? `${req.protocol}://${req.get("host")}/api/get-countertop/${estimate.imageIds[0]}` : null,
            likes: 0,
            dislikes: 0
        };

        console.log(`[${new Date().toISOString()}] Sending response for /api/contractor-estimate`);
        res.status(201).json(responseData);
    } catch (err) {
        logError("Error in /api/contractor-estimate", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

app.get("/api/audio/:filename", async (req, res) => {
    const filePath = path.join(tempDir, req.params.filename);
    try {
        const audioBuffer = await fs.readFile(filePath);
        res.setHeader("Content-Type", "audio/mpeg");
        res.send(audioBuffer);
    } catch (err) {
        logError("Audio file not found", err);
        res.status(404).send("Audio file not found");
    }
});

app.get("/api/get-countertop/:id", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) throwError("Database not connected", 500);
        const imagesCollection = appState.db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);
        res.status(200).json({
            estimate: countertop.metadata.estimate,
            likes: countertop.metadata.likes || 0,
            dislikes: countertop.metadata.dislikes || 0
        });
    } catch (err) {
        logError("Error in /api/get-countertop", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

app.post("/api/like-countertop/:id", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) throwError("Database not connected", 500);
        const imagesCollection = appState.db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        const newLikes = (countertop.metadata.likes || 0) + 1;
        await imagesCollection.updateOne({ _id: objectId }, { $set: { "metadata.likes": newLikes } });
        res.status(200).json({ message: "Like added", likes: newLikes, dislikes: countertop.metadata.dislikes || 0 });
    } catch (err) {
        logError("Error in /api/like-countertop", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

app.post("/api/dislike-countertop/:id", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) throwError("Database not connected", 500);
        const imagesCollection = appState.db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        const newDislikes = (countertop.metadata.dislikes || 0) + 1;
        await imagesCollection.updateOne({ _id: objectId }, { $set: { "metadata.dislikes": newDislikes } });
        res.status(200).json({ message: "Dislike added", likes: countertop.metadata.likes || 0, dislikes: newDislikes });
    } catch (err) {
        logError("Error in /api/dislike-countertop", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

app.post("/api/send-email", async (req, res) => {
    try {
        if (!transporter) throwError("Email service not configured", 500);
        const { name, email, phone, message, stone_type, analysis_summary } = req.body;
        if (!name || !email || !message) throwError("Missing required fields: name, email, and message", 400);

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_RECIPIENT || "recipient@example.com",
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
        res.status(200).json({ message: "Email sent successfully" });
    } catch (err) {
        logError("Error in /api/send-email", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || "Unknown server error";
    logError(`Unhandled error in ${req.method} ${req.path}`, err);
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size exceeds 5MB limit" });
        } else if (err.code === "LIMIT_UNEXPECTED_FILE") {
            return res.status(400).json({ error: "Unexpected field in file upload. Use 'files' field." });
        }
    }
    res.status(status).json({ error: message, details: `Call ${SURPRISE_GRANITE_PHONE} if this persists.` });
});

// Server Startup
function startServer() {
    const server = app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Service live at http://localhost:${PORT} or Render URL`);
        await Promise.all([loadLaborData(), loadMaterialsData(), connectToMongoDB()]);
    });

    const keepAlive = setInterval(() => {
        console.log(`[${new Date().toISOString()}] Server is alive`);
        logMemoryUsage();
    }, 30000);

    process.on("SIGTERM", async () => {
        console.log("Received SIGTERM, shutting down...");
        clearInterval(keepAlive);
        if (appState.mongoClient) await appState.mongoClient.close();
        cache.flushAll();
        server.close(() => {
            console.log("Server shut down gracefully due to SIGTERM");
            process.exit(0);
        });
    });

    process.on("SIGINT", async () => {
        console.log("Received SIGINT, shutting down...");
        clearInterval(keepAlive);
        if (appState.mongoClient) await appState.mongoClient.close();
        cache.flushAll();
        server.close(() => {
            console.log("Server shut down gracefully due to SIGINT");
            process.exit(0);
        });
    });

    process.on("uncaughtException", err => logError("Uncaught Exception", err));
    process.on("unhandledRejection", (reason, promise) => logError("Unhandled Rejection", reason));
}

startServer();
