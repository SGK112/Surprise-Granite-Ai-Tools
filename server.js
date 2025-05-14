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
import { GridFSBucket } from 'mongodb';
import FormData from 'form-data';

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
let redis;
try {
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 3 });
  redis.on('error', (err) => logger.error(`Redis error: ${err.message}`));
} catch (err) {
  logger.error(`Failed to initialize Redis: ${err.message}`);
}

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
  origin: (origin, callback) => {
    const allowedOrigins = process.env.CORS_ORIGIN 
      ? process.env.CORS_ORIGIN.split(',') 
      : [
          'https://surprisegranite.webflow.io',
          'http://localhost:3000',
          'https://artifacts.grokusercontent.com',
          'https://grok.com'
        ];
    logger.info(`CORS check for origin: ${origin}, allowed: ${allowedOrigins}`);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error(`CORS policy: ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Content-Length'],
  credentials: false,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.url} from origin: ${req.headers.origin}, user-agent: ${req.headers['user-agent']}, referer: ${req.headers.referer}, accept: ${req.headers.accept}, headers: ${JSON.stringify(req.headers)}`);
  next();
});

// MongoDB GridFS setup
let gfs;
mongoose.connection.once('open', () => {
  gfs = new GridFSBucket(mongoose.connection.db, { bucketName: 'images' });
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
  imageId: { type: mongoose.Types.ObjectId },
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
  let additionalCost = 25;
  if (['quartzite', 'marble'].includes(material.toLowerCase())) {
    additionalCost = 35;
  } else if (['dekton', 'porcelain'].includes(material.toLowerCase())) {
    additionalCost = 45;
  }
  return (costSqFt * 3.25 + additionalCost).toFixed(2);
}

// Store and retrieve images
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    const image = req.file;
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const uploadStream = gfs.openUploadStream(image.originalname, {
      contentType: image.mimetype
    });
    uploadStream.end(image.buffer);

    const imageId = await new Promise((resolve, reject) => {
      uploadStream.on('finish', () => resolve(uploadStream.id));
      uploadStream.on('error', reject);
    });

    const imageUrl = `/api/image/${imageId}`;
    res.json({ imageId, imageUrl });
  } catch (error) {
    logger.error(`Image upload error: ${error.message}, stack: ${error.stack}`);
    res.status(500).json({ error: `Failed to upload image: ${error.message}` });
  }
});

app.get('/api/image/:id', async (req, res) => {
  try {
    const imageId = new mongoose.Types.ObjectId(req.params.id);
    const downloadStream = gfs.openDownloadStream(imageId);

    downloadStream.on('error', (err) => {
      logger.error(`Image download error: ${err.message}, stack: ${err.stack}`);
      res.status(404).json({ error: 'Image not found' });
    });

    downloadStream.pipe(res);
  } catch (error) {
    logger.error(`Image retrieval error: ${error.message}, stack: ${error.stack}`);
    res.status(500).json({ error: `Failed to retrieve image: ${error.message}` });
  }
});

// Send quote request to Basin
app.post('/api/quote', async (req, res) => {
  try {
    const { email, message, imageAnalysis, imageId } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const formData = new FormData();
    formData.append('email', email);
    if (message) formData.append('message', message);
    if (imageAnalysis) formData.append('imageAnalysis', imageAnalysis);
    if (imageId) formData.append('imageId', imageId);

    const response = await axios.post('https://usebasin.com/f/0e9742fed801', formData, {
      headers: formData.getHeaders()
    });

    if (response.status !== 200) {
      throw new Error(`Basin API error: ${response.statusText}`);
    }

    res.json({ message: 'Quote request sent successfully' });
  } catch (error) {
    logger.error(`Quote submission error: ${error.message}, stack: ${error.stack}`);
    res.status(500).json({ error: `Failed to send quote request: ${error.message}` });
  }
});

// GET /api/chat (handle invalid method)
app.get('/api/chat', (req, res) => {
  logger.warn(`Invalid GET request to /api/chat from origin: ${req.headers.origin}, user-agent: ${req.headers['user-agent']}, referer: ${req.headers.referer}, accept: ${req.headers.accept}`);
  res.status(405).json({ error: 'Method Not Allowed: Use POST for /api/chat' });
});

