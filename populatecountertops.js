require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const fuse = require("fuse.js");
const { MongoClient } = require("mongodb");

// Import the populatecountertops function
const { populatecountertops } = require("./populatecountertops");

const app = express();
const upload = multer({ dest: "uploads/" });

let colors_data = [];

// MongoDB connection
const mongo_uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const db_name = "countertops";
const collection_name = "countertops.images";
let client;
let collection;

// Fallback data if MongoDB query fails
const fallback_countertops = [
    {
        product_name: "Calacatta Gold",
        material: "marble",
        brand: "Surprise Granite",
        veining: "dramatic veining",
        primary_color: "255,255,255",
        secondary_color: "200,200,200",
        scene_image_path: "/countertop_images/calacatta_gold_scene.avif"
    },
    {
        product_name: "Black Galaxy",
        material: "granite",
        brand: "Surprise Granite",
        veining: "no veining",
        primary_color: "0,0,0",
        secondary_color: "50,50,50",
        scene_image_path: "/countertop_images/black_galaxy_scene.avif"
    },
    {
        product_name: "Carrara White",
        material: "marble",
        brand: "Surprise Granite",
        veining: "moderate veining",
        primary_color: "240,240,240",
        secondary_color: "180,180,180",
        scene_image_path: "/countertop_images/cascade_white_scene.avif"
    }
];

async function connect_to_mongodb() {
    try {
        console.log("Attempting to connect to MongoDB with URI:", mongo_uri);
        client = new MongoClient(mongo_uri, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        await client.connect();
        console.log("MongoDB server status:", client.topology.isConnected() ? "Connected" : "Disconnected");
        const db = client.db(db_name);
        const collections = await db.listCollections().toArray();
        console.log("Collections in database:", collections.map(c => c.name));
        collection = db.collection(collection_name);
        const collection_exists = await db.listCollections({ name: collection_name }).toArray();
        console.log(`Does ${collection_name} exist?`, collection_exists.length > 0 ? "Yes" : "No");
        console.log("✅ Connected to MongoDB");
        console.log(`Database: ${db_name}, Collection: ${collection_name}`);
        const count = await collection.countDocuments();
        console.log(`Number of documents in ${collection_name}: ${count}`);
    } catch (err) {
        console.error("❌ Failed to connect to MongoDB:", err.message, err.stack);
        throw err;
    }
}

// Middleware
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use('/countertop_images', express.static(path.join(__dirname, 'countertop_images'), {
    setHeaders: (res, filePath) => {
        console.log(`Serving static file: ${filePath}`);
        res.setHeader('Content-Type', 'image/avif');
    }
}));

app.get("/api/health", (req, res) => {
    const db_status = client && client.topology && client.topology.isConnected() ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: process.env.PORT, db_status });
});

app.get("/api/test-mongo", async (req, res) => {
    try {
        if (!client || !client.topology || !client.topology.isConnected()) {
            throw new Error("MongoDB client not connected.");
        }
        if (!collection) {
            throw new Error("MongoDB collection not initialized.");
        }
        const count = await collection.countDocuments();
        const sample = await collection.findOne();
        res.json({ document_count: count, sample_document: sample });
    } catch (err) {
        console.error("❌ Error in /api/test-mongo:", err.message, err.stack);
        res.status(500).json({ error: "Failed to test MongoDB: " + err.message });
    }
});

app.get("/api/countertops", async (req, res) => {
    const max_retries = 3;
    const retry_delay = 1000;
    console.log("Received request to /api/countertops");
    for (let attempt = 1; attempt <= max_retries; attempt++) {
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
            console.log(`Querying database: ${db_name}, collection: ${collection_name}`);
            const countertops = await collection.find({}, { projection: { _id: 0 } }).toArray();
            console.log("Raw countertops from MongoDB:", countertops);
            console.log(`Found ${countertops.length} documents in ${collection_name}`);
            if (countertops.length === 0) {
                console.warn("No countertops found in the database. Using fallback data.");
                return res.status(200).json(fallback_countertops);
            }
            return res.json(countertops);
        } catch (err) {
            console.error(`Attempt ${attempt} failed: ❌ Error fetching countertops:`, err.message, err.stack);
            if (attempt === max_retries) {
                console.warn("All attempts failed. Using fallback data.");
                return res.status(200).json(fallback_countertops);
            }
            await new Promise(resolve => setTimeout(resolve, retry_delay));
        }
    }
});

