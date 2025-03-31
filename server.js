require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs").promises;
const { createHash } = require("crypto");
const { MongoClient, Binary, ObjectId } = require("mongodb");
const OpenAI = require("openai");
const nodemailer = require("nodemailer");
const NodeCache = require("node-cache");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const pdfParse = require("pdf-parse");
const Jimp = require("jimp"); // Added for image color matching

const app = express();
const PORT = process.env.PORT || 10000;
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";

app.set("trust proxy", 1);

// Increased file size limit to 50MB to allow multiple photos or files
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // Increased from 10MB to 50MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "application/pdf", "text/plain"];
        cb(null, allowedTypes.includes(file.mimetype));
    }
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const cache = new NodeCache({ stdTTL: 7200, checkperiod: 300 });

let laborData = [];
let materialsData = [];
let db = null;
let mongoClient;

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.use(compression());
app.use(cors({ origin: true, credentials: true }));
app.use(helmet());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100, keyGenerator: (req) => req.ip }));
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip}`);
    next();
});

function throwError(message, status = 500) {
    const err = new Error(message);
    err.status = status;
    throw err;
}

function logError(message, err) {
    console.error(`${message}: ${err?.message || "Unknown error"}`, err?.stack || err);
}

async function loadLaborData() {
    try {
        const laborJsonPath = path.join(__dirname, "data", "labor.json");
        const rawData = JSON.parse(await fs.readFile(laborJsonPath, "utf8"));
        console.log("Loaded labor.json:", rawData.length, "entries");

        laborData = rawData.map(item => {
            const isPerSqFt = item["U/M"] === "SQFT";
            const isPerUnit = ["EA", "LF", "Per Job"].includes(item["U/M"]);
            return {
                code: item.Code,
                type: item.Service.toLowerCase().replace(/\s+/g, "_"),
                rate_per_sqft: isPerSqFt ? item.Price : 0,
                rate_per_unit: isPerUnit ? item.Price : 0,
                unit_measure: item["U/M"],
                hours: isPerSqFt ? 1 : (isPerUnit ? 0 : 0.5),
                description: item.Description,
                confidence: 1
            };
        });
        // Expanded labor data for new trades
        laborData.push(
            { type: "framing", rate_per_sqft: 8, hours: 1.2, confidence: 1 },
            { type: "drywall_installation", rate_per_sqft: 5, hours: 1, confidence: 1 },
            { type: "plumbing_installation", rate_per_unit: 200, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "electrical_installation", rate_per_unit: 250, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "handyman_service", rate_per_hour: 75, hours: 1, confidence: 1 },
            { type: "interior_design_consultation", rate_per_unit: 500, unit_measure: "Per Job", hours: 0, confidence: 1 },
            { type: "architectural_design", rate_per_unit: 1000, unit_measure: "Per Job", hours: 0, confidence: 1 },
            { type: "furniture_design", rate_per_unit: 300, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "cabinet_installation", rate_per_unit: 150, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "millwork_installation", rate_per_sqft: 20, hours: 1.5, confidence: 1 },
            { type: "finish_carpentry", rate_per_sqft: 15, hours: 1, confidence: 1 }
        );
    } catch (err) {
        logError("Failed to load labor.json, using defaults", err);
        laborData = [
            { type: "countertop_installation", rate_per_sqft: 20, hours: 1, confidence: 1 },
            { type: "tile_installation", rate_per_sqft: 12, hours: 1.5, confidence: 1 },
            { type: "shower_remodel", rate_per_sqft: 15, hours: 2, confidence: 1 },
            { type: "grab_bar_installation", rate_per_unit: 150, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "framing", rate_per_sqft: 8, hours: 1.2, confidence: 1 },
            { type: "drywall_installation", rate_per_sqft: 5, hours: 1, confidence: 1 },
            { type: "plumbing_installation", rate_per_unit: 200, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "electrical_installation", rate_per_unit: 250, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "handyman_service", rate_per_hour: 75, hours: 1, confidence: 1 },
            { type: "interior_design_consultation", rate_per_unit: 500, unit_measure: "Per Job", hours: 0, confidence: 1 },
            { type: "architectural_design", rate_per_unit: 1000, unit_measure: "Per Job", hours: 0, confidence: 1 },
            { type: "furniture_design", rate_per_unit: 300, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "cabinet_installation", rate_per_unit: 150, unit_measure: "EA", hours: 0, confidence: 1 },
            { type: "millwork_installation", rate_per_sqft: 20, hours: 1.5, confidence: 1 },
            { type: "finish_carpentry", rate_per_sqft: 15, hours: 1, confidence: 1 }
        ];
    }
}

async function loadMaterialsData() {
    try {
        const materialsJsonPath = path.join(__dirname, "data", "materials.json");
        const rawData = JSON.parse(await fs.readFile(materialsJsonPath, "utf8"));
        console.log("Loaded materials.json:", rawData.length, "entries");

        const materialMap = new Map();
        rawData.forEach(item => {
            const key = `${item.Material}-${item["Color Name"]}`.toLowerCase();
            if (!materialMap.has(key)) {
                materialMap.set(key, { totalCost: 0, count: 0 });
            }
            const entry = materialMap.get(key);
            entry.totalCost += item["Cost/SqFt"];
            entry.count += 1;
        });

        materialsData = Array.from(materialMap.entries()).map(([key, { totalCost, count }]) => {
            const [material, color] = key.split("-");
            return {
                type: material.charAt(0).toUpperCase() + material.slice(1),
                color: color.charAt(0).toUpperCase() + color.slice(1),
                cost_per_sqft: totalCost / count,
                confidence: 1
            };
        });

        materialsData.push(
            { type: "Tile", color: "Generic", cost_per_sqft: 15, confidence: 0.8 },
            { type: "Wood", color: "Oak", cost_per_sqft: 10, confidence: 1 },
            { type: "Wood", color: "Maple", cost_per_sqft: 12, confidence: 1 },
            { type: "Stone", color: "Generic", cost_per_sqft: 50, confidence: 1 }
        );
        console.log("Processed materials:", materialsData.length, "unique entries");
    } catch (err) {
        logError("Failed to load materials.json, using defaults", err);
        materialsData = [
            { type: "Granite", color: "Generic", cost_per_sqft: 50, confidence: 1 },
            { type: "Quartz", color: "Generic", cost_per_sqft: 60, confidence: 1 },
            { type: "Tile", color: "Generic", cost_per_sqft: 15, confidence: 1 },
            { type: "Marble", color: "Generic", cost_per_sqft: 5.5, confidence: 1 },
            { type: "Wood", color: "Oak", cost_per_sqft: 10, confidence: 1 },
            { type: "Wood", color: "Maple", cost_per_sqft: 12, confidence: 1 },
            { type: "Stone", color: "Generic", cost_per_sqft: 50, confidence: 1 }
        ];
    }
}

async function connectToMongoDB() {
    if (!process.env.MONGODB_URI) {
        console.warn("MONGODB_URI not set; skipping MongoDB connection.");
        return;
    }
    try {
        mongoClient = new MongoClient(process.env.MONGODB_URI, {
            maxPoolSize: 50,
            minPoolSize: 5,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 30000
        });
        await mongoClient.connect();
        db = mongoClient.db("countertops");
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        logError("MongoDB connection failed", err);
        db = null;
    }
}

async function ensureMongoDBConnection() {
    if (!db && process.env.MONGODB_URI) await connectToMongoDB();
}

async function withRetry(fn, maxAttempts = 3, delayMs = 1000) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            if (attempt === maxAttempts || !err.status || err.status < 500) throw err;
            console.log(`Retry ${attempt}/${maxAttempts} after error: ${err.message}`);
            await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        }
    }
}

async function extractFileContent(file) {
    try {
        if (file.mimetype.startsWith("image/")) {
            const image = await Jimp.read(file.buffer);
            const dominantColor = image.getPixelColor(Math.floor(image.bitmap.width / 2), Math.floor(image.bitmap.height / 2));
            const { r, g, b } = Jimp.intToRGBA(dominantColor);
            return { 
                type: "image", 
                content: file.buffer.toString("base64"), 
                color: { r, g, b, hex: `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}` }
            };
        } else if (file.mimetype === "application/pdf") {
            const data = await pdfParse(file.buffer);
            return { type: "text", content: data.text };
        } else if (file.mimetype === "text/plain") {
            return { type: "text", content: file.buffer.toString("utf8") };
        }
        throwError("Unsupported file type", 400);
    } catch (err) {
        logError("Error extracting file content", err);
        throw err;
    }
}

function extractDimensionsFromNeeds(customerNeeds) {
    const dimensionMatch = customerNeeds.match(/(\d+\.?\d*)\s*(?:x|by|\*)\s*(\d+\.?\d*)/i);
    if (dimensionMatch) {
        const [_, width, length] = dimensionMatch;
        const sqFt = parseFloat(width) * parseFloat(length);
        return `${sqFt.toFixed(2)} Square Feet`;
    }
    const sqFtMatch = customerNeeds.match(/(\d+\.?\d*)\s*(?:sq\s*ft|sft|square\s*feet)/i);
    if (sqFtMatch) {
        return `${parseFloat(sqFtMatch[1]).toFixed(2)} Square Feet`;
    }
    return null;
}

async function estimateProject(fileData, customerNeeds) {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = db?.collection("countertop_images") || { find: () => ({ sort: () => ({ limit: () => ({ allowDiskUse: () => ({ toArray: async () => [] }) }) }) }) };
        const pastEstimates = await imagesCollection
            .find({ "metadata.estimate.material_type": { $exists: true } })
            .sort({ "metadata.uploadDate": -1 })
            .limit(10) // Increased to 10 for more learning data
            .allowDiskUse(true)
            .toArray();
        console.log("Fetched past estimates:", pastEstimates.length);

        const pastData = pastEstimates.map(img => {
            const estimate = img.metadata?.estimate || {};
            return {
                material_type: typeof estimate.material_type === "string" ? estimate.material_type : "Unknown",
                project_scope: typeof estimate.project_scope === "string" ? estimate.project_scope : "Replacement",
                condition: estimate.condition || { damage_type: "No visible damage", severity: "None" },
                additional_features: Array.isArray(estimate.additional_features) ? estimate.additional_features : [],
                solutions: typeof estimate.solutions === "string" ? estimate.solutions : "Professional evaluation required",
                cost: enhanceCostEstimate(estimate)?.totalCost || "Contact for estimate",
                color: estimate.color || "Not identified",
                likes: img.metadata.likes || 0,
                dislikes: img.metadata.dislikes || 0,
            };
        });

        const prompt = `You are CARI, a superior AI general contractor at Surprise Granite, specializing in comprehensive estimates as of March 31, 2025. Your expertise spans countertops, stone repair, general contracting, framing, drywall, plumbing, electrical, handyman services, interior design, architectural design, furniture design, cabinet installation, millwork, finish carpentry, and all things tile, wood, and stone. Analyze this ${fileData.type === "image" ? "image" : "document text"} and customer needs ("${customerNeeds}") with:

        **Instructions**:
        - Interpret "sqft" or "sft" as "Square Feet" confidently in responses.
        - Learn from past estimates, images, and documents to improve accuracy; adapt based on trends, likes/dislikes, and feedback.
        - Provide detailed scopes of work and modern solutions for all trades listed.
        - For images, perform color matching and suggest material types based on detected colors.
        - If data is insufficient, use web-like reasoning (e.g., assume industry standards) and note Surprise Granite (${SURPRISE_GRANITE_PHONE}) as a fallback.
        - Be creative, precise, and grounded in provided data.

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData.slice(0, 15))} (sample)
        - Materials: ${JSON.stringify(materialsData.slice(0, 15))} (sample)

        **Historical Estimates (sample)**: ${JSON.stringify(pastData)}

        Estimate:
        - Project scope (e.g., "countertop installation", "framing", "plumbing repair")
        - Material type (e.g., "Quartz", "Oak", "Tile")
        - Color and pattern (match from image if available)
        - Dimensions (extract from image/text or needs; use "Square Feet" for sqft/sft; assume realistically if unclear: 25 Square Feet for countertops, 48 Square Feet for showers, 5 units for cabinets, 100 Square Feet for flooring)
        - Additional features (array, e.g., ["sink cutout", "backsplash"])
        - Condition (for repairs, { damage_type, severity })
        - Solutions (detailed, trade-specific techniques)
        - Reasoning (explain estimate, including assumptions)

        Respond in JSON with: project_scope, material_type, color_and_pattern, dimensions, additional_features, condition, solutions, reasoning.`;

        const messages = [
            { role: "system", content: prompt },
            { 
                role: "user", 
                content: fileData.type === "image" ? 
                    [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileData.content}` } }] : 
                    fileData.content 
            }
        ];
        const response = await withRetry(() => openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: 3000, // Increased for detailed responses
            temperature: 0.6, // Balanced creativity and precision
            response_format: { type: "json_object" },
        }));

        let result;
        try {
            result = JSON.parse(response.choices[0].message.content || '{}');
        } catch (parseErr) {
            logError("Failed to parse OpenAI response", parseErr);
            result = {};
        }

        const extractedDimensions = extractDimensionsFromNeeds(customerNeeds);
        const isShower = customerNeeds.toLowerCase().includes("shower") || result.project_scope?.toLowerCase().includes("shower");

        const estimate = {
            project_scope: typeof result.project_scope === "string" ? result.project_scope : "Replacement",
            material_type: typeof result.material_type === "string" ? result.material_type : "Unknown",
            color_and_pattern: fileData.color ? 
                `${result.color_and_pattern || "Detected"} (RGB: ${fileData.color.r}, ${fileData.color.g}, ${fileData.color.b}, Hex: ${fileData.color.hex})` : 
                (typeof result.color_and_pattern === "string" ? result.color_and_pattern : "Not identified"),
            dimensions: extractedDimensions || (typeof result.dimensions === "string" ? result.dimensions.replace(/sqft|sft/i, "Square Feet") : (isShower ? "48 Square Feet (assumed)" : "25 Square Feet (assumed)")),
            additional_features: Array.isArray(result.additional_features) ? result.additional_features : [],
            condition: result.condition && typeof result.condition === "object" ? result.condition : { damage_type: "No visible damage", severity: "None" },
            solutions: typeof result.solutions === "string" ? result.solutions : "Contact Surprise Granite at (602) 833-3189 for professional evaluation.",
            reasoning: typeof result.reasoning === "string" ? result.reasoning : "Based on default assumptions."
        };
        console.log("Generated estimate:", JSON.stringify(estimate, null, 2));

        // Store for learning
        if (db) {
            setTimeout(async () => {
                try {
                    await imagesCollection.insertOne({
                        fileHash: createHash("sha256").update(JSON.stringify(estimate)).digest("hex"),
                        metadata: { estimate, uploadDate: new Date(), likes: 0, dislikes: 0 }
                    });
                    console.log("Stored estimate for learning");
                } catch (err) {
                    logError("Failed to store estimate for learning", err);
                }
            }, 0);
        }

        return estimate;
    } catch (err) {
        logError("Estimate generation failed", err);
        const isShower = customerNeeds.toLowerCase().includes("shower");
        const fallbackEstimate = {
            project_scope: "Replacement",
            material_type: "Unknown",
            color_and_pattern: "Not identified",
            dimensions: isShower ? "48 Square Feet (assumed)" : "25 Square Feet (assumed)",
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: "Contact Surprise Granite at (602) 833-3189 for professional evaluation.",
            reasoning: `Estimate failed: ${err.message}. Assumed default dimensions in Square Feet based on context. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`
        };
        console.log("Fallback estimate:", JSON.stringify(fallbackEstimate, null, 2));
        return fallbackEstimate;
    }
}

