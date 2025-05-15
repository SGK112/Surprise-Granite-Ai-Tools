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
import sharp from 'sharp';

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
const requiredEnv = ['MONGODB_URI', 'PUBLISHED_CSV_MATERIALS', 'PUBLISHED_CSV_LABOR', 'REDIS_URL', 'SHOPIFY_ACCESS_TOKEN', 'SHOPIFY_STORE_URL'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

// Log CORS_ORIGIN for debugging
logger.info(`Raw CORS_ORIGIN: "${process.env.CORS_ORIGIN || 'undefined'}"`);

// Redis setup
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
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
  origin: (origin, callback) => {
    const corsOrigin = process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.trim();
    if (corsOrigin === '*' || !origin) {
      logger.info(`CORS allowed for origin: ${origin || 'none'}`);
      return callback(null, true);
    }
    const allowedOrigins = corsOrigin.split(',').map(o => o.trim()).filter(o => o);
    logger.info(`CORS check - Origin: ${origin || 'none'}, Allowed: ${allowedOrigins.join(', ')}`);
    if (allowedOrigins.includes(origin)) {
      logger.info(`CORS allowed for origin: ${origin}`);
      callback(null, true);
    } else {
      logger.warn(`CORS blocked for origin: ${origin || 'none'}`);
      callback(new Error(`CORS policy: ${origin || 'none'} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Content-Length'],
  credentials: false,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.url} from origin: ${req.headers.origin || 'none'} with user-agent: ${req.headers['user-agent']}`);
  next();
});

// Favicon redirect
app.get('/favicon.ico', (req, res) => {
  res.redirect(301, 'https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/64a70d4b30e87feb388f004f_surprise-granite-profile-logo.svg');
});

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
  contact: 'info@surprisegranite.com'
};

// Calculate finished pricing
function calculateFinishedPrice(material, costSqFt) {
  let additionalCost = 25;
  if (['quartzite', 'marble'].includes(material.toLowerCase())) {
    additionalCost = 35;
  } else if (['dekton', 'porcelain'].includes(material.toLowerCase())) {
    additionalCost = 45;
  }
  return (costSqFt * 3.25 + additionalCost).toFixed(2);
}

// GET /api/chat
app.get('/api/chat', (req, res) => {
  logger.warn(`Invalid GET request to /api/chat from origin: ${req.headers.origin || 'none'}, user-agent: ${req.headers['user-agent']}`);
  res.status(405).json({ error: 'Method Not Allowed: Use POST for /api/chat' });
});

// POST /api/chat
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    const { message } = req.body;
    const image = req.file;
    let responseMessage = '';

    if (image) {
      const metadata = await sharp(image.buffer).metadata();
      const { width, height } = metadata;
      const pixel = await sharp(image.buffer)
        .extract({ left: 0, top: 0, width: 1, height: 1 })
        .toBuffer();
      const [r, g, b] = pixel;

      const materials = await Material.find({ material: 'Granite' }).lean();
      const suggestedMaterial = materials[Math.floor(Math.random() * materials.length)] || { colorName: 'Classic Granite' };
      const analysis = `Image (${width}x${height}px, dominant color RGB(${r}, ${g}, ${b})). Try ${suggestedMaterial.colorName} granite for a modern look. Share your email for a quote!`;

      if (message && message.includes('@')) {
        await Lead.create({ email: message, message, imageAnalysis: analysis });
      }
      responseMessage = analysis;
    } else if (!message) {
      return res.status(400).json({ error: 'Message or image required' });
    } else {
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('granite options')) {
        const materials = await Material.find({ material: 'Granite' }).lean();
        responseMessage = materials.length > 0
          ? `Granites: ${materials.slice(0, 3).map(m => m.colorName).join(', ')}. Upload a photo for design tips!`
          : `No granite options. Email ${businessInfo.contact}.`;
      } else if (lowerMessage.includes('pricing') || lowerMessage.includes('how much')) {
        const materials = await Material.find({ material: 'Granite' }).lean();
        const avgPrice = materials.length > 0
          ? materials.reduce((sum, m) => sum + parseFloat(calculateFinishedPrice(m.material, m.costSqFt)), 0) / materials.length
          : 0;
        responseMessage = avgPrice
          ? `Granite ~$${avgPrice.toFixed(2)}/sq.ft. Share details for a quote!`
          : `Pricing unavailable. Email ${businessInfo.contact}.`;
      } else if (lowerMessage.includes('services')) {
        const labor = await Labor.find({}).lean();
        responseMessage = labor.length > 0
          ? `Services: ${labor.slice(0, 3).map(l => l.service).join(', ')}. Upload a photo for project ideas!`
          : `Services unavailable. Email ${businessInfo.contact}.`;
      } else if (lowerMessage.includes('quote') || lowerMessage.includes('interested')) {
        responseMessage = 'Share your email and project details for a quote!';
      } else if (lowerMessage.includes('location') || lowerMessage.includes('hours')) {
        responseMessage = `Location: ${businessInfo.location}. Hours: ${businessInfo.hours}. Visit or request a quote!`;
      } else if (lowerMessage.includes('@')) {
        await Lead.create({ email: message, message });
        responseMessage = `Email saved! We’ll send a quote. Upload a photo for more ideas.`;
      } else if (lowerMessage.includes('shopify') || lowerMessage.includes('products')) {
        responseMessage = 'Check out our Shopify store at <a href="https://www.surprisegranite.com/collections/all" class="underline text-blue-800">www.surprisegranite.com</a> for granite samples, countertops, and more!';
      } else {
        responseMessage = `Ask about granite, pricing, services, our Shopify store, or upload a photo!`;
      }
    }

    res.json({ message: responseMessage });
  } catch (error) {
    logger.error(`Chat error: ${error.message}`);
    res.status(500).json({ error: `Failed to process request: ${error.message}` });
  }
});

