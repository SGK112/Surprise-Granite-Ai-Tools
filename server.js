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
const { createHash } = require("crypto"); // For image hashing

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
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;

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
            const imageHash = createHash("sha256").update(imageBase64).digest("hex");
            const exists = await imagesCollection.findOne({ imageHash });
            if (!exists) {
                const analysis = await analyzeImageForMetadata(imageBase64);
                await imagesCollection.insertOne({
                    filename: image.name,
                    imageBase64,
                    imageHash,
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
        const imageHash = createHash("sha256").update(imageBase64).digest("hex");
        await fs.unlink(filePath).catch(err => console.error("Failed to delete temp file:", err));

        const imagesCollection = db.collection(COLLECTION_NAME);
        const existing = await imagesCollection.findOne({ imageHash });
        if (existing) {
            console.log("Returning cached analysis for image:", imageHash);
            return res.json({ response: existing.analysis });
        }

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `You are CARI, an expert countertop analyst at Surprise Granite. Analyze the image with precision and conversational tone:
                    - Stone type: Identify specifically (e.g., "This looks like granite") based on texture and pattern.
                    - Material composition: Detail the material conversationally (e.g., "It’s mostly quartz with a bit of resin").
                    - Color and pattern: Describe naturally (e.g., "It’s got a cool brown vibe with black and beige speckles").
                    - Natural stone: True/false with a casual note (e.g., "Yep, it’s natural stone").
                    - Damage type: Specify clearly (e.g., "There’s a noticeable crack here, over 5mm wide").
                    - Severity: Assess with context:
                      - Low: "Just a tiny scratch, no biggie" ($50-$150).
                      - Moderate: "A decent crack, worth fixing" ($200-$500).
                      - Severe: "Whoa, this crack’s serious—structural stuff" ($1000+ or replacement).
                    - Estimated cost range: Tie to severity (e.g., "You’re looking at $1500-$3000 for this one").
                    - Professional recommendation: Always end with "Contact Surprise Granite for further details" (e.g., "I’d say replace it. Contact Surprise Granite for further details").
                    - Cleaning recommendation: Practical tip (e.g., "Stick to mild soap and water—keep it simple").
                    - Repair recommendation: DIY or pro advice (e.g., "A pro should handle this crack—too big for DIY").
                    Use image data only, no defaults. Respond in JSON format with keys: stone_type, material_composition, color_and_pattern, natural_stone, damage_type, severity, estimated_cost_range, professional_recommendation, cleaning_recommendation, repair_recommendation.`
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Analyze this countertop image with maximum accuracy. Focus on damage severity, material details, and give conversational cleaning and repair tips." },
                        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                    ]
                }
            ],
            max_tokens: 1500,
            temperature: 0.7 // Slightly higher for conversational tone
        });

        const content = response.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("Invalid JSON response from OpenAI");

        const result = JSON.parse(jsonMatch[0]);
        console.log("Analysis successful:", result);

        if (db) {
            await imagesCollection.insertOne({ imageBase64, imageHash, analysis: result, createdAt: new Date() });
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

// Submit Lead Endpoint with EmailJS
app.post("/api/submit-lead", async (req, res) => {
    console.log("Received request to /api/submit-lead");
    try {
        const leadData = req.body;
        if (!leadData.name || !leadData.email) return res.status(400).json({ error: "Name and email are required" });

        // Store in MongoDB
        let leadId;
        if (db) {
            const leadsCollection = db.collection(LEADS_COLLECTION_NAME);
            const result = await leadsCollection.insertOne({ ...leadData, status: "new", createdAt: new Date() });
            leadId = result.insertedId;
            console.log("Lead saved to MongoDB:", leadId);
        } else {
            leadId = "simulated-" + Date.now();
            console.log("No DB connection, simulating lead save:", leadData);
        }

        // Send via EmailJS (client-side will handle this, but adding server-side option)
        // Note: EmailJS is typically client-side, so this is a fallback if needed
        const emailData = {
            service_id: EMAILJS_SERVICE_ID,
            template_id: EMAILJS_TEMPLATE_ID,
            user_id: process.env.EMAILJS_PUBLIC_KEY, // Public key from .env
            template_params: {
                from_name: leadData.name,
                from_email: leadData.email,
                message: leadData.message,
                stone_type: leadData.analysisResult?.stone_type || "N/A",
                damage_type: leadData.analysisResult?.damage_type || "N/A",
                severity: leadData.analysisResult?.severity || "N/A"
            }
        };

        // For server-side EmailJS, you'd need an API key and a different setup. Here, we’ll assume client-side handles it.
        console.log("EmailJS data prepared (client-side will send):", emailData);

        res.json({ success: true, leadId });
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
