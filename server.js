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

const PORT = process.env.PORT || 10000;
const MONGODB_URI = process.env.MONGODB_URI || (() => { throw new Error("MONGODB_URI is required"); })();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || (() => { throw new Error("OPENAI_API_KEY is required"); })();
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || (() => { throw new Error("EMAILJS_SERVICE_ID is required"); })();
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || (() => { throw new Error("EMAILJS_TEMPLATE_ID is required"); })();
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || (() => { throw new Error("EMAILJS_PUBLIC_KEY is required"); })();
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
app.use(require("compression")());
app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(require("express-rate-limit")({ windowMs: 15 * 60 * 1000, max: 100 }));

// Utility Functions
function throwError(message, status = 500) {
    const err = new Error(message);
    err.status = status;
    throw err;
}

function logError(message, err) {
    console.error(`${message}: ${err ? err.message : "Unknown error"}`, err?.stack || err);
}

async function loadLaborData() {
    try {
        const laborJsonPath = path.join(__dirname, "data", "labor.json");
        console.log("Attempting to load labor.json from:", laborJsonPath);
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
            { type: "edge_profile", rate_per_linear_ft: 20, hours: 0.25 }
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
        logError("Failed to load materials.json", err);
        materialsData = [
            { type: "Granite", cost_per_sqft: 50 },
            { type: "Quartz", cost_per_sqft: 60 },
            { type: "Marble", cost_per_sqft: 70 },
            { type: "Soapstone", cost_per_sqft: 80 },
            { type: "Concrete", cost_per_sqft: 65 },
            { type: "Acrylic or Fiberglass", cost_per_sqft: 20 }
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
        if (!db) throwError("Database not connected", 503);
        if (!req.file) throwError("No image uploaded", 400);

        const imageBuffer = req.file.buffer;
        const fileContent = imageBuffer.toString("base64");
        const customerNeeds = (req.body.customer_needs || "").trim();
        const imageHash = createHash("sha256").update(fileContent).digest("hex");
        const cacheKey = `estimate_${imageHash}_${customerNeeds}`;

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
        const costEstimate = enhanceCostEstimate(estimate);
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
        next(err);
    }
});

app.get("/api/get-countertop/:id", async (req, res, next) => {
    console.log("GET /api/get-countertop/", req.params.id);
    try {
        if (!db) throwError("Database not connected", 503);
        const imagesCollection = db.collection("countertop_images");
        const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!countertop) throwError("Countertop not found", 404);

        res.json({
            id: countertop._id,
            imageBase64: countertop.imageData.buffer.toString("base64"),
            metadata: {
                ...countertop.metadata.estimate,
                likes: countertop.metadata.likes || 0,
                dislikes: countertop.metadata.dislikes || 0,
                shareDescription: `Countertop Estimate: ${countertop.metadata.estimate.material_type || "Unknown"}, ${countertop.metadata.estimate.project_scope || "Project"}. Total: ${enhanceCostEstimate(countertop.metadata.estimate).totalCost}`,
                shareUrl: `${req.protocol}://${req.get("host")}/api/get-countertop/${countertop._id}`,
            },
        });
    } catch (err) {
        next(err);
    }
});

app.post("/api/like-countertop/:id", async (req, res, next) => {
    console.log("POST /api/like-countertop/", req.params.id);
    try {
        if (!db) throwError("Database not connected", 503);
        const imagesCollection = db.collection("countertop_images");
        const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!countertop) throwError("Countertop not found", 404);

        const newLikes = (countertop.metadata.likes || 0) + 1;
        await imagesCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { "metadata.likes": newLikes } }
        );
        console.log("Like added, new likes:", newLikes);
        res.status(200).json({ message: "Like added", likes: newLikes, dislikes: countertop.metadata.dislikes || 0 });
    } catch (err) {
        next(err);
    }
});

app.post("/api/dislike-countertop/:id", async (req, res, next) => {
    console.log("POST /api/dislike-countertop/", req.params.id);
    try {
        if (!db) throwError("Database not connected", 503);
        const imagesCollection = db.collection("countertop_images");
        const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!countertop) throwError("Countertop not found", 404);

        const newDislikes = (countertop.metadata.dislikes || 0) + 1;
        await imagesCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { "metadata.dislikes": newDislikes } }
        );
        console.log("Dislike added, new dislikes:", newDislikes);
        res.status(200).json({ message: "Dislike added", likes: countertop.metadata.likes || 0, dislikes: newDislikes });
    } catch (err) {
        next(err);
    }
});

app.post("/api/send-email", async (req, res, next) => {
    console.log("POST /api/send-email", req.body);
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
            contact_phone: SURPRISE_GRANITE_PHONE,
        };

        // EmailJS.send doesn't need publicKey again since it's initialized globally
        const emailResponse = await EmailJS.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
        console.log("Email sent successfully:", emailResponse);

        res.status(200).json({ message: "Email sent successfully", emailResponse });
    } catch (err) {
        logError("Error sending email", err);
        const status = err.status || 500;
        res.status(status).json({
            error: "Failed to send email",
            details: err.message || "Unknown error",
            emailjsError: err.response?.data || "No additional error details"
        });
    }
});

