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
const stringSimilarity = require("string-similarity");

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
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
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
        laborData = rawData.map(item => ({
            code: item.Code,
            type: item.Service.toLowerCase().replace(/\s+/g, "_"),
            rate_per_sqft: item["U/M"] === "SQFT" ? item.Price : 0,
            rate_per_unit: ["EA", "LF", "Per Job"].includes(item["U/M"]) ? item.Price : 0,
            unit_measure: item["U/M"],
            hours: item["U/M"] === "SQFT" ? 1 : (["EA", "LF", "Per Job"].includes(item["U/M"]) ? 0 : 0.5),
            description: item.Description,
            confidence: 1
        }));
        console.log("Labor data loaded:", JSON.stringify(laborData.slice(0, 5), null, 2));
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
            if (!materialMap.has(key)) materialMap.set(key, { totalCost: 0, count: 0 });
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
        console.log("Processed materials:", materialsData.length, "unique entries");
        console.log("Materials data sample:", JSON.stringify(materialsData.slice(0, 5), null, 2));
    } catch (err) {
        logError("Failed to load materials.json, using defaults", err);
        materialsData = [
            { type: "Granite", color: "Generic", cost_per_sqft: 50, confidence: 1 },
            { type: "Quartz", color: "Generic", cost_per_sqft: 60, confidence: 1 },
            { type: "Marble", color: "Generic", cost_per_sqft: 55, confidence: 1 },
            { type: "Dekton", color: "Generic", cost_per_sqft: 65, confidence: 1 }
        ];
    }
}

