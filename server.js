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

const PORT = process.env.PORT || 10000; // Matches your log "Server running on port 10000"
const MONGODB_URI = process.env.MONGODB_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

let laborData;
async function loadLaborData() {
    try {
        const laborJsonPath = path.join(__dirname, "data", "labor.json");
        const data = await fs.readFile(laborJsonPath, "utf8");
        laborData = JSON.parse(data);
        console.log("Loaded labor.json:", laborData);
    } catch (err) {
        console.error("Failed to load labor.json:", err.message);
        laborData = [];
    }
}

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
    const filePath = path.join(__dirname, "public", "index.html");
    console.log("GET / - Attempting to serve:", filePath);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error("Error serving index.html:", err.message);
            res.status(500).json({ error: "Failed to load index.html", details: err.message });
        }
    });
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
        const imageBuffer = await fs.readFile(filePath);
        const imageBase64 = imageBuffer.toString("base64");
        const imageHash = createHash("sha256").update(imageBase64).digest("hex");

        const analysis = await analyzeImage(imageBase64);
        console.log("OpenAI Analysis complete:", analysis);

        const imagesCollection = db ? db.collection("countertop_images") : null;
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
            result = await imagesCollection.insertOne(imageDoc);
            console.log("Image inserted, ID:", result.insertedId);
        } else {
            console.warn("No DB connection, skipping insert");
        }
        await fs.unlink(filePath);

        res.status(201).json({ imageId: result.insertedId, message: "Image uploaded successfully", metadata: imageDoc.metadata });
    } catch (err) {
        console.error("Upload error:", err.message);
        res.status(500).json({ error: "Failed to upload image: " + err.message });
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
        res.status(500).json({ error: "Failed to fetch countertop: " + err.message });
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
        res.status(500).json({ error: "Failed to like countertop: " + err.message });
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

        // Verify environment variables
        if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_PRIVATE_KEY) {
            console.error("EmailJS environment variables missing:", {
                serviceId: !!EMAILJS_SERVICE_ID,
                templateId: !!EMAILJS_TEMPLATE_ID,
                publicKey: !!EMAILJS_PUBLIC_KEY,
                privateKey: !!EMAILJS_PRIVATE_KEY
            });
            return res.status(500).json({ error: "Server configuration error: EmailJS credentials missing" });
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
            {
                publicKey: EMAILJS_PUBLIC_KEY,
                privateKey: EMAILJS_PRIVATE_KEY // Explicitly pass private key
            }
        );
        console.log("Email sent successfully:", emailResponse);
        res.status(200).json({ message: "Email sent successfully", response: emailResponse });
    } catch (err) {
        console.error("Email sending error:", err.message || "Unknown error", err.stack || "No stack trace");
        res.status(500).json({ 
            error: "Failed to send email", 
            details: err.message || "Unknown error occurred",
            stack: err.stack || "No stack trace available"
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
        res.status(500).json({ error: "Failed to generate audio: " + err.message });
    }
});