app.post("/api/upload-image", upload.single("file"), async (req, res) => {
    let file_stream;
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded." });
        }

        if (req.file.size > 5 * 1024 * 1024) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Image size exceeds 5MB limit." });
        }

        file_stream = fs.createReadStream(req.file.path);
        const chunks = [];
        for await (const chunk of file_stream) {
            chunks.push(chunk);
        }
        const image_base64 = Buffer.concat(chunks).toString("base64");
        fs.unlinkSync(req.file.path);

        const api_key = process.env.OPENAI_API_KEY;
        if (!api_key) {
            console.error("OPENAI_API_KEY is not set in environment variables.");
            return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key." });
        }
        console.log("Using OpenAI API key (first 5 chars):", api_key.substring(0, 5) + "...");

        const openai_response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${api_key}`,
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
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_base64}` } },
                        ],
                    },
                ],
                max_tokens: 800,
                temperature: 0.8,
            }),
        });

        if (!openai_response.ok) {
            const error_text = await openai_response.text();
            console.error(`OpenAI API failed: ${openai_response.status} - ${error_text}`);
            if (openai_response.status === 401) {
                return res.status(401).json({ error: "Invalid OpenAI API key. Please contact the administrator to update the OpenAI API key." });
            }
            return res.status(500).json({ error: `OpenAI API failed: ${openai_response.status} - ${error_text}` });
        }

        const data = await openai_response.json();
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

        const json_output = match[0];
        let parsed;
        try {
            parsed = JSON.parse(json_output);
        } catch (parse_error) {
            console.error("Failed to parse JSON from OpenAI response:", raw, parse_error);
            return res.status(500).json({ error: "Failed to parse JSON from OpenAI API response." });
        }

        if (colors_data?.length && parsed.colorPattern) {
            const fuse_instance = new fuse(colors_data, {
                keys: ["name", "description"],
                threshold: 0.3,
            });
            const top_match = fuse_instance.search(parsed.colorPattern)?.[0]?.item;
            if (top_match) {
                parsed.matched_color = top_match.name;
                parsed.matched_vendor = top_match.description;
                parsed.matched_image = top_match.imageUrl;
            }
        }

        res.json({ response: parsed });
    } catch (error) {
        console.error("❌ Error in /api/upload-image:", error.message, error.stack);
        if (file_stream) file_stream.destroy();
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: "Failed to analyze image: " + error.message });
    }
});