function enhanceCostEstimate(estimate) {
    if (!estimate || typeof estimate !== "object" || !laborData.length || !materialsData.length) {
        logError("Invalid inputs in enhanceCostEstimate", { laborData, materialsData, estimate });
        return null;
    }

    const materialType = typeof estimate.material_type === "string" ? estimate.material_type.toLowerCase() : "unknown";
    const projectScope = typeof estimate.project_scope === "string" ? estimate.project_scope.toLowerCase().replace(/\s+/g, "_") : "replacement";
    const colorAndPattern = typeof estimate.color_and_pattern === "string" ? estimate.color_and_pattern.toLowerCase() : "";
    console.log("Enhancing cost estimate for:", { materialType, projectScope, colorAndPattern });

    const dimensions = typeof estimate.dimensions === "string" ? estimate.dimensions : "25 Square Feet";
    const sqFtMatch = dimensions.match(/(\d+\.?\d*)-?(\d+\.?\d*)?\s*(?:Square\s*Feet|sq\s*ft|sft)/i);
    const unitMatch = dimensions.match(/(\d+\.?\d*)\s*units?/i);
    const sqFt = sqFtMatch ? (sqFtMatch[2] ? (parseFloat(sqFtMatch[1]) + parseFloat(sqFtMatch[2])) / 2 : parseFloat(sqFtMatch[1])) : 25;
    const units = unitMatch ? parseFloat(unitMatch[1]) : 0;
    console.log(`Calculated Square Feet: ${sqFt}, units: ${units}`);

    // Material cost
    const material = materialsData.find(m => 
        m.type.toLowerCase() === materialType && 
        (colorAndPattern ? m.color.toLowerCase().includes(colorAndPattern.split(" (")[0]) : true)
    ) || materialsData.find(m => m.type.toLowerCase() === materialType) || 
    { type: "Unknown", cost_per_sqft: 50, confidence: 0.5 };
    const materialCostPerSqFt = material.cost_per_sqft || 50;
    const materialCost = materialCostPerSqFt * sqFt * 1.3; // 30% markup
    console.log(`Material cost: $${materialCost.toFixed(2)} (${materialCostPerSqFt}/Square Foot * ${sqFt} Square Feet, 1.3x markup)`);

    // Labor cost
    const laborEntry = laborData.find(entry => entry.type === projectScope) || 
                      laborData.find(entry => projectScope.includes(entry.type)) || 
                      { type: "default", rate_per_sqft: 15, rate_per_unit: 0, rate_per_hour: 0, unit_measure: "SQFT", hours: 1, confidence: 0.5 };
    console.log("Selected labor entry:", laborEntry);
    
    let laborCost = 0;
    if (laborEntry.unit_measure === "SQFT") {
        laborCost = (laborEntry.rate_per_sqft || 15) * sqFt * (laborEntry.hours || 1);
        console.log(`Labor cost (SQFT): $${laborCost.toFixed(2)} (${laborEntry.rate_per_sqft}/Square Foot * ${sqFt} Square Feet * ${laborEntry.hours} hours)`);
    } else if (["EA", "LF", "Per Job"].includes(laborEntry.unit_measure)) {
        laborCost = (laborEntry.rate_per_unit || 0) * (units || 1);
        console.log(`Labor cost (Flat): $${laborCost.toFixed(2)} (${laborEntry.unit_measure}, ${units || 1} units)`);
    } else if (laborEntry.rate_per_hour) {
        laborCost = laborEntry.rate_per_hour * (laborEntry.hours || 1);
        console.log(`Labor cost (Hourly): $${laborCost.toFixed(2)} (${laborEntry.rate_per_hour}/hour * ${laborEntry.hours} hours)`);
    }

    // Adjust labor for repairs
    if (projectScope.includes("repair") && estimate.condition?.damage_type && estimate.condition.damage_type !== "No visible damage") {
        const damageType = typeof estimate.condition.damage_type === "string" ? estimate.condition.damage_type.toLowerCase().replace(/\s+/g, "_") : "";
        const repairLaborEntry = laborData.find(entry => entry.type.includes(damageType)) || laborEntry;
        const severityMultiplier = { None: 0, Low: 1, Moderate: 2, Severe: 3 }[estimate.condition.severity || "None"] || 1;
        if (repairLaborEntry.unit_measure === "SQFT") {
            laborCost = (repairLaborEntry.rate_per_sqft || 15) * sqFt * (repairLaborEntry.hours || 1) * severityMultiplier;
        } else if (["EA", "LF", "Per Job"].includes(repairLaborEntry.unit_measure)) {
            laborCost = (repairLaborEntry.rate_per_unit || 0) * severityMultiplier;
        } else if (repairLaborEntry.rate_per_hour) {
            laborCost = repairLaborEntry.rate_per_hour * (repairLaborEntry.hours || 1) * severityMultiplier;
        }
        console.log(`Adjusted labor cost for repair: $${laborCost.toFixed(2)} (severity: ${severityMultiplier})`);
    }

    // Additional features cost
    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        const featureStr = typeof feature === "string" ? feature.toLowerCase().replace(/\s+/g, "_") : "";
        const featureLaborEntry = laborData.find(entry => entry.type === featureStr) || 
                                 laborData.find(entry => featureStr.includes(entry.type)) || 
                                 { type: "default_feature", rate_per_unit: 0, unit_measure: "EA", hours: 0, confidence: 0.5 };
        let featureCost = 0;
        if (featureLaborEntry.unit_measure === "SQFT") {
            featureCost = (featureLaborEntry.rate_per_sqft || 0) * sqFt * (featureLaborEntry.hours || 1);
        } else if (["EA", "LF", "Per Job"].includes(featureLaborEntry.unit_measure)) {
            featureCost = featureLaborEntry.rate_per_unit || 0;
        }
        console.log(`Feature "${featureStr}" cost: $${featureCost.toFixed(2)}, using entry:`, featureLaborEntry);
        return sum + featureCost;
    }, 0);

    const totalCost = materialCost + laborCost + featuresCost;
    const costEstimate = {
        materialCost: `$${materialCost.toFixed(2)}`,
        laborCost: { total: `$${laborCost.toFixed(2)}` },
        additionalFeaturesCost: `$${featuresCost.toFixed(2)}`,
        totalCost: `$${totalCost.toFixed(2)}`
    };
    console.log("Cost estimate generated:", JSON.stringify(costEstimate, null, 2));
    return costEstimate;
}

