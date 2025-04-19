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
import axios from 'axios';
import { parse } from 'csv-parse';

dotenv.config();

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
const port = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const requiredEnv = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'MONGODB_URI', 'PUBLISHED_CSV_MATERIALS'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only images are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

app.get('/api/materials', async (req, res) => {
  try {
    logger.info(`Fetching materials from: ${process.env.PUBLISHED_CSV_MATERIALS}`);
    const response = await axios.get(process.env.PUBLISHED_CSV_MATERIALS);
    const materialsData = await new Promise((resolve, reject) => {
      const records = [];
      parse(response.data, { columns: true, skip_empty_lines: true })
        .on('data', (record) => records.push(record))
        .on('end', () => resolve(records))
        .on('error', (error) => reject(error));
    });

    if (!Array.isArray(materialsData) || materialsData.length === 0) {
      throw new Error('No valid materials data');
    }

    const normalizedData = materialsData.map((item) => ({
      colorName: item['Color Name'] || '',
      vendorName: item['Vendor Name'] || '',
      thickness: item['Thickness'] || '',
      material: item['Material'] || '',
      size: item['size'] || '',
      totalSqFt: parseFloat(item['Total/SqFt']) || 0,
      costSqFt: parseFloat(item['Cost/SqFt']) || 0,
      priceGroup: item['Price Group'] || '',
      tier: item['Tier'] || '',
    })).filter((item) => item.colorName && item.material && item.vendorName);

    if (normalizedData.length === 0) {
      throw new Error('No valid materials data after filtering');
    }

    logger.info(`Materials fetched successfully: ${normalizedData.length} items`);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials data', details: error.message });
  }
});

app.get('/api/labor', async (req, res) => {
  try {
    const csvUrl = process.env.PUBLISHED_CSV_LABOR || process.env.PUBLISHED_CSV_MATERIALS;
    logger.info(`Fetching labor from: ${csvUrl}`);
    const response = await axios.get(csvUrl);
    const laborData = await new Promise((resolve, reject) => {
      const records = [];
      parse(response.data, { columns: true, skip_empty_lines: true })
        .on('data', (record) => records.push(record))
        .on('end', () => resolve(records))
        .on('error', (error) => reject(error));
    });

    if (!Array.isArray(laborData) || laborData.length === 0) {
      throw new Error('No valid labor data');
    }

    const normalizedData = laborData.map((item) => ({
      task: item['Task'] || '',
      cost: parseFloat(item['Cost']) || 0,
    })).filter((item) => item.task);

    logger.info(`Labor data fetched successfully: ${normalizedData.length} items`);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Labor fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch labor data', details: error.message });
  }
});

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

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/estimates', estimateRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  logger.warn(`404: Route not found - ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  logger.error(`Server error on ${req.method} ${req.url}: ${err.stack}`);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

const server = app.listen(port, () => logger.info(`Server running on port ${port}`));

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  try {
    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    logger.info('Express server closed');
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
