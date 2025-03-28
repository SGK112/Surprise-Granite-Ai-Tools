require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fetch = require("node-fetch");
const fs = require("fs").promises;
const path = require("path");
const { MongoClient } = require("mongodb");

const app = express();
const upload = multer({ dest: "uploads/" });

// Configuration
const PORT = process.env.PORT || 5000; // Render will set PORT automatically
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://CARI:%4011560Ndysart@cluster1.s4iodnn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";
const DB_NAME = "countertops";
const COLLECTION_NAME = "countertops.images";
const LEADS_COLLECTION_NAME = "leads";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
        // Continue without MongoDB if not critical
    }
}

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || "*", // Allow all origins for now; tighten in production
    credentials: true
}));
app.use(helmet({
    contentSecurityPolicy: false // Disable CSP for simplicity; configure properly in production
}));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health Check Endpoint
app.get("/api/health", (req, res) => {
    const dbStatus = client && client.topology?.isConnected() ? "Connected" : "Disconnected";
    res.json({ 
        status: "Server is running", 
        port: PORT, 
        dbStatus,
        openAIConfigured: !!OPENAI_API_KEY 
    });
});

// Analyze Damage Endpoint
app.post("/api/analyze-damage", upload.single("file"), async (req, res) => {
    console.log("Received request to /api/analyze-damage");
    try {
        if (!req.file) {
            console.log("No file uploaded");
            return res.status(400).json({ error: "No file uploaded" });
        }

        if (!OPENAI_API_KEY) {
            console.log("Missing OpenAI API key");
            return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key" });
        }

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath);
        const imageBase64 = imageBuffer.toString("base64");
        await fs.unlink(filePath).catch(err => console.error("Failed to delete temp file:", err));

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You are CARI, a countertop damage analyst at Surprise Granite. Analyze the image and provide:
                        - Stone type (granite, quartz, marble, etc.)
                        - Color and pattern
                        - Whether it's natural stone (true/false)
                        - Damage type (chips, cracks, etc.)
                        - Severity (low, moderate, severe)
                        - Estimated cost range
                        - Professional recommendation
                        Respond in JSON format only.`
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Analyze this countertop image" },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                        ]
                    }
                ],
                max_tokens: 800,
                temperature: 0.7
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenAI API error:", errorText);
            throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            console.error("Invalid JSON response from OpenAI:", content);
            throw new Error("Invalid JSON response from OpenAI");
        }

        const result = JSON.parse(jsonMatch[0]);
        console.log("Analysis successful:", result);
        res.json({ response: result });
    } catch (err) {
        console.error("Analysis error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Submit Lead Endpoint
app.post("/api/submit-lead", async (req, res) => {
    try {
        const leadData = req.body;
        if (!leadData.name || !leadData.email) {
            return res.status(400).json({ error: "Name and email are required" });
        }

        if (db) {
            const leadsCollection = db.collection(LEADS_COLLECTION_NAME);
            const result = await leadsCollection.insertOne({
                ...leadData,
                status: "new",
                createdAt: new Date()
            });
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
process.on('SIGTERM', async () => {
    if (client) await client.close();
    console.log("Server shut down");
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error("Uncaught Exception:", err.message);
    process.exit(1);
});

// Start Server
async function startServer() {
    try {
        await connectToMongoDB();
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            console.log(`Health check available at: https://surprise-granite-connections-dev.onrender.com/api/health`);
        });
    } catch (err) {
        console.error("Failed to start server:", err.message);
        process.exit(1);
    }
}

startServer();
