import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { MongoClient, Binary, ObjectId } from "mongodb";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Jimp from "jimp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

// Ensure temp directory exists
const tempDir = path.join(__dirname, "temp");
await fs.mkdir(tempDir, { recursive: true }).catch(err => console.error("Failed to create temp dir:", err));

// Global Variables
let appState = { db: null, mongoClient: null };

// Multer Configuration for Stone Images
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024, files: 9 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ["image/jpeg", "image/png"];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error("Invalid file type. Allowed: JPEG, PNG"), false);
        }
        cb(null, true);
    }
});

// Middleware
app.use(compression());
app.use(cors({
    origin: process.env.CORS_ORIGINS?.split(",") || ["http://localhost:3000", "https://www.example.com"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
    optionsSuccessStatus: 204
}));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: "Too many requests. Please try again later."
}));

// Helper Functions
function throwError(message, status = 500) {
    const err = new Error(message);
    err.status = status;
    throw err;
}

function logError(message, err) {
    console.error(`[${new Date().toISOString()}] ${message}: ${err?.message || "Unknown error"}`, err?.stack || err);
}

async function connectToMongoDB() {
    if (!process.env.MONGODB_URI) {
        console.warn("MONGODB_URI not set; running without MongoDB");
        return;
    }
    try {
        appState.mongoClient = new MongoClient(process.env.MONGODB_URI);
        await appState.mongoClient.connect();
        appState.db = appState.mongoClient.db("stone_database");
        console.log("Connected to MongoDB Atlas");
    } catch (err) {
        logError("MongoDB connection failed", err);
        appState.db = null;
    }
}

async function ensureMongoDBConnection() {
    if (!appState.db && process.env.MONGODB_URI) await connectToMongoDB();
}

async function extractImageData(file) {
    try {
        const image = await Jimp.read(file.buffer);
        image.resize(100, Jimp.AUTO);
        const dominantColor = image.getPixelColor(Math.floor(image.bitmap.width / 2), Math.floor(image.bitmap.height / 2));
        const { r, g, b } = Jimp.intToRGBA(dominantColor);
        return {
            content: (await image.getBase64Async(Jimp.MIME_JPEG)).split(",")[1],
            color: { r, g, b, hex: `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}` }
        };
    } catch (err) {
        logError("Error extracting image data", err);
        throw err;
    }
}

// Routes

// Upload Stone Data and Remnant Images
app.post("/api/stone/upload", upload.array("images", 9), async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) throwError("Database not connected", 500);

        const { name, type, color, uploadedBy } = req.body;
        const files = req.files || [];

        if (!name || !type || !color) throwError("Missing required fields: name, type, color", 400);

        const imageDataArray = await Promise.all(files.map(file => extractImageData(file)));
        const stonesCollection = appState.db.collection("stones");

        const stoneDoc = {
            name,
            type: type.toLowerCase(),
            color: color.toLowerCase(),
            images: imageDataArray.map(img => ({
                data: new Binary(Buffer.from(img.content, "base64")),
                color: img.color
            })),
            uploadedBy: uploadedBy || "Anonymous",
            uploadDate: new Date(),
            remnants: imageDataArray.length > 0 // Flag if remnants are included
        };

        const result = await stonesCollection.insertOne(stoneDoc);
        res.status(201).json({
            message: "Stone added successfully",
            stoneId: result.insertedId.toString()
        });
    } catch (err) {
        logError("Error in /api/stone/upload", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

// Search Stones by Color or Type
app.get("/api/stone/search", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) throwError("Database not connected", 500);

        const { color, type } = req.query;
        const stonesCollection = appState.db.collection("stones");

        const query = {};
        if (color) query.color = { $regex: color.toLowerCase(), $options: "i" };
        if (type) query.type = { $regex: type.toLowerCase(), $options: "i" };

        const stones = await stonesCollection.find(query).limit(50).toArray();
        const results = stones.map(stone => ({
            id: stone._id.toString(),
            name: stone.name,
            type: stone.type,
            color: stone.color,
            imageCount: stone.images.length,
            hasRemnants: stone.remnants,
            uploadedBy: stone.uploadedBy,
            uploadDate: stone.uploadDate
        }));

        res.status(200).json(results);
    } catch (err) {
        logError("Error in /api/stone/search", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

// Get Stone Details by ID
app.get("/api/stone/:id", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) throwError("Database not connected", 500);

        const stonesCollection = appState.db.collection("stones");
        const stone = await stonesCollection.findOne({ _id: new ObjectId(req.params.id) });

        if (!stone) throwError("Stone not found", 404);

        res.status(200).json({
            id: stone._id.toString(),
            name: stone.name,
            type: stone.type,
            color: stone.color,
            images: stone.images.map(img => ({
                color: img.color,
                data: img.data.buffer.toString("base64")
            })),
            uploadedBy: stone.uploadedBy,
            uploadDate: stone.uploadDate,
            remnants: stone.remnants
        });
    } catch (err) {
        logError("Error in /api/stone/:id", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

// Error Handling Middleware
app.use((err, req, res, next) => {
    const status = err.status || 500;
    const message = err.message || "Unknown server error";
    logError(`Unhandled error in ${req.method} ${req.path}`, err);
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size exceeds 5MB limit" });
        }
    }
    res.status(status).json({ error: message });
});

// Server Startup
function startServer() {
    const server = app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);
        await connectToMongoDB();
    });

    process.on("SIGTERM", async () => {
        console.log("Shutting down...");
        if (appState.mongoClient) await appState.mongoClient.close();
        server.close(() => process.exit(0));
    });

    process.on("SIGINT", async () => {
        console.log("Shutting down...");
        if (appState.mongoClient) await appState.mongoClient.close();
        server.close(() => process.exit(0));
    });
}

startServer();
