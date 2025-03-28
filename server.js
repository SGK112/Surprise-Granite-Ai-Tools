require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs").promises;
const { MongoClient, Binary } = require("mongodb");
const OpenAI = require("openai");
const { createHash } = require("crypto");

const app = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });

// Configuration
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb+srv://CARI:%4011560Ndysart@cluster1.s4iodnn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let db;

// MongoDB Connection
async function connectToMongoDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db("countertops");
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        console.error("MongoDB connection error:", err.message);
        process.exit(1);
    }
}

// Middleware
app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get("/api/health", (req, res) => {
    const dbStatus = db ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: PORT, dbStatus });
});

// Image Upload Endpoint
app.post("/api/upload-countertop", upload.single("image"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No image uploaded" });

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath);
        const imageBase64 = imageBuffer.toString("base64");
        const imageHash = createHash("sha256").update(imageBase64).digest("hex");

        const imagesCollection = db.collection("countertop_images");
        const existingImage = await imagesCollection.findOne({ imageHash });
        if (existingImage) {
            await fs.unlink(filePath);
            return res.json({ imageId: existingImage._id, message: "Image already exists" });
        }

        const imageDoc = {
            imageHash,
            imageData: new Binary(imageBuffer),
            metadata: {
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                size: req.file.size,
                uploadDate: new Date(),
                analysis: process.env.OPENAI_API_KEY ? await analyzeImage(imageBase64) : null
            }
        };

        const result = await imagesCollection.insertOne(imageDoc);
        await fs.unlink(filePath);

        res.status(201).json({ imageId: result.insertedId, message: "Image uploaded successfully" });
    } catch (err) {
        console.error("Upload error:", err.message);
        res.status(500).json({ error: "Failed to upload image" });
    }
});

// Placeholder Analysis Function
async function analyzeImage(imageBase64) {
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: "Analyze this countertop image and return JSON with stone_type, color_and_pattern, damage_type, and severity." },
            { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] }
        ],
        max_tokens: 1500
    });
    const content = response.choices[0].message.content.match(/\{[\s\S]*\}/);
    return content ? JSON.parse(content[0]) : { error: "Analysis failed" };
}

// Start Server
connectToMongoDB().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