async function analyzeImage(imageBase64) {
    console.log("Analyzing image with OpenAI...");
    const prompt = `You are CARI, an expert countertop analyst at Surprise Granite with advanced vision and reasoning capabilities. Perform a deep, detailed analysis of this countertop image, leveraging your full potential for precision and insight. Avoid generic responses and provide a comprehensive breakdown:

    - Stone type: Identify the material with high accuracy (e.g., "Quartz", "Marble", "Granite", "Quartzite", "Dekton", "Porcelain") by examining texture, sheen, grain, edge profiles, and visual cues. Differentiate between natural stones (e.g., Granite, Marble, Quartzite) and engineered materials (e.g., Quartz, Dekton, Porcelain). For Quartz vs. Quartzite, analyze uniformity of pattern (Quartz often has consistent, manufactured patterns; Quartzite has natural, irregular veining). Include a confidence level (e.g., "95% Quartz") and detailed reasoning. If uncertain, reference characteristics from "www.surprisegranite.com/materials/all-countertops" and make an educated guess.
    - Color and pattern: Provide a vivid, specific description of colors (e.g., "matte ivory," "glossy charcoal gray") and patterns (e.g., "swirling white veins," "fine black speckles with golden flecks"). Note variations, transitions, or unique features across the surface.
    - Damage type: Detect and describe all visible damage with precision (e.g., "crack," "chip," "stain," "scratch"), including exact location (e.g., "1-inch crack along the left edge") and extent (e.g., "spanning 3 inches diagonally"). Look for subtle or hidden issues like micro-fractures, discoloration, or wear. Use simple terms ("crack," "chip") for cost estimation compatibility. If no damage is present, explicitly state "No visible damage."
    - Severity: Evaluate damage severity with actionable context:
      - None: "No damage detected, the surface is pristine!"
      - Low: "Minor imperfection, easily repairable with minimal effort."
      - Moderate: "Noticeable damage, repair advised to prevent progression."
      - Severe: "Significant structural damage, immediate professional attention recommended."
    - Possible matches: Suggest up to 5 possible countertop material matches from common industry options (e.g., "Carrara Marble", "Calacatta Quartz", "Black Galaxy Granite"). Base these on the stone type, color, and pattern observed in the image. For each match, provide a name, material type, and brief reasoning (e.g., "Carrara Marble - Marble - Matches the white base with gray veining"). If no close matches, state "No close matches identified."
    - Reasoning: Deliver a thorough, evidence-based explanation of your findings, referencing specific visual clues (e.g., "The uniform sheen and engineered veining suggest Quartz over Quartzite"). Avoid assumptions; base conclusions solely on the image.

    Respond in JSON format with keys: stone_type, color_and_pattern, damage_type, severity, possible_matches (array of objects with name, material, reasoning), reasoning. Ensure every analysis is fresh and unique, even for identical images, to support testing.`;

    let result;
    try {
        console.log("Sending request to OpenAI API...");
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] }
            ],
            max_tokens: 3000,
            temperature: 0.7
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
            possible_matches: [],
            reasoning: "Analysis failed due to an error: " + err.message
        };
    }

    const identifiedColor = result.color_and_pattern.toLowerCase();
    const identifiedMaterial = result.stone_type.toLowerCase();
    const bestMatch = materialsData.find(item =>
        item.Material.toLowerCase() === identifiedMaterial &&
        identifiedColor.includes(item["Color Name"].toLowerCase().split("-")[0])
    ) || {};

    result.color_match_suggestion = bestMatch["Color Name"] || "No match found";
    result.estimated_cost = calculateRepairCost(result.damage_type, result.severity);
    result.material_composition = result.stone_type ? `${result.stone_type} ${result.natural_stone ? "(Natural)" : "(Engineered)"}` : "Not identified";
    result.natural_stone = result.stone_type && ["marble", "granite", "quartzite"].includes(result.stone_type.toLowerCase());
    result.professional_recommendation = result.severity === "Severe" ? "Contact a professional for repair or replacement." : 
                                        result.severity === "Moderate" ? "Consider professional repair." : 
                                        "No action required.";
    result.cleaning_recommendation = result.stone_type === "Marble" ? "Use a pH-neutral cleaner and avoid acidic substances." : 
                                    "Clean with mild soap and water.";
    result.repair_recommendation = result.severity === "Severe" || result.severity === "Moderate" ? "Professional repair recommended." : 
                                  "No repairs needed.";

    console.log("Final analysis result:", result);
    return result;
}

function calculateRepairCost(damageType, severity) {
    if (!laborData || laborData.length === 0) {
        console.warn("laborData not loaded or empty");
        return "Contact for estimate";
    }
    
    let simplifiedDamageType = damageType.toLowerCase();
    if (simplifiedDamageType.includes("none") || simplifiedDamageType.includes("pristine")) {
        console.log("No damage detected, cost set to $0.00");
        return "$0.00";
    }
    if (simplifiedDamageType.includes("crack")) simplifiedDamageType = "crack";
    else if (simplifiedDamageType.includes("chip")) simplifiedDamageType = "chip";
    else if (simplifiedDamageType.includes("stain")) simplifiedDamageType = "stain";
    else if (simplifiedDamageType.includes("scratch")) simplifiedDamageType = "scratch";
    else {
        console.warn("No matching damage type found in laborData:", simplifiedDamageType);
        return "Contact for estimate";
    }

    const laborEntry = laborData.find(entry => 
        entry.repair_type.toLowerCase() === simplifiedDamageType
    );
    if (!laborEntry) {
        console.warn("No labor entry found for damage type:", simplifiedDamageType);
        return "Contact for estimate";
    }

    const severityMultiplier = {
        "Low": 1,
        "Moderate": 2,
        "Severe": 3,
        "N/A": 0,
        "None": 0
    }[severity] || 1;

    const cost = laborEntry.rate_per_sqft * severityMultiplier * laborEntry.hours;
    console.log("Calculated repair cost:", { damageType: simplifiedDamageType, severity, cost });
    return `$${cost.toFixed(2)}`;
}

console.log(`Starting server on port ${PORT}...`);
loadLaborData().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        connectToMongoDB();
    });
});
