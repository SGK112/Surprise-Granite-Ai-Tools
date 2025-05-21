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

// Connect to MongoDB
mongoose.connect(uri, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true 
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
  process.exit(1);
});

// API route for materials
app.get('/api/materials', async (req, res) => {
  try {
    const materials = await Countertop.find({}).exec();
    if (!materials.length) {
      return res.status(404).json({ error: 'No materials found' });
    }
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
