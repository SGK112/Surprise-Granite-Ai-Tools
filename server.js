require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs").promises;
const path = require("path"); // Added for file path handling
const { MongoClient, Binary } = require("mongodb");
const OpenAI = require("openai");
const { createHash } = require("crypto");
const EmailJS = require("@emailjs/nodejs");

const app = express();
const upload = multer({ dest: "uploads/", limits: { fileSize: 5 * 1024 * 1024 } });

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const materialsData = [
    { "Color Name": "Frost-N", "Vendor Name": "Arizona Tile", "Thickness": "3cm", "Material": "Quartz", "size": "126 x 63", "Total/SqFt": 55.13, "Cost/SqFt": 10.24, "Price Group": 2, "Tier": "Low Tier" },
    { "Color Name": "VANILLA SKY", "Vendor Name": "MSI", "Thickness": "1.6cm", "Material": "Marble", "size": "126x63", "Total/SqFt": 4.8, "Cost/SqFt": 5.65, "Price Group": 1, "Tier": "Low Tier" }
];

let db;

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

app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public"))); // Serve static files from 'public'

// Explicitly serve index.html at root
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (req, res) => {
    const dbStatus = db ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: PORT, dbStatus });
});

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
            return res.json({ imageId: existingImage._id, message: "Image already exists", metadata: existingImage.metadata });
        }

        const analysis = OPENAI_API_KEY ? await analyzeImage(imageBase64) : null;

        const imageDoc = {
            imageHash,
            imageData: new Binary(imageBuffer),
            metadata: {
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                size: req.file.size,
                uploadDate: new Date(),
                analysis
            }
        };

        const result = await imagesCollection.insertOne(imageDoc);
        await fs.unlink(filePath);

        res.status(201).json({ imageId: result.insertedId, message: "Image uploaded successfully", metadata: imageDoc.metadata });
    } catch (err) {
        console.error("Upload error:", err.message);
        res.status(500).json({ error: "Failed to upload image" });
    }
});

app.get("/api/get-countertop/:id", async (req, res) => {
    try {
        const imagesCollection = db.collection("countertop_images");
        const countertop = await imagesCollection.findOne({ _id: new MongoClient.ObjectId(req.params.id) });
        if (!countertop) return res.status(404).json({ error: "Countertop not found" });

        const response = {
            id: countertop._id,
            imageBase64: countertop.imageData.buffer.toString("base64"),
            metadata: countertop.metadata || {}
        };
        res.json(response);
    } catch (err) {
        console.error("Error fetching countertop:", err.message);
        res.status(500).json({ error: "Failed to fetch countertop" });
    }
});

app.post("/api/send-email", async (req, res) => {
    try {
        const { name, email, phone, message, stone_type, analysis_summary } = req.body;
        if (!name || !email || !message) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const templateParams = {
            from_name: name,
            from_email: email,
            phone: phone || "Not provided",
            message,
            stone_type: stone_type || "N/A",
            analysis_summary: analysis_summary || "No analysis provided"
        };

        await EmailJS.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            templateParams,
            { publicKey: EMAILJS_PUBLIC_KEY }
        );

        res.status(200).json({ message: "Email sent successfully" });
    } catch (err) {
        console.error("Email error:", err.message);
        res.status(500).json({ error: "Failed to send email" });
    }
});

app.post("/api/tts", (req, res) => {
    res.status(501).json({ error: "Text-to-speech not implemented yet" });
});

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

    if (result.error) return result;

    const identifiedColor = result.color_and_pattern.toLowerCase();
    const identifiedMaterial = result.stone_type.toLowerCase();
    const bestMatch = materialsData.find(item =>
        item.Material.toLowerCase() === identifiedMaterial &&
        identifiedColor.includes(item["Color Name"].toLowerCase().split("-")[0])
    ) || {};

    result.color_match_suggestion = bestMatch["Color Name"] || "No match found";
    result.estimated_cost = bestMatch["Cost/SqFt"] ? (bestMatch["Cost/SqFt"] * bestMatch["Total/SqFt"]).toFixed(2) : "N/A";
    result.material_composition = result.stone_type ? `${result.stone_type} (Natural)` : "Not identified";
    result.natural_stone = result.stone_type && ["Marble", "Granite"].includes(result.stone_type);
    result.professional_recommendation = result.severity === "Severe" ? "Contact a professional for repair or replacement." : result.severity === "Moderate" ? "Consider professional repair." : "No action required.";
    result.cleaning_recommendation = result.stone_type === "Marble" ? "Use a pH-neutral cleaner and avoid acidic substances." : "Clean with mild soap and water.";
    result.repair_recommendation = result.severity === "Severe" || result.severity === "Moderate" ? "Professional repair recommended." : "No repairs needed.";
    result.possible_matches = materialsData.map(item => ({
        color_name: item["Color Name"],
        material: item.Material,
        thickness: item.Thickness,
        replacement_cost: (item["Cost/SqFt"] * item["Total/SqFt"]).toFixed(2)
    }));

    return result;
}

connectToMongoDB().then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