app.post("/api/speak", async (req, res) => {
    try {
        const { text, voice = "shimmer", speed = 1.0 } = req.body;
        if (!text) return res.status(400).json({ error: "Text is required." });

        const api_key = process.env.OPENAI_API_KEY_TTS || process.env.OPENAI_API_KEY;
        if (!api_key) {
            console.error("Neither OPENAI_API_KEY_TTS nor OPENAI_API_KEY is set in environment variables.");
            return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key." });
        }

        const tts_response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${api_key}`,
            },
            body: JSON.stringify({
                model: "tts-1-hd",
                input: text,
                voice,
                speed: parseFloat(speed),
                response_format: "mp3",
            }),
        });

        if (!tts_response.ok) {
            const error_text = await tts_response.text();
            console.error(`OpenAI TTS failed: ${tts_response.status} - ${error_text}`);
            return res.status(500).json({ error: `OpenAI TTS failed: ${tts_response.status} - ${error_text}` });
        }

        res.setHeader("Content-Type", "audio/mpeg");
        const buffer = await tts_response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error("❌ TTS error:", err.message, err.stack);
        res.status(500).json({ error: "TTS request failed: " + err.message });
    }
});

app.get("/api/user-uploads", async (req, res) => {
    try {
        const db = client.db(db_name);
        const uploads_collection = db.collection("user_uploads");
        const uploads = await uploads_collection.find({}, { projection: { _id: 0 } }).toArray();
        res.status(200).json(uploads);
    } catch (err) {
        console.error("Error fetching user uploads:", err.message, err.stack);
        res.status(500).json({ error: "Failed to fetch user uploads: " + err.message });
    }
});

app.post("/api/save-upload", async (req, res) => {
    try {
        const upload_data = req.body;
        if (!upload_data || !upload_data.scene_image_path) {
            return res.status(400).json({ error: "Invalid upload data." });
        }

        const db = client.db(db_name);
        const uploads_collection = db.collection("user_uploads");
        await uploads_collection.insertOne(upload_data);
        res.status(200).json({ message: "Image saved successfully." });
    } catch (err) {
        console.error("Error saving uploaded image:", err.message, err.stack);
        res.status(500).json({ error: "Failed to save uploaded image: " + err.message });
    }
});

app.post("/api/submit-feedback", async (req, res) => {
    try {
        const feedback_data = req.body;
        if (!feedback_data || !feedback_data.rating) {
            return res.status(400).json({ error: "Invalid feedback data." });
        }

        const db = client.db(db_name);
        const feedback_collection = db.collection("user_feedback");
        await feedback_collection.insertOne({
            ...feedback_data,
            submitted_at: new Date().toISOString()
        });
        res.status(200).json({ message: "Feedback submitted successfully." });
    } catch (err) {
        console.error("Error saving feedback:", err.message, err.stack);
        res.status(500).json({ error: "Failed to save feedback: " + err.message });
    }
});

app.post("/api/upload-remnant", upload.single("file"), async (req, res) => {
    let file_stream;
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded." });
        }

        if (req.file.size > 5 * 1024 * 1024) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Image size exceeds 5MB limit." });
        }

        file_stream = fs.createReadStream(req.file.path);
        const chunks = [];
        for await (const chunk of file_stream) {
            chunks.push(chunk);
        }
        const image_base64 = Buffer.concat(chunks).toString("base64");
        fs.unlinkSync(req.file.path);

        const { material, location, dimensions, contact } = req.body;
        if (!material || !location || !dimensions || !contact) {
            return res.status(400).json({ error: "Missing required fields: material, location, dimensions, contact." });
        }

        const db = client.db(db_name);
        const remnants_collection = db.collection("remnants");
        await remnants_collection.insertOne({
            material,
            location,
            dimensions,
            contact,
            image: image_base64,
            uploaded_at: new Date().toISOString()
        });

        res.status(200).json({ message: "Remnant uploaded successfully." });
    } catch (err) {
        console.error("Error uploading remnant:", err.message, err.stack);
        if (file_stream) file_stream.destroy();
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: "Failed to upload remnant: " + err.message });
    }
});

app.get("/api/search-remnants", async (req, res) => {
    try {
        const { material, location } = req.query;
        const query = {};
        if (material) query.material = { $regex: material, $options: "i" };
        if (location) query.location = { $regex: location, $options: "i" };

        const db = client.db(db_name);
        const remnants_collection = db.collection("remnants");
        const remnants = await remnants_collection.find(query).toArray();
        res.status(200).json(remnants);
    } catch (err) {
        console.error("Error searching remnants:", err.message, err.stack);
        res.status(500).json({ error: "Failed to search remnants: " + err.message });
    }
});

app.get("/", (req, res) => {
    res.send("✅ CARI API is live");
});

function load_color_data() {
    try {
        if (!fs.existsSync("./colors.json")) {
            console.error("colors.json file not found. Initializing with empty array.");
            colors_data = [];
            return;
        }
        const data = fs.readFileSync("./colors.json", "utf8");
        colors_data = JSON.parse(data);
        console.log(`✅ Loaded ${colors_data.length} countertop colors.`);
    } catch (err) {
        console.error("❌ Error loading colors:", err.message, err.stack);
        colors_data = [];
    }
}

process.on('SIGTERM', async () => {
    console.log("Received SIGTERM. Closing MongoDB connection...");
    if (client) {
        await client.close();
        console.log("MongoDB connection closed.");
    }
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error("Uncaught Exception:", err.message, err.stack);
    process.exit(1);
});

const port = process.env.PORT || 5000;
async function start_server() {
    try {
        console.log("Starting server...");
        await connect_to_mongodb();
        console.log("Starting to populate countertops...");
        try {
            await populatecountertops();
        } catch (err) {
            console.error("❌ Failed to populate countertops:", err.message, err.stack);
        }
        load_color_data();
        app.listen(port, () => {
            console.log(`✅ Server running on port ${port}`);
        });
    } catch (err) {
        console.error("❌ Failed to start server:", err.message, err.stack);
        process.exit(1);
    }
}

start_server();
