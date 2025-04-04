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
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Jimp from "jimp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const tempDir = path.join(__dirname, "temp");
fs.mkdir(tempDir, { recursive: true }).catch((err) => console.error("Failed to create temp dir:", err));

let appState = { db: null, mongoClient: null };
let laborData = [];
let materialsData = [];

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

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const transporter = process.env.EMAIL_USER && process.env.EMAIL_PASS
    ? nodemailer.createTransport({
          service: "gmail",
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
      })
    : null;

app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000"], credentials: true }));
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"] } } }));
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ extended: true, limit: "100mb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, keyGenerator: (req) => req.ip }));

async function loadLaborData() {
    try {
        const laborJsonPath = path.join(__dirname, "data", "labor.json");
        const rawData = JSON.parse(await fs.readFile(laborJsonPath, "utf8"));
        laborData = rawData.map((item) => ({
            type: item.Service.toLowerCase().replace(/\s+/g, "_"),
            rate_per_sqft: item["U/M"] === "SQFT" ? item.Price : 0,
            rate_per_unit: ["EA", "LF", "Per Job"].includes(item["U/M"]) ? item.Price : 0,
            unit_measure: item["U/M"],
            hours: item["U/M"] === "SQFT" ? 1 : 0.5
        }));
        console.log("Labor data loaded:", laborData.length, "entries");
    } catch (err) {
        console.error("Failed to load labor.json:", err);
        laborData = [
            { type: "countertop_installation", rate_per_sqft: 20, hours: 1 },
            { type: "countertop_repair", rate_per_sqft: 15, hours: 0.5 }
        ];
    }
}

async function loadMaterialsData() {
    try {
        const materialsJsonPath = path.join(__dirname, "data", "materials.json");
        const rawData = JSON.parse(await fs.readFile(materialsJsonPath, "utf8"));
        materialsData = rawData.map((item) => ({
            type: item.Material,
            color: item["Color Name"],
            cost_per_sqft: item["Cost/SqFt"],
            thickness: item.Thickness || "N/A"
        }));
        console.log("Materials data loaded:", materialsData.length, "entries");
    } catch (err) {
        console.error("Failed to load materials.json:", err);
        materialsData = [
            { type: "Granite", color: "Generic", cost_per_sqft: 50, thickness: "N/A" },
            { type: "Quartz", color: "Generic", cost_per_sqft: 60, thickness: "N/A" }
        ];
    }
}

async function connectToMongoDB() {
    if (!process.env.MONGODB_URI) return;
    try {
        appState.mongoClient = new MongoClient(process.env.MONGODB_URI);
        await appState.mongoClient.connect();
        appState.db = appState.mongoClient.db("countertops");
        console.log("Connected to MongoDB");
    } catch (err) {
        console.error("MongoDB connection failed:", err);
        appState.db = null;
    }
}

async function ensureMongoDBConnection() {
    if (!appState.db && process.env.MONGODB_URI) await connectToMongoDB();
}

async function extractFileContent(file) {
    if (file.mimetype.startsWith("image/")) {
        const image = await Jimp.read(file.buffer);
        return { type: "image", content: (await image.getBase64Async(Jimp.MIME_JPEG)).split(",")[1] };
    } else if (file.mimetype === "application/pdf") {
        return { type: "text", content: "PDF content parsing not implemented" };
    } else if (file.mimetype === "text/plain") {
        return { type: "text", content: file.buffer.toString("utf8") };
    }
    throw new Error("Unsupported file type");
}

