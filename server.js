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
    origin: ["http://localhost:3000", "https://www.surprisegranite.com", "https://surprise-granite-connections-dev.onrender.com"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
    credentials: true,
    optionsSuccessStatus: 204
}));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: "Too many requests. Please try again later."
}));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, "public")));

// Request Logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} from ${req.ip} - Headers:`, req.headers);
    next();
});

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
        appState.mongoClient = new MongoClient(process.env.MONGODB_URI, {
            maxPoolSize: 50,
            minPoolSize: 2,
            connectTimeoutMS: 5000,
            socketTimeoutMS: 15000
        });
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
        image.resize(100, Jimp.AUTO); // Thumbnail size
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
            remnants: imageDataArray.length > 0,
            likes: 0 // Initialize likes
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
            uploadDate: stone.uploadDate,
            likes: stone.likes || 0
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
            remnants: stone.remnants,
            likes: stone.likes || 0
        });
    } catch (err) {
        logError("Error in /api/stone/:id", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

// Get Stone Thumbnail by ID
app.get("/api/stone/:id/thumbnail", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) throwError("Database not connected", 500);

        const stonesCollection = appState.db.collection("stones");
        const stone = await stonesCollection.findOne({ _id: new ObjectId(req.params.id) });

        if (!stone || !stone.images.length) throwError("Stone or image not found", 404);

        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400"); // Cache for 1 day
        res.send(stone.images[0].data.buffer);
    } catch (err) {
        logError("Error in /api/stone/:id/thumbnail", err);
        res.status(err.status || 404).sendFile(path.join(__dirname, "placeholder.jpg"), err => {
            if (err) res.status(500).json({ error: "Failed to serve placeholder image" });
        });
    }
});

// Like a Stone
app.post("/api/stone/:id/like", async (req, res) => {
    try {
        await ensureMongoDBConnection();
        if (!appState.db) throwError("Database not connected", 500);

        const stonesCollection = appState.db.collection("stones");
        const stone = await stonesCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!stone) throwError("Stone not found", 404);

        const newLikes = (stone.likes || 0) + 1;
        await stonesCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { likes: newLikes } }
        );

        res.status(200).json({ likes: newLikes });
    } catch (err) {
        logError("Error in /api/stone/:id/like", err);
        res.status(err.status || 500).json({ error: err.message || "Server error" });
    }
});

// Health Check
app.get("/health", (req, res) => {
    res.status(200).json({
        uptime: process.uptime(),
        mongoConnected: !!appState.db,
        timestamp: new Date().toISOString()
    });
});

// Catch-all route to serve index.html for SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), (err) => {
        if (err) {
            logError("Error serving index.html", err);
            res.status(500).json({ error: "Failed to load application" });
        }
    });
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

    const keepAlive = setInterval(() => {
        console.log(`[${new Date().toISOString()}] Server is alive`);
        const used = process.memoryUsage();
        console.log(`[${new Date().toISOString()}] Memory Usage: RSS=${(used.rss / 1024 / 1024).toFixed(2)}MB, HeapTotal=${(used.heapTotal / 1024 / 1024).toFixed(2)}MB, HeapUsed=${(used.heapUsed / 1024 / 1024).toFixed(2)}MB`);
    }, 30000);

    process.on("SIGTERM", async () => {
        console.log("Received SIGTERM, shutting down...");
        clearInterval(keepAlive);
        if (appState.mongoClient) await appState.mongoClient.close();
        server.close(() => {
            console.log("Server shut down gracefully due to SIGTERM");
            process.exit(0);
        });
    });

    process.on("SIGINT", async () => {
        console.log("Received SIGINT, shutting down...");
        clearInterval(keepAlive);
        if (appState.mongoClient) await appState.mongoClient.close();
        server.close(() => {
            console.log("Server shut down gracefully due to SIGINT");
            process.exit(0);
        });
    });

    process.on("uncaughtException", err => logError("Uncaught Exception", err));
    process.on("unhandledRejection", (reason, promise) => logError("Unhandled Rejection", reason));
}

startServer();
