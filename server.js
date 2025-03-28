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
const emailjs = require("@emailjs/nodejs");

const app = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });

// Configuration
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://CARI:%4011560Ndysart@cluster1.s4iodnn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";
const DB_NAME = "countertops";
const COLLECTION_NAME = "countertop_images"; // Changed to match your request
const LEADS_COLLECTION_NAME = "leads";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_jmjjix9";
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || "template_h6l3a6d";
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "sRh-ECDA5cGVTzDz-";
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || "XOJ6w3IZgj67PSRNzgkwK";

// Initialize OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Initialize EmailJS
emailjs.init({
    publicKey: EMAILJS_PUBLIC_KEY,
    privateKey: EMAILJS_PRIVATE_KEY
});

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

// Import Countertop Images into MongoDB (Manual Setup)
async function importCountertopImages() {
    try {
        const imagesDir = path.join(__dirname, "countertop_images"); // Local folder with your images
        const files = await fs.readdir(imagesDir);
        const imagesCollection = db.collection(COLLECTION_NAME);

        for (const file of files) {
            if (/\.(jpg|jpeg|png)$/i.test(file)) {
                const filePath = path.join(imagesDir, file);
                const imageBuffer = await fs.readFile(filePath);
                const imageBase64 = imageBuffer.toString("base64");
                const imageHash = createHash("sha256").update(imageBase64).digest("hex");

                const exists = await imagesCollection.findOne({ imageHash });
                if (!exists) {
                    const analysis = await analyzeImage(imageBase64);
                    await imagesCollection.insertOne({
                        filename: file,
                        imageBase64,
                        imageHash,
                        analysis,
                        createdAt: new Date()
                    });
                    console.log(`Imported ${file} into MongoDB`);
                }
            }
        }
        console.log(`Total images in DB: ${await imagesCollection.countDocuments()}`);
    } catch (err) {
        console.error("Failed to import countertop images:", err.message);
    }
}

// Analyze Image with OpenAI Vision
async function analyzeImage(imageBase64) {
    const prompt = `Analyze this countertop image and provide:
    - Stone type (e.g., granite, marble)
    - Color and pattern (e.g., "brown with black speckles")
    - Material composition (e.g., "mostly quartz")
    Return in JSON format with keys: stone_type, color_and_pattern, material_composition.`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: prompt },
            {
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ]
            }
        ],
        max_tokens: 500,
        temperature: 0.5
    });

    const content = response.choices[0].message.content.match(/\{[\s\S]*\}/);
    if (!content) throw new Error("Invalid JSON response from OpenAI");
    return JSON.parse(content[0]);
}

// Visual Search Endpoint
app.post("/api/visual-search", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OpenAI API key" });

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath);
        const uploadedImageBase64 = imageBuffer.toString("base64");
        await fs.unlink(filePath).catch(err => console.error("Failed to delete temp file:", err));

        // Analyze uploaded image
        const uploadedAnalysis = await analyzeImage(uploadedImageBase64);

        // Search database for matches
        const imagesCollection = db.collection(COLLECTION_NAME);
        const allImages = await imagesCollection.find({}).toArray();

        const matches = await Promise.all(allImages.map(async (dbImage) => {
            const similarityPrompt = `Compare these two countertop images and estimate their similarity (0-100%):
            - Image 1: Uploaded image
            - Image 2: Database image
            Return a JSON object with a "similarity" key (percentage).`;

            const response = await openai.chat.completions.create({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: similarityPrompt },
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${uploadedImageBase64}` } },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${dbImage.imageBase64}` } }
                        ]
                    }
                ],
                max_tokens: 200,
                temperature: 0.5
            });

            const content = response.choices[0].message.content.match(/\{[\s\S]*\}/);
            const similarity = content ? JSON.parse(content[0]).similarity : 0;

            return { ...dbImage.analysis, filename: dbImage.filename, similarity };
        }));

        // Sort by similarity and return top matches
        const topMatches = matches.sort((a, b) => b.similarity - a.similarity).slice(0, 3);
        res.json({ uploadedAnalysis, matches: topMatches });
    } catch (err) {
        console.error("Visual search error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// EmailJS Endpoint
app.post("/api/send-email", async (req, res) => {
    try {
        const { name, email, phone, message, stone_type, analysis_summary } = req.body;
        if (!name || !email || !message) {
            return res.status(400).json({ error: "Name, email, and message are required" });
        }

        const templateParams = {
            from_name: name,
            from_email: email,
            from_phone: phone,
            message: message,
            stone_type: stone_type || "N/A",
            analysis_summary: analysis_summary || "No analysis provided",
            to_email: "info@surprisegranite.com",
            reply_to: email
        };

        const emailResponse = await emailjs.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            templateParams
        );

        console.log("Email sent successfully:", emailResponse.status, emailResponse.text);

        if (db) {
            const leadsCollection = db.collection(LEADS_COLLECTION_NAME);
            await leadsCollection.insertOne({ ...req.body, status: "new", createdAt: new Date() });
        }

        res.json({ success: true, message: "Email sent successfully" });
    } catch (err) {
        console.error("EmailJS error:", err.message);
        res.status(500).json({ error: "Failed to send email" });
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
        await importCountertopImages(); // Import images on startup
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