async function estimateProject(fileDataArray, customerNeeds) {
    await ensureMongoDBConnection();
    const needsLower = customerNeeds.toLowerCase();
    const keywords = {
        dimensions: needsLower.match(/(\d+\.?\d*)\s*(?:sq\s*ft|sft|square\s*feet)/i)?.[1],
        material: needsLower.match(/granite|quartz|marble|dekton|tile/i)?.[0],
        scope: needsLower.includes("repair") ? "repair" : "replacement"
    };

    const prompt = `You are CARI, an AI at Surprise Granite, providing instant countertop repair/replacement recommendations as of April 04, 2025. Analyze ${fileDataArray.length} files and customer needs ("${customerNeeds}"):
        - Recommend "Repair" or "Replacement" based on damage or intent.
        - For images: Detect damage (cracks, stains, chips) and severity (Low, Moderate, Severe).
        - Suggest material and color if identifiable.
        - Use customer needs for dimensions or material.
        - Encourage contacting Surprise Granite at ${SURPRISE_GRANITE_PHONE}.
        - Solicit feedback at ${BASE_URL}/feedback.

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData)}
        - Materials: ${JSON.stringify(materialsData)}

        Respond in JSON with:
        - recommendation: "Repair" or "Replacement"
        - material_type: e.g., "Granite"
        - color: e.g., "Black Pearl"
        - dimensions: e.g., "25 Square Feet"
        - condition: { damage_type: e.g., "Cracks", severity: e.g., "Moderate" }
        - solutions: e.g., "Seal cracks or contact Surprise Granite"
        - feedback_prompt: "Help us improve! Rate this at ${BASE_URL}/feedback."
        - consultation_prompt: "Call Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a free consultation."
        - reasoning: Explain analysis
    `;

    const messages = [
        { role: "system", content: prompt },
        {
            role: "user",
            content: fileDataArray.length
                ? fileDataArray.map((f) => ({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${f.content}` } }))
                : customerNeeds
        }
    ];
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages,
        max_tokens: 1500,
        temperature: 0.7,
        response_format: { type: "json_object" }
    });

    let result = JSON.parse(response.choices[0].message.content || "{}");
    const estimate = {
        recommendation: result.recommendation || (keywords.scope === "repair" ? "Repair" : "Replacement"),
        material_type: result.material_type || keywords.material || "Granite",
        color: result.color || "Not identified",
        dimensions: result.dimensions || `${keywords.dimensions || 25} Square Feet`,
        condition: result.condition || { damage_type: "No visible damage", severity: "None" },
        solutions: result.solutions || `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`,
        feedback_prompt: result.feedback_prompt || `Help us improve! Rate this at ${BASE_URL}/feedback.`,
        consultation_prompt: result.consultation_prompt || `Call Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a free consultation.`,
        reasoning: result.reasoning || "Based on defaults and input."
    };

    if (appState.db) {
        const imagesCollection = appState.db.collection("countertop_images");
        const imageIds = await Promise.all(
            fileDataArray.map(async (fileData) => {
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
}

function enhanceCostEstimate(estimate) {
    const sqFt = parseFloat(estimate.dimensions.match(/(\d+\.?\d*)/)?.[1] || 25);
    const material = materialsData.find(m => m.type.toLowerCase() === estimate.material_type.toLowerCase()) || { cost_per_sqft: 50 };
    const labor = laborData.find(l => l.type.includes(estimate.recommendation.toLowerCase())) || { rate_per_sqft: 15 };
    const materialCost = estimate.recommendation === "Repair" ? 0 : material.cost_per_sqft * sqFt;
    const laborCost = labor.rate_per_sqft * sqFt;
    return { totalCost: materialCost + laborCost };
}

async function generateTTS(estimate) {
    if (!openai) return null;
    const costEstimate = enhanceCostEstimate(estimate);
    const text = `Your Surprise Granite recommendation: ${estimate.recommendation}. Material: ${estimate.material_type}. Color: ${estimate.color}. Dimensions: ${estimate.dimensions}. Condition: ${estimate.condition.damage_type}, ${estimate.condition.severity}. Cost: $${costEstimate.totalCost.toFixed(2)}. ${estimate.solutions}. ${estimate.consultation_prompt}`;
    const response = await openai.audio.speech.create({ model: "tts-1", voice: "alloy", input: text });
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(tempDir, `tts-${Date.now()}.mp3`);
    await fs.writeFile(filePath, audioBuffer);
    return filePath;
}

app.get("/", (req, res) => res.send("CARI Server is running"));

app.post("/api/contractor-estimate", upload.array("files", 9), async (req, res) => {
    try {
        const customerNeeds = req.body.customer_needs || "";
        const files = req.files || [];
        const fileDataArray = await Promise.all(files.map(extractFileContent));
        const estimate = await estimateProject(fileDataArray, customerNeeds);
        const costEstimate = enhanceCostEstimate(estimate);
        const audioFilePath = await generateTTS(estimate);

        res.status(201).json({
            imageIds: estimate.imageIds || [],
            recommendation: estimate.recommendation,
            materialType: estimate.material_type,
            color: estimate.color,
            dimensions: estimate.dimensions,
            condition: estimate.condition,
            solutions: estimate.solutions,
            costEstimate,
            reasoning: estimate.reasoning,
            feedbackPrompt: estimate.feedback_prompt,
            consultationPrompt: estimate.consultation_prompt,
            audioFilePath,
            shareUrl: estimate.imageIds?.[0] ? `${req.protocol}://${req.get("host")}/api/get-countertop/${estimate.imageIds[0]}` : null,
            likes: 0,
            dislikes: 0
        });
    } catch (err) {
        console.error("Estimate failed:", err);
        res.status(500).json({ error: "Failed to generate recommendation" });
    }
});

app.get("/api/audio/:filename", async (req, res) => {
    const filePath = path.join(tempDir, req.params.filename);
    try {
        const audioBuffer = await fs.readFile(filePath);
        res.setHeader("Content-Type", "audio/mpeg");
        res.send(audioBuffer);
    } catch (err) {
        res.status(404).send("Audio not found");
    }
});

app.post("/api/feedback", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) return res.status(500).json({ error: "Database not connected" });
        const { imageId, rating } = req.body;
        const imagesCollection = appState.db.collection("countertop_images");
        const objectId = new ObjectId(imageId);
        await imagesCollection.updateOne(
            { _id: objectId },
            { $push: { "metadata.feedback": { rating, date: new Date() } } }
        );
        res.status(200).json({ message: "Feedback submitted" });
    } catch (err) {
        res.status(500).json({ error: "Feedback submission failed" });
    }
});

function startServer() {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        Promise.all([loadLaborData(), loadMaterialsData(), connectToMongoDB()]);
    });
}

startServer();