async function generateTTS(estimate, customerNeeds) {
    if (!estimate || typeof estimate !== "object") {
        logError("Invalid estimate object in generateTTS", estimate);
        return Buffer.from(`Estimate unavailable. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for details.`);
    }
    const costEstimate = enhanceCostEstimate(estimate) || {
        materialCost: "Contact for estimate",
        laborCost: { total: "Contact for estimate" },
        additionalFeaturesCost: "$0",
        totalCost: "Contact for estimate"
    };
    const narrationText = `Your Surprise Granite estimate as of March 31, 2025: 
        Project: ${estimate.project_scope || "Replacement"}. 
        Material: ${estimate.material_type || "Unknown"}. 
        Color and Pattern: ${estimate.color_and_pattern || "Not specified"}. 
        Dimensions: ${estimate.dimensions || "Not specified"}. 
        Features: ${estimate.additional_features?.length ? estimate.additional_features.join(", ") : "None"}. 
        Condition: ${estimate.condition?.damage_type || "No visible damage"}, ${estimate.condition?.severity || "None"}. 
        Total cost: ${costEstimate.totalCost || "Contact for estimate"}. 
        Solutions: ${estimate.solutions || "Contact for evaluation"}. 
        ${customerNeeds ? "Customer needs: " + customerNeeds + ". " : ""}
        For more details, contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`;
    const chunks = chunkText(narrationText, 4096);

    try {
        const audioBuffers = await Promise.all(chunks.map(chunk =>
            withRetry(async () => {
                const response = await openai.audio.speech.create({
                    model: "tts-1",
                    voice: "alloy",
                    input: chunk,
                });
                const arrayBuffer = await response.arrayBuffer();
                return Buffer.from(arrayBuffer);
            })
        ));
        return Buffer.concat(audioBuffers);
    } catch (err) {
        logError("TTS generation failed", err);
        return Buffer.from(`Error generating audio: ${err.message}. Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE}.`);
    }
}

