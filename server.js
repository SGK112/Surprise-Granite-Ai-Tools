require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs").promises;
const path = require("path");
const { MongoClient, Binary, ObjectId } = require("mongodb");
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

let laborData = [];
async function loadLaborData() {
    try {
        const laborJsonPath = path.join(__dirname, "data", "labor.json");
        const data = await fs.readFile(laborJsonPath, "utf8");
        laborData = JSON.parse(data);
        console.log("Loaded labor.json:", laborData);
    } catch (err) {
        console.error("Failed to load labor.json:", err.message);
        laborData = [
            {"repair_type": "crack", "rate_per_sqft": 10, "hours": 2},
            {"repair_type": "chip", "rate_per_sqft": 8, "hours": 1},
            {"repair_type": "stain", "rate_per_sqft": 6, "hours": 1.5},
            {"repair_type": "scratch", "rate_per_sqft": 5, "hours": 0.5}
        ];
        console.log("Using default labor data:", laborData);
    }
}

let db;

async function connectToMongoDB() {
    try {
        const client = new MongoClient(MONGODB_URI);
        await client.connect();
        db = client.db("countertops");
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        console.error("MongoDB connection failed:", err.message);
        db = null;
    }
}

app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    try {
        const filePath = path.join(__dirname, "public", "index.html");
        console.log("GET / - Attempting to serve:", filePath);
        res.sendFile(filePath, (err) => {
            if (err) {
                console.error("Error serving index.html:", err.message);
                res.status(500).json({ error: "Failed to load index.html", details: err.message });
            }
        });
    } catch (err) {
        console.error("GET / error:", err.message);
        res.status(500).json({ error: "Server error", details: err.message });
    }
});

app.get("/api/health", (req, res) => {
    console.log("GET /api/health");
    const dbStatus = db ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: PORT, dbStatus });
});

app.post("/api/upload-countertop", upload.single("image"), async (req, res) => {
    console.log("POST /api/upload-countertop");
    try {
        if (!req.file) {
            console.error("No file uploaded");
            return res.status(400).json({ error: "No image uploaded" });
        }

        const filePath = req.file.path;
        let imageBuffer;
        try {
            imageBuffer = await fs.readFile(filePath);
        } catch (err) {
            console.error("Failed to read image file:", err.message);
            throw new Error("Failed to process image file");
        }
        
        const imageBase64 = imageBuffer.toString("base64");
        const imageHash = createHash("sha256").update(imageBase64).digest("hex");

        const analysis = await analyzeImage(imageBase64);
        console.log("OpenAI Analysis complete:", analysis);

        if (!db) {
            console.warn("Database not connected, proceeding with OpenAI analysis only");
        }

        const imagesCollection = db ? db.collection("countertop_images") : null;
        if (imagesCollection) {
            if (analysis.stone_type.toLowerCase() === "granite") {
                const colorKeywords = analysis.color_and_pattern.toLowerCase().split(" ");
                const mongoMatches = await imagesCollection.find({ 
                    "metadata.analysis.stone_type": "Granite",
                    $or: colorKeywords.map(keyword => ({
                        "metadata.analysis.color_and_pattern": { $regex: keyword, $options: "i" }
                    }))
                }).limit(5).toArray();

                analysis.mongo_matches = mongoMatches.map(match => ({
                    stone_type: match.metadata.analysis.stone_type,
                    color_and_pattern: match.metadata.analysis.color_and_pattern,
                    imageBase64: match.imageData.buffer.toString("base64")
                }));
            } else {
                analysis.mongo_matches = [];
            }
        } else {
            analysis.mongo_matches = [];
        }

        const imageDoc = {
            imageHash,
            imageData: new Binary(imageBuffer),
            metadata: {
                originalName: req.file.originalname,
                mimeType: req.file.mimetype,
                size: req.file.size,
                uploadDate: new Date(),
                analysis,
                likes: 0
            }
        };

        let result = { insertedId: new ObjectId().toString() };
        if (imagesCollection) {
            try {
                result = await imagesCollection.insertOne(imageDoc);
                console.log("Image inserted, ID:", result.insertedId);
            } catch (err) {
                console.error("Failed to insert image into MongoDB:", err.message);
            }
        } else {
            console.warn("No DB connection, skipping insert");
        }

        try {
            await fs.unlink(filePath);
            console.log("Temporary file deleted:", filePath);
        } catch (err) {
            console.error("Failed to delete temporary file:", err.message);
        }

        res.status(201).json({ imageId: result.insertedId, message: "Image uploaded successfully", metadata: imageDoc.metadata });
    } catch (err) {
        console.error("Upload error:", err.message);
        res.status(500).json({ error: "Upload processing failed", details: err.message });
    }
});

