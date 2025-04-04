import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import { MongoClient, Binary, ObjectId } from "mongodb";
import OpenAI from "openai";
import nodemailer from "nodemailer";
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
        const allowedTypes = ["image/jpeg", "image/png", "audio/wav"];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error("Only JPEG, PNG, or WAV allowed"), false);
        }
        cb(null, true);
    }
});

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static("public"));

async function loadLaborData() {
    laborData = [
        { type: "countertop_repair", rate_per_sqft: 15 },
        { type: "countertop_replacement", rate_per_sqft: 20 },
        { type: "sink_repair", rate_per_sqft: 10 },
        { type: "sink_replacement", rate_per_sqft: 25 }
    ];
}

async function loadMaterialsData() {
    materialsData = [
        { type: "Granite", color: "Generic", cost_per_sqft: 50 },
        { type: "Quartz", color: "Generic", cost_per_sqft: 60 },
        { type: "Sink", color: "Stainless Steel", cost_per_sqft: 20 }
    ];
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
    }
}

async function ensureMongoDBConnection() {
    if (!appState.db && process.env.MONGODB_URI) await connectToMongoDB();
}

async function extractFileContent(file) {
    if (file.mimetype.startsWith("image/")) {
        const image = await Jimp.read(file.buffer);
        return { type: "image", content: (await image.getBase64Async(Jimp.MIME_JPEG)).split(",")[1] };
    } else if (file.mimetype === "audio/wav") {
        return { type: "audio", content: file.buffer };
    }
    throw new Error("Unsupported file type");
}

async function estimateProject(fileDataArray, customerNeeds) {
    await ensureMongoDBConnection();
    const needsLower = customerNeeds.toLowerCase();
    const keywords = {
        dimensions: needsLower.match(/(\d+\.?\d*)\s*(?:sq\s*ft|sft|square\s*feet)/i)?.[1],
        material: needsLower.match(/granite|quartz|marble|sink/i)?.[0],
        scope: needsLower.includes("repair") ? "repair" : "replacement",
        edge: needsLower.match(/bullnose|ogee|bevel/i)?.[0],
        features: needsLower.match(/sink|backsplash|cutout/i)?.map(f => f.toLowerCase()) || []
    };

    let spokenText = "";
    for (const file of fileDataArray) {
        if (file.type === "audio") {
            const audioResponse = await openai.audio.transcriptions.create({
                file: fs.createReadStream(Buffer.from(file.content)),
                model: "whisper-1"
            });
            spokenText += audioResponse.text + " ";
        }
    }
    const fullNeeds = `${customerNeeds} ${spokenText}`.trim();

    const prompt = `You are CARI, an expert AI at Surprise Granite, specializing in countertop and remodeling analysis as of April 04, 2025. Analyze ${fileDataArray.length} files (images or audio) and customer needs ("${fullNeeds}"):
        - Recommend "Repair" or "Replacement" for countertops, sinks, or related features.
        - Detect specific issues: countertop damage (cracks, chips, etching, stains, scratches), sink problems (falling in, broken, leaking), or structural wear.
        - Assess severity (Low, Moderate, Severe).
        - Identify material (e.g., Granite, Quartz, Marble, Stainless Steel) from texture, sheen, or audio description.
        - Determine color and patterns (e.g., Black Pearl with veins).
        - Analyze edge profiles (e.g., bullnose, ogee) and additional features (e.g., sink cutout, backsplash).
        - Use customer needs or spoken input for dimensions, material, or scope.
        - Provide detailed reasoning, including image/audio observations and recommendations.
        - Always suggest contacting Surprise Granite at ${SURPRISE_GRANITE_PHONE} for precise quotes or complex issues.
        - Respond in JSON with:
          - recommendation: e.g., "Repair" or "Replacement"
          - material_type: e.g., "Granite"
          - color: e.g., "Black Pearl"
          - dimensions: e.g., "25 Square Feet"
          - condition: { damage_type: e.g., "Cracks", severity: e.g., "Moderate" }
          - edge_profile: e.g., "Bullnose"
          - additional_features: array, e.g., ["sink cutout"]
          - solutions: e.g., "Seal cracks or contact ${SURPRISE_GRANITE_PHONE}"
          - reasoning: Detailed analysis
    `;

    const messages = [
        { role: "system", content: prompt },
        {
            role: "user",
            content: fileDataArray.length
                ? fileDataArray.map((f) => ({
                    type: f.type === "image" ? "image_url" : "text",
                    [f.type === "image" ? "image_url" : "text"]: f.type === "image" ? { url: `data:image/jpeg;base64,${f.content}` } : spokenText
                }))
                : fullNeeds
        }
    ];

    let estimate;
    if (openai) {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: 2000,
            temperature: 0.7,
            response_format: { type: "json_object" }
        });
        estimate = JSON.parse(response.choices[0].message.content);
    } else {
        estimate = {
            recommendation: keywords.scope === "repair" ? "Repair" : "Replacement",
            material_type: keywords.material || "Granite",
            color: "Not identified",
            dimensions: `${keywords.dimensions || 25} Square Feet`,
            condition: { damage_type: "No visible damage", severity: "None" },
            edge_profile: keywords.edge || "Standard",
            additional_features: keywords.features,
            solutions: `Contact ${SURPRISE_GRANITE_PHONE} for evaluation`,
            reasoning: "No AI available, using defaults based on customer needs or spoken input"
        };
    }

    if (appState.db) {
        const imagesCollection = appState.db.collection("countertop_images");
        const imageIds = await Promise.all(
            fileDataArray.map(async (fileData) => {
                const insertResult = await imagesCollection.insertOne({
                    fileData: new Binary(Buffer.from(fileData.content, "base64")),
                    metadata: { estimate, uploadDate: new Date(), likes: 0, dislikes: 0 }
                });
                return insertResult.insertedId.toString();
            })
        );
        estimate.imageIds = imageIds;
    }

    estimate.feedback_prompt = `Rate this at ${BASE_URL}`;
    estimate.consultation_prompt = `Call ${SURPRISE_GRANITE_PHONE} for a free consultation`;
    return estimate;
}