async function connectToMongoDB() {
    if (!process.env.MONGODB_URI) {
        console.warn("MONGODB_URI not set; skipping MongoDB connection.");
        return;
    }
    try {
        console.log("Connecting to MongoDB...");
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
        console.log("Extracting file content...");
        if (file.mimetype.startsWith("image/")) {
            const image = await Jimp.read(file.buffer);
            const dominantColor = image.getPixelColor(Math.floor(image.bitmap.width / 2), Math.floor(image.bitmap.height / 2));
            const { r, g, b } = Jimp.intToRGBA(dominantColor);
            console.log("File content extracted");
            return { 
                type: "image", 
                content: file.buffer.toString("base64"), 
                color: { r, g, b, hex: `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}` }
            };
        } else if (file.mimetype === "application/pdf") {
            const data = await pdfParse(file.buffer);
            console.log("File content extracted");
            return { type: "text", content: data.text };
        } else if (file.mimetype === "text/plain") {
            console.log("File content extracted");
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
        console.log("Starting estimateProject...");
        await ensureMongoDBConnection();
        const imagesCollection = db?.collection("countertop_images") || { find: () => ({ sort: () => ({ limit: () => ({ allowDiskUse: () => ({ toArray: async () => [] }) }) }) }) };
        console.log("Fetching past estimates...");
        const pastEstimates = await imagesCollection
            .find({ "metadata.estimate.material_type": { $exists: true } })
            .sort({ "metadata.uploadDate": -1 })
            .limit(10)
            .allowDiskUse(true)
            .toArray();
        console.log("Fetched past estimates:", pastEstimates.length);

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

        const needsLower = customerNeeds.toLowerCase();
        const keywords = {
            dimensions: extractDimensionsFromNeeds(customerNeeds),
            material: needsLower.match(/granite|quartz|marble|dekton/i)?.[0],
            scope: needsLower.includes("repair") ? "repair" : needsLower.includes("replace") ? "replacement" : "installation",
            features: needsLower.match(/sink|edge|backsplash/i)?.map(f => f.toLowerCase()) || [],
        };

        const prompt = `You are CARI, an expert AI at Surprise Granite, specializing in countertop remodeling estimates as of March 31, 2025. Analyze this ${fileData ? "image" : "description"} and customer needs ("${customerNeeds}") to generate a precise countertop estimate:

        **Instructions**:
        - Focus on countertops (repair, replacement, or fabrication/installation).
        ${fileData ? `
        - For images, analyze:
          - **Damage**: Detect cracks, stains, chips (type and severity: Low, Moderate, Severe).
          - **Material**: Identify likely material (e.g., Granite, Quartz, Dekton) based on texture and sheen.
          - **Color/Pattern**: Match dominant color and veining/streaks to known countertop styles.
          - **Size Hints**: Estimate surface area if visible (e.g., table vs. full counter, adjust from 25 Square Feet if clear).
        ` : ""}
        - Cross-reference with customer needs:
          - Dimensions: Use "${keywords.dimensions || 'unknown'}" if provided, else assume 25 Square Feet${fileData ? " or estimate from image" : ""}.
          - Material: Prefer "${keywords.material || 'unknown'}" if specified${fileData ? ", else infer from image" : ""}.
          - Scope: Match "${keywords.scope}" (repair/replacement/installation) with intent${fileData ? " or damage; adjust if image contradicts" : ""}.
          - Features: Include "${keywords.features.join(", ") || 'none'}" if mentioned.
        - Use labor and material data for accuracy.

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData)}
        - Materials: ${JSON.stringify(materialsData)}

        **Historical Estimates**: ${JSON.stringify(pastData)}

        Respond in JSON with:
        - project_scope: e.g., "Countertop Repair" or "Countertop Replacement"
        - material_type: e.g., "Granite"
        - color_and_pattern: e.g., "Brown with black speckles"
        - dimensions: e.g., "25 Square Feet"
        - additional_features: array, e.g., ["sink cutout"]
        - condition: { damage_type: e.g., "Cracks", severity: e.g., "Moderate" }
        - solutions: e.g., "Seal cracks with epoxy"
        - reasoning: Detail analysis and customer needs integration
        `;

        console.log("Sending prompt to OpenAI...");
        const messages = [
            { role: "system", content: prompt },
            { 
                role: "user", 
                content: fileData ? 
                    [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileData.content}` } }] : 
                    customerNeeds 
            }
        ];
        const response = await withRetry(() => openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: 3500,
            temperature: 0.8,
            response_format: { type: "json_object" },
        }));
        console.log("Received OpenAI response");

        let result = JSON.parse(response.choices[0].message.content || '{}');

        const estimate = {
            project_scope: result.project_scope || (keywords.scope === "repair" ? "Countertop Repair" : "Countertop Replacement"),
            material_type: result.material_type || keywords.material || "Granite",
            color_and_pattern: fileData && fileData.color ? 
                `${result.color_and_pattern || "Detected"} (Hex: ${fileData.color.hex})` : 
                (result.color_and_pattern || "Not identified"),
            dimensions: keywords.dimensions || (result.dimensions?.replace(/sqft|sft/i, "Square Feet") || "25 Square Feet"),
            additional_features: result.additional_features || keywords.features,
            condition: result.condition || { damage_type: "No visible damage", severity: "None" },
            solutions: result.solutions || "Contact Surprise Granite at (602) 833-3189 for evaluation.",
            reasoning: result.reasoning || "Based on default assumptions and customer input."
        };

        console.log("Generated estimate:", JSON.stringify(estimate, null, 2));

        if (db) {
            console.log("Storing estimate in MongoDB...");
            const insertResult = await imagesCollection.insertOne({
                fileHash: createHash("sha256").update(JSON.stringify(estimate)).digest("hex"),
                metadata: { estimate, uploadDate: new Date(), likes: 0, dislikes: 0 }
            });
            estimate.imageId = insertResult.insertedId.toString();
            console.log("Stored estimate with ID:", estimate.imageId);
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
    if (!estimate || !laborData.length || !materialsData.length) {
        logError("Invalid inputs in enhanceCostEstimate", { estimate });
        return null;
    }

    const materialType = estimate.material_type.toLowerCase();
    const projectScope = estimate.project_scope.toLowerCase().replace(/\s+/g, "_");
    const customerNeeds = (estimate.customer_needs || "").toLowerCase();
    const dimensions = estimate.dimensions || "25 Square Feet";
    const sqFt = parseFloat(dimensions.match(/(\d+\.?\d*)/)?.[1] || 25);
    console.log(`Calculated Square Feet: ${sqFt}`);

    const materialMatches = materialsData.map(m => ({
        ...m,
        similarity: stringSimilarity.compareTwoStrings(materialType, m.type.toLowerCase())
    }));
    const material = materialMatches.reduce((best, current) => 
        current.similarity > best.similarity ? current : best, { similarity: 0 }) || 
        { type: "Granite", cost_per_sqft: 50, confidence: 0.8 };
    const materialCostPerSqFt = material.cost_per_sqft;
    const materialCost = projectScope.includes("repair") ? 0 : materialCostPerSqFt * sqFt * 1.3;
    console.log(`Material match: ${material.type} (similarity: ${material.similarity.toFixed(2)})`);
    console.log(`Material cost: $${materialCost.toFixed(2)} (${materialCostPerSqFt}/Square Foot * ${sqFt} Square Feet, 1.3x markup)`);

    const laborMatches = laborData.map(entry => ({
        ...entry,
        similarity: Math.max(
            stringSimilarity.compareTwoStrings(projectScope, entry.type),
            stringSimilarity.compareTwoStrings(customerNeeds, entry.type)
        )
    }));
    const laborEntry = laborMatches.reduce((best, current) => 
        current.similarity > best.similarity ? current : best, { similarity: 0 }) || 
        { type: "default", rate_per_sqft: 15, rate_per_unit: 0, unit_measure: "SQFT", hours: 1, confidence: 0.5 };
    if (laborEntry.similarity < 0.7) {
        console.log("No strong labor match (similarity < 0.7), using default");
        laborEntry.type = "default";
        laborEntry.rate_per_sqft = 15;
        laborEntry.hours = 1;
        laborEntry.confidence = 0.5;
    }
    console.log("Selected labor entry:", JSON.stringify(laborEntry, null, 2));
    let laborCost = (laborEntry.rate_per_sqft || 15) * sqFt;

    if (projectScope.includes("repair")) {
        const severityMultiplier = { None: 0.5, Low: 0.75, Moderate: 1, Severe: 1.5 }[estimate.condition.severity] || 1;
        laborCost *= severityMultiplier;
        console.log(`Adjusted labor cost for repair: $${laborCost.toFixed(2)} (severity: ${severityMultiplier})`);
    } else {
        console.log(`Labor cost (SQFT): $${laborCost.toFixed(2)} (${laborEntry.rate_per_sqft || 15}/Square Foot * ${sqFt} Square Feet)`);
    }

    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        return sum + (feature.toLowerCase().includes("sink") ? 150 : feature.toLowerCase().includes("edge") ? 100 : 0);
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
    console.log("Generating TTS...");
    estimate.customer_needs = customerNeeds;
    const costEstimate = enhanceCostEstimate(estimate) || {
        materialCost: "Contact for estimate",
        laborCost: { total: "Contact for estimate" },
        additionalFeaturesCost: "$0",
        totalCost: "Contact for estimate"
    };
    const narrationText = `Your Surprise Granite estimate as of March 31, 2025: 
        Project: ${estimate.project_scope}. 
        Material: ${estimate.material_type}. 
        Color: ${estimate.color_and_pattern}. 
        Dimensions: ${estimate.dimensions}. 
        Features: ${estimate.additional_features?.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition?.damage_type}, ${estimate.condition?.severity}. 
        Total cost: ${costEstimate.totalCost}. 
        Solutions: ${estimate.solutions}. 
        ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
        Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`;
    const chunks = narrationText.match(/.{1,4096}/g) || [narrationText];

    try {
        const audioBuffers = await Promise.all(chunks.map(chunk =>
            withRetry(async () => {
                const response = await openai.audio.speech.create({
                    model: "tts-1",
                    voice: "alloy",
                    input: chunk,
                });
                return Buffer.from(await response.arrayBuffer());
            })
        ));
        console.log("TTS generated successfully");
        return Buffer.concat(audioBuffers);
    } catch (err) {
        logError("TTS generation failed", err);
        return Buffer.from(`Error generating audio. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`);
    }
}

app.get("/", (req, res) => res.status(200).send("CARI Server is running"));

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
        console.log("Request headers:", req.headers);
        console.log("Request body:", req.body);
        console.log("Request file:", req.file || "No file provided");
        await ensureMongoDBConnection();

        const customerNeeds = (req.body.customer_needs || "").trim();
        let fileData = null;
        if (req.file) {
            fileData = await extractFileContent(req.file);
        } else {
            console.log("No file uploaded, proceeding with customer_needs only");
        }

        const fileHash = fileData ? createHash("sha256").update(fileData.content).digest("hex") : createHash("sha256").update(customerNeeds).digest("hex");
        const cacheKey = `estimate_${fileHash}_${customerNeeds.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '')}`;

        let estimate = cache.get(cacheKey);
        if (!estimate) {
            console.log("Generating new estimate...");
            estimate = await estimateProject(fileData, customerNeeds);
            estimate.customer_needs = customerNeeds;
            cache.set(cacheKey, estimate);
        }

        const imagesCollection = db?.collection("countertop_images");
        if (imagesCollection && fileData) {
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
            estimate.imageId = insertResult.insertedId.toString();
            console.log("Image stored with ID:", estimate.imageId);
        }

        const costEstimate = enhanceCostEstimate(estimate) || {
            materialCost: "Contact for estimate",
            laborCost: { total: "Contact for estimate" },
            additionalFeaturesCost: "$0",
            totalCost: "Contact for estimate"
        };

        const audioBuffer = await generateTTS(estimate, customerNeeds);

        const responseData = {
            imageId: estimate.imageId || null,
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
        console.log("Sending full response:", JSON.stringify(responseData, null, 2));
        res.status(201).json(responseData);
    } catch (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            console.log("File size exceeds 50MB limit");
            return res.status(400).json({ error: "File size exceeds 50MB limit" });
        }
        logError("Error in /api/contractor-estimate", err);
        res.status(500).json({ error: "Failed to generate estimate", details: err.message || "Unknown error" });
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

process.on("uncaughtException", (err) => logError("Uncaught Exception", err));
process.on("unhandledRejection", (reason, promise) => logError("Unhandled Rejection at", reason));

startServer();
