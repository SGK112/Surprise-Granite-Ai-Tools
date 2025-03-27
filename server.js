require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const Fuse = require("fuse.js");
const { MongoClient } = require("mongodb");

const app = express();
const upload = multer({ dest: "uploads/" });

let colors_data = [];
let materials_data = [];

const mongo_uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const db_name = "countertops";
const collection_name = "countertops.images";
let client;
let collection;

const fallback_countertops = [
    {
        product_name: "Calacatta Gold",
        material: "marble",
        brand: "Surprise Granite",
        veining: "dramatic veining",
        primary_color: "255,255,255",
        secondary_color: "200,200,200",
        scene_image_path: "/countertop_images/calacatta_gold_scene.avif"
    },
    {
        product_name: "Black Galaxy",
        material: "granite",
        brand: "Surprise Granite",
        veining: "no veining",
        primary_color: "0,0,0",
        secondary_color: "50,50,50",
        scene_image_path: "/countertop_images/black_galaxy_scene.avif"
    },
    {
        product_name: "Carrara White",
        material: "marble",
        brand: "Surprise Granite",
        veining: "moderate veining",
        primary_color: "240,240,240",
        secondary_color: "180,180,180",
        scene_image_path: "/countertop_images/cascade_white_scene.avif"
    }
];

async function connect_to_mongodb() {
    try {
        client = new MongoClient(mongo_uri, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        await client.connect();
        const db = client.db(db_name);
        collection = db.collection(collection_name);
    } catch (err) {
        console.error("Failed to connect to MongoDB:", err.message);
        throw err;
    }
}

function load_materials_data() {
    try {
        if (!fs.existsSync("./materials.json")) {
            console.error("materials.json not found. Initializing with empty array.");
            materials_data = [];
            return;
        }
        const data = fs.readFileSync("./materials.json", "utf8");
        materials_data = JSON.parse(data);
        console.log(`Loaded ${materials_data.length} materials from materials.json`);
    } catch (err) {
        console.error("Error loading materials.json:", err.message);
        materials_data = [];
    }
}

function load_color_data() {
    try {
        if (!fs.existsSync("./colors.json")) {
            colors_data = [];
            return;
        }
        const data = fs.readFileSync("./colors.json", "utf8");
        colors_data = JSON.parse(data);
    } catch (err) {
        colors_data = [];
    }
}

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use('/countertop_images', express.static(path.join(__dirname, 'countertop_images'), {
    setHeaders: (res) => {
        res.setHeader('Content-Type', 'image/avif');
    }
}));

app.get("/api/health", (req, res) => {
    const db_status = client && client.topology && client.topology.isConnected() ? "Connected" : "Disconnected";
    res.json({ status: "Server is running", port: process.env.PORT, db_status });
});

app.get("/api/countertops", async (req, res) => {
    const max_retries = 3;
    const retry_delay = 1000;
    for (let attempt = 1; attempt <= max_retries; attempt++) {
        try {
            if (!client || !client.topology || !client.topology.isConnected()) {
                throw new Error("Database connection not available.");
            }
            if (!collection) {
                throw new Error("Database collection not initialized.");
            }
            const countertops = await collection.find({}, { projection: { _id: 0 } }).toArray();
            if (countertops.length === 0) {
                return res.status(200).json(fallback_countertops);
            }
            return res.json(countertops);
        } catch (err) {
            if (attempt === max_retries) {
                return res.status(200).json(fallback_countertops);
            }
            await new Promise(resolve => setTimeout(resolve, retry_delay));
        }
    }
});

app.post("/api/analyze-damage", upload.single("file"), async (req, res) => {
    let file_stream;
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No file uploaded." });
        }

        if (req.file.size > 5 * 1024 * 1024) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: "Image size exceeds 5MB limit." });
        }

        file_stream = fs.createReadStream(req.file.path);
        const chunks = [];
        for await (const chunk of file_stream) {
            chunks.push(chunk);
        }
        const image_base64 = Buffer.concat(chunks).toString("base64");
        fs.unlinkSync(req.file.path);

        const api_key = process.env.OPENAI_API_KEY;
        if (!api_key) {
            return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key." });
        }

        const openai_response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${api_key}`,
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    {
                        role: "system",
                        content: `
You are CARI, a countertop damage analyst at Surprise Granite.

Analyze the uploaded image. Your job is to:
1. Identify the stone type (granite, quartz, marble, quartzite, etc.)
2. Describe the color and pattern (e.g., white with grey veining)
3. Detect damage (chips, cracks, scratches, breaks, discoloration)
4. Classify severity (low, moderate, severe)
5. Suggest estimated repair cost range (e.g., $250–$450)
6. Make a confident recommendation:
   - Recommend full/partial replacement for cracks over 1 inch, multiple chips, or broken pieces.
   - Recommend repair for minor cosmetic damage.
   - If unclear, suggest in-person evaluation.
7. Be clear, professional, and concise.