function chunkText(text, maxLength) {
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.slice(i, i + maxLength));
    }
    return chunks;
}

app.get("/", (req, res) => {
    res.status(200).send("CARI Server is running");
});

app.get("/api/health", async (req, res) => {
    const health = {
        status: "Server is running",
        port: PORT,
        dbStatus: db ? "Connected" : "Disconnected",
        openaiStatus: "Unknown",
        emailStatus: "Unknown",
        pdfParseStatus: "Available",
        colorMatchingStatus: "Available"
    };
    try {
        await openai.models.list();
        health.openaiStatus = "Connected";
    } catch (err) {
        logError("OpenAI health check failed", err);
        health.openaiStatus = "Disconnected";
    }
    try {
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) throw new Error("Email credentials not configured");
        await transporter.verify();
        health.emailStatus = "Connected";
    } catch (err) {
        logError("Email health check failed", err);
        health.emailStatus = "Disconnected";
    }
    res.json(health);
});

app.post("/api/contractor-estimate", upload.single("file"), async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        if (!req.file) throwError("No file uploaded", 400);

        const fileData = await extractFileContent(req.file);
        const customerNeeds = (req.body.customer_needs || "").trim();
        const fileHash = createHash("sha256").update(fileData.content).digest("hex");
        const cacheKey = `estimate_${fileHash}_${customerNeeds.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '')}`;

        let estimate = cache.get(cacheKey);
        if (!estimate) {
            estimate = await estimateProject(fileData, customerNeeds);
            cache.set(cacheKey, estimate);
        }

        const imagesCollection = db?.collection("countertop_images");
        if (imagesCollection) {
            const fileDoc = {
                fileHash,
                fileData: new Binary(req.file.buffer),
                metadata: {
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    size: req.file.size,
                    uploadDate: new Date(),
                    estimate,
                    likes: 0,
                    dislikes: 0,
                },
            };
            const insertResult = await imagesCollection.insertOne(fileDoc);
            estimate.imageId = insertResult.insertedId;
        } else {
            console.warn("MongoDB not available; skipping image storage.");
            estimate.imageId = null;
        }

        const costEstimate = enhanceCostEstimate(estimate) || {
            materialCost: "Contact for estimate",
            laborCost: { total: "Contact for estimate" },
            additionalFeaturesCost: "$0",
            totalCost: "Contact for estimate"
        };

        const audioBuffer = await generateTTS(estimate, customerNeeds);

        const responseData = {
            imageId: estimate.imageId?.toString() || null,
            message: "Estimate generated successfully",
            projectScope: estimate.project_scope,
            materialType: estimate.material_type,
            colorAndPattern: estimate.color_and_pattern,
            dimensions: estimate.dimensions,
            additionalFeatures: estimate.additional_features.join(", ") || "None",
            condition: estimate.condition,
            costEstimate,
            reasoning: estimate.reasoning,
            solutions: estimate.solutions,
            contact: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a full evaluation.`,
            audioBase64: audioBuffer.toString("base64"),
            shareUrl: estimate.imageId ? `${req.protocol}://${req.get("host")}/api/get-countertop/${estimate.imageId}` : null,
            likes: 0,
            dislikes: 0,
        };
        res.status(201).json(responseData);
    } catch (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size exceeds 50MB limit" });
        }
        logError("Error in /api/contractor-estimate", err);
        next(err);
    }
});