// POST /api/chat
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    const { message } = req.body;
    const image = req.file;
    let responseMessage = '';
    let imageId, imageUrl;

    if (image) {
      let jimpImage;
      try {
        jimpImage = await Jimp.read(image.buffer);
      } catch (jimpErr) {
        logger.error(`Jimp image processing error: ${jimpErr.message}, stack: ${jimpErr.stack}`);
        throw new Error('Failed to process image. Please try another file.');
      }
      const { width, height } = jimpImage.bitmap;
      const dominantColor = jimpImage.getPixelColor(0, 0);
      const rgba = Jimp.intToRGBA(dominantColor);

      const uploadStream = gfs.openUploadStream(image.originalname, {
        contentType: image.mimetype
      });
      uploadStream.end(image.buffer);

      imageId = await new Promise((resolve, reject) => {
        uploadStream.on('finish', () => resolve(uploadStream.id));
        uploadStream.on('error', reject);
      });
      imageUrl = `/api/image/${imageId}`;

      let materials;
      try {
        materials = await Material.find({ material: 'Granite' }).lean();
      } catch (mongoErr) {
        logger.error(`MongoDB query error for materials: ${mongoErr.message}, stack: ${mongoErr.stack}`);
        throw new Error('Database error. Please try again later.');
      }
      const suggestedMaterial = materials[Math.floor(Math.random() * materials.length)] || { colorName: 'Classic Granite' };
      const analysis = `Image (${width}x${height}px, dominant color RGB(${rgba.r}, ${rgba.g}, ${rgba.b})). Try ${suggestedMaterial.colorName} granite for a modern look. Share your email for a quote!`;

      if (message && message.includes('@')) {
        try {
          await Lead.create({ email: message, message, imageAnalysis: analysis, imageId });
        } catch (mongoErr) {
          logger.error(`MongoDB insert error for lead: ${mongoErr.message}, stack: ${mongoErr.stack}`);
          throw new Error('Failed to save lead. Please try again.');
        }
      }
      responseMessage = analysis;
    } else if (!message) {
      return res.status(400).json({ error: 'Message or image required' });
    } else {
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('granite options')) {
        let materials;
        try {
          materials = await Material.find({ material: 'Granite' }).lean();
        } catch (mongoErr) {
          logger.error(`MongoDB query error for materials: ${mongoErr.message}, stack: ${mongoErr.stack}`);
          throw new Error('Database error. Please try again later.');
        }
        responseMessage = materials.length > 0
          ? `Granites: ${materials.slice(0, 3).map(m => m.colorName).join(', ')}. Upload a photo for design tips!`
          : `No granite options. Email ${businessInfo.contact}.`;
      } else if (lowerMessage.includes('pricing') || lowerMessage.includes('how much')) {
        let materials;
        try {
          materials = await Material.find({ material: 'Granite' }).lean();
        } catch (mongoErr) {
          logger.error(`MongoDB query error for materials: ${mongoErr.message}, stack: ${mongoErr.stack}`);
          throw new Error('Database error. Please try again later.');
        }
        const avgPrice = materials.length > 0
          ? materials.reduce((sum, m) => sum + parseFloat(calculateFinishedPrice(m.material, m.costSqFt)), 0) / materials.length
          : 0;
        responseMessage = avgPrice
          ? `Granite ~$${avgPrice.toFixed(2)}/sq.ft. Share details for a quote!`
          : `Pricing unavailable. Email ${businessInfo.contact}.`;
      } else if (lowerMessage.includes('services')) {
        let labor;
        try {
          labor = await Labor.find({}).lean();
        } catch (mongoErr) {
          logger.error(`MongoDB query error for labor: ${mongoErr.message}, stack: ${mongoErr.stack}`);
          throw new Error('Database error. Please try again later.');
        }
        responseMessage = labor.length > 0
          ? `Services: ${labor.slice(0, 3).map(l => l.service).join(', ')}. Upload a photo for project ideas!`
          : `Services unavailable. Email ${businessInfo.contact}.`;
      } else if (lowerMessage.includes('quote') || lowerMessage.includes('interested')) {
        responseMessage = 'Share your email and project details for a quote!';
      } else if (lowerMessage.includes('location') || lowerMessage.includes('hours')) {
        responseMessage = `Location: ${businessInfo.location}. Hours: ${businessInfo.hours}. Visit or request a quote!`;
      } else if (lowerMessage.includes('@')) {
        try {
          await Lead.create({ email: message, message });
          const formData = new FormData();
          formData.append('email', message);
          formData.append('message', message);
          await axios.post('https://usebasin.com/f/0e9742fed801', formData, {
            headers: formData.getHeaders()
          });
        } catch (mongoErr) {
          logger.error(`MongoDB insert or Basin submission error: ${mongoErr.message}, stack: ${mongoErr.stack}`);
          throw new Error('Failed to save lead or send quote. Please try again.');
        }
        responseMessage = `Email saved and quote request sent! We’ll contact you soon. Upload a photo for more ideas.`;
      } else {
        responseMessage = `Ask about granite, pricing, services, our location (${businessInfo.location}), or upload a photo!`;
      }
    }

    res.json({ message: responseMessage, imageId, imageUrl });
  } catch (error) {
    logger.error(`Chat error: ${error.message}, stack: ${error.stack}`);
    res.status(500).json({ error: `Failed to process request: ${error.message}` });
  }
});