app.get("/api/get-countertop/:id", async (req, res) => {
    console.log("GET /api/get-countertop/", req.params.id);
    try {
        if (!db) return res.status(503).json({ error: "Database unavailable" });
        const imagesCollection = db.collection("countertop_images");
        const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!countertop) {
            console.error("Countertop not found");
            return res.status(404).json({ error: "Countertop not found" });
        }

        const response = {
            id: countertop._id,
            imageBase64: countertop.imageData.buffer.toString("base64"),
            metadata: countertop.metadata || {}
        };
        res.json(response);
    } catch (err) {
        console.error("Fetch countertop error:", err.message);
        res.status(500).json({ error: "Failed to fetch countertop", details: err.message });
    }
});

app.post("/api/like-countertop/:id", async (req, res) => {
    console.log("POST /api/like-countertop/", req.params.id);
    try {
        if (!db) return res.status(503).json({ error: "Database unavailable" });
        const imagesCollection = db.collection("countertop_images");
        const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!countertop) {
            console.error("Countertop not found");
            return res.status(404).json({ error: "Countertop not found" });
        }

        const newLikes = (countertop.metadata.likes || 0) + 1;
        await imagesCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { "metadata.likes": newLikes } }
        );
        console.log("Like added, new count:", newLikes);
        res.status(200).json({ message: "Like added", likes: newLikes });
    } catch (err) {
        console.error("Like error:", err.message);
        res.status(500).json({ error: "Failed to like countertop", details: err.message });
    }
});

app.post("/api/send-email", async (req, res) => {
    console.log("POST /api/send-email - Request body:", req.body);
    try {
        const { name, email, phone, message, stone_type, analysis_summary } = req.body;
        if (!name || !email || !message) {
            console.error("Missing required fields:", { name, email, message });
            return res.status(400).json({ error: "Missing required fields: name, email, and message are required" });
        }

        const templateParams = {
            from_name: name,
            from_email: email,
            phone: phone || "Not provided",
            message,
            stone_type: stone_type || "N/A",
            analysis_summary: analysis_summary || "No analysis provided"
        };

        console.log("Sending email with EmailJS:", templateParams);
        const emailResponse = await EmailJS.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            templateParams,
            { publicKey: EMAILJS_PUBLIC_KEY }
        );
        console.log("Email sent successfully:", emailResponse);
        res.status(200).json({ message: "Email sent successfully" });
    } catch (err) {
        console.error("Email sending error:", err.message, err.stack);
        res.status(500).json({ 
            error: "Failed to send email", 
            details: err.message || "Unknown error occurred" 
        });
    }
});

app.post("/api/tts", async (req, res) => {
    console.log("POST /api/tts");
    try {
        const { text } = req.body;
        if (!text) {
            console.error("No text provided");
            return res.status(400).json({ error: "No text provided" });
        }

        const response = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy",
            input: text
        });

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = Buffer.from(arrayBuffer);
        res.set({
            "Content-Type": "audio/mpeg",
            "Content-Length": audioBuffer.length
        });
        console.log("TTS audio generated, length:", audioBuffer.length);
        res.send(audioBuffer);
    } catch (err) {
        console.error("TTS error:", err.message);
        res.status(500).json({ error: "Failed to generate audio", details: err.message });
    }
});