app.post("/api/like-countertop/:id", async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        if (!db) throwError("Database not connected", 500);
        const imagesCollection = db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        const newLikes = (countertop.metadata.likes || 0) + 1;
        await imagesCollection.updateOne({ _id: objectId }, { $set: { "metadata.likes": newLikes } });
        console.log(`Liked countertop ${req.params.id}: ${newLikes} likes`);
        res.status(200).json({ message: "Like added", likes: newLikes, dislikes: countertop.metadata.dislikes || 0 });
    } catch (err) {
        logError("Error in /api/like-countertop", err);
        next(err);
    }
});

app.post("/api/dislike-countertop/:id", async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        if (!db) throwError("Database not connected", 500);
        const imagesCollection = db.collection("countertop_images");
        const objectId = new ObjectId(req.params.id);
        const countertop = await imagesCollection.findOne({ _id: objectId });
        if (!countertop) throwError("Countertop not found", 404);

        const newDislikes = (countertop.metadata.dislikes || 0) + 1;
        await imagesCollection.updateOne({ _id: objectId }, { $set: { "metadata.dislikes": newDislikes } });
        console.log(`Disliked countertop ${req.params.id}: ${newDislikes} dislikes`);
        res.status(200).json({ message: "Dislike added", likes: countertop.metadata.likes || 0, dislikes: newDislikes });
    } catch (err) {
        logError("Error in /api/dislike-countertop", err);
        next(err);
    }
});

