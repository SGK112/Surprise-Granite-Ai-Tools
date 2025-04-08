import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";
import OpenAI from "openai";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: "https://surprisegranite.webflow.io" })); // Restrict to Webflow
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let appState = { db: null, mongoClient: null };
let countertops = [];

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

async function loadCountertops() {
    try {
        await connectToMongoDB();
        if (appState.db) {
            const collection = appState.db.collection("countertops");
            countertops = await collection.find({}).toArray();
            if (countertops.length === 0) {
                const materialsData = JSON.parse(await fs.readFile(path.join(__dirname, "materials.json"), "utf8"));
                await collection.insertMany(materialsData);
                countertops = materialsData;
                console.log("Seeded countertops from materials.json:", countertops.length);
            }
        }
    } catch (err) {
        console.error("Failed to load countertops:", err);
        countertops = JSON.parse(await fs.readFile(path.join(__dirname, "materials.json"), "utf8"));
    }
}

// Existing endpoint
app.get("/api/get-countertops", async (req, res) => {
    try {
        await loadCountertops();
        res.json(countertops);
    } catch (err) {
        console.error("Failed to fetch countertops:", err);
        res.status(500).json({ error: "Failed to fetch countertops" });
    }
});

// New endpoint for estimate generation
app.post("/api/generate-estimate", async (req, res) => {
    try {
        await connectToMongoDB();
        const { projectName, stoneColor, totalSqFt, wastePercentage = 10, materialMargin = 20, laborMargin = 25, laborType } = req.body;

        if (!projectName || !stoneColor || !totalSqFt || !laborType) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const countertop = countertops.find(c => (c.colorName || c.name)?.toLowerCase() === stoneColor.toLowerCase());
        if (!countertop) {
            return res.status(404).json({ error: "Countertop color not found" });
        }

        const laborRates = {
            countertop_repair: 15,
            countertop_replacement: 20,
            sink_repair: 10,
            sink_replacement: 25
        };
        const laborRate = laborRates[laborType];
        if (!laborRate) {
            return res.status(404).json({ error: "Invalid labor type" });
        }

        const wasteFactor = 1 + wastePercentage / 100;
        const baseMaterialCost = (countertop.costPerSqFt || 50) * totalSqFt;
        const materialCost = baseMaterialCost * wasteFactor * (1 + materialMargin / 100);
        const laborCost = laborRate * totalSqFt * (1 + laborMargin / 100);
        const totalCost = materialCost + laborCost;

        const prompt = `
            Write a professional countertop estimate for ${projectName} with Surprise Granite.
            Stone: ${stoneColor}. Total area: ${totalSqFt} sq ft.
            Material cost: $${materialCost.toFixed(2)} with ${wastePercentage}% waste and ${materialMargin}% margin.
            Labor (${laborType}): $${laborCost.toFixed(2)} with ${laborMargin}% margin.
            Total cost: $${totalCost.toFixed(2)}.
        `;
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 300,
        });
        const estimateText = response.choices[0].message.content;

        if (appState.db) {
            const estimateCollection = appState.db.collection("estimates");
            await estimateCollection.insertOne({
                projectName, stoneColor, totalSqFt, wastePercentage, materialMargin, laborMargin, laborType,
                materialCost, laborCost, totalCost, estimateText, createdAt: new Date()
            });
        }

        res.json({ totalCost, materialCost, laborCost, estimateText });
    } catch (err) {
        console.error("Failed to generate estimate:", err);
        res.status(500).json({ error: "Failed to generate estimate" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    loadCountertops();
});
