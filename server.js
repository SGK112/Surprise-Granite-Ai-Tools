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
    try {
        const materialsJsonPath = path.join(__dirname, "data", "materials.json");
        materialsData = JSON.parse(await fs.readFile(materialsJsonPath, "utf8")).map(item => ({
            type: item.Material,
            color: item["Color Name"],
            cost_per_sqft: item["Cost/SqFt"]
        }));
        console.log("Materials data loaded:", materialsData.length, "entries");
    } catch (err) {
        console.error("Failed to load materials.json:", err);
        materialsData = [
            { type: "Granite", color: "Generic", cost_per_sqft: 50 },
            { type: "Quartz", color: "Generic", cost_per_sqft: 60 },
            { type: "Sink", color: "Stainless Steel", cost_per_sqft: 20 }
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
    }
}

async function ensureMongoDBConnection() {
    if (!appState.db && process.env.MONGODB_URI) await connectToMongoDB();
}

async function extractFileContent(file) {
    try {
        if (file.mimetype.startsWith("image/")) {
            const image = await Jimp.read(file.buffer);
            return { type: "image", content: (await image.getBase64Async(Jimp.MIME_JPEG)).split(",")[1] };
        } else if (file.mimetype === "audio/wav") {
            return { type: "audio", content: file.buffer };
        }
        throw new Error("Unsupported file type");
    } catch (err) {
        console.error("File extraction failed:", err);
        throw err;
    }
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
            try {
                const audioResponse = await openai.audio.transcriptions.create({
                    file: fs.createReadStream(Buffer.from(file.content)),
                    model: "whisper-1"
                });
                spokenText += audioResponse.text + " ";
            } catch (err) {
                console.error("Audio transcription failed:", err);
                spokenText += "Audio unavailable ";
            }
        }
    }
    const fullNeeds = `${customerNeeds} ${spokenText}`.trim();

    const prompt = `You are CARI, an expert AI at Surprise Granite, specializing in countertop and remodeling analysis as of April 04, 2025. Analyze ${fileDataArray.length} files (primarily images, with optional audio) and customer needs ("${fullNeeds}"), prioritizing image analysis:
        - Recommend "Repair" or "Replacement" for countertops, sinks, or related features based on image evidence.
        - Detect specific issues: countertop damage (cracks, chips, etching, stains, scratches), sink problems (falling in, broken, leaking), or structural wear.
        - Assess severity (Low, Moderate, Severe) from visual cues.
        - Identify material (e.g., Granite, Quartz, Marble, Stainless Steel) from texture, sheen, or patterns in images.
        - Determine color and patterns (e.g., Black Pearl with veins) from images.
        - Analyze edge profiles (e.g., bullnose, ogee) and additional features (e.g., sink cutout, backsplash) from images.
        - Use customer needs or spoken input only as secondary context if images are unclear.
        - Provide detailed reasoning, focusing on image-based observations, and recommend contacting Surprise Granite at ${SURPRISE_GRANITE_PHONE} for precise quotes or complex issues.
        - Respond in JSON with:
          - recommendation: e.g., "Repair" or "Replacement"
          - material_type: e.g., "Granite"
          - color: e.g., "Black Pearl"
          - dimensions: e.g., "25 Square Feet"
          - condition: { damage_type: e.g., "Cracks", severity: e.g., "Moderate" }
          - edge_profile: e.g., "Bullnose"
          - additional_features: array, e.g., ["sink cutout"]
          - solutions: e.g., "Seal cracks or contact ${SURPRISE_GRANITE_PHONE}"
          - reasoning: Detailed image-based analysis
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
    try {
        if (openai) {
            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages,
                max_tokens: 2000,
                temperature: 0.7,
                response_format: { type: "json_object" }
            });
            estimate = JSON.parse(response.choices[0].message.content);
            console.log("Estimate generated:", estimate);
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
                reasoning: "No AI available, using defaults based on limited input"
            };
            console.log("Fallback estimate:", estimate);
        }
    } catch (err) {
        console.error("OpenAI analysis failed:", err);
        estimate = {
            recommendation: "Replacement",
            material_type: "Granite",
            color: "Not identified",
            dimensions: "25 Square Feet",
            condition: { damage_type: "Unknown", severity: "Unknown" },
            edge_profile: "Standard",
            additional_features: [],
            solutions: `Contact ${SURPRISE_GRANITE_PHONE} for evaluation`,
            reasoning: "Analysis failed due to server error, defaulting to basic estimate"
        };
    }

    if (appState.db) {
        try {
            const imagesCollection = appState.db.collection("countertop_images");
            const imageIds = await Promise.all(
                fileDataArray.map(async (fileData) => {
                    const insertResult = await imagesCollection.insertOne({
                        fileData: new Binary(Buffer.from(fileData.content)),
                        metadata: { estimate, uploadDate: new Date(), likes: 0, dislikes: 0 }
                    });
                    return insertResult.insertedId.toString();
                })
            );
            estimate.imageIds = imageIds;
            console.log("Images stored in MongoDB with IDs:", imageIds);
        } catch (err) {
            console.error("MongoDB insert failed:", err);
        }
    }

    estimate.feedback_prompt = `Rate this at ${BASE_URL}`;
    estimate.consultation_prompt = `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a detailed quote`;
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

function numberToWords(num) {
    const units = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
    const teens = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
    const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
    
    if (num === 0) return "zero";
    if (num < 10) return units[num];
    if (num < 20) return teens[num - 10];
    if (num < 100) return `${tens[Math.floor(num / 10)]} ${units[num % 10]}`.trim();
    if (num < 1000) return `${units[Math.floor(num / 100)]} hundred ${numberToWords(num % 100)}`.trim();
    if (num < 1000000) return `${numberToWords(Math.floor(num / 1000))} thousand ${numberToWords(num % 1000)}`.trim();
    return num.toString();
}

async function generateTTS(estimate) {
    if (!openai) return null;
    const costEstimate = enhanceCostEstimate(estimate);
    const lowWords = numberToWords(Math.floor(costEstimate.low)) + " dollars";
    const highWords = numberToWords(Math.floor(costEstimate.high)) + " dollars";
    const text = `Based on my detailed analysis, I confidently recommend ${estimate.recommendation} for your project. The material is ${estimate.material_type}, color ${estimate.color}, with dimensions of ${estimate.dimensions}. I’ve identified ${estimate.condition.damage_type} with ${estimate.condition.severity} severity. The edge profile is ${estimate.edge_profile}, and additional features include ${estimate.additional_features.join(", ") || "none"}. The estimated cost ranges from ${lowWords} to ${highWords}. For the best solution, ${estimate.solutions}. Please contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a precise quote.`;
    try {
        const response = await openai.audio.speech.create({ model: "tts-1", voice: "alloy", input: text });
        const audioBuffer = Buffer.from(await response.arrayBuffer());
        const filePath = path.join(tempDir, `tts-${Date.now()}.mp3`);
        await fs.writeFile(filePath, audioBuffer);
        console.log("TTS generated at:", filePath);
        return filePath;
    } catch (err) {
        console.error("TTS generation failed:", err);
        return null;
    }
}

app.get("/", (req, res) => {
    console.log("Serving index.html");
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/estimate", upload.array("files", 9), async (req, res) => {
    try {
        console.log("Received estimate request:", req.body, req.files?.length);
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
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: process.env.EMAIL_USER,
                    subject: `New Lead: ${name}`,
                    text: `Name: ${name}\nPhone: ${phone}\nEmail: ${email}\nNeeds: ${customerNeeds}\nEstimate: ${JSON.stringify(estimate)}\nCost Range: $${costEstimate.low.toFixed(2)} - $${costEstimate.high.toFixed(2)}`
                });
                console.log("Lead email sent successfully");
            } catch (err) {
                console.error("Lead email failed:", err);
            }
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
        console.error("Estimate endpoint failed:", err);
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
        console.error("Audio fetch failed:", err);
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

app.post("/api/tts", async (req, res) => {
    const { text } = req.body;
    if (!openai || !text) return res.status(400).send("TTS unavailable or no text provided");
    try {
        const response = await openai.audio.speech.create({ model: "tts-1", voice: "alloy", input: text });
        const audioBuffer = Buffer.from(await response.arrayBuffer());
        res.setHeader("Content-Type", "audio/mpeg");
        res.send(audioBuffer);
    } catch (err) {
        console.error("TTS endpoint failed:", err);
        res.status(500).send("TTS generation failed");
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
