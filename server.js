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
const upload = multer({ dest: "uploads/", limits: { fileSize: 10 * 1024 * 1024 } }); // Increased to 10MB

const PORT = process.env.PORT || 10000; // Match Render detection
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
            {"type": "crack", "rate_per_sqft": 10, "hours": 2},
            {"type": "chip", "rate_per_sqft": 8, "hours": 1},
            {"type": "stain", "rate_per_sqft": 6, "hours": 1.5},
            {"type": "scratch", "rate_per_sqft": 5, "hours": 0.5},
            {"type": "installation", "rate_per_sqft": 15, "hours": 1},
            {"type": "cutout", "rate_per_unit": 50, "hours": 0.5},
            {"type": "edge_profile", "rate_per_linear_ft": 20, "hours": 0.25}
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
        console.log("GET / - Serving:", filePath);
        res.sendFile(filePath, (err) => {
            if (err) throw err;
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

// Repair Analysis
app.post("/api/upload-countertop", upload.single("image"), async (req, res) => {
    console.log("POST /api/upload-countertop");
    try {
        if (!req.file) {
            console.error("No file uploaded");
            return res.status(400).json({ error: "No image uploaded" });
        }

        const filePath = req.file.path;
        const imageBuffer = await fs.readFile(filePath).catch(err => {
            console.error("Failed to read image file:", err.message);
            throw new Error("Failed to process image file");
        });
        
        const imageBase64 = imageBuffer.toString("base64");
        const imageHash = createHash("sha256").update(imageBase64).digest("hex");

        const analysis = await analyzeImage(imageBase64);
        console.log("OpenAI Repair Analysis complete:", analysis);

        const imagesCollection = db ? db.collection("countertop_images") : null;
        if (imagesCollection && analysis.stone_type) {
            const stoneTypeLower = analysis.stone_type.toLowerCase();
            if (stoneTypeLower.includes("granite")) {
                const colorKeywords = (analysis.color_and_pattern || "").toLowerCase().split(" ");
                const mongoMatches = await imagesCollection.find({ 
                    "metadata.analysis.stone_type": { $regex: /granite/i },
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
            result = await imagesCollection.insertOne(imageDoc).catch(err => {
                console.error("Failed to insert image into MongoDB:", err.message);
                return { insertedId: new ObjectId().toString() };
            });
            console.log("Image inserted, ID:", result.insertedId);
        }

        await fs.unlink(filePath).catch(err => console.error("Failed to delete temporary file:", err.message));

        res.status(201).json({ imageId: result.insertedId, message: "Image uploaded successfully", metadata: imageDoc.metadata });
    } catch (err) {
        console.error("Upload error:", err.message);
        if (req.file && fs.existsSync(req.file.path)) await fs.unlink(req.file.path).catch(() => {});
        res.status(500).json({ error: "Upload processing failed", details: err.message });
    }
});

// Project Estimation
app.post("/api/contractor-estimate", upload.single("image"), async (req, res) => {
    console.log("POST /api/contractor-estimate");
    try {
        if (!req.file) {
            console.error("No file uploaded");
            return res.status(400).json({ error: "No file uploaded" });
        }

        const filePath = req.file.path;
        let fileContent;
        if (req.file.mimetype.startsWith("image/")) {
            fileContent = (await fs.readFile(filePath)).toString("base64");
        } else if (req.file.mimetype === "application/pdf" || req.file.mimetype === "text/plain") {
            fileContent = await fs.readFile(filePath, "utf8");
        } else {
            throw new Error("Unsupported file type: " + req.file.mimetype);
        }

        const estimate = await estimateProject(fileContent, req.file.mimetype);
        console.log("OpenAI Contractor Estimate complete:", estimate);

        const imagesCollection = db ? db.collection("countertop_images") : null;
        let imageId = new ObjectId().toString();
        if (imagesCollection && req.file.mimetype.startsWith("image/")) {
            const imageHash = createHash("sha256").update(fileContent).digest("hex");
            const imageDoc = {
                imageHash,
                imageData: new Binary(Buffer.from(fileContent, "base64")),
                metadata: {
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    size: req.file.size,
                    uploadDate: new Date(),
                    estimate,
                    likes: 0
                }
            };
            const result = await imagesCollection.insertOne(imageDoc).catch(err => {
                console.error("Failed to insert image into MongoDB:", err.message);
                return { insertedId: imageId };
            });
            imageId = result.insertedId;
            console.log("Image inserted, ID:", imageId);
        }

        await fs.unlink(filePath).catch(err => console.error("Failed to delete temporary file:", err.message));

        // Enhance cost estimate with labor data
        const costEstimate = enhanceCostEstimate(estimate, laborData);
        res.status(201).json({ imageId, message: "Estimate generated successfully", ...estimate, cost_estimate: costEstimate });
    } catch (err) {
        console.error("Contractor estimate error:", err.message);
        if (req.file && fs.existsSync(req.file.path)) await fs.unlink(req.file.path).catch(() => {});
        res.status(500).json({ error: "Estimate processing failed", details: err.message });
    }
});

// Helper function to enhance cost estimate with labor data
function enhanceCostEstimate(estimate, laborData) {
    let materialCost = parseFloat(estimate.cost_estimate?.material_cost?.replace("$", "") || "50") * (parseFloat(estimate.dimensions) || 25);
    let laborCost = { installation: 0, cutouts: 0, edge_profile: 0, total: 0 };
    
    const area = parseFloat(estimate.dimensions) || 25; // Default 25 sq ft
    const installLabor = laborData.find(d => d.type === "installation");
    laborCost.installation = installLabor ? installLabor.rate_per_sqft * area : 375;

    const cutouts = estimate.additional_features?.filter(f => f.includes("cutout")).length || 0;
    const cutoutLabor = laborData.find(d => d.type === "cutout");
    laborCost.cutouts = cutoutLabor ? cutoutLabor.rate_per_unit * cutouts : 0;

    const edgeProfileLabor = laborData.find(d => d.type === "edge_profile");
    const perimeter = estimate.dimensions ? (2 * (Math.sqrt(area * 144) + Math.sqrt(area * 144))) / 12 : 20; // Approx linear ft
    laborCost.edge_profile = edgeProfileLabor && estimate.additional_features?.includes("edge profile") ? edgeProfileLabor.rate_per_linear_ft * perimeter : 0;

    laborCost.total = laborCost.installation + laborCost.cutouts + laborCost.edge_profile;
    const totalCost = materialCost + laborCost.total;

    return {
        material_cost: `$${materialCost.toFixed(2)}`,
        labor_cost: {
            installation: `$${laborCost.installation.toFixed(2)}`,
            cutouts: `$${laborCost.cutouts.toFixed(2)}`,
            edge_profile: `$${laborCost.edge_profile.toFixed(2)}`,
            total: `$${laborCost.total.toFixed(2)}`
        },
        total_cost: `$${totalCost.toFixed(2)} - $${(totalCost + 125).toFixed(2)}`
    };
}

// Other endpoints (unchanged except for minor logging)
app.get("/api/get-countertop/:id", async (req, res) => {
    console.log("GET /api/get-countertop/", req.params.id);
    try {
        if (!db) return res.status(503).json({ error: "Database unavailable" });
        const imagesCollection = db.collection("countertop_images");
        const countertop = await imagesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!countertop) return res.status(404).json({ error: "Countertop not found" });

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
        if (!countertop) return res.status(404).json({ error: "Countertop not found" });

        const newLikes = (countertop.metadata.likes || 0) + 1;
        await imagesCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { "metadata.likes": newLikes } }
        );
        res.status(200).json({ message: "Like added", likes: newLikes });
    } catch (err) {
        console.error("Like error:", err.message);
        res.status(500).json({ error: "Failed to like countertop", details: err.message });
    }
});

app.post("/api/send-email", async (req, res) => {
    console.log("POST /api/send-email", req.body);
    try {
        const { name, email, phone, message, stone_type, analysis_summary } = req.body;
        if (!name || !email || !message) return res.status(400).json({ error: "Missing required fields" });

        const templateParams = {
            from_name: name,
            from_email: email,
            phone: phone || "Not provided",
            message,
            stone_type: stone_type || "N/A",
            analysis_summary: analysis_summary || "No analysis provided"
        };

        const emailResponse = await EmailJS.send(
            EMAILJS_SERVICE_ID,
            EMAILJS_TEMPLATE_ID,
            templateParams,
            { publicKey: EMAILJS_PUBLIC_KEY }
        );
        console.log("Email sent:", emailResponse);
        res.status(200).json({ message: "Email sent successfully" });
    } catch (err) {
        console.error("Email sending error:", err.message);
        res.status(500).json({ error: "Failed to send email", details: err.message });
    }
});

app.post("/api/tts", async (req, res) => {
    console.log("POST /api/tts");
    try {
        const { text } = req.body;
        if (!text) return res.status(400).json({ error: "No text provided" });

        const response = await openai.audio.speech.create({
            model: "tts-1",
            voice: "alloy",
            input: text
        });

        const audioBuffer = Buffer.from(await response.arrayBuffer());
        res.set({ "Content-Type": "audio/mpeg", "Content-Length": audioBuffer.length });
        res.send(audioBuffer);
    } catch (err) {
        console.error("TTS error:", err.message);
        res.status(500).json({ error: "Failed to generate audio", details: err.message });
    }
});

// Analysis Functions (unchanged except for null checks)
async function analyzeImage(imageBase64) {
    console.log("Analyzing image with OpenAI for repair...");
    const prompt = `...`; // Your existing prompt unchanged

    let result;
    try {
        console.log("Sending request to OpenAI API for repair analysis...");
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] }
            ],
            max_tokens: 4000,
            temperature: 0.5
        });

        const content = response.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No valid JSON found in OpenAI response");

        result = JSON.parse(jsonMatch[0]);
    } catch (err) {
        console.error("OpenAI repair analysis failed:", err.message);
        result = {
            stone_type: "Unknown",
            color_and_pattern: "Not identified",
            damage_type: "No visible damage",
            severity: "None",
            reasoning: "Repair analysis failed: " + err.message
        };
    }

    let materialsFromDB = [];
    if (db) {
        const imagesCollection = db.collection("countertop_images");
        materialsFromDB = await imagesCollection.find({ "metadata.analysis": { $exists: true } }).toArray().catch(err => {
            console.error("Failed to load materials from MongoDB:", err.message);
            return [];
        });
    }

    const identifiedColor = (result.color_and_pattern || "").toLowerCase();
    const identifiedMaterial = (result.stone_type || "").toLowerCase();

    const bestMatch = materialsFromDB.find(item => 
        item.metadata?.analysis?.stone_type?.toLowerCase() === identifiedMaterial &&
        identifiedColor.includes(item.metadata.analysis.color_and_pattern?.toLowerCase().split(" ")[0] || "")
    );

    result.color_match_suggestion = bestMatch?.metadata.analysis.color_and_pattern || "No match found";
    result.estimated_cost = calculateRepairCost(result.damage_type || "none", result.severity || "None");
    result.material_composition = result.stone_type ? `${result.stone_type} (${result.natural_stone ? "Natural" : "Engineered"})` : "Not identified";
    result.natural_stone = result.stone_type && ["marble", "granite", "quartzite", "limestone", "soapstone"].includes(identifiedMaterial);
    result.professional_recommendation = result.severity === "Severe" ? "Contact a professional for repair or replacement." : 
                                        result.severity === "Moderate" ? "Consider professional repair." : 
                                        "No action required.";
    result.cleaning_recommendation = identifiedMaterial === "marble" ? "Use a pH-neutral cleaner and avoid acidic substances." : 
                                    "Clean with mild soap and water.";
    result.repair_recommendation = result.severity === "Severe" || result.severity === "Moderate" ? "Professional repair recommended." : 
                                  "No repairs needed.";
    result.possible_matches = materialsFromDB
        .filter(item => item.metadata?.analysis?.stone_type && item.metadata?.analysis?.color_and_pattern)
        .map(item => ({
            color_name: item.metadata.analysis.color_and_pattern,
            material: item.metadata.analysis.stone_type
        }))
        .slice(0, 5);

    return result;
}

