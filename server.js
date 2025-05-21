import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { parse } from 'csv-parse';
import fetch from 'node-fetch';

// Load environment variables
dotenv.config();

const app = express();

// Enable CORS for Webflow
app.use(cors({
  origin: 'https://surprisegranite.webflow.io',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Accept']
}));

// Serve static files (e.g., app.js)
app.use(express.static('public'));

// MongoDB connection
const uri = process.env.MONGODB_URI;
const csvUrl = process.env.CSV_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRWyYuTQxC8_fKNBg9_aJiB7NMFztw6mgdhN35lo8sRL45MvncRg4D217lopZxuw39j5aJTN6TP4Elh/pub?output=csv';
if (!uri) {
  console.error('MONGODB_URI is not defined in environment variables');
  process.exit(1);
}

// Define Mongoose schema and model
const countertopSchema = new mongoose.Schema({
  colorName: String,
  vendorName: String,
  material: String,
  costSqFt: Number,
  availableSqFt: Number,
  imageUrl: String
}, { collection: 'countertop_images' });

const Countertop = mongoose.model('Countertop', countertopSchema);

// Connect to MongoDB with retry
const connectWithRetry = async (retries = 5, delay = 5000) => {
  try {
    await mongoose.connect(uri, { dbName: 'countertops' });
    console.log('Connected to MongoDB (countertops database)');
  } catch (err) {
    console.error('MongoDB connection error:', err.message, err.stack);
    if (retries > 0) {
      console.log(`Retrying MongoDB connection (${retries} attempts left)...`);
      setTimeout(() => connectWithRetry(retries - 1, delay), delay);
    } else {
      console.error('MongoDB connection failed after retries');
      process.exit(1);
    }
  }
};
connectWithRetry();

// Handle process termination
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, closing MongoDB connection');
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (err) {
    console.error('Error closing MongoDB connection:', err.message);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT, closing MongoDB connection');
  try {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  } catch (err) {
    console.error('Error closing MongoDB connection:', err.message);
  }
  process.exit(0);
});

// Sync CSV to MongoDB
const syncCsvToMongo = async () => {
  try {
    console.log('Fetching CSV from:', csvUrl);
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error(`Failed to fetch CSV: ${response.status}`);
    const csvText = await response.text();

    const parser = parse({
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    const records = [];
    parser.on('readable', () => {
      let record;
      while ((record = parser.read())) {
        records.push({
          colorName: record.colorName || 'Unknown',
          vendorName: record.vendorName || 'Unknown',
          material: record.material || 'Unknown',
          costSqFt: parseFloat(record.costSqFt) || 0,
          availableSqFt: parseFloat(record.availableSqFt) || 0
        });
      }
    });

    parser.on('error', (err) => {
      throw new Error(`CSV parsing error: ${err.message}`);
    });

    await new Promise((resolve, reject) => {
      parser.on('end', resolve);
      parser.on('error', reject);
      parser.write(csvText);
      parser.end();
    });

    console.log('Parsed CSV records:', records.length);
    const batchSize = 100; // Process in batches to reduce memory usage
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const bulkOps = batch
        .filter(record => record.costSqFt > 0)
        .map(record => ({
          updateOne: {
            filter: { colorName: record.colorName, vendorName: record.vendorName, material: record.material },
            update: { $set: { costSqFt: record.costSqFt, availableSqFt: record.availableSqFt } },
            upsert: true
          }
        }));
      if (bulkOps.length > 0) {
        await Countertop.bulkWrite(bulkOps);
      }
    }
    console.log('CSV pricing synced to MongoDB');
  } catch (error) {
    console.error('Error syncing CSV to MongoDB:', error.message, error.stack);
  }
};

// Sync on startup and every 15 minutes (reduced frequency)
syncCsvToMongo();
setInterval(syncCsvToMongo, 15 * 60 * 1000);

// API route to trigger manual sync
app.get('/api/sync-csv', async (req, res) => {
  try {
    await syncCsvToMongo();
    res.status(200).json({ message: 'CSV sync completed' });
  } catch (error) {
    console.error('Manual CSV sync error:', error.message);
    res.status(500).json({ error: 'Failed to sync CSV' });
  }
});

// API route for materials
app.get('/api/materials', async (req, res) => {
  try {
    const materials = await Countertop.find({}).exec();
    console.log('Fetched materials:', materials.length);
    res.json(materials);
  } catch (error) {
    console.error('Error fetching materials:', error.message, error.stack);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', mongooseConnected: mongoose.connection.readyState === 1 });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
