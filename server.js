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

const mongo_uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const db_name = "countertops";
const collection_name = "countertops.images";
const leads_collection_name = "leads";
let client;
let db;

const fallback_countertops = [
    // ... (keep existing fallback countertops)
];

// MongoDB Connection
async function connectToMongoDB() {
    try {
        client = new MongoClient(mongo_uri, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        await client.connect();
        db = client.db(db_name);
        console.log("Connected to MongoDB");
    } catch (err) {
        console.error("Failed to connect to MongoDB:", err.message);
        throw err;
    }
}

app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true
}));
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://www.googletagmanager.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https://cdn.prod.website-files.com"]
        }
    }
}));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use('/countertop_images', express.static(path.join(__dirname, 'countertop_images')));

// Health Check
app.get("/api/health", (req, res) => {
    const dbStatus = client && client.topology?.isConnected() ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: process.env.PORT, dbStatus });
});

// Get Countertops
app.get("/api/countertops", async (req, res) => {
    try {
        const collection = db.collection(collection_name);
        const countertops = await collection.find({}, { projection: { _id: 0 } }).toArray();
        res.json(countertops.length > 0 ? countertops : fallback_countertops);
    } catch (err) {
        console.error("Error fetching countertops:", err);
        res.status(200).json(fallback_countertops);
    }
});

// Improved Image Analysis Endpoint
app.post("/api/analyze-damage", upload.single("file"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath);
        const imageBase64 = imageBuffer.toString("base64");
        await fs.unlink(filePath);

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error("Missing OpenAI API key");
        }

        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `You are CARI, a countertop damage analyst at Surprise Granite. Analyze the image and provide:
                        - Stone type (granite, quartz, marble, etc.)
                        - Color and pattern
                        - Whether it's natural stone
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
            throw new Error(`OpenAI API error: ${await response.text()}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        
        if (!jsonMatch) {
            throw new Error("Invalid JSON response from OpenAI");
        }

        const result = JSON.parse(jsonMatch[0]);
        res.json({ response: result });
    } catch (err) {
        console.error("Analysis error:", err);
        res.status(500).json({ error: err.message });
    }
});

// New Lead Submission Endpoint
app.post("/api/submit-lead", async (req, res) => {
    try {
        const leadData = req.body;
        const leadsCollection = db.collection(leads_collection_name);
        
        const result = await leadsCollection.insertOne({
            ...leadData,
            status: 'new',
            createdAt: new Date()
        });

        res.json({ success: true, leadId: result.insertedId });
    } catch (err) {
        console.error("Lead submission error:", err);
        res.status(500).json({ error: "Failed to save lead" });
    }
});

// Server Startup
const port = process.env.PORT || 5000;
async function startServer() {
    try {
        await connectToMongoDB();
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error("Server startup failed:", err);
        process.exit(1);
    }
}

startServer();

process.on('SIGTERM', async () => {
    if (client) await client.close();
    process.exit(0);
});
