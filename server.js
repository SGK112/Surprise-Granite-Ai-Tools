require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs").promises;
const { MongoClient, Binary } = require("mongodb");
const OpenAI = require("openai");
const { createHash } = require("crypto");
const emailjs = require("@emailjs/nodejs");

const app = express();

// Configuration
const config = {
    port: process.env.PORT || 5000,
    mongodbUri: "mongodb+srv://CARI:%4011560Ndysart@cluster1.s4iodnn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1",
    dbName: "countertops",
    collections: {
        images: "countertop_images",
        items: "home_items",
        leads: "leads"
    },
    openaiApiKey: process.env.OPENAI_API_KEY,
    emailjs: {
        serviceId: process.env.EMAILJS_SERVICE_ID || "service_jmjjix9",
        templateId: process.env.EMAILJS_TEMPLATE_ID || "template_h6l3a6d",
        publicKey: process.env.EMAILJS_PUBLIC_KEY || "sRh-ECDA5cGVTzDz-",
        privateKey: process.env.EMAILJS_PRIVATE_KEY || "XOJ6w3IZgj67PSRNzgkwK"
    },
    upload: {
        maxFileSize: 5 * 1024 * 1024, // 5MB
        destination: "uploads/"
    }
};

// Initialize services
const upload = multer({ 
    dest: config.upload.destination, 
    limits: { fileSize: config.upload.maxFileSize }
});
const openai = new OpenAI({ apiKey: config.openaiApiKey });
emailjs.init({
    publicKey: config.emailjs.publicKey,
    privateKey: config.emailjs.privateKey
});

let client;
let db;

// MongoDB Connection
async function connectToMongoDB() {
    try {
        client = new MongoClient(config.mongodbUri, {
            maxPoolSize: 20,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        await client.connect();
        db = client.db(config.dbName);
        console.log("Connected to MongoDB Atlas at Cluster1");
    } catch (err) {
        console.error("MongoDB connection error:", err.message);
        process.exit(1);
    }
}

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || "*", credentials: true }));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Health Check
app.get("/api/health", (req, res) => {
    const dbStatus = client && client.topology?.isConnected() ? "Connected" : "Disconnected";
    res.json({ 
        status: "Server is running", 
        port: config.port, 
        dbStatus, 
        openaiConfigured: !!config.openaiApiKey 
    });
});

// Image Upload Endpoint
app.post("/api/upload-countertop", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file uploaded" });
        }

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath);
        const imageBase64 = imageBuffer.toString("base64");
        const imageHash = createHash("sha256").update(imageBase64).digest("hex");

        await fs.unlink(filePath).catch(err => console.error("Cleanup error:", err));

        const imagesCollection = db.collection(config.collections.images);
        
        const existingImage = await imagesCollection.findOne({ imageHash });
        if (existingImage) {
            return res.status(200).json({ 
                message: "Image already exists",
                imageId: existingImage._id,
                metadata: existingImage.metadata
            });
        }

        const imageDoc = {
            imageHash,
            imageData: new Binary(imageBuffer),
            metadata: {
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                size: req.file.size,
                uploadDate: new Date(),
                analysis: null
            }
        };

        const result = await imagesCollection.insertOne(imageDoc);
        
        if (config.openaiApiKey) {
            const analysis = await analyzeImage(imageBase64);
            await imagesCollection.updateOne(
                { _id: result.insertedId },
                { $set: { "metadata.analysis": analysis } }
            );
            imageDoc.metadata.analysis = analysis;
        }

        res.status(201).json({
            message: "Image uploaded successfully",
            imageId: result.insertedId,
            metadata: imageDoc.metadata
        });

    } catch (err) {
        console.error("Upload error:", err.message);
        res.status(500).json({ error: "Failed to upload image" });
    }
});

// Simplified analyzeImage function (add your materialsData and full logic)
async function analyzeImage(imageBase64) {
    const prompt = `Analyze this countertop image...`; // Your full prompt here
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: prompt },
            {
                role: "user",
                content: [
                    { type: "text", text: "Analyze this countertop image" },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ]
            }
        ],
        max_tokens: 1500,
        temperature: 0.7
    });

    const content = response.choices[0].message.content.match(/\{[\s\S]*\}/);
    return JSON.parse(content[0]);
}

// Start Server
async function startServer() {
    try {
        await connectToMongoDB();
        app.listen(config.port, () => {
            console.log(`Server running on port ${config.port}`);
            console.log(`Health check: http://localhost:${config.port}/api/health`);
        });
    } catch (err) {
        console.error("Server startup error:", err.message);
        process.exit(1);
    }
}

startServer();

// Process Handlers
process.on("SIGTERM", async () => {
    if (client) await client.close();
    console.log("Server shut down");
    process.exit(0);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err.message);
    process.exit(1);
});
