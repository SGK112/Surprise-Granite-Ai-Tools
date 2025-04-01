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
const Jimp = require("jimp");

const app = express();
const PORT = process.env.PORT || 10000;
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";

app.set("trust proxy", 1);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
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
        const rawData = JSON.parse(await fs.readFile(laborJsonPath, "utf8"));
        console.log("Loaded labor.json:", rawData.length, "entries");

        laborData = rawData.map(item => {
            const isPerSqFt = item["U/M"] === "SQFT";
            const isPerUnit = ["EA", "LF", "Per Job"].includes(item["U/M"]);
            return {
                code: item.Code,
                type: item.Service.toLowerCase().replace(/\s+/g, "_"),
                rate_per_sqft: isPerSqFt ? item.Price : 0,
                rate_per_unit: isPerUnit ? item.Price : 0,
                unit_measure: item["U/M"],
                hours: isPerSqFt ? 1 : (isPerUnit ? 0 : 0.5),
                description: item.Description,
                confidence: 1
            };
        });
        // Add countertop-specific defaults if not present
        laborData.push(
            { type: "countertop_installation", rate_per_sqft: 20, hours: 1, confidence: 1 },
            { type: "countertop_repair", rate_per_sqft: 15, hours: 0.5, confidence: 1 }
        );
    } catch (err) {
        logError("Failed to load labor.json, using defaults", err);
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
        console.log("Loaded materials.json:", rawData.length, "entries");

        const materialMap = new Map();
        rawData.forEach(item => {
            const key = `${item.Material}-${item["Color Name"]}`.toLowerCase();
            if (!materialMap.has(key)) {
                materialMap.set(key, { totalCost: 0, count: 0 });
            }
            const entry = materialMap.get(key);
            entry.totalCost += item["Cost/SqFt"];
            entry.count += 1;
        });

        materialsData = Array.from(materialMap.entries()).map(([key, { totalCost, count }]) => {
            const [material, color] = key.split("-");
            return {
                type: material.charAt(0).toUpperCase() + material.slice(1),
                color: color.charAt(0).toUpperCase() + color.slice(1),
                cost_per_sqft: totalCost / count,
                confidence: 1
            };
        });

        // Add countertop-specific defaults
        materialsData.push(
            { type: "Granite", color: "Generic", cost_per_sqft: 50, confidence: 1 },
            { type: "Quartz", color: "Generic", cost_per_sqft: 60, confidence: 1 },
            { type: "Marble", color: "Generic", cost_per_sqft: 55, confidence: 1 }
        );
    } catch (err) {
        logError("Failed to load materials.json, using defaults", err);
        materialsData = [
            { type: "Granite", color: "Generic", cost_per_sqft: 50, confidence: 1 },
            { type: "Quartz", color: "Generic", cost_per_sqft: 60, confidence: 1 },
            { type: "Marble", color: "Generic", cost_per_sqft: 55, confidence: 1 }
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
            const image = await Jimp.read(file.buffer);
            const dominantColor = image.getPixelColor(Math.floor(image.bitmap.width / 2), Math.floor(image.bitmap.height / 2));
            const { r, g, b } = Jimp.intToRGBA(dominantColor);
            return { 
                type: "image", 
                content: file.buffer.toString("base64"), 
                color: { r, g, b, hex: `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}` }
            };
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
        return `${sqFt.toFixed(2)} Square Feet`;
    }
    const sqFtMatch = customerNeeds.match(/(\d+\.?\d*)\s*(?:sq\s*ft|sft|square\s*feet)/i);
    if (sqFtMatch) {
        return `${parseFloat(sqFtMatch[1]).toFixed(2)} Square Feet`;
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
            .limit(10)
            .allowDiskUse(true)
            .toArray();

        const pastData = pastEstimates.map(img => {
            const estimate = img.metadata?.estimate || {};
            return {
                material_type: estimate.material_type || "Unknown",
                project_scope: estimate.project_scope || "Countertop Replacement",
                condition: estimate.condition || { damage_type: "No visible damage", severity: "None" },
                additional_features: estimate.additional_features || [],
                solutions: estimate.solutions || "Professional evaluation required",
                cost: enhanceCostEstimate(estimate)?.totalCost || "Contact for estimate",
                color: estimate.color_and_pattern || "Not identified",
                likes: img.metadata.likes || 0,
                dislikes: img.metadata.dislikes || 0,
            };
        });

        const prompt = `You are CARI, an expert AI at Surprise Granite, specializing in countertop remodeling estimates as of March 31, 2025. Your task is to analyze the provided ${fileData.type === "image" ? "image" : "document text"} and customer needs ("${customerNeeds}") to generate a professional countertop estimate for repair or replacement. Use the following:

        **Instructions**:
        - Focus exclusively on countertops (repair or replacement).
        - For images, analyze visible damage (e.g., cracks, stains, chips) to determine repair vs. replacement and assess severity (Low, Moderate, Severe).
        - Extract dimensions from customer needs (e.g., "10x5" or "50 sqft") or assume 25 Square Feet if unclear.
        - Suggest material types (e.g., Granite, Quartz) and colors based on image analysis or customer input.
        - Use labor and material data provided to estimate costs.
        - Provide a detailed scope of work and solutions (e.g., "seal cracks" for repair, "full slab replacement" for replacement).

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData.filter(item => item.type.includes("countertop")))}
        - Materials: ${JSON.stringify(materialsData.filter(item => ["Granite", "Quartz", "Marble"].includes(item.type)))}

        **Historical Estimates**: ${JSON.stringify(pastData.filter(p => p.project_scope.toLowerCase().includes("countertop")))}

        Estimate in JSON:
        - project_scope: "Countertop Repair" or "Countertop Replacement"
        - material_type: e.g., "Granite", "Quartz"
        - color_and_pattern: e.g., "Black Galaxy", "White Matte"
        - dimensions: e.g., "25 Square Feet"
        - additional_features: array, e.g., ["sink cutout", "edge polishing"]
        - condition: { damage_type: e.g., "Cracks", severity: e.g., "Moderate" }
        - solutions: e.g., "Seal cracks with epoxy" or "Replace with new slab"
        - reasoning: Explain the analysis and assumptions
        `;

        const messages = [
            { role: "system", content: prompt },
            { 
                role: "user", 
                content: fileData.type === "image" ? 
                    [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileData.content}` } }] : 
                    fileData.content 
            }
        ];
        const response = await withRetry(() => openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: 3000,
            temperature: 0.6,
            response_format: { type: "json_object" },
        }));

        let result = JSON.parse(response.choices[0].message.content || '{}');

        const extractedDimensions = extractDimensionsFromNeeds(customerNeeds);

        const estimate = {
            project_scope: result.project_scope || "Countertop Replacement",
            material_type: result.material_type || "Granite",
            color_and_pattern: fileData.color ? 
                `${result.color_and_pattern || "Detected"} (Hex: ${fileData.color.hex})` : 
                (result.color_and_pattern || "Not identified"),
            dimensions: extractedDimensions || (result.dimensions?.replace(/sqft|sft/i, "Square Feet") || "25 Square Feet"),
            additional_features: Array.isArray(result.additional_features) ? result.additional_features : [],
            condition: result.condition || { damage_type: "No visible damage", severity: "None" },
            solutions: result.solutions || "Contact Surprise Granite at (602) 833-3189 for evaluation.",
            reasoning: result.reasoning || "Based on default assumptions."
        };

        if (db) {
            setTimeout(async () => {
                await imagesCollection.insertOne({
                    fileHash: createHash("sha256").update(JSON.stringify(estimate)).digest("hex"),
                    metadata: { estimate, uploadDate: new Date(), likes: 0, dislikes: 0 }
                });
            }, 0);
        }

        return estimate;
    } catch (err) {
        logError("Estimate generation failed", err);
        return {
            project_scope: "Countertop Replacement",
            material_type: "Granite",
            color_and_pattern: "Not identified",
            dimensions: "25 Square Feet (assumed)",
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: "Contact Surprise Granite at (602) 833-3189 for evaluation.",
            reasoning: `Estimate failed: ${err.message}. Assumed defaults.`
        };
    }
}

function enhanceCostEstimate(estimate) {
    if (!estimate || !laborData.length || !materialsData.length) return null;

    const materialType = estimate.material_type.toLowerCase();
    const projectScope = estimate.project_scope.toLowerCase().replace(/\s+/g, "_");
    const dimensions = estimate.dimensions || "25 Square Feet";
    const sqFt = parseFloat(dimensions.match(/(\d+\.?\d*)/)?.[1] || 25);

    // Material Cost
    const material = materialsData.find(m => m.type.toLowerCase() === materialType) || 
                    { type: "Granite", cost_per_sqft: 50, confidence: 0.8 };
    const materialCostPerSqFt = material.cost_per_sqft;
    const materialCost = materialCostPerSqFt * sqFt * 1.3; // 30% markup

    // Labor Cost
    const laborEntry = laborData.find(entry => entry.type === projectScope) || 
                      { type: "countertop_installation", rate_per_sqft: 20, hours: 1, confidence: 0.8 };
    let laborCostPerSqFt = laborEntry.rate_per_sqft || 20;
    let laborCost = laborCostPerSqFt * sqFt;

    // Adjust for repair
    if (projectScope.includes("repair")) {
        const severityMultiplier = { None: 0.5, Low: 0.75, Moderate: 1, Severe: 1.5 }[estimate.condition.severity] || 1;
        laborCost = laborCostPerSqFt * sqFt * severityMultiplier;
        laborCostPerSqFt *= severityMultiplier;
    }

    // Additional Features
    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        const featureCost = feature.toLowerCase().includes("sink") ? 150 : 
                           feature.toLowerCase().includes("edge") ? 100 : 0;
        return sum + featureCost;
    }, 0);

    const totalCost = materialCost + laborCost + featuresCost;
    const totalCostPerSqFt = totalCost / sqFt;

    return {
        materialCost: `$${materialCost.toFixed(2)}`,
        materialCostPerSqFt: `$${materialCostPerSqFt.toFixed(2)}`,
        laborCost: { total: `$${laborCost.toFixed(2)}`, perSqFt: `$${laborCostPerSqFt.toFixed(2)}` },
        additionalFeaturesCost: `$${featuresCost.toFixed(2)}`,
        totalCost: `$${totalCost.toFixed(2)}`,
        totalCostPerSqFt: `$${totalCostPerSqFt.toFixed(2)}`
    };
}

async function generateTTS(estimate, customerNeeds) {
    const costEstimate = enhanceCostEstimate(estimate) || {
        materialCost: "Contact for estimate",
        laborCost: { total: "Contact for estimate" },
        additionalFeaturesCost: "$0",
        totalCost: "Contact for estimate",
        totalCostPerSqFt: "Contact for estimate"
    };
    const narrationText = `Your Surprise Granite countertop estimate as of March 31, 2025: 
        Project: ${estimate.project_scope}. 
        Material: ${estimate.material_type}. 
        Color: ${estimate.color_and_pattern}. 
        Dimensions: ${estimate.dimensions}. 
        Features: ${estimate.additional_features?.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition?.damage_type}, ${estimate.condition?.severity}. 
        Total cost: ${costEstimate.totalCost}, or ${costEstimate.totalCostPerSqFt} per square foot. 
        Solutions: ${estimate.solutions}. 
        ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
        Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for details.`;
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
        return Buffer.from(`Error generating audio. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`);
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
        pdfParseStatus: "Available",
        colorMatchingStatus: "Available"
    };
    try {
        await openai.models.list();
        health.openaiStatus = "Connected";
    } catch (err) {
        health.openaiStatus = "Disconnected";
    }
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) throw new Error("Email credentials not configured");
        await transporter.verify();
        health.emailStatus = "Connected";
    } catch (err) {
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
        }

        const costEstimate = enhanceCostEstimate(estimate) || {
            materialCost: "Contact for estimate",
            materialCostPerSqFt: "Contact for estimate",
            laborCost: { total: "Contact for estimate", perSqFt: "Contact for estimate" },
            additionalFeaturesCost: "$0",
            totalCost: "Contact for estimate",
            totalCostPerSqFt: "Contact for estimate"
        };

        const audioBuffer = await generateTTS(estimate, customerNeeds);

        const responseData = {
            imageId: estimate.imageId?.toString() || null,
            message: "Countertop estimate generated successfully",
            projectScope: estimate.project_scope,
            materialType: estimate.material_type,
            colorAndPattern: estimate.color_and_pattern,
            dimensions: estimate.dimensions,
            additionalFeatures: estimate.additional_features.join(", ") || "None",
            condition: estimate.condition,
            costEstimate: {
                ...costEstimate,
                totalCostPerSquareFoot: costEstimate.totalCostPerSqFt
            },
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
            return res.status(400).json({ error: "File size exceeds 50MB limit" });
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
            to: "recipient@example.com",
            subject: `New Countertop Quote Request from ${name}`,
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