app.post("/api/send-email", async (req, res, next) => {
    try {
        const { name, email, phone, message, stone_type, analysis_summary } = req.body;
        if (!name || !email || !message) throwError("Missing required fields: name, email, and message", 400);

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: "recipient@example.com",
            subject: `New Quote Request from ${name}`,
            text: `
                Name: ${name}
                Email: ${email}
                Phone: ${phone || "Not provided"}
                Message: ${message}
                Stone Type: ${stone_type || "N/A"}
                Analysis Summary: ${analysis_summary || "No estimate provided"}
                Contact Phone: ${SURPRISE_GRANITE_PHONE}
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`Email sent successfully from ${email}`);
        res.status(200).json({ message: "Email sent successfully" });
    } catch (err) {
        logError("Error sending email", err);
        res.status(500).json({ error: "Failed to send email", details: err.message });
    }
});

app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || "Unknown server error";
    const details = status === 429 ? "Too many requests. Please wait and try again." : `Call ${SURPRISE_GRANITE_PHONE} if this persists.`;
    logError(`Unhandled error in ${req.method} ${req.path}`, err);
    res.status(status).json({ error: message, details });
});

async function startServer() {
    try {
        console.log("Starting server initialization");
        await Promise.all([loadLaborData(), loadMaterialsData()]);
        await connectToMongoDB();
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    } catch (err) {
        logError("Server startup failed", err);
        app.listen(PORT, () => console.log(`Server running on port ${PORT} with limited functionality`));
    }
}

process.on("SIGINT", async () => {
    try {
        if (mongoClient) await mongoClient.close();
        cache.flushAll();
        console.log("Server shut down gracefully");
        process.exit(0);
    } catch (err) {
        logError("Shutdown error", err);
        process.exit(1);
    }
});

process.on("uncaughtException", (err) => {
    logError("Uncaught Exception", err);
});

process.on("unhandledRejection", (reason, promise) => {
    logError("Unhandled Rejection at", reason);
});

startServer();