// Analysis Functions
async function estimateProject(fileContent, customerNeeds) {
    console.log("Starting estimateProject with customerNeeds:", customerNeeds);
    try {
        if (!db) throwError("Database not connected", 503);
        console.log("Fetching past images from MongoDB");
        const imagesCollection = db.collection("countertop_images");
        const pastImages = await imagesCollection.find({
            "metadata.estimate.material_type": { $exists: true }
        }).limit(5).toArray();
        console.log("Fetched past images:", pastImages.length);

        const pastData = pastImages.map(img => ({
            material_type: img.metadata.estimate.material_type || "Unknown",
            condition: img.metadata.estimate.condition,
            solutions: img.metadata.estimate.solutions || "Professional evaluation required",
            likes: img.metadata.likes || 0,
            dislikes: img.metadata.dislikes || 0,
        }));
        console.log("Past data prepared:", pastData);

        const prompt = `You are CARI, a professional countertop and remodeling expert estimator at Surprise Granite with the latest industry knowledge as of March 2025. Analyze this countertop image and customer needs ("${customerNeeds}") for a precise estimate:
        - Project scope: New installation, replacement, or repair (use customer needs or infer; default "replacement").
        - Material type: Identify material (e.g., "Quartz", "Granite") from image with confidence; if uncertain, return "Unknown".
        - Color and pattern: Describe briefly from image.
        - Dimensions: Use customer needs (e.g., "25 sq ft") or assume 25 sq ft for kitchen, 5 sq ft for vanity.
        - Additional features: List extras (e.g., "sink cutout") as an array from customer needs or image; default to [].
        - Condition: For repairs, detect damage (e.g., "crack") and severity (None, Low, Moderate, Severe); default { damage_type: "No visible damage", severity: "None" }.
        - Solutions: Propose repair or replacement solutions based on condition and past data (${JSON.stringify(pastData)}). Consider user feedback (likes/dislikes) to refine suggestions; prioritize highly liked solutions. Suggest modern techniques or materials if applicable.
        - Reasoning: Explain concisely, note assumptions, and reference past data/feedback if used.
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
        result.solutions = result.solutions || "No specific solutions identified; contact for professional evaluation.";
        console.log("Estimate result:", result);
        return result;
    } catch (err) {
        logError("OpenAI estimate failed", err);
        const fallback = {
            project_scope: "Replacement",
            material_type: "Unknown",
            color_and_pattern: "Not identified",
            dimensions: "25 sq ft (assumed)",
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: "Contact for professional evaluation.",
            reasoning: "Estimate failed: " + err.message + ". Assumed 25 sq ft kitchen countertop.",
        };
        console.log("Returning fallback estimate:", fallback);
        return fallback;
    }
}

async function generateTTS(estimate, customerNeeds) {
    console.log("Generating TTS for estimate");
    const costEstimate = enhanceCostEstimate(estimate);
    const narrationText = `Your Surprise Granite estimate: 
        Project: ${estimate.project_scope || "Replacement"}. 
        Material: ${estimate.material_type || "Unknown"}. 
        Dimensions: ${estimate.dimensions || "25 sq ft"}. 
        Features: ${estimate.additional_features.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition.damage_type}, ${estimate.condition.severity}. 
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
        return Buffer.from("");
    }
}

function enhanceCostEstimate(estimate) {
    console.log("Enhancing cost estimate for:", estimate.material_type);
    if (!laborData.length || !materialsData.length) {
        console.log("No labor or materials data available");
        return { materialCost: "Contact for estimate", laborCost: { total: "Contact for estimate" }, additionalFeaturesCost: "$0", totalCost: "Contact for estimate" };
    }

    const dimensions = estimate.dimensions || "25 sq ft";
    const sqFtMatch = dimensions.match(/(\d+)-?(\d+)?\s*sq\s*ft/i);
    const sqFt = sqFtMatch ? (sqFtMatch[2] ? (parseInt(sqFtMatch[1]) + parseInt(sqFtMatch[2])) / 2 : parseInt(sqFtMatch[1])) : 25;
    console.log("Calculated sq ft:", sqFt);

    const materialType = estimate.material_type || "Unknown";
    const material = materialsData.find(m => m.type.toLowerCase() === materialType.toLowerCase()) || { cost_per_sqft: 50 };
    const baseMaterialCost = material.cost_per_sqft * sqFt;
    const materialCostWithMargin = baseMaterialCost * 1.3; // 30% margin
    console.log("Material cost with margin:", materialCostWithMargin);

    let laborCost = 0;
    if (estimate.project_scope?.toLowerCase() === "repair" && estimate.condition.damage_type !== "No visible damage") {
        const damageType = estimate.condition.damage_type.toLowerCase();
        const laborEntry = laborData.find(entry => entry.type === damageType) || { rate_per_sqft: 15, hours: 1 };
        const severityMultiplier = { None: 0, Low: 1, Moderate: 2, Severe: 3 }[estimate.condition.severity] || 1;
        laborCost = laborEntry.rate_per_sqft * sqFt * laborEntry.hours * severityMultiplier;
        console.log("Repair labor cost:", laborCost);
    } else {
        const installEntry = laborData.find(entry => entry.type === "installation") || { rate_per_sqft: 15, hours: 1 };
        laborCost = installEntry.rate_per_sqft * sqFt * installEntry.hours;
        console.log("Installation labor cost:", laborCost);
    }

    const featuresCost = estimate.additional_features.reduce((sum, feature) => {
        const featureLower = feature.toLowerCase();
        const laborEntry = laborData.find(entry => featureLower.includes(entry.type)) || { rate_per_unit: 0, rate_per_linear_ft: 0, rate_per_sqft: 0 };
        if (laborEntry.rate_per_unit) return sum + laborEntry.rate_per_unit;
        if (laborEntry.rate_per_linear_ft) return sum + (laborEntry.rate_per_linear_ft * sqFt);
        return sum + (laborEntry.rate_per_sqft * sqFt || 0);
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
    logError(`Unhandled error in ${req.method} ${req.path}`, err);
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
    if (mongoClient) {
        await mongoClient.close();
        console.log("MongoDB connection closed");
    }
    process.exit(0);
});

startServer();
