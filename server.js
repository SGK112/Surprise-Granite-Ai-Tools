require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");
const { MongoClient } = require("mongodb");

const app = express();
const upload = multer({ dest: "uploads/" });

let colorsData = [];

// MongoDB connection
const MONGO_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = "countertops";
const COLLECTION_NAME = "images";
let client;
let collection;

async function connectToMongoDB() {
    try {
        client = new MongoClient(MONGO_URI, {
            useUnifiedTopology: true,
            maxPoolSize: 10, // Connection pooling
            serverSelectionTimeoutMS: 5000, // Timeout for server selection
            connectTimeoutMS: 10000, // Timeout for initial connection
        });
        await client.connect();
        const db = client.db(DB_NAME);
        collection = db.collection(COLLECTION_NAME);
        console.log("✅ Connected to MongoDB");
    } catch (err) {
        console.error("❌ Failed to connect to MongoDB:", err.message, err.stack);
        process.exit(1);
    }
}

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Serve static files from the countertop_images directory
app.use('/countertop_images', express.static(path.join(__dirname, 'countertop_images'), {
    setHeaders: (res, filePath) => {
        console.log(`Serving static file: ${filePath}`);
        res.setHeader('Content-Type', 'image/avif');
    }
}));

// Health check endpoint for monitoring
app.get("/api/health", (req, res) => {
    const dbStatus = client && client.topology && client.topology.isConnected() ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: process.env.PORT, dbStatus });
});

