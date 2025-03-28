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
const COLLECTION_NAME = "home_items";
const LEADS_COLLECTION_NAME = "leads";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "yourusername/your-repo";
const EMAILJS_SERVICE_ID = "service_jmjjix9";
const EMAILJS_TEMPLATE_ID = "template_h6l3a6d";
const EMAILJS_PUBLIC_KEY = "sRh-ECDA5cGVTzDz-";
const EMAILJS_PRIVATE_KEY = "XOJ6w3IZgj67PSRNzgkwK";

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

// [Your existing importGitHubImages, analyzeImage, /api/analyze-damage, /api/tts endpoints remain unchanged]

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

        // Optionally save to MongoDB
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

// [Your existing /api/submit-lead, root endpoint, cleanup, startServer remain unchanged]

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