Respond ONLY in JSON like this:
{
  "stoneType": "",
  "colorPattern": "",
  "isNaturalStone": true,
  "damageType": "",
  "severity": "",
  "estimatedCost": "",
  "recommendation": "",
  "description": ""
}
                        `,
                    },
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Analyze this countertop image." },
                            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_base64}` } },
                        ],
                    },
                ],
                max_tokens: 800,
                temperature: 0.8,
            }),
        });

        if (!openai_response.ok) {
            const error_text = await openai_response.text();
            return res.status(500).json({ error: `OpenAI API failed: ${openai_response.status} - ${error_text}` });
        }

        const data = await openai_response.json();
        const raw = data.choices[0].message.content.trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) {
            return res.status(500).json({ error: "Invalid response format from OpenAI API: No JSON found." });
        }

        const json_output = match[0];
        let parsed;
        try {
            parsed = JSON.parse(json_output);
        } catch (parse_error) {
            return res.status(500).json({ error: "Failed to parse JSON from OpenAI API response." });
        }

        if (colors_data.length && parsed.colorPattern) {
            const fuse_instance = new Fuse(colors_data, {
                keys: ["name", "description"],
                threshold: 0.3,
            });
            const top_match = fuse_instance.search(parsed.colorPattern)?.[0]?.item;
            if (top_match) {
                parsed.matched_color = top_match.name;
                parsed.matched_vendor = top_match.description;
                parsed.matched_image = top_match.imageUrl;
            }
        }

        res.json({ response: parsed });
    } catch (error) {
        if (file_stream) file_stream.destroy();
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: "Failed to analyze image: " + error.message });
    }
});

app.post("/api/estimate-job", async (req, res) => {
    try {
        const {
            materialType, // e.g., "Quartz", "Marble"
            colorName, // e.g., "Frost-N"
            thickness, // e.g., "2cm"
            dimensions, // e.g., "120x60" (length x width in inches)
            jobType, // "repair", "replacement", or "material-only"
            damageDetails // Optional: { damageType: "crack", severity: "moderate" }
        } = req.body;

        if (!materialType || !colorName || !thickness || !dimensions || !jobType) {
            return res.status(400).json({ error: "Missing required fields: materialType, colorName, thickness, dimensions, jobType" });
        }

        const [length, width] = dimensions.split("x").map(Number);
        const sqFt = (length * width) / 144; // Convert square inches to square feet

        // Find matching material in materials.json
        const materialMatch = materials_data.find(m =>
            m["Color Name"].toLowerCase() === colorName.toLowerCase() &&
            m.Material.toLowerCase() === materialType.toLowerCase() &&
            m.Thickness === thickness
        );

        if (!materialMatch) {
            return res.status(404).json({ error: "Material not found in pricing sheet." });
        }

        const api_key = process.env.OPENAI_API_KEY;
        if (!api_key) {
            return res.status(500).json({ error: "Server configuration error: Missing OpenAI API key." });
        }

        let estimatePrompt = `
You are CARI, a countertop project estimator at Surprise Granite.

Given the following job details:
- Material Type: ${materialType}
- Color Name: ${colorName}
- Thickness: ${thickness}
- Dimensions: ${dimensions} inches (${sqFt.toFixed(2)} sq ft)
- Job Type: ${jobType}
- Material Cost per Sq Ft: $${materialMatch["Cost/SqFt"]}
- Total Material Sq Ft Available: ${materialMatch["Total/SqFt"]}

Additional Info:
- For repairs, assume labor costs range from $100-$300 depending on severity.
- For replacements, include material cost plus $500 labor/installation.
- For material-only, calculate based on material cost per sq ft.

${
    damageDetails
        ? `Damage Details: ${JSON.stringify(damageDetails)}`
        : "No damage details provided."
}

Generate a detailed written estimate in the following JSON format:
{
  "estimate": {
    "materialCost": 0,
    "laborCost": 0,
    "totalCost": 0,
    "description": ""
  }
}
`;

        const openai_response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${api_key}`,
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: [
                    { role: "system", content: estimatePrompt },
                    { role: "user", content: "Provide a detailed estimate for this countertop job." },
                ],
                max_tokens: 1000,
                temperature: 0.7,
            }),
        });

        if (!openai_response.ok) {
            const error_text = await openai_response.text();
            return res.status(500).json({ error: `OpenAI API failed: ${openai_response.status} - ${error_text}` });
        }

        const data = await openai_response.json();
        const raw = data.choices[0].message.content.trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) {
            return res.status(500).json({ error: "Invalid response format from OpenAI API: No JSON found." });
        }

        const json_output = match[0];
        let parsed;
        try {
            parsed = JSON.parse(json_output);
        } catch (parse_error) {
            return res.status(500).json({ error: "Failed to parse JSON from OpenAI API response." });
        }

        res.json(parsed);
    } catch (error) {
        res.status(500).json({ error: "Failed to generate estimate: " + error.message });
    }
});

app.get("/", (req, res) => {
    res.send("✅ CARI API is live");
});

process.on('SIGTERM', async () => {
    if (client) {
        await client.close();
    }
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error("Uncaught Exception:", err.message);
    process.exit(1);
});

const port = process.env.PORT || 5000;
async function start_server() {
    try {
        await connect_to_mongodb();
        load_materials_data();
        load_color_data();
        app.listen(port, () => {
            console.log(`Server running on port ${port}`);
        });
    } catch (err) {
        console.error("Failed to start server:", err.message);
        process.exit(1);
    }
}

start_server();
