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
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.static(path.join(path.dirname(import.meta.url.replace('file://', '')), 'public')));

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

// MongoDB Connection
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully');
  try {
    await mongoose.connection.close(); // No callback, returns a promise
    console.log('MongoDB connection closed');
    process.exit(0);
  } catch (err) {
    console.error('Error closing MongoDB connection:', err);
    process.exit(1);
  }
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/estimates', estimateRoutes);

// Health check for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
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
app.listen(port, () => logger.info(`Server running on port ${port}`));

// Handle process termination
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  mongoose.connection.close(() => {
    logger.info('MongoDB connection closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});
