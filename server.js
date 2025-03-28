require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs").promises;
const path = require("path");
const { MongoClient } = require("mongodb");
const OpenAI = require("openai");
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
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_jmjjix9";
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || "template_h6l3a6d";
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "sRh-ECDA5cGVTzDz-";
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || "XOJ6w3IZgj67PSRNzgkwK";

// Initialize OpenAI
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Initialize EmailJS
emailjs.init({
    publicKey: EMAILJS_PUBLIC_KEY,
    privateKey: EMAILJS_PRIVATE_KEY
});

// Load materials.json data (inline for now)
const materialsData = [
  { "Color Name": "Frost-N", "Vendor Name": "Arizona Tile", "Thickness": "3cm", "Material": "Quartz", "size": "126 x 63", "Total/SqFt": 55.13, "Cost/SqFt": 10.24, "Price Group": 2, "Tier": "Low Tier" },
  { "Color Name": "VANILLA SKY", "Vendor Name": "MSI", "Thickness": "1.6cm", "Material": "Marble", "size": "126x63", "Total/SqFt": 4.8, "Cost/SqFt": 5.65, "Price Group": 1, "Tier": "Low Tier" }
  // Add your full materials.json data here
];

let client;
let db;

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

app.get("/api/health", (req, res) => {
    const dbStatus = client && client.topology?.isConnected() ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: PORT, dbStatus, openAIConfigured: !!OPENAI_API_KEY });
});

// Enhanced Analysis with Precise Color Match
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
            {
                role: "user",
                content: [
                    { type: "text", text: "Analyze this countertop image with maximum accuracy. Identify material type, color, pattern, and damage." },
                    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }
                ]
            }
        ],
        max_tokens: 1500,
        temperature: 0.7
    });

    const content = response.choices[0].message.content.match(/\{[\s\S]*\}/);
    if (!content) throw new Error("Invalid JSON response from OpenAI");
    let result = JSON.parse(content[0]);

    // Find possible matches in materials.json
    const identifiedColor = result.color_and_pattern.toLowerCase();
    const identifiedMaterial = result.stone_type.toLowerCase();
    const possibleMatches = materialsData
        .filter(item => 
            item.Material.toLowerCase() === identifiedMaterial &&
            identifiedColor.includes(item["Color Name"].toLowerCase().split("-")[0])
        )
        .slice(0, 3)
        .map(match => ({
            color_name: match["Color Name"],
            material: match.Material,
            thickness: match.Thickness,
            size: match.size,
            total_sqft: match["Total/SqFt"],
            cost_per_sqft: match["Cost/SqFt"],
            replacement_cost: (match["Cost/SqFt"] * match["Total/SqFt"]).toFixed(2)
        }));

    // Use the best match for primary result
    const bestMatch = possibleMatches[0] || materialsData.find(item => item.Material.toLowerCase() === identifiedMaterial) || {};

    // Refine result with best match
    result.stone_type = bestMatch.material || result.stone_type;
    result.material_composition = bestMatch.material === "Quartz" 
        ? "Engineered stone (93% quartz, 7% resin)" 
        : bestMatch.material === "Marble" 
        ? "Natural metamorphic rock (calcite or dolomite)" 
        : "Unknown composition";
    result.natural_stone = bestMatch.material === "Marble";
    result.color_and_pattern = bestMatch.color_name 
        ? `${bestMatch.color_name} (${result.color_and_pattern})` 
        : result.color_and_pattern;

    // Set color_match_suggestion to the best match's color_name
    result.color_match_suggestion = bestMatch.color_name || "No specific match found";

    // Calculate costs based on severity and best match
    const severityMap = { None: 0, Low: 1, Moderate: 2, Severe: 3 };
    const severityLevel = severityMap[result.severity] || 0;
    let estimatedCostRange;

    if (bestMatch.cost_per_sqft) {
        const costPerSqFt = bestMatch.cost_per_sqft;
        const totalSqFt = bestMatch.total_sqft;
        const replacementCost = costPerSqFt * totalSqFt;

        if (severityLevel === 0) {
            estimatedCostRange = "$0 (No repair needed)";
        } else if (severityLevel === 1) {
            estimatedCostRange = "$50 - $150 (Repair)";
        } else if (severityLevel === 2) {
            estimatedCostRange = "$200 - $500 (Repair)";
        } else if (severityLevel === 3) {
            estimatedCostRange = `$${replacementCost.toLocaleString()} - $${(replacementCost + 500).toLocaleString()} (Replacement)`;
        }
    } else {
        estimatedCostRange = severityLevel === 0 ? "$0" : severityLevel === 1 ? "$50-$150" : severityLevel === 2 ? "$200-$500" : "$1000-$1500";
    }

    result.estimated_cost_range = estimatedCostRange;
    result.professional_recommendation = severityLevel === 0 
        ? "No repairs needed—keep it pristine with Surprise Granite’s cleaning subscription starting at $29/month!"
        : "Contact Surprise Granite for repair or replacement—our subscription plans start at $29/month!";
    result.cleaning_recommendation = "Use mild soap and water—our cleaning service can keep it sparkling!";
    result.repair_recommendation = severityLevel === 0 
        ? "No repairs needed, but our cleaning subscription keeps it great!"
        : severityLevel < 3 
        ? "A pro should handle this repair—subscribe to our repair service!"
        : "Replacement recommended—contact us for a quote!";
    result.possible_matches = possibleMatches.length > 0 ? possibleMatches : [];

    return result;
}

app.post("/api/analyze-damage", upload.single("file"), async (req, res) => {
    console.log("Received request to /api/analyze-damage");
    try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OpenAI API key" });

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath);
        const imageBase64 = imageBuffer.toString("base64");
        const imageHash = createHash("sha256").update(imageBase64).digest("hex");
        await fs.unlink(filePath).catch(err => console.error("Failed to delete temp file:", err));

        const itemsCollection = db.collection(COLLECTION_NAME);
        const existing = await itemsCollection.findOne({ imageHash });
        if (existing) {
            console.log("Returning cached analysis for image:", imageHash);
            return res.json({ response: existing.analysis });
        }

        const result = await analyzeImage(imageBase64);
        await itemsCollection.insertOne({ imageBase64, imageHash, analysis: result, createdAt: new Date() });
        console.log("Saved new analysis to DB:", imageHash);
        res.json({ response: result });
    } catch (err) {
        console.error("Analysis error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/tts", async (req, res) => {
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "Text is required" });
        if (!OPENAI_API_KEY) return res.status(500).json({ error: "Missing OpenAI API key" });

        const response = await openai.audio.speech.create({
            model: "tts-1",
            voice: "nova",
            input: text,
            response_format: "mp3",
        });

        res.set({ "Content-Type": "audio/mp3", "Content-Disposition": "inline; filename=\"tts.mp3\"" });
        response.body.pipe(res);
    } catch (err) {
        console.error("TTS error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

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

app.get("/", (req, res) => {
    res.send("✅ CARI API is live");
});

process.on("SIGTERM", async () => {
    if (client) await client.close();
    console.log("Server shut down");
    process.exit(0);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err.message);
    process.exit(1);
});

async function startServer() {
    try {
        await connectToMongoDB();
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
