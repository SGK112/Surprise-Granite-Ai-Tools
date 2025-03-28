require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs").promises;
const path = require("path");
const { MongoClient } = require("mongodb");
const OpenAI = require("openai");
const axios = require("axios");

const app = express();
const upload = multer({ dest: "uploads/" });

// Configuration
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://CARI:%4011560Ndysart@cluster1.s4iodnn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";
const DB_NAME = "countertops";
const COLLECTION_NAME = "countertops.images";
const LEADS_COLLECTION_NAME = "leads";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "yourusername/your-repo"; // Replace with your GitHub repo

// Initialize OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let client;
let db;

// MongoDB Connection
async function connectToMongoDB() {
    try {
        client = new MongoClient(MONGODB_URI, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        await client.connect();
        db = client.db(DB_NAME);
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        console.error("Failed to connect to MongoDB:", err.message);
    }
}

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health Check Endpoint
app.get("/api/health", (req, res) => {
    const dbStatus = client && client.topology?.isConnected() ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: PORT, dbStatus, openAIConfigured: !!OPENAI_API_KEY });
});

// Import GitHub Images to MongoDB with Metadata
async function importGitHubImages() {
    if (!GITHUB_TOKEN || !db) {
        console.error("GitHub token or DB missing");
        return;
    }
    try {
        const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/images`, {
            headers: { Authorization: `token ${GITHUB_TOKEN}` },
        });
        const images = response.data.filter(file => /\.(jpg|jpeg|png)$/i.test(file.name));
        const imagesCollection = db.collection(COLLECTION_NAME);

        for (const image of images) {
            const imageResponse = await axios.get(image.download_url, { responseType: "arraybuffer" });
            const imageBase64 = Buffer.from(imageResponse.data).toString("base64");
            const exists = await imagesCollection.findOne({ filename: image.name });
            if (!exists) {
                const analysis = await analyzeImageForMetadata(imageBase64);
                await imagesCollection.insertOne({
                    filename: image.name,
                    imageBase64,
                    analysis,
                    createdAt: new Date(),
                    metadata: {
                        stone_type: analysis.stone_type,
                        color_and_pattern: analysis.color_and_pattern,
                        natural_stone: analysis.natural_stone,
                        potential_use: "countertop"
                    }
                });
                console.log(`Imported and analyzed ${image.name}`);
            }
        }
        console.log(`Imported ${images.length} images from GitHub`);
    } catch (err) {
        console.error("Failed to import GitHub images:", err.message);
    }
}

// Helper: Analyze Image for Metadata
async function analyzeImageForMetadata(imageBase64) {
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "system",
                content: `Analyze this image for countertop metadata:
                - Stone type (granite, quartz, marble, etc.)
                - Color and pattern
                - Natural stone (true/false)
                Respond in JSON format with keys: stone_type, color_and_pattern, natural_stone.`
            },
            {
                role: "user",
                content: [
                    { type: "text", text: "Analyze this image" },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ]
            }
        ],
        max_tokens: 500,
        temperature: 0.5
    });
    const content = response.choices[0].message.content.match(/\{[\s\S]*\}/)[0];
    return JSON.parse(content);
}

// Analyze Damage Endpoint
app.post("/api/analyze-damage", upload.single("file"), async (req, res) => {
    console.log("Received request to /api/analyze-damage");
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (!OPENAI_API_KEY) return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key" });

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath);
        const imageBase64 = imageBuffer.toString("base64");
        await fs.unlink(filePath).catch(err => console.error("Failed to delete temp file:", err));

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `You are CARI, an expert countertop analyst at Surprise Granite. Analyze the image with precision and NO FALLBACKS:
                    - Stone type: Identify specifically (e.g., granite, quartz, marble) based on texture and pattern.
                    - Material composition: Detail the material (e.g., "90% quartz, 10% resin" for man-made; "igneous rock with feldspar" for natural).
                    - Color and pattern: Describe precisely (e.g., "brown with black and beige speckles").
                    - Natural stone: True/false based on composition and appearance.
                    - Damage type: Specify (e.g., "crack >5mm wide," "surface scratch"). Detect all damage accurately.
                    - Severity: Assess rigorously:
                      - Low: Minor cosmetic (e.g., scratches <1mm deep, $50-$150).
                      - Moderate: Aesthetic/functional impact (e.g., cracks 1-5mm, $200-$500).
                      - Severe: Structural damage (e.g., cracks >5mm, broken edges, $1000+ or replacement).
                    - Estimated cost range: Realistic, tied to severity (e.g., severe = $1500-$3000 or "replacement cost").
                    - Professional recommendation: Always include "Contact Surprise Granite for further details" plus specific advice (repair, replace, or inspect; severe = replacement).
                    - Cleaning recommendation: Suggest a method based on stone type and damage (e.g., "Use mild soap and water for granite, avoid abrasives").
                    - Repair recommendation: Suggest a DIY or professional fix based on damage (e.g., "Epoxy filler for small cracks, professional repair for severe damage").
                    Use image data only—do not guess or use defaults. Respond in JSON format with keys: stone_type, material_composition, color_and_pattern, natural_stone, damage_type, severity, estimated_cost_range, professional_recommendation, cleaning_recommendation, repair_recommendation.`
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Analyze this countertop image with maximum accuracy. Focus on damage severity, material details, and provide cleaning and repair recommendations." },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                    ]
                }
            ],
            max_tokens: 1500, // Increased for extra fields
            temperature: 0.3
        });

        const content = response.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid JSON response from OpenAI");

        const result = JSON.parse(jsonMatch[0]);
        console.log("Analysis successful:", result);

        if (db) {
            const imagesCollection = db.collection(COLLECTION_NAME);
            await imagesCollection.insertOne({ imageBase64, analysis: result, createdAt: new Date() });
        }

        res.json({ response: result });
    } catch (err) {
        console.error("Analysis error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// TTS Endpoint
app.post("/api/tts", async (req, res) => {
    console.log("Received request to /api/tts");
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "Text is required" });
        if (!OPENAI_API_KEY) return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key" });

        const response = await openai.audio.speech.create({
            model: "tts-1",
            voice: "nova",
            input: text,
            response_format: "mp3",
        });

        res.set({ "Content-Type": "audio/mp3", "Content-Disposition": "inline; filename=\"tts.mp3\"" });
        response.body.pipe(res);
    } catch (err) {
        console.error("TTS error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Submit Lead Endpoint
app.post("/api/submit-lead", async (req, res) => {
    console.log("Received request to /api/submit-lead");
    try {
        const leadData = req.body;
        if (!leadData.name || !leadData.email) return res.status(400).json({ error: "Name and email are required" });

        if (db) {
            const leadsCollection = db.collection(LEADS_COLLECTION_NAME);
            const result = await leadsCollection.insertOne({ ...leadData, status: "new", createdAt: new Date() });
            console.log("Lead saved:", result.insertedId);
            res.json({ success: true, leadId: result.insertedId });
        } else {
            console.log("No DB connection, simulating lead save:", leadData);
            res.json({ success: true, leadId: "simulated-" + Date.now() });
        }
    } catch (err) {
        console.error("Lead submission error:", err.message);
        res.status(500).json({ error: "Failed to save lead" });
    }
});

// Root Endpoint
app.get("/", (req, res) => {
    res.send("✅ CARI API is live");
});

// Cleanup on Shutdown
process.on("SIGTERM", async () => {
    if (client) await client.close();
    console.log("Server shut down");
    process.exit(0);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err.message);
    process.exit(1);
});

// Start Server
async function startServer() {
    try {
        await connectToMongoDB();
        await importGitHubImages();
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Health check: https://surprise-granite-connections-dev.onrender.com/api/health`);
        });
    } catch (err) {
        console.error("Failed to start server:", err.message);
        process.exit(1);
    }
}

startServer();
