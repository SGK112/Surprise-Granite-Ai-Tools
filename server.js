import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import winston from 'winston';
import axios from 'axios';
import { parse } from 'csv-parse';
import Redis from 'ioredis';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import Jimp from 'jimp';

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

// Multer setup for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('Only JPEG and PNG images are allowed'));
    }
    cb(null, true);
  }
});

// Middleware
app.use(express.json());
app.use(cors({ 
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['https://surprisegranite.webflow.io', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// MongoDB Schemas
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
materialSchema.index({ colorName: 1, material: 1 });
const Material = mongoose.model('Material', materialSchema);

const laborSchema = new mongoose.Schema({
  code: { type: String, required: true },
  service: { type: String, required: true },
  unit: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
laborSchema.index({ service: 1 });
const Labor = mongoose.model('Labor', laborSchema);

const leadSchema = new mongoose.Schema({
  email: { type: String, required: true },
  message: { type: String },
  imageAnalysis: { type: String },
  createdAt: { type: Date, default: Date.now }
});
const Lead = mongoose.model('Lead', leadSchema);

// Business Info
const businessInfo = {
  location: 'Surprise, AZ 85374',
  hours: 'Mon-Fri: 8 AM - 5 PM, Sat: 9 AM - 2 PM, Sun: Closed',
  contact: 'support@surprisegranite.com'
};

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

// Fetch Materials from MongoDB
app.get('/api/materials', async (req, res) => {
  try {
    const cacheKey = 'materials:data';
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    const { name } = req.query;
    let query = {};
    if (name) {
      query.colorName = { $regex: name, $options: 'i' };
    }
    let materials = await Material.find(query).lean();

    if (!materials || materials.length === 0) {
      const response = await axios.get(process.env.PUBLISHED_CSV_MATERIALS);
      const materialsData = await new Promise((resolve, reject) => {
        const records = [];
        parse(response.data, { columns: true, skip_empty_lines: true })
          .on('data', (record) => records.push(record))
          .on('end', () => resolve(records))
          .on('error', (error) => reject(error));
      });

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

    await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials data' });
  }
});

// Fetch Labor Costs from MongoDB
app.get('/api/labor', async (req, res) => {
  try {
    const cacheKey = 'labor:data';
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    let laborCosts = await Labor.find({}).lean();
    if (!laborCosts || laborCosts.length === 0) {
      const response = await axios.get(process.env.PUBLISHED_CSV_LABOR);
      const laborData = await new Promise((resolve, reject) => {
        const records = [];
        parse(response.data, { columns: true, skip_empty_lines: true })
          .on('data', (record) => records.push(record))
          .on('end', () => resolve(records))
          .on('error', (error) => reject(error));
      });

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

    await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Labor costs fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch labor costs' });
  }
});

// Chat Endpoint with Image Analysis
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    const { message } = req.body;
    const image = req.file;
    let responseMessage = '';

    // Handle image upload
    if (image) {
      const jimpImage = await Jimp.read(image.buffer);
      const { width, height } = jimpImage.bitmap;
      const dominantColor = jimpImage.getPixelColor(0, 0); // Simplified; use histogram for real apps
      const rgba = Jimp.intToRGBA(dominantColor);

      // Basic interior design suggestion
      const materials = await Material.find({ material: 'Granite' }).lean();
      const suggestedMaterial = materials[Math.floor(Math.random() * materials.length)] || { colorName: 'Classic Granite' };
      const analysis = `Uploaded image (${width}x${height}px, dominant color RGB(${rgba.r}, ${rgba.g}, ${rgba.b})). For this space, consider ${suggestedMaterial.colorName} granite for a modern, durable look. Want a quote? Share your email!`;

      // Save lead with image analysis
      if (message && message.includes('@')) {
        await Lead.create({ email: message, message, imageAnalysis: analysis });
      }

      responseMessage = analysis;
    } else if (!message) {
      return res.status(400).json({ error: 'Message or image required' });
    } else {
      const lowerMessage = message.toLowerCase();

      // Intent matching
      if (lowerMessage.includes('granite options')) {
        const materials = await Material.find({ material: 'Granite' }).lean();
        responseMessage = materials.length > 0
          ? `We offer granites like ${materials.slice(0, 3).map(m => m.colorName).join(', ')}. Upload a room photo for design tips!`
          : 'No granite options available. Contact us at ${businessInfo.contact}.';
      } else if (lowerMessage.includes('pricing') || lowerMessage.includes('how much')) {
        const materials = await Material.find({ material: 'Granite' }).lean();
        const avgPrice = materials.length > 0
          ? materials.reduce((sum, m) => sum + calculateFinishedPrice(m.material, m.costSqFt), 0) / materials.length
          : 0;
        responseMessage = avgPrice
          ? `Granite averages $${avgPrice.toFixed(2)}/sq.ft. (finished). Share project details for a quote!`
          : 'Pricing unavailable. Email us at ${businessInfo.contact}.';
      } else if (lowerMessage.includes('services')) {
        const labor = await Labor.find({}).lean();
        responseMessage = labor.length > 0
          ? `Services: ${labor.slice(0, 3).map(l => l.service).join(', ')}. Upload a photo to discuss your project!`
          : 'Service details unavailable. Contact ${businessInfo.contact}.';
      } else if (lowerMessage.includes('quote') || lowerMessage.includes('interested')) {
        responseMessage = 'Share your email and project details for a personalized quote!';
      } else if (lowerMessage.includes('location') || lowerMessage.includes('hours')) {
        responseMessage = `We’re located at ${businessInfo.location}. Hours: ${businessInfo.hours}. Visit us or ask for a quote!`;
      } else if (lowerMessage.includes('@')) {
        await Lead.create({ email: message, message });
        responseMessage = `Thanks for sharing your email! We’ll send a quote soon. Upload a project photo to discuss further.`;
      } else {
        responseMessage = 'Ask about granite, pricing, services, our location (${businessInfo.location}), or upload a photo for design ideas!';
      }
    }

    res.json({ message: responseMessage });
  } catch (error) {
    logger.error(`Chat error: ${error.message}`);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Root Route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Surprise Granite API' });
});

// Error Handling Middleware
app.use((req, res) => {
  logger.warn(`404: Route not found - ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  logger.error(`Server error on ${req.method} ${req.url}: ${err.stack}`);
  res.status(500).json({ error: 'Internal server error' });
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
