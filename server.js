import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import { MongoClient, Binary, ObjectId } from "mongodb";
import OpenAI from "openai";
import nodemailer from "nodemailer";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Jimp from "jimp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;
const SURPRISE_GRANITE_PHONE = "(602) 833-3189";
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const tempDir = path.join(__dirname, "temp");
fs.mkdir(tempDir, { recursive: true }).catch((err) => console.error("Failed to create temp dir:", err));

let appState = { db: null, mongoClient: null };
let laborData = [];
let stoneProducts = [];

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 9 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png", "audio/wav"];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error("Only JPEG, PNG, or WAV allowed"), false);
        }
        cb(null, true);
    }
});

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.static("public"));

async function loadLaborData() {
    laborData = [
        { type: "countertop_repair", rate_per_sqft: 15 },
        { type: "countertop_replacement", rate_per_sqft: 20 },
        { type: "sink_repair", rate_per_sqft: 10 },
        { type: "sink_replacement", rate_per_sqft: 25 }
    ];
}

async function loadStoneProducts() {
    try {
        await ensureMongoDBConnection();
        if (appState.db) {
            const stoneCollection = appState.db.collection("stone_products");
            stoneProducts = await stoneCollection.find({}).toArray();
            if (stoneProducts.length === 0) {
                const materialsData = JSON.parse(await fs.readFile(path.join(__dirname, "materials.json"), "utf8"));
                const initialData = materialsData.map(material => ({
                    colorName: material["Color Name"],
                    vendorName: material["Vendor Name"],
                    thickness: material["Thickness"],
                    material: material["Material"],
                    size: material["size"],
                    totalSqFt: material["Total/SqFt"],
                    costPerSqFt: material["Cost/SqFt"],
                    priceGroup: material["Price Group"],
                    tier: material["Tier"]
                }));
                await stoneCollection.insertMany(initialData);
                stoneProducts = initialData;
                console.log("Seeded stone products from materials.json:", stoneProducts.length);
            } else {
                console.log("Loaded stone products from MongoDB:", stoneProducts.length);
            }
        }
    } catch (err) {
        console.error("Failed to load stone products:", err);
        stoneProducts = [
            { 
                colorName: "Generic", 
                vendorName: "Unknown", 
                thickness: "2cm", 
                material: "Granite", 
                size: "126 x 63", 
                totalSqFt: 55, 
                costPerSqFt: 50, 
                priceGroup: 1, 
                tier: "Low Tier"
            }
        ];
    }
}

async function connectToMongoDB() {
    if (!process.env.MONGODB_URI) return;
    try {
        appState.mongoClient = new MongoClient(process.env.MONGODB_URI);
        await appState.mongoClient.connect();
        appState.db = appState.mongoClient.db("countertops");
        console.log("Connected to MongoDB");
    } catch (err) {
        console.error("MongoDB connection failed:", err);
    }
}

async function ensureMongoDBConnection() {
    if (!appState.db && process.env.MONGODB_URI) await connectToMongoDB();
}

app.get("/api/stone-products", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        const imageCollection = appState.db.collection("countertop_images");
        const images = await imageCollection.find({}).toArray();

        const enrichedProducts = stoneProducts.map(product => {
            const normalizedColorName = product.colorName.toLowerCase().replace(/\s+/g, '_');
            const matchingImage = images.find(img => 
                img.filename.toLowerCase().includes(normalizedColorName)
            );
            return {
                colorName: product.colorName,
                vendorName: product.vendorName,
                material: product.material,
                thickness: product.thickness,
                size: product.size,
                totalSqFt: product.totalSqFt,
                costPerSqFt: product.costPerSqFt,
                priceGroup: product.priceGroup,
                tier: product.tier,
                imageBase64: matchingImage ? matchingImage.imageBase64 : '',
                analysis: matchingImage ? matchingImage.analysis : { stone_type: product.material, color_and_pattern: "Unknown", material_composition: "Unknown" }
            };
        });
        res.json(enrichedProducts);
    } catch (err) {
        console.error("Failed to fetch stone products with images:", err);
        res.status(500).json({ error: "Failed to fetch stone products" });
    }
});

// New endpoint for generating estimates with waste and margin controls
app.post("/api/generate-estimate", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        const { 
            projectName, 
            stoneColor, 
            totalSqFt, 
            wastePercentage = 10, // Default 10% waste
            materialMargin = 20,  // Default 20% margin
            laborMargin = 25,     // Default 25% margin
            laborType 
        } = req.body;

        // Validate inputs
        if (!projectName || !stoneColor || !totalSqFt || !laborType) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // Find stone product
        const stone = stoneProducts.find(p => p.colorName.toLowerCase() === stoneColor.toLowerCase());
        if (!stone) {
            return res.status(404).json({ error: "Stone color not found" });
        }

        // Find labor rate
        const labor = laborData.find(l => l.type === laborType);
        if (!labor) {
            return res.status(404).json({ error: "Labor type not found" });
        }

        // Calculate costs
        const wasteFactor = 1 + wastePercentage / 100;
        const baseMaterialCost = stone.costPerSqFt * totalSqFt;
        const materialCost = baseMaterialCost * wasteFactor * (1 + materialMargin / 100);
        const laborCost = labor.rate_per_sqft * totalSqFt * (1 + laborMargin / 100);
        const totalCost = materialCost + laborCost;

        // Generate professional estimate with OpenAI
        const prompt = `
            Write a professional countertop estimate for ${projectName} with Surprise Granite.
            Stone: ${stone.colorName} (${stone.material}, ${stone.thickness}, Price Group ${stone.priceGroup}).
            Total area: ${totalSqFt} sq ft.
            Material cost: $${baseMaterialCost.toFixed(2)} base, adjusted to $${materialCost.toFixed(2)} with ${wastePercentage}% waste and ${materialMargin}% margin.
            Labor (${laborType}): $${laborCost.toFixed(2)} with ${laborMargin}% margin.
            Total cost: $${totalCost.toFixed(2)}.
            Contact: ${SURPRISE_GRANITE_PHONE}.
        `;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 300,
        });
        const estimateText = response.choices[0].message.content;

        // Save to MongoDB
        const estimateCollection = appState.db.collection("estimates");
        const estimate = {
            projectName,
            stoneColor: stone.colorName,
            totalSqFt,
            wastePercentage,
            materialMargin,
            laborMargin,
            laborType,
            materialCost,
            laborCost,
            totalCost,
            estimateText,
            createdAt: new Date()
        };
        await estimateCollection.insertOne(estimate);

        res.json({ totalCost, estimateText, materialCost, laborCost });
    } catch (err) {
        console.error("Failed to generate estimate:", err);
        res.status(500).json({ error: "Failed to generate estimate" });
    }
});

function startServer() {
    const server = app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
        Promise.all([loadLaborData(), loadStoneProducts(), connectToMongoDB()]);
    });

    setInterval(() => {
        console.log("Keep-alive ping");
    }, 300000);

    process.on("SIGTERM", () => {
        console.log("SIGTERM received, shutting down...");
        if (appState.mongoClient) appState.mongoClient.close();
        server.close(() => {
            console.log("Server closed");
            process.exit(0);
        });
    });
}

startServer();