async function analyzeImage(imageBase64) {
    console.log("Analyzing image with OpenAI...");
    const prompt = `You are CARI, an expert countertop analyst at Surprise Granite with advanced vision and reasoning capabilities. Perform an exhaustive, detailed analysis of this countertop image, leveraging your full potential for precision and insight. Provide a comprehensive breakdown without generic responses:

    - Stone type: Identify the material with maximum accuracy (e.g., "Quartz", "Marble", "Granite", "Quartzite", "Dekton", "Porcelain", "Limestone", "Soapstone") by examining texture, sheen, grain, edge profiles, polish level, and visual cues. Differentiate natural stones (e.g., Granite, Marble, Quartzite, Limestone, Soapstone) from engineered materials (e.g., Quartz, Dekton, Porcelain) based on pattern uniformity, veining irregularity, and surface finish. For Quartz vs. Quartzite, note Quartz’s consistent, manufactured patterns vs. Quartzite’s natural, varied veining. Include a confidence level (e.g., "95% Quartz") and exhaustive reasoning. If uncertain, cross-reference with "www.surprisegranite.com/materials/all-countertops" and hypothesize based on visual evidence.
    - Color and pattern: Deliver a vivid, precise description of colors (e.g., "matte ivory with golden undertones," "glossy charcoal gray") and patterns (e.g., "swirling white veins with subtle blue streaks," "fine black speckles with golden flecks"). Note variations, transitions, edge details, or unique surface features (e.g., honed vs. polished finish).
    - Damage type: Detect and describe all visible damage with precision (e.g., "crack," "chip," "stain," "scratch," "discoloration," "wear"), specifying exact location (e.g., "1-inch crack along the left edge near the sink") and extent (e.g., "spanning 3 inches diagonally"). Identify subtle issues like micro-fractures, pitting, or fading. Use simple terms ("crack," "chip") for cost estimation compatibility. If no damage, state "No visible damage."
    - Severity: Evaluate damage severity with detailed, actionable context:
      - None: "No damage detected, the surface is pristine and flawless!"
      - Low: "Minor imperfection, easily repairable with minimal effort (e.g., light sanding)."
      - Moderate: "Noticeable damage, repair advised to prevent progression (e.g., sealing or patching)."
      - Severe: "Significant structural damage, immediate professional attention recommended."
    - Reasoning: Provide a thorough, evidence-based explanation of your findings, referencing specific visual clues (e.g., "The uniform sheen, consistent veining, and polished edge suggest engineered Quartz"). Explore all visible details, avoid assumptions, and ensure a unique analysis each time.

    Respond in JSON format with keys: stone_type, color_and_pattern, damage_type, severity, reasoning. Maximize detail for testing purposes, even for repeat images.`;

    let result;
    try {
        console.log("Sending request to OpenAI API...");
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] }
            ],
            max_tokens: 4000,
            temperature: 0.5
        });

        console.log("OpenAI response received:", response);
        const content = response.choices[0].message.content;
        console.log("Raw content from OpenAI:", content);

        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("No valid JSON found in OpenAI response");
        }

        result = JSON.parse(jsonMatch[0]);
        console.log("Parsed analysis result:", result);

        if (result.error) {
            console.error("OpenAI returned an error:", result.error);
            throw new Error(result.error);
        }
    } catch (err) {
        console.error("OpenAI analysis failed:", err.message, err.stack);
        result = {
            stone_type: "Unknown",
            color_and_pattern: "Not identified",
            damage_type: "No visible damage",
            severity: "None",
            reasoning: "Analysis failed due to an error: " + err.message
        };
    }

    // Fetch dynamic materials from MongoDB with validation
    let materialsFromDB = [];
    if (db) {
        try {
            const imagesCollection = db.collection("countertop_images");
            materialsFromDB = await imagesCollection.find({ "metadata.analysis": { $exists: true } }).toArray();
            console.log("Loaded materials from MongoDB:", materialsFromDB.length, "entries");
        } catch (err) {
            console.error("Failed to load materials from MongoDB:", err.message);
        }
    } else {
        console.warn("No DB connection, skipping materials fetch");
    }

    const identifiedColor = result.color_and_pattern.toLowerCase();
    const identifiedMaterial = result.stone_type.toLowerCase();

    // Find best match from uploaded materials with safety checks
    const bestMatch = materialsFromDB.find(item => 
        item.metadata && 
        item.metadata.analysis && 
        item.metadata.analysis.stone_type && 
        item.metadata.analysis.color_and_pattern &&
        item.metadata.analysis.stone_type.toLowerCase() === identifiedMaterial &&
        identifiedColor.includes(item.metadata.analysis.color_and_pattern.toLowerCase().split(" ")[0])
    );

    result.color_match_suggestion = bestMatch && bestMatch.metadata.analysis.color_and_pattern ? bestMatch.metadata.analysis.color_and_pattern : "No match found";
    result.estimated_cost = calculateRepairCost(result.damage_type, result.severity);
    result.material_composition = result.stone_type ? `${result.stone_type} (${result.natural_stone ? "Natural" : "Engineered"})` : "Not identified";
    result.natural_stone = result.stone_type && ["marble", "granite", "quartzite", "limestone", "soapstone"].includes(result.stone_type.toLowerCase());
    result.professional_recommendation = result.severity === "Severe" ? "Contact a professional for repair or replacement." : 
                                        result.severity === "Moderate" ? "Consider professional repair." : 
                                        "No action required.";
    result.cleaning_recommendation = result.stone_type === "Marble" ? "Use a pH-neutral cleaner and avoid acidic substances." : 
                                    "Clean with mild soap and water.";
    result.repair_recommendation = result.severity === "Severe" || result.severity === "Moderate" ? "Professional repair recommended." : 
                                  "No repairs needed.";
    result.possible_matches = materialsFromDB
        .filter(item => item.metadata && item.metadata.analysis && item.metadata.analysis.stone_type && item.metadata.analysis.color_and_pattern)
        .map(item => ({
            color_name: item.metadata.analysis.color_and_pattern,
            material: item.metadata.analysis.stone_type
        }))
        .slice(0, 5);

    console.log("Final analysis result:", result);
    return result;
}

