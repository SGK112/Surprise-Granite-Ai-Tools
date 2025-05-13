import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import winston from 'winston';
import axios from 'axios';
import { parse } from 'csv-parse';
import Redis from 'ioredis';
import rateLimit from 'express-rate-limit';

// Load environment variables
dotenv.config();

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

// Initialize Express app
const app = express();
const port = process.env.PORT || 10000;

// Validate required environment variables
const requiredEnv = ['MONGODB_URI', 'PUBLISHED_CSV_MATERIALS', 'PUBLISHED_CSV_LABOR', 'REDIS_URL'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

// Redis setup for caching
const redis = new Redis(process.env.REDIS_URL);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests
});
app.use(limiter);

// Middleware
app.use(express.json());
app.use(cors({ 
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['https://surprisegranite.webflow.io', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// MongoDB Schema for Materials
const materialSchema = new mongoose.Schema({
  colorName: { type: String, required: true },
  vendorName: { type: String, required: true },
  thickness: { type: String, required: true },
  material: { type: String, required: true },
  costSqFt: { type: Number, required: true },
  availableSqFt: { type: Number, default: 0 },
  imageUrl: { type: String, default: 'https://via.placeholder.com/50' },
  createdAt: { type: Date, default: Date.now }
});

const Material = mongoose.model('Material', materialSchema);

// MongoDB Schema for Labor Costs
const laborSchema = new mongoose.Schema({
  code: { type: String, required: true },
  service: { type: String, required: true },
  unit: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

const Labor = mongoose.model('Labor', laborSchema);

// Calculate finished pricing
function calculateFinishedPrice(material, costSqFt) {
  let additionalCost = 25; // Default for granite/quartz
  if (['quartzite', 'marble'].includes(material.toLowerCase())) {
    additionalCost = 35;
  } else if (['dekton', 'porcelain'].includes(material.toLowerCase())) {
    additionalCost = 45;
  }
  const basePrice = costSqFt * 3.25 + additionalCost;
  return basePrice;
}

// Fetch Materials from MongoDB with name query support
app.get('/api/materials', async (req, res) => {
  try {
    logger.info('Fetching materials from MongoDB');
    const cacheKey = 'materials:data';
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      logger.info('Serving materials from Redis cache');
      return res.json(JSON.parse(cachedData));
    }

    const { name } = req.query;
    let query = {};
    if (name) {
      query.colorName = { $regex: name, $options: 'i' };
    }
    let materials = await Material.find(query).lean();

    if (!materials || materials.length === 0) {
      logger.warn('No materials found in MongoDB, attempting CSV fallback');
      const response = await axios.get(process.env.PUBLISHED_CSV_MATERIALS);
      const materialsData = await new Promise((resolve, reject) => {
        const records = [];
        parse(response.data, { columns: true, skip_empty_lines: true })
          .on('data', (record) => records.push(record))
          .on('end', () => resolve(records))
          .on('error', (error) => reject(error));
      });

      if (!Array.isArray(materialsData) || materialsData.length === 0) {
        logger.error('No valid materials data in CSV');
        return res.status(404).json({ error: 'No materials found in MongoDB or CSV' });
      }

      materials = materialsData.map((item) => ({
        colorName: item['Color Name'] || 'Unknown',
        vendorName: item['Vendor Name'] || 'Unknown',
        thickness: item['Thickness'] || 'Unknown',
        material: item['Material'] || 'Unknown',
        costSqFt: parseFloat(item['Cost/SqFt']) || 0,
        availableSqFt: parseFloat(item['Total/SqFt']) || 0,
        imageUrl: item['ImageUrl'] || 'https://via.placeholder.com/50'
      }));

      await Material.deleteMany({});
      await Material.insertMany(materials);
      materials = await Material.find(query).lean();
    }

    const normalizedData = materials.map((item) => ({
      colorName: item.colorName,
      vendorName: item.vendorName,
      thickness: item.thickness,
      material: item.material,
      costSqFt: item.costSqFt,
      finishedPrice: calculateFinishedPrice(item.material, item.costSqFt).toFixed(2),
      availableSqFt: item.availableSqFt,
      imageUrl: item.imageUrl
    })).filter((item) => item.colorName && item.material && item.vendorName && item.costSqFt > 0);

    if (normalizedData.length === 0) {
      logger.error('No valid materials data after filtering');
      return res.status(404).json({ error: 'No valid materials data available' });
    }

    await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600); // Cache for 1 hour
    logger.info(`Materials fetched successfully: ${normalizedData.length} items`);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials data', details: error.message });
  }
});

// Fetch Labor Costs from MongoDB with CSV fallback
app.get('/api/labor', async (req, res) => {
  try {
    logger.info('Fetching labor costs');
    const cacheKey = 'labor:data';
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      logger.info('Serving labor costs from Redis cache');
      return res.json(JSON.parse(cachedData));
    }

    let laborCosts = await Labor.find({}).lean();
    if (!laborCosts || laborCosts.length === 0) {
      logger.warn('No labor costs found in MongoDB, attempting CSV fallback');
      const response = await axios.get(process.env.PUBLISHED_CSV_LABOR);
      const laborData = await new Promise((resolve, reject) => {
        const records = [];
        parse(response.data, { columns: true, skip_empty_lines: true })
          .on('data', (record) => records.push(record))
          .on('end', () => resolve(records))
          .on('error', (error) => reject(error));
      });

      if (!Array.isArray(laborData) || laborData.length === 0) {
        logger.error('No valid labor data in CSV');
        return res.status(404).json({ error: 'No labor costs found in MongoDB or CSV' });
      }

      laborCosts = laborData.map((item) => ({
        code: item['Code'] || 'Unknown',
        service: item['Service'] || 'Unknown',
        unit: item['U/M'] || 'Unknown',
        price: parseFloat(item['Price']) || 0,
        description: item['Description'] || ''
      }));

      await Labor.deleteMany({});
      await Labor.insertMany(laborCosts);
      laborCosts = await Labor.find({}).lean();
    }

    const normalizedData = laborCosts.map((item) => ({
      code: item.code,
      service: item.service,
      unit: item.unit,
      price: item.price,
      description: item.description
    })).filter((item) => item.code && item.service && item.unit && item.price >= 0);

    if (normalizedData.length === 0) {
      logger.error('No valid labor data after filtering');
      return res.status(404).json({ error: 'No valid labor data available' });
    }

    await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600); // Cache for 1 hour
    logger.info(`Labor costs fetched successfully: ${normalizedData.length} items`);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Labor costs fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch labor costs', details: error.message });
  }
});

// Health Check
app.get('/health', (req, res) => {
  logger.info('Health check requested');
  res.status(200).json({ status: 'OK' });
});

// Root Route
app.get('/', (req, res) => {
  logger.info('Root route requested');
  res.status(200).json({ message: 'Surprise Granite API' });
});

// Error Handling Middleware
app.use((req, res) => {
  logger.warn(`404: Route not found - ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  logger.error(`Server error on ${req.method} ${req.url}: ${err.stack}`);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  });

// Start Server
app.listen(port, () => logger.info(`Server running on port ${port}`));