// GET /api/materials
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

    const normalizedData = materials
      .map((item) => ({
        colorName: item.colorName,
        vendorName: item.vendorName,
        thickness: item.thickness,
        material: item.material,
        costSqFt: item.costSqFt,
        finishedPrice: calculateFinishedPrice(item.material, item.costSqFt),
        availableSqFt: item.availableSqFt,
        imageUrl: item.imageUrl
      }))
      .filter((item) => item.colorName && item.material && item.vendorName && item.costSqFt > 0);

    await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: `Failed to fetch materials: ${error.message}` });
  }
});

// GET /api/labor
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

    const normalizedData = laborCosts
      .map((item) => ({
        code: item.code,
        service: item.service,
        unit: item.unit,
        price: item.price,
        description: item.description
      }))
      .filter((item) => item.code && item.service && item.unit && item.price >= 0);

    await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Labor costs fetch error: ${error.message}`);
    res.status(500).json({ error: `Failed to fetch labor costs: ${error.message}` });
  }
});

// GET /api/shopify-products
app.get('/api/shopify-products', async (req, res) => {
  try {
    const response = await axios.get(`${process.env.SHOPIFY_STORE_URL}/admin/api/2023-10/products.json`, {
      headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN }
    });
    const products = response.data.products.map(p => ({
      title: p.title,
      price: parseFloat(p.variants[0].price),
      url: `https://www.surprisegranite.com/products/${p.handle}`
    }));
    res.json(products);
  } catch (error) {
    logger.error(`Shopify fetch error: ${error.message}`);
    res.status(500).json({ error: `Failed to fetch Shopify products: ${error.message}` });
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

// Catch-all for undefined GET routes
app.get('*', (req, res) => {
  logger.warn(`404 GET: ${req.url} from origin: ${req.headers.origin || 'none'}, user-agent: ${req.headers['user-agent']}`);
  res.status(404).json({ error: `Resource not found: ${req.url}` });
});

// Error Handling
app.use((err, req, res, next) => {
  logger.error(`Server error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ error: `Internal server error: ${err.message}` });
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  });

// Start Server
app.listen(port, () => logger.info(`Server running on port ${port}`));
