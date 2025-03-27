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
        console.log("mongo_uri:", mongo_uri);
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
        process.exit(1);
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