// Fetch countertops from MongoDB with retry logic
app.get("/api/countertops", async (req, res) => {
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second delay between retries
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Attempt ${attempt}: Fetching countertops from MongoDB...`);
            if (!client || !client.topology || !client.topology.isConnected()) {
                console.error("MongoDB client not connected.");
                throw new Error("Database connection not available.");
            }
            if (!collection) {
                console.error("MongoDB collection not initialized.");
                throw new Error("Database collection not initialized.");
            }
            const countertops = await collection.find({}, { projection: { _id: 0 } }).toArray();
            console.log("Countertops fetched:", countertops);
            return res.json(countertops);
        } catch (err) {
            console.error(`Attempt ${attempt} failed: ❌ Error fetching countertops:`, err.message, err.stack);
            if (attempt === maxRetries) {
                return res.status(500).json({ error: `Failed to fetch countertops after ${maxRetries} attempts: ${err.message}` });
            }
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
});

// Image analysis with OpenAI API
app.post("/api/upload-image", upload.single("file"), async (req, res) => {
    let fileStream;
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded." });
        }

        if (req.file.size > 5 * 1024 * 1024) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Image size exceeds 5MB limit." });
        }

        fileStream = fs.createReadStream(req.file.path);
        const chunks = [];
        for await (const chunk of fileStream) {
            chunks.push(chunk);
        }
        const imageBase64 = Buffer.concat(chunks).toString("base64");
        fs.unlinkSync(req.file.path);

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error("OPENAI_API_KEY is not set in environment variables.");
            return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key." });
        }
        console.log("Using OpenAI API key (first 5 chars):", apiKey.substring(0, 5) + "...");

        const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `
You are CARI, a countertop damage analyst at Surprise Granite.

Analyze the uploaded image. Your job is to:
1. Identify the stone type (granite, quartz, marble, quartzite, etc.)
2. Describe the color and pattern (e.g., white with grey veining)
3. Detect damage (chips, cracks, scratches, breaks, discoloration)
4. Classify severity (low, moderate, severe)
5. Suggest estimated repair cost (e.g. $250–$450)
6. Make a confident recommendation:
   - Recommend full/partial replacement for cracks over 1 inch, multiple chips, or broken pieces.
   - Recommend repair for minor cosmetic damage.
   - If unclear, suggest in-person evaluation.
7. Be clear, professional, and concise.

Respond ONLY in JSON like this:
{
  "stoneType": "",
  "colorPattern": "",
  "isNaturalStone": true,
  "damageType": "",
  "severity": "",
  "estimatedCost": "",
  "recommendation": "",
  "description": ""
}
                        `,
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Analyze this countertop image." },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                        ],
                    },
                ],
                max_tokens: 800,
                temperature: 0.8,
            }),
        });

        if (!openAIResponse.ok) {
            const errorText = await openAIResponse.text();
            console.error(`OpenAI API failed: ${openAIResponse.status} - ${errorText}`);
            if (openAIResponse.status === 401) {
                return res.status(401).json({ error: "Invalid OpenAI API key. Please contact the administrator to update the OpenAI API key." });
            }
            return res.status(500).json({ error: `OpenAI API failed: ${openAIResponse.status} - ${errorText}` });
        }

        const data = await openAIResponse.json();
        console.log("OpenAI API response:", JSON.stringify(data, null, 2));

        if (!data.choices || !data.choices[0] || !data.choices[0].message || !data.choices[0].message.content) {
            console.error("Invalid OpenAI API response structure:", data);
            return res.status(500).json({ error: "Invalid response structure from OpenAI API." });
        }

        const raw = data.choices[0].message.content.trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) {
            console.error("No JSON found in OpenAI response:", raw);
            return res.status(500).json({ error: "Invalid response format from OpenAI API: No JSON found." });
        }

        const jsonOutput = match[0];
        let parsed;
        try {
            parsed = JSON.parse(jsonOutput);
        } catch (parseError) {
            console.error("Failed to parse JSON from OpenAI response:", raw, parseError);
            return res.status(500).json({ error: "Failed to parse JSON from OpenAI API response." });
        }

        if (colorsData?.length && parsed.colorPattern) {
            const fuse = new Fuse(colorsData, {
                keys: ["name", "description"],
                threshold: 0.3,
            });
            const topMatch = fuse.search(parsed.colorPattern)?.[0]?.item;
            if (topMatch) {
                parsed.matchedColor = topMatch.name;
                parsed.matchedVendor = topMatch.description;
                parsed.matchedImage = topMatch.imageUrl;
            }
        }

        res.json({ response: parsed });
    } catch (error) {
        console.error("❌ Error in /api/upload-image:", error.message, error.stack);
        if (fileStream) fileStream.destroy();
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: "Failed to analyze image: " + error.message });
    }
});

// Text to Speech
app.post("/api/speak", async (req, res) => {
    try {
        const { text, voice = "shimmer", speed = 1.0 } = req.body;
        if (!text) return res.status(400).json({ error: "Text is required." });

        const apiKey = process.env.OPENAI_API_KEY_TTS || process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error("Neither OPENAI_API_KEY_TTS nor OPENAI_API_KEY is set in environment variables.");
            return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key." });
        }

        const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "tts-1-hd",
                input: text,
                voice,
                speed: parseFloat(speed),
                response_format: "mp3",
            }),
        });

        if (!ttsResponse.ok) {
            const errorText = await ttsResponse.text();
            console.error(`OpenAI TTS failed: ${ttsResponse.status} - ${errorText}`);
            return res.status(500).json({ error: `OpenAI TTS failed: ${ttsResponse.status} - ${errorText}` });
        }

        res.setHeader("Content-Type", "audio/mpeg");
        const buffer = await ttsResponse.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error("❌ TTS error:", err.message, err.stack);
        res.status(500).json({ error: "TTS request failed: " + err.message });
    }
});

// Root endpoint
app.get("/", (req, res) => {
    res.send("✅ CARI API is live");
});

// Load colors data from scraper
function loadColorData() {
    try {
        if (!fs.existsSync("./colors.json")) {
            console.error("colors.json file not found. Initializing with empty array.");
            colorsData = [];
            return;
        }
        const data = fs.readFileSync("./colors.json", "utf8");
        colorsData = JSON.parse(data);
        console.log(`✅ Loaded ${colorsData.length} countertop colors.`);
    } catch (err) {
        console.error("❌ Error loading colors:", err.message, err.stack);
        colorsData = [];
    }
}

// Handle SIGTERM for graceful shutdown
process.on('SIGTERM', async () => {
    console.log("Received SIGTERM. Closing MongoDB connection...");
    if (client) {
        await client.close();
        console.log("MongoDB connection closed.");
    }
    process.exit(0);
});

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (err) => {
    console.error("Uncaught Exception:", err.message, err.stack);
    // Do not exit, let the server continue running
});

// Start the server
const PORT = process.env.PORT || 5000;
async function startServer() {
    try {
        await connectToMongoDB();
        loadColorData();
        app.listen(PORT, () => {
            console.log(`✅ Server running on port ${PORT}`);
        });
    } catch (err) {
        console.error("❌ Failed to start server:", err.message, err.stack);
        process.exit(1);
    }
}

startServer();
