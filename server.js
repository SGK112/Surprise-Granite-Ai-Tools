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
    limits: { fileSize: 5 * 1024 * 1024, files: 9 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "application/pdf", "text/plain"];
        cb(null, allowedTypes.includes(file.mimetype));
    }
});

let openai = null;
if (process.env.OPENAI_API_KEY) {
    try {
        openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        console.log("OpenAI initialized successfully");
    } catch (err) {
        console.error("Failed to initialize OpenAI:", err.message);
    }
} else {
    console.warn("OPENAI_API_KEY not set; AI features disabled");
}

const cache = new NodeCache({ stdTTL: 7200, checkperiod: 300 });

let laborData = [];
let materialsData = [];
let db = null;
let mongoClient;

const transporter = process.env.EMAIL_USER && process.env.EMAIL_PASS ? nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
}) : null;

app.use(compression());
app.use(cors({ origin: ["http://localhost:3000", "https://your-frontend-url.netlify.app"], credentials: true })); // Replace with your frontend URL
app.use(helmet());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
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
        console.log("Labor data loaded successfully:", laborData.length, "entries");
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
        materialsData = rawData.map(item => ({
            type: item.Material,
            color: item["Color Name"],
            cost_per_sqft: item["Cost/SqFt"],
            thickness: item.Thickness || "N/A",
            vendor: item.Vendor || "Unknown",
            availability: item.Availability || "In Stock",
            confidence: 1
        }));
        console.log("Materials data loaded successfully:", materialsData.length, "entries");
    } catch (err) {
        logError("Failed to load materials.json, using defaults", err);
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
        console.log("Attempting MongoDB connection...");
        mongoClient = new MongoClient(process.env.MONGODB_URI, {
            maxPoolSize: 10,
            minPoolSize: 2,
            connectTimeoutMS: 3000, // Shortened timeout
            socketTimeoutMS: 10000
        });
        await mongoClient.connect();
        db = mongoClient.db("countertops");
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        logError("MongoDB connection failed, continuing without DB", err);
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
            image.resize(100, Jimp.AUTO); // Reduced to 100px for memory
            const dominantColor = image.getPixelColor(Math.floor(image.bitmap.width / 2), Math.floor(image.bitmap.height / 2));
            const { r, g, b } = Jimp.intToRGBA(dominantColor);
            return { 
                type: "image", 
                content: await image.getBase64Async(Jimp.MIME_JPEG).then(buf => buf.split(",")[1]), 
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

async function estimateProject(fileDataArray, customerNeeds) {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = db?.collection("countertop_images") || { find: () => ({ sort: () => ({ limit: () => ({ allowDiskUse: () => ({ toArray: async () => [] }) }) }) }) };
        const pastEstimates = await imagesCollection
            .find({ "metadata.estimate.material_type": { $exists: true } })
            .sort({ "metadata.uploadDate": -1 })
            .limit(3)
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
            console.warn("OpenAI unavailable; returning default estimate");
            return {
                project_scope: keywords.scope === "repair" ? "Countertop Repair" : "Countertop Replacement",
                material_type: keywords.material || "Granite",
                color_and_pattern: keywords.color || "Not identified",
                thickness: keywords.thickness || "N/A",
                dimensions: keywords.dimensions || "25 Square Feet",
                additional_features: keywords.features,
                condition: { damage_type: "No visible damage", severity: "None" },
                solutions: "Contact Surprise Granite at (602) 833-3189 for evaluation.",
                reasoning: "OpenAI unavailable; default estimate based on customer needs."
            };
        }

        const prompt = `You are CARI, an expert AI at Surprise Granite, specializing in countertop and tile remodeling estimates as of April 02, 2025. Analyze these ${fileDataArray.length} files and customer needs ("${customerNeeds}") to generate a precise estimate:

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
          - Features: Include "${keywords.features.join(", ") || 'none'}" if mentioned.
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
        - additional_features: array, e.g., ["sink cutout"]
        - condition: { damage_type: e.g., "Cracks", severity: e.g., "Moderate" }
        - solutions: e.g., "Seal cracks with epoxy"
        - reasoning: Detail analysis, customer needs integration, and pricing source
        `;

        const messages = [
            { role: "system", content: prompt },
            { 
                role: "user", 
                content: fileDataArray.length ? 
                    fileDataArray.map(f => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.content}` } })) : 
                    customerNeeds 
            }
        ];
        const response = await withRetry(() => openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: 2000,
            temperature: 0.825,
            response_format: { type: "json_object" },
        }));

        let result = JSON.parse(response.choices[0].message.content || '{}');

        const estimate = {
            project_scope: result.project_scope || (keywords.scope === "repair" ? "Countertop Repair" : "Countertop Replacement"),
            material_type: result.material_type || keywords.material || "Granite",
            color_and_pattern: result.color_and_pattern || keywords.color || "Not identified",
            thickness: result.thickness || keywords.thickness || "N/A",
            dimensions: keywords.dimensions || (result.dimensions?.replace(/sqft|sft/i, "Square Feet") || "25 Square Feet"),
            additional_features: result.additional_features || keywords.features,
            condition: result.condition || { damage_type: "No visible damage", severity: "None" },
            solutions: result.solutions || "Contact Surprise Granite at (602) 833-3189 for evaluation.",
            reasoning: result.reasoning || "Based on default assumptions and customer input."
        };

        if (db) {
            const imagesCollection = db.collection("countertop_images");
            const imageIds = await Promise.all(fileDataArray.map(async (fileData, i) => {
                const insertResult = await imagesCollection.insertOne({
                    fileHash: createHash("sha256").update(fileData.content).digest("hex"),
                    fileData: new Binary(Buffer.from(fileData.content, "base64")),
                    metadata: { estimate, uploadDate: new Date(), likes: 0, dislikes: 0 }
                });
                return insertResult.insertedId.toString();
            }));
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
    const colorPattern = estimate.color_and_pattern.toLowerCase();
    const thickness = estimate.thickness?.toLowerCase() || "n/a";
    const projectScope = estimate.project_scope.toLowerCase().replace(/\s+/g, "_");
    const dimensions = estimate.dimensions || "25 Square Feet";
    const sqFt = parseFloat(dimensions.match(/(\d+\.?\d*)/)?.[1] || 25);

    const material = materialsData.reduce((best, current) => {
        const similarity = Math.max(
            stringSimilarity.compareTwoStrings(materialType, current.type.toLowerCase()),
            stringSimilarity.compareTwoStrings(colorPattern, current.color.toLowerCase()),
            stringSimilarity.compareTwoStrings(thickness, current.thickness.toLowerCase())
        );
        return similarity > best.similarity ? { ...current, similarity } : best;
    }, { similarity: 0 }) || { type: "Granite", color: "Generic", cost_per_sqft: 50, thickness: "N/A", vendor: "Unknown", availability: "In Stock", confidence: 0.8 };

    const materialCost = projectScope.includes("repair") ? 0 : material.cost_per_sqft * sqFt * 1.3;

    const laborEntry = laborData.reduce((best, current) => {
        const similarity = stringSimilarity.compareTwoStrings(projectScope, current.type);
        return similarity > best.similarity ? { ...current, similarity } : best;
    }, { similarity: 0 }) || { type: "default", rate_per_sqft: 15, rate_per_unit: 0, unit_measure: "SQFT", hours: 1, confidence: 0.5 };

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
        materialCost: `$${materialCost.toFixed(2)}`,
        laborCost: { total: `$${laborCost.toFixed(2)}` },
        additionalFeaturesCost: `$${featuresCost.toFixed(2)}`,
        totalCost: `$${totalCost.toFixed(2)}`
    };
}

async function generateTTS(estimate, customerNeeds) {
    if (!openai) {
        console.warn("OpenAI unavailable; TTS disabled");
        return Buffer.from(`Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for your estimate.`);
    }

    const costEstimate = enhanceCostEstimate(estimate) || {
        materialCost: "Contact for estimate",
        laborCost: { total: "Contact for estimate" },
        additionalFeaturesCost: "$0",
        totalCost: "Contact for estimate"
    };
    const narrationText = `Your Surprise Granite estimate: 
        Project: ${estimate.project_scope}. 
        Material: ${estimate.material_type}. 
        Color: ${estimate.color_and_pattern}. 
        Thickness: ${estimate.thickness}. 
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
        return Buffer.concat(audioBuffers);
    } catch (err) {
        logError("TTS generation failed", err);
        return Buffer.from(`Error generating audio. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`);
    }
}

app.get("/", (req, res) => {
    console.log("Health check successful");
    res.status(200).send("CARI Server is running");
});

app.post("/api/contractor-estimate", upload.array("files", 9), async (req, res) => {
    try {
        console.log("Processing contractor estimate request...");
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
            materialCost: "Contact for estimate",
            laborCost: { total: "Contact for estimate" },
            additionalFeaturesCost: "$0",
            totalCost: "Contact for estimate"
        };
        const audioBuffer = await generateyorsTTS(estimate, customerNeeds);

        if (db) {
            console.log("Storing lead in MongoDB...");
            const leadsCollection = db.collection("leads");
            await leadsCollection.insertOne({
                ...leadData,
                customerNeeds,
                estimate,
                timestamp: new Date(),
                status: "new"
            });
        } else {
            console.warn("MongoDB unavailable; lead not stored");
        }

        const responseData = {
            imageIds: estimate.imageIds || [],
            message: "Estimate generated successfully",
            projectScope: estimate.project_scope,
            materialType: estimate.material_type,
            colorAndPattern: estimate.color_and_pattern,
            thickness: estimate.thickness,
            dimensions: estimate.dimensions,
            additionalFeatures: estimate.additional_features || [],
            condition: estimate.condition,
            costEstimate,
            reasoning: estimate.reasoning,
            solutions: estimate.solutions,
            contact: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a full evaluation.`,
            audioBase64: audioBuffer.toString("base64"),
            shareUrl: estimate.imageIds?.[0] ? `${req.protocol}://${req.get("host")}/api/get-countertop/${estimate.imageIds[0]}` : null,
            likes: 0,
            dislikes: 0
        };
        console.log("Estimate generated successfully");
        res.status(201).json(responseData);
    } catch (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size exceeds 5MB limit" });
        }
        logError("Error in /api/contractor-estimate", err);
        res.status(500).json({ error: "Failed to generate estimate", details: err.message });
    }
});