// Fetch Materials
app.get('/api/materials', async (req, res) => {
  try {
    const cacheKey = 'materials:data';
    let cachedData;
    try {
      cachedData = await redis.get(cacheKey);
    } catch (redisErr) {
      logger.error(`Redis get error: ${redisErr.message}, stack: ${redisErr.stack}`);
    }
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    const { name } = req.query;
    let query = {};
    if (name) {
      query.colorName = { $regex: name, $options: 'i' };
    }
    let materials;
    try {
      materials = await Material.find(query).lean();
    } catch (mongoErr) {
      logger.error(`MongoDB query error for materials: ${mongoErr.message}, stack: ${mongoErr.stack}`);
      throw new Error('Database error. Please try again later.');
    }

    if (!materials || materials.length === 0) {
      let response;
      try {
        response = await axios.get(process.env.PUBLISHED_CSV_MATERIALS);
      } catch (csvErr) {
        logger.error(`CSV fetch error for materials: ${csvErr.message}, stack: ${csvErr.stack}`);
        throw new Error('Failed to fetch material data');
      }
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

      try {
        await Material.deleteMany({});
        await Material.insertMany(materials);
        materials = await Material.find(query).lean();
      } catch (mongoErr) {
        logger.error(`MongoDB update error for materials: ${mongoErr.message}, stack: ${mongoErr.stack}`);
        throw new Error('Database error. Please try again later.');
      }
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

    try {
      await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600);
    } catch (redisErr) {
      logger.error(`Redis set error: ${redisErr.message}, stack: ${redisErr.stack}`);
    }
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}, stack: ${error.stack}`);
    res.status(500).json({ error: `Failed to fetch materials: ${error.message}` });
  }
});

// Fetch Labor Costs
app.get('/api/labor', async (req, res) => {
  try {
    const cacheKey = 'labor:data';
    let cachedData;
    try {
      cachedData = await redis.get(cacheKey);
    } catch (redisErr) {
      logger.error(`Redis get error: ${redisErr.message}, stack: ${redisErr.stack}`);
    }
    if (cachedData) {
      return res.json(JSON.parse(cachedData));
    }

    let laborCosts;
    try {
      laborCosts = await Labor.find({}).lean();
    } catch (mongoErr) {
      logger.error(`MongoDB query error for labor: ${mongoErr.message}, stack: ${mongoErr.stack}`);
      throw new Error('Database error. Please try again later.');
    }

    if (!laborCosts || laborCosts.length === 0) {
      let response;
      try {
        response = await axios.get(process.env.PUBLISHED_CSV_LABOR);
      } catch (csvErr) {
        logger.error(`CSV fetch error for labor: ${csvErr.message}, stack: ${csvErr.stack}`);
        throw new Error('Failed to fetch labor data');
      }
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

      try {
        await Labor.deleteMany({});
        await Labor.insertMany(laborCosts);
        laborCosts = await Labor.find({}).lean();
      } catch (mongoErr) {
        logger.error(`MongoDB update error for labor: ${mongoErr.message}, stack: ${mongoErr.stack}`);
        throw new Error('Database error. Please try again later.');
      }
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

    try {
      await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600);
    } catch (redisErr) {
      logger.error(`Redis set error: ${redisErr.message}, stack: ${redisErr.stack}`);
    }
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Labor costs fetch error: ${error.message}, stack: ${error.stack}`);
    res.status(500).json({ error: `Failed to fetch labor costs: ${error.message}` });
  }
});

// Health Check
app.get('/health', async (req, res) => {
  const health = {
    status: 'OK',
    mongodb: 'disconnected',
    redis: 'disconnected'
  };
  try {
    await mongoose.connection.db.admin().ping();
    health.mongodb = 'connected';
  } catch (err) {
    logger.error(`MongoDB health check failed: ${err.message}`);
    health.mongodb = `error: ${err.message}`;
  }
  try {
    await redis.ping();
    health.redis = 'connected';
  } catch (err) {
    logger.error(`Redis health check failed: ${err.message}`);
    health.redis = `error: ${err.message}`;
  }
  res.status(200).json(health);
});

// Root Route
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Surprise Granite API' });
});

// Catch-all for undefined GET routes
app.get('*', (req, res) => {
  logger.warn(`404 GET: ${req.url} from origin: ${req.headers.origin}, user-agent: ${req.headers['user-agent']}, referer: ${req.headers.referer}, accept: ${req.headers.accept}`);
  res.status(404).json({ error: `Resource not found: ${req.url}` });
});

// Error Handling
app.use((err, req, res, next) => {
  logger.error(`Server error: ${err.stack}`);
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
