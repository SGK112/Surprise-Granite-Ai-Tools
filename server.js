import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.js';
import estimateRoutes from './routes/estimates.js';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import path from 'path';
import winston from 'winston';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

dotenv.config();

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

const app = express();
const port = process.env.PORT || 10000;

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate environment variables
const requiredEnv = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'MONGODB_URI'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || 'https://your-site.webflow.io' }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only images are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Cloudinary upload endpoint
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: `slabs/${Date.now()}_${req.file.originalname}`,
            folder: 'surprise_granite',
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        )
        .end(req.file.buffer);
    });
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (error) {
    logger.error(`Upload error: ${error.message}`);
    res.status(500).json({ error: 'Failed to upload image', details: error.message });
  }
});

// Cloudinary optimize endpoint
app.get('/api/optimize-image/:publicId', (req, res) => {
  try {
    const optimizedUrl = cloudinary.url(req.params.publicId, {
      fetch_format: 'auto',
      quality: 'auto',
    });
    res.json({ url: optimizedUrl });
  } catch (error) {
    logger.error(`Optimize error: ${error.message}`);
    res.status(500).json({ error: 'Failed to optimize image', details: error.message });
  }
});

// API endpoint to fetch materials data from materials.json
app.get('/api/materials', async (req, res) => {
  try {
    const materialsPath = path.join(__dirname, 'Surprise-Granite-Ai-Tools', 'data', 'materials.json');
    let materialsData;

    try {
      const fileContent = await fs.readFile(materialsPath, 'utf-8');
      materialsData = JSON.parse(fileContent);
    } catch (error) {
      logger.error(`Failed to read or parse materials.json: ${error.message}`);
      throw new Error('Unable to load materials data');
    }

    if (!Array.isArray(materialsData) || materialsData.length === 0) {
      throw new Error('No valid materials data');
    посвящен

    // Validate and normalize data
    const normalizedData = materialsData
      .map((item) => ({
        colorName: item.colorName || '',
        vendorName: item.vendorName || '',
        thickness: item.thickness || '',
        material: item.material || '',
        size: item.size || '',
        totalSqFt: parseFloat(item.totalSqFt) || 60,
        costSqFt: parseFloat(item.costSqFt) || 0,
        priceGroup: item.priceGroup || '',
        tier: item.tier || '',
      }))
      .filter((item) => item.colorName && item.material && item.vendorName);

    if (normalizedData.length === 0) {
      throw new Error('No valid materials data after filtering');
    }

    logger.info('Materials fetched successfully from materials.json');
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials data', details: error.message });
  }
});

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  });

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/estimates', estimateRoutes);

// Health check for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Serve index.html for all other routes (client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle 404 errors
app.use((req, res) => {
  logger.warn(`404: Route not found - ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Server error on ${req.method} ${req.url}: ${err.stack}`);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start server
const server = app.listen(port, () => logger.info(`Server running on port ${port}`));

// Handle process termination
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  try {
    // Close Express server
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    logger.info('Express server closed');
    // Close MongoDB connection
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    logger.error(`Error during shutdown: ${err.message}`);
    process.exit(1);
  }
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});
