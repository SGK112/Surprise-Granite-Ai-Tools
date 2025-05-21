import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

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
    await mongoose.connect(uri, { dbName: 'test' });
    console.log('Connected to MongoDB (test database)');
  } catch (err) {
    console.error('MongoDB connection error:', err);
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

// API route for materials
app.get('/api/materials', async (req, res) => {
  try {
    const materials = await Countertop.find({}).exec();
    console.log('Fetched materials:', materials);
    res.json(materials);
  } catch (error) {
    console.error('Error fetching materials:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