function enhanceCostEstimate(estimate) {
    const sqFt = parseFloat(estimate.dimensions.match(/(\d+\.?\d*)/)?.[1] || 25);
    const material = materialsData.find(m => m.type.toLowerCase() === estimate.material_type.toLowerCase()) || { cost_per_sqft: 50 };
    const labor = laborData.find(l => l.type.includes(estimate.recommendation.toLowerCase())) || { rate_per_sqft: 15 };
    const materialCost = estimate.recommendation === "Repair" ? 0 : material.cost_per_sqft * sqFt;
    const laborCost = labor.rate_per_sqft * sqFt;
    const additionalCost = (estimate.additional_features || []).length * 50;
    const mid = materialCost + laborCost + additionalCost;
    return {
        low: mid * 0.8,
        mid,
        high: mid * 1.2
    };
}

async function generateTTS(estimate) {
    if (!openai) return null;
    const costEstimate = enhanceCostEstimate(estimate);
    const text = `Your recommendation: ${estimate.recommendation}. Material: ${estimate.material_type}. Color: ${estimate.color}. Dimensions: ${estimate.dimensions}. Condition: ${estimate.condition.damage_type}, severity ${estimate.condition.severity}. Edge profile: ${estimate.edge_profile}. Additional features: ${estimate.additional_features.join(", ") || "none"}. Cost range: from $${costEstimate.low.toFixed(2)} to $${costEstimate.high.toFixed(2)}. Solutions: ${estimate.solutions}. ${estimate.consultation_prompt}`;
    const response = await openai.audio.speech.create({ model: "tts-1", voice: "alloy", input: text });
    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(tempDir, `tts-${Date.now()}.mp3`);
    await fs.writeFile(filePath, audioBuffer);
    return filePath;
}

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.post("/api/estimate", upload.array("files", 9), async (req, res) => {
    try {
        const customerNeeds = req.body.customer_needs || "";
        const name = req.body.name || "Unknown";
        const phone = req.body.phone || "Not provided";
        const email = req.body.email || "unknown@example.com";
        const files = req.files || [];
        if (!files.length && !customerNeeds) return res.status(400).json({ error: "Upload files or provide needs" });

        const fileDataArray = await Promise.all(files.map(extractFileContent));
        const estimate = await estimateProject(fileDataArray, customerNeeds);
        const costEstimate = enhanceCostEstimate(estimate);
        const audioFilePath = await generateTTS(estimate);

        if (transporter && email !== "unknown@example.com") {
            await transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_USER,
                subject: `New Lead: ${name}`,
                text: `Name: ${name}\nPhone: ${phone}\nEmail: ${email}\nNeeds: ${customerNeeds}\nEstimate: ${JSON.stringify(estimate)}\nCost Range: $${costEstimate.low.toFixed(2)} - $${costEstimate.high.toFixed(2)}`
            });
        }

        res.json({
            recommendation: estimate.recommendation,
            materialType: estimate.material_type,
            color: estimate.color,
            dimensions: estimate.dimensions,
            condition: estimate.condition,
            edgeProfile: estimate.edge_profile,
            additionalFeatures: estimate.additional_features,
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
        res.status(500).json({ error: "Server error", details: err.message });
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

app.post("/api/rating", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) return res.status(500).json({ error: "Database not connected" });
        const { imageId, rating } = req.body;
        const imagesCollection = appState.db.collection("countertop_images");
        const objectId = new ObjectId(imageId);
        const updateField = rating === "like" ? "metadata.likes" : "metadata.dislikes";
        await imagesCollection.updateOne({ _id: objectId }, { $inc: { [updateField]: 1 } });
        res.json({ message: `${rating} recorded` });
    } catch (err) {
        console.error("Rating failed:", err);
        res.status(500).json({ error: "Rating failed" });
    }
});

function startServer() {
    const server = app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        Promise.all([loadLaborData(), loadMaterialsData(), connectToMongoDB()]);
    });

    setInterval(() => {
        console.log("Keep-alive ping");
    }, 300000);

    process.on("SIGTERM", () => {
        console.log("SIGTERM received, shutting down...");
        if (appState.mongoClient) appState.mongoClient.close();
        server.close(() => {
            console.log("Server closed");
            process.exit(0);
        });
    });
}

startServer();