function calculateRepairCost(damageType, severity) {
    if (!laborData || laborData.length === 0) {
        console.warn("Labor data not loaded or empty");
        return "Contact for estimate";
    }

    let simplifiedDamageType = damageType.toLowerCase();
    if (simplifiedDamageType.includes("none") || simplifiedDamageType.includes("pristine")) {
        console.log("No damage detected, cost set to $0.00");
        return "$0.00";
    }
    if (simplifiedDamageType.includes("crack")) simplifiedDamageType = "crack";
    else if (simplifiedDamageType.includes("chip")) simplifiedDamageType = "chip";
    else if (simplifiedDamageType.includes("stain") || simplifiedDamageType.includes("discoloration")) simplifiedDamageType = "stain";
    else if (simplifiedDamageType.includes("scratch")) simplifiedDamageType = "scratch";
    else {
        console.log("No matching damage type found in labor.json for:", damageType);
        return "Contact for estimate (unrecognized damage type)";
    }

    const laborEntry = laborData.find(entry => 
        entry.repair_type.toLowerCase() === simplifiedDamageType
    );
    if (!laborEntry) {
        console.log("Labor entry not found for simplified damage type:", simplifiedDamageType);
        return "Contact for estimate (labor data missing)";
    }

    const severityMultiplier = {
        "Low": 1,
        "Moderate": 2,
        "Severe": 3,
        "N/A": 0,
        "None": 0
    }[severity] || 1;

    const cost = laborEntry.rate_per_sqft * severityMultiplier * laborEntry.hours;
    console.log(`Calculated cost: $${cost.toFixed(2)} for ${simplifiedDamageType}, severity: ${severity}`);
    return `$${cost.toFixed(2)}`;
}

console.log(`Starting server on port ${PORT}...`);
loadLaborData().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        connectToMongoDB();
    });
}).catch(err => {
    console.error("Server startup failed:", err.message);
    process.exit(1);
});