async function estimateProject(fileContent, mimeType) {
    console.log("Estimating project with OpenAI...");
    const prompt = `...`; // Your existing prompt unchanged

    let result;
    try {
        const messages = [
            { role: "system", content: prompt },
            {
                role: "user",
                content: mimeType.startsWith("image/") ? 
                    [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileContent}` } }] : 
                    [{ type: "text", text: fileContent }]
            }
        ];

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: 4000,
            temperature: 0.5
        });

        const content = response.choices[0].message.content;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No valid JSON found in OpenAI response");

        result = JSON.parse(jsonMatch[0]);
    } catch (err) {
        console.error("OpenAI contractor estimate failed:", err.message);
        result = {
            input_type: mimeType.startsWith("image/") ? "image" : "document",
            project_scope: "Unknown",
            material_type: "Unknown",
            color_and_pattern: "Not identified",
            dimensions: "Not specified",
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            cost_estimate: { material_cost: "Unknown", labor_cost: "Unknown", total_cost: "Contact for estimate" },
            reasoning: "Estimate failed: " + err.message
        };
    }

    let materialsFromDB = [];
    if (db) {
        const imagesCollection = db.collection("countertop_images");
        materialsFromDB = await imagesCollection.find({ "metadata.analysis": { $exists: true } }).toArray().catch(err => {
            console.error("Failed to load materials from MongoDB:", err.message);
            return [];
        });
    }

    const identifiedColor = (result.color_and_pattern || "").toLowerCase();
    const identifiedMaterial = (result.material_type || "").toLowerCase();

    const bestMatch = materialsFromDB.find(item => 
        item.metadata?.analysis?.stone_type?.toLowerCase() === identifiedMaterial &&
        identifiedColor.includes(item.metadata.analysis.color_and_pattern?.toLowerCase().split(" ")[0] || "")
    );

    result.material_match_suggestion = bestMatch?.metadata.analysis.color_and_pattern || "No match found";
    result.possible_matches = materialsFromDB
        .filter(item => item.metadata?.analysis?.stone_type && item.metadata?.analysis?.color_and_pattern)
        .map(item => ({
            color_name: item.metadata.analysis.color_and_pattern,
            material: item.metadata.analysis.stone_type
        }))
        .slice(0, 5);

    return result;
}

function calculateRepairCost(damageType, severity) {
    if (!laborData.length) return "Contact for estimate";

    const simplifiedDamageType = (damageType || "none").toLowerCase();
    if (simplifiedDamageType.includes("none") || simplifiedDamageType.includes("pristine")) return "$0.00";

    const typeMap = { crack: "crack", chip: "chip", stain: "stain", discoloration: "stain", scratch: "scratch" };
    const matchedType = Object.keys(typeMap).find(key => simplifiedDamageType.includes(key));
    if (!matchedType) return "Contact for estimate (unrecognized damage type)";

    const laborEntry = laborData.find(entry => entry.type === typeMap[matchedType]);
    if (!laborEntry) return "Contact for estimate (labor data missing)";

    const severityMultiplier = { "Low": 1, "Moderate": 2, "Severe": 3, "None": 0 }[severity || "None"] || 1;
    const cost = laborEntry.rate_per_sqft * severityMultiplier * laborEntry.hours;
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
