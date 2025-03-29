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

// Configuration (using Render environment variables)
const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Materials data (add your full list here)
const materialsData = [
    { "Color Name": "Frost-N", "Vendor Name": "Arizona Tile", "Thickness": "3cm", "Material": "Quartz", "size": "126 x 63", "Total/SqFt": 55.13, "Cost/SqFt": 10.24, "Price Group": 2, "Tier": "Low Tier" },
    { "Color Name": "VANILLA SKY", "Vendor Name": "MSI", "Thickness": "1.6cm", "Material": "Marble", "size": "126x63", "Total/SqFt": 4.8, "Cost/SqFt": 5.65, "Price Group": 1, "Tier": "Low Tier" }
];

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

// Get All Countertops Endpoint with Pagination
app.get("/api/get-countertops", async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const imagesCollection = db.collection("countertop_images");
        const total = await imagesCollection.countDocuments();
        const countertops = await imagesCollection.find({}).skip(skip).limit(limit).toArray();

        const response = countertops.map(item => {
            try {
                return {
                    id: item._id,
                    // Temporarily omit imageBase64 to reduce response size
                    // imageBase64: item.imageData.buffer.toString("base64"),
                    originalName: item.metadata.originalName,
                    analysis: item.metadata.analysis || {}
                };
            } catch (err) {
                console.error(`Error processing item ${item._id}:`, err.message);
                return null;
            }
        }).filter(item => item !== null);

        res.json({
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
            countertops: response
        });
    } catch (err) {
        console.error("Error in /api/get-countertops:", err.message, err.stack);
        res.status(500).json({ error: "Failed to fetch countertops" });
    }
});

// Analysis Function
async function analyzeImage(imageBase64) {
    const prompt = `You are CARI, an expert countertop analyst at Surprise Granite with advanced vision. Analyze this countertop image with precision and conversational tone:
    - Stone type: Identify the material (e.g., "Quartz", "Marble") based on texture and visual cues.
    - Color and pattern: Describe naturally with specific colors and patterns (e.g., "Rich brown with black speckles and beige veins").
    - Damage type: Specify clearly, including hidden issues (e.g., "There’s a hairline crack under the surface" or "No damage here, looks clean!").
    - Severity: Assess with context:
      - None: "No damage at all, it’s in great shape!".
      - Low: "Just a tiny scratch, no biggie".
      - Moderate: "A decent crack, worth fixing".
      - Severe: "Whoa, this crack’s serious—structural stuff".
    Use image data only, be honest if no damage is found. Respond in JSON format with keys: stone_type, color_and_pattern, damage_type, severity.`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            { role: "system", content: prompt },
            { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] }
        ],
        max_tokens: 1500
    });

    const content = response.choices[0].message.content.match(/\{[\s\S]*\}/);
    let result = content ? JSON.parse(content[0]) : { error: "Analysis failed" };

    // Match with materialsData
    const identifiedColor = result.color_and_pattern.toLowerCase();
    const identifiedMaterial = result.stone_type.toLowerCase();
    const bestMatch = materialsData.find(item =>
        item.Material.toLowerCase() === identifiedMaterial &&
        identifiedColor.includes(item["Color Name"].toLowerCase().split("-")[0])
    ) || {};

    result.color_match_suggestion = bestMatch["Color Name"] || "No match found";
    result.estimated_cost = bestMatch["Cost/SqFt"] ? (bestMatch["Cost/SqFt"] * bestMatch["Total/SqFt"]).toFixed(2) : "N/A";

    return result;
}

// Start Server
connectToMongoDB().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
