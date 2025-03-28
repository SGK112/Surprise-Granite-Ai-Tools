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
const { createHash } = require("crypto");

const app = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });

// Configuration
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://CARI:%4011560Ndysart@cluster1.s4iodnn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";
const DB_NAME = "countertops";
const COLLECTION_NAME = "home_items";
const LEADS_COLLECTION_NAME = "leads";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "yourusername/your-repo"; // Replace with your GitHub repo
const STRIPE_API_KEY = "your_stripe_api_key"; // Add your Stripe API key here

// Initialize OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let client;
let db;

// MongoDB Connection
async function connectToMongoDB() {
    try {
        client = new MongoClient(MONGODB_URI, {
            maxPoolSize: 20,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        await client.connect();
        db = client.db(DB_NAME);
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        console.error("Failed to connect to MongoDB:", err.message);
        process.exit(1);
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

// Import GitHub Images to MongoDB
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
        const itemsCollection = db.collection(COLLECTION_NAME);

        console.log(`Found ${images.length} images in GitHub repo`);
        let importedCount = 0;

        for (const image of images) {
            const imageResponse = await axios.get(image.download_url, { responseType: "arraybuffer" });
            const imageBase64 = Buffer.from(imageResponse.data).toString("base64");
            const imageHash = createHash("sha256").update(imageBase64).digest("hex");
            const exists = await itemsCollection.findOne({ imageHash });

            if (!exists) {
                const analysis = await analyzeImage(imageBase64, "countertop");
                await itemsCollection.insertOne({
                    filename: image.name,
                    imageBase64,
                    imageHash,
                    analysis,
                    createdAt: new Date(),
                    metadata: {
                        item_type: analysis.item_type || "countertop",
                        stone_type: analysis.stone_type,
                        color_and_pattern: analysis.color_and_pattern,
                        natural_stone: analysis.natural_stone,
                        vendor: image.name.includes("vendor") ? "Unknown Vendor" : null
                    }
                });
                importedCount++;
                console.log(`Imported ${image.name} (${importedCount}/${images.length})`);
            }
        }
        console.log(`Successfully imported ${importedCount} new images from GitHub. Total in DB: ${await itemsCollection.countDocuments()}`);
    } catch (err) {
        console.error("Failed to import GitHub images:", err.message);
    }
}

// Analyze Image
async function analyzeImage(imageBase64, itemType = "countertop") {
    const prompt = `You are CARI, an expert countertop analyst at Surprise Granite with advanced vision. Analyze this countertop image with precision and conversational tone, detecting damage not always visible to the naked eye:
    - Item type: Confirm it’s a countertop.
    - Stone type: Identify specifically (e.g., "This looks like granite") based on texture and pattern.
    - Material composition: Detail conversationally (e.g., "It’s mostly quartz with a bit of resin").
    - Color and pattern: Describe naturally (e.g., "It’s got a cool brown vibe with black and beige speckles").
    - Natural stone: True/false with a note (e.g., "Yep, it’s natural stone").
    - Damage type: Specify clearly, including hidden issues (e.g., "There’s a hairline crack under the surface" or "No damage here, looks clean!").
    - Severity: Assess with context:
      - None: "No damage at all, it’s in great shape!" ($0).
      - Low: "Just a tiny scratch, no biggie" ($50-$150).
      - Moderate: "A decent crack, worth fixing" ($200-$500).
      - Severe: "Whoa, this crack’s serious—structural stuff" ($1000+ or replacement).
    - Estimated cost range: Tie to severity (e.g., "You’re looking at $1500-$3000 for this one" or "$0, it’s perfect!").
    - Professional recommendation: If damage, "Contact Surprise Granite for repair or replacement—our subscription plans start at $29/month!" If none, "No repairs needed—keep it pristine with Surprise Granite’s cleaning subscription starting at $29/month!"
    - Cleaning recommendation: Practical tip (e.g., "Stick to mild soap and water—our cleaning service can keep it sparkling!").
    - Repair recommendation: DIY or pro advice (e.g., "A pro should handle this crack—subscribe to our repair service!" or "No repairs needed, but our cleaning subscription keeps it great!").
    Use image data only, be honest if no damage is found. Respond in JSON format with keys: item_type, stone_type, material_composition, color_and_pattern, natural_stone, damage_type, severity, estimated_cost_range, professional_recommendation, cleaning_recommendation, repair_recommendation.`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: prompt },
            {
                role: "user",
                content: [
                    { type: "text", text: "Analyze this countertop image with maximum accuracy. Look for hidden damage and be honest if there’s none." },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ]
            }
        ],
        max_tokens: 1500,
        temperature: 0.5
    });

    const content = response.choices[0].message.content.match(/\{[\s\S]*\}/);
    if (!content) throw new Error("Invalid JSON response from OpenAI");
    return JSON.parse(content[0]);
}

// Analyze Damage Endpoint
app.post("/api/analyze-damage", upload.single("file"), async (req, res) => {
    console.log("Received request to /api/analyze-damage");
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OpenAI API key" });

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath);
        const imageBase64 = imageBuffer.toString("base64");
        const imageHash = createHash("sha256").update(imageBase64).digest("hex");
        await fs.unlink(filePath).catch(err => console.error("Failed to delete temp file:", err));

        const itemsCollection = db.collection(COLLECTION_NAME);
        const existing = await itemsCollection.findOne({ imageHash });
        if (existing) {
            console.log("Returning cached analysis for image:", imageHash);
            return res.json({ response: existing.analysis });
        }

        const result = await analyzeImage(imageBase64, "countertop");
        await itemsCollection.insertOne({ imageBase64, imageHash, analysis: result, createdAt: new Date() });
        console.log("Saved new analysis to DB:", imageHash);
        res.json({ response: result });
    } catch (err) {
        console.error("Analysis error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// TTS Endpoint
app.post("/api/tts", async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "Text is required" });
        if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OpenAI API key" });

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
            console.log(`Health check: http://localhost:${PORT}/api/health`);
        });
    } catch (err) {
        console.error("Failed to start server:", err.message);
        process.exit(1);
    }
}

startServer();