app.post("/api/like-countertop/:id", async (req, res) => {
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
        res.status(500).json({ error: "Failed to like countertop", details: err.message });
    }
});

app.post("/api/dislike-countertop/:id", async (req, res) => {
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
        res.status(500).json({ error: "Failed to dislike countertop", details: err.message });
    }
});

app.post("/api/send-email", async (req, res) => {
    try {
        if (!transporter) throwError("Email service not configured", 500);
        const { name, email, phone, message, stone_type, analysis_summary } = req.body;
        if (!name || !email || !message) throwError("Missing required fields: name, email, and message", 400);

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: "recipient@example.com", // Replace with your email
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
    console.log("Starting server initialization...");
    try {
        console.log("Loading data files...");
        await Promise.all([loadLaborData(), loadMaterialsData()]);
        console.log("Data files loaded");
        console.log("Connecting to MongoDB...");
        await connectToMongoDB();
        console.log("MongoDB connection attempted");
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Service live at http://localhost:${PORT} or Render URL`);
            console.log("Post-startup check"); // Confirm server stays alive
        });
    } catch (err) {
        logError("Server startup failed", err);
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT} with limited functionality`);
            console.log(`Service live at http://localhost:${PORT} or Render URL (limited mode)`);
            console.log("Post-startup check (limited mode)");
        });
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
