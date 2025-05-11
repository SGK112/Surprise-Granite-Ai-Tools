import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import winston from 'winston';
import axios from 'axios';
import { parse } from 'csv-parse';

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
const port = process.env.PORT || 3000;

// Validate required environment variables
const requiredEnv = ['MONGODB_URI', 'PUBLISHED_CSV_MATERIALS'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

// Middleware
app.use(express.json());
app.use(cors({ 
  origin: process.env.CORS_ORIGIN || 'https://surprisegranite.webflow.io',
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

// Fetch Materials from MongoDB with CSV fallback
app.get('/api/materials', async (req, res) => {
  try {
    logger.info('Fetching materials from MongoDB');
    let materials = await Material.find({}).lean();
    
    if (!materials || materials.length === 0) {
      logger.warn('No materials found in MongoDB, falling back to CSV');
      const response = await axios.get(process.env.PUBLISHED_CSV_MATERIALS);
      const materialsData = await new Promise((resolve, reject) => {
        const records = [];
        parse(response.data, { columns: true, skip_empty_lines: true })
          .on('data', (record) => records.push(record))
          .on('end', () => resolve(records))
          .on('error', (error) => reject(error));
      });

      if (!Array.isArray(materialsData) || materialsData.length === 0) {
        throw new Error('No valid materials data in CSV');
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
      logger.info(`Saved ${materials.length} materials from CSV to MongoDB`);
    }

    const normalizedData = materials.map((item) => ({
      colorName: item.colorName,
      vendorName: item.vendorName,
      thickness: item.thickness,
      material: item.material,
      costSqFt: item.costSqFt,
      availableSqFt: item.availableSqFt,
      imageUrl: item.imageUrl
    })).filter((item) => item.colorName && item.material && item.vendorName && item.costSqFt > 0);

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

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Root Route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Surprise Granite AI Tools API' });
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
