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
import Shopify from 'shopify-api-node';
import fs from 'fs/promises';
import helmet from 'helmet';
import sanitizeHtml from 'sanitize-html';

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
const requiredEnv = [
  'MONGODB_URI',
  'PUBLISHED_CSV_MATERIALS',
  'PUBLISHED_CSV_LABOR',
  'REDIS_URL',
  'OPENAI_API_KEY'
];
const optionalEnv = ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_STORE_DOMAIN'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`Missing required environment variable: ${key}`);
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

// Security and middleware
app.use(helmet());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',')
      : ['https://surprisegranite.webflow.io', 'http://localhost:3000'];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked for origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Content-Length'],
  credentials: false,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per IP
  message: 'Too many requests, please try again later.'
}));
app.use((req, res, next) => {
  logger.info(`Request: ${req.method} ${req.url} from ${req.headers.origin}`);
  next();
});

// MongoDB GridFS setup
let gfs;
mongoose.connection.once('open', () => {
  gfs = new GridFSBucket(mongoose.connection.db, { bucketName: 'images' });
  logger.info('MongoDB GridFS initialized');
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
materialSchema.index({ colorName: 1, material: 1, vendorName: 1 });
const Material = mongoose.model('Material', materialSchema);

const laborSchema = new mongoose.Schema({
  code: { type: String, required: true },
  service: { type: String, required: true },
  unit: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
laborSchema.index({ service: 1, code: 1 });
const Labor = mongoose.model('Labor', laborSchema);

const leadSchema = new mongoose.Schema({
  email: { type: String, required: true },
  name: { type: String },
  phone: { type: String },
  message: { type: String },
  imageAnalysis: { type: String },
  imageId: { type: mongoose.Types.ObjectId },
  projectDetails: { type: Object },
  createdAt: { type: Date, default: Date.now }
});
leadSchema.index({ email: 1, createdAt: -1 });
const Lead = mongoose.model('Lead', leadSchema);

// Business Info
const businessInfo = {
  name: 'Surprise Granite',
  location: '11560 N Dysart Rd. Suite 112, Surprise, AZ 85379',
  hours: 'Mon-Fri: 9:00 AM - 5:00 PM, Sat: 10:00 AM - 2:00 PM, Sun: Closed',
  contact: 'support@surprisegranite.com',
  website: 'https://surprisegranite.webflow.io',
  process: 'Our process starts with a consultation to understand your needs, followed by material selection from our premium granite, marble, quartz, quartzite, Dekton, or porcelain offerings. We provide detailed estimates, including material costs with a 3.25x markup plus $25-$45 based on material type and a 5-15% waste factor. Our expert team handles precise fabrication and professional installation, ensuring a seamless experience.'
};

// Shopify API setup (optional)
let shopify;
if (process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET && process.env.SHOPIFY_STORE_DOMAIN) {
  try {
    shopify = new Shopify({
      shopName: process.env.SHOPIFY_STORE_DOMAIN,
      apiKey: process.env.SHOPIFY_API_KEY,
      password: process.env.SHOPIFY_API_SECRET
    });
    logger.info('Shopify API initialized');
  } catch (err) {
    logger.error(`Failed to initialize Shopify: ${err.message}`);
  }
}

// Guardrails: Content filtering
const harmfulPatterns = [
  /\b(hate|insult|offensive|profane|toxic|racist|sexist)\b/i,
  /\b(medical|legal|financial)\s+advice\b/i,
  /prompt\s+injection|jailbreak/i,
  /\b(pii|personal\s+information|ssn|credit\s+card)\b/i
];

function validateInput(message) {
  if (typeof message !== 'string' || message.length > 1000) {
    return { valid: false, reason: 'Invalid or too long input' };
  }
  for (const pattern of harmfulPatterns) {
    if (pattern.test(message)) {
      return { valid: false, reason: 'Input contains restricted content' };
    }
  }
  return { valid: true };
}

// Calculate finished pricing
function calculateFinishedPrice(material, costSqFt) {
  let additionalCost = 25; // Granite/Quartz
  if (['quartzite', 'marble'].includes(material.toLowerCase())) {
    additionalCost = 35;
  } else if (['dekton', 'porcelain'].includes(material.toLowerCase())) {
    additionalCost = 45;
  }
  const basePrice = costSqFt * 3.25 + additionalCost;
  return parseFloat(basePrice.toFixed(2));
}

// Apply waste factor
function applyWasteFactor(price, message) {
  let wasteFactor = 0.10; // Default 10%
  if (message && (message.toLowerCase().includes('complex') || message.toLowerCase().includes('intricate'))) {
    wasteFactor = 0.15; // 15% for complex layouts
  } else if (message && (message.toLowerCase().includes('simple') || message.toLowerCase().includes('basic'))) {
    wasteFactor = 0.05; // 5% for simple layouts
  }
  return parseFloat((price * (1 + wasteFactor)).toFixed(2));
}

// Estimate service costs
function estimateServiceCost(message, laborData) {
  const services = ['fabrication', 'installation'];
  let total = 0;
  const matchedServices = [];
  services.forEach(service => {
    if (message && message.toLowerCase().includes(service)) {
      const labor = laborData.find(l => l.service.toLowerCase().includes(service));
      if (labor) {
        total += labor.price;
        matchedServices.push(`${labor.service}: $${labor.price}`);
      }
    }
  });
  return { total: parseFloat(total.toFixed(2)), details: matchedServices };
}

// Favicon redirect
app.get('/favicon.ico', (req, res) => {
  res.redirect(301, 'https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/64a70d4b30e87feb388f004f_surprise-granite-profile-logo.svg');
});

// Store and retrieve images
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    const image = req.file;
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }
    if (!gfs) {
      throw new Error('GridFS not initialized');
    }
    const uploadStream = gfs.openUploadStream(image.originalname, {
      contentType: image.mimetype
    });
    uploadStream.end(image.buffer);
    const imageId = await new Promise((resolve, reject) => {
      uploadStream.on('finish', () => resolve(uploadStream.id));
      uploadStream.on('error', reject);
    });
    res.json({ imageId, imageUrl: `/api/image/${imageId}` });
  } catch (error) {
    logger.error(`Image upload error: ${error.message}`);
    res.status(500).json({ error: `Failed to upload image: ${error.message}` });
  }
});

app.get('/api/image/:id', async (req, res) => {
  try {
    const imageId = new mongoose.Types.ObjectId(req.params.id);
    if (!gfs) {
      throw new Error('GridFS not initialized');
    }
    const downloadStream = gfs.openDownloadStream(imageId);
    downloadStream.on('error', () => res.status(404).json({ error: 'Image not found' }));
    downloadStream.pipe(res);
  } catch (error) {
    logger.error(`Image retrieval error: ${error.message}`);
    res.status(500).json({ error: `Failed to retrieve image: ${error.message}` });
  }
});

// Chatbot Endpoint
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    const { message } = req.body;
    const image = req.file;
    if (!message && !image) {
      return res.status(400).json({ error: 'Message or image required' });
    }

    // Validate input
    if (message) {
      const validation = validateInput(message);
      if (!validation.valid) {
        logger.warn(`Invalid input: ${validation.reason}`);
        return res.status(400).json({ error: 'Sorry, your message contains restricted content. Please rephrase.' });
      }
    }

    // Cache materials and labor
    let materials, laborData;
    const materialCacheKey = 'materials:data';
    const laborCacheKey = 'labor:data';
    try {
      const cachedMaterials = await redis.get(materialCacheKey);
      const cachedLabor = await redis.get(laborCacheKey);
      materials = cachedMaterials ? JSON.parse(cachedMaterials) : await Material.find({}).lean();
      laborData = cachedLabor ? JSON.parse(cachedLabor) : await Labor.find({}).lean();
      if (!cachedMaterials) await redis.set(materialCacheKey, JSON.stringify(materials), 'EX', 3600);
      if (!cachedLabor) await redis.set(laborCacheKey, JSON.stringify(laborData), 'EX', 3600);
    } catch (err) {
      logger.error(`Cache or DB error: ${err.message}`);
      materials = await Material.find({}).lean();
      laborData = await Labor.find({}).lean();
    }

    // Shopify product data
    let shopifyContext = 'No Shopify product data available.';
    if (shopify) {
      try {
        const products = await shopify.product.list({ limit: 5 });
        shopifyContext = products.map(p => 
          `Product: ${p.title}, Price: $${p.variants[0].price}, Inventory: ${p.variants[0].inventory_quantity}`
        ).join('\n');
      } catch (error) {
        logger.error(`Shopify API error: ${error.message}`);
      }
    }

    // Service context from labor.json
    let serviceContext = '';
    try {
      const laborJson = await fs.readFile('data/labor.json', 'utf8');
      const services = JSON.parse(laborJson);
      serviceContext = services.map(s => 
        `Service: ${s.service}, Description: ${s.description}, Price: $${s.price}`
      ).join('\n');
    } catch (error) {
      logger.error(`Failed to load labor.json: ${error.message}`);
      serviceContext = 'No service data available.';
    }

    // Material context with pricing
    const materialContext = materials.slice(0, 30).map(m => {
      const finishedPrice = calculateFinishedPrice(m.material, m.costSqFt);
      const finalPrice = applyWasteFactor(finishedPrice, message || '');
      return `Color: ${m.colorName}, Vendor: ${m.vendorName}, Material: ${m.material}, Thickness: ${m.thickness}, Finished Price/SqFt: $${finalPrice}, Available: ${m.availableSqFt} SqFt`;
    }).join('\n');

    // Image analysis
    let imageAnalysis = '';
    let imageId, imageUrl;
    if (image) {
      const jimpImage = await Jimp.read(image.buffer);
      const { width, height } = jimpImage.bitmap;
      const dominantColor = jimpImage.getPixelColor(0, 0);
      const rgba = Jimp.intToRGBA(dominantColor);

      // Store image in GridFS
      if (!gfs) throw new Error('GridFS not initialized');
      const uploadStream = gfs.openUploadStream(image.originalname, {
        contentType: image.mimetype
      });
      uploadStream.end(image.buffer);
      imageId = await new Promise((resolve, reject) => {
        uploadStream.on('finish', () => resolve(uploadStream.id));
        uploadStream.on('error', reject);
      });
      imageUrl = `/api/image/${imageId}`;

      // OpenAI Vision for material matching
      const imageBase64 = image.buffer.toString('base64');
      const openaiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4-vision-preview',
          messages: [
            {
              role: 'system',
              content: 'Analyze the image for countertop material and color. Suggest a matching material from Surprise Granite’s offerings (granite, marble, quartz, quartzite, Dekton, porcelain). Provide a brief description.'
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Analyze this image for countertop material and color.' },
                { type: 'image_url', image_url: { url: `data:${image.mimetype};base64,${imageBase64}` } }
              ]
            }
          ],
          max_tokens: 100
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      imageAnalysis = openaiResponse.data.choices[0].message.content;
    }

    // System prompt
    const systemMessage = {
      role: 'system',
      content: `You are the Surprise Granite Assistant, an expert representative of Surprise Granite, a premier provider of high-quality granite, marble, quartz, quartzite, Dekton, and porcelain countertops located at ${businessInfo.location}. Your primary goals are lead generation and exceptional customer service. Use a conversational, professional, friendly, and enthusiastic tone to engage users, answer questions accurately, and drive interest in our products and services.

Available Data:
- Materials (finished prices include markup and 5-15% waste factor):\n${materialContext}
- Services:\n${serviceContext}
- Shopify Products:\n${shopifyContext}
- Location: ${businessInfo.location}
- Hours: ${businessInfo.hours}
- Contact: ${businessInfo.contact}
- Website: ${businessInfo.website}
- Process: ${businessInfo.process}

Guidelines:
- Always reference Surprise Granite and highlight our premium materials and services.
- For pricing, provide finished prices (e.g., $X.XX/SqFt, includes 5-15% waste factor based on layout) and suggest contacting for a precise quote.
- Estimate service costs (e.g., fabrication, installation) based on services data, noting estimates are approximate.
- For image uploads, analyze the image for material/color and suggest a matching Surprise Granite material, encouraging a quote.
- Encourage users to visit our showroom, request a quote, or share contact info (e.g., email, name, phone) for follow-up.
- Handle customer service queries (e.g., hours, services, product availability) promptly and accurately.
- If users share an email or express interest, acknowledge it and suggest a follow-up (e.g., “Thanks for sharing! We’ll send a quote.”).
- Avoid medical, legal, or financial advice; redirect off-topic questions to our services or products.
- Keep responses concise (2-3 sentences) and actionable, ending with a call-to-action (e.g., “Visit our showroom!”).
- If unsure, offer to connect with our team or provide contact info.

Example Responses:
- Pricing: “At Surprise Granite, Black Granite from [Vendor] is $X.XX/SqFt (includes 10% waste factor). Request a quote for your project!”
- Services: “We offer countertop fabrication and installation starting at $X.XX. Share your project details for an estimate!”
- Image: “Your image suggests a dark countertop. Try our Black Granite! Upload more details for a quote.”
- Lead: “Interested in granite? Share your email, and we’ll send a personalized quote or schedule a visit!”`
    };

    // Prepare OpenAI messages
    const messages = [systemMessage];
    if (image) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: message || 'Analyze this image for countertop material and suggest a match.' },
          { type: 'image_url', image_url: { url: `data:${image.mimetype};base64,${image.buffer.toString('base64')}` } }
        ]
      });
    } else if (message) {
      messages.push({ role: 'user', content: message });
    }

    // Call OpenAI API
    const openaiResponse = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo', // Fallback to gpt-3.5-turbo
        messages,
        max_tokens: 150,
        temperature: 0.5
      },
      {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  let botResponse = openaiResponse.data.choices[0].message.content;

  // Sanitize output
  botResponse = sanitizeHtml(botResponse, {
    allowedTags: [],
    allowedAttributes: {}
  });

  // Validate output
  const outputValidation = validateInput(botResponse);
  if (!outputValidation.valid) {
    logger.warn(`Invalid output: ${outputValidation.reason}`);
    botResponse = 'Sorry, I couldn’t generate a valid response. Please try again or contact support@surprisegranite.com.';
  }

  // Store lead if email or interest detected
  if (message && (message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/) || message.toLowerCase().includes('quote'))) {
    const emailMatch = message.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
    const projectDetails = estimateServiceCost(message, laborData);
    await Lead.create({
      email: emailMatch ? emailMatch[0] : 'unknown@example.com',
      name: req.body.name || 'Unknown',
      phone: req.body.phone || '',
      message,
      imageAnalysis,
      imageId,
      projectDetails
    });
    // Send to Basin
    const formData = new FormData();
    formData.append('email', emailMatch ? emailMatch[0] : 'unknown@example.com');
    formData.append('message', message);
    formData.append('name', req.body.name || 'Unknown');
    if (imageId) formData.append('image_id', imageId.toString());
    if (projectDetails.details.length) formData.append('project_details', projectDetails.details.join('; '));
    await axios.post('https://usebasin.com/f/0e9742fed801', formData, {
      headers: formData.getHeaders()
    });
  }

  conversationHistory.push({ role: 'assistant', content: botResponse });
  if (conversationHistory.length > 10) {
    conversationHistory = conversationHistory.slice(-10);
  }

  res.json({ message: botResponse, imageId, imageUrl });
} catch (error) {
  logger.error(`Chat error: ${error.message}`);
  res.status(500).json({ error: `Failed to process request: ${error.message}` });
}
});

// Fetch Materials
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
  const materials = await Material.find(query).lean();

  if (!materials.length) {
    const response = await axios.get(process.env.PUBLISHED_CSV_MATERIALS);
    const materialsData = await new Promise((resolve, reject) => {
      const records = [];
      parse(response.data, { columns: true, skip_empty_lines: true })
        .on('data', (record) => records.push(record))
        .on('end', () => resolve(records))
        .on('error', (error) => reject(error));
    });

    const newMaterials = materialsData.map((item) => ({
      colorName: item['Color Name'] || 'Unknown',
      vendorName: item['Vendor Name'] || 'Unknown',
      thickness: item['Thickness'] || 'Unknown',
      material: item['Material'] || 'Unknown',
      costSqFt: parseFloat(item['Cost/SqFt']) || 0,
      availableSqFt: parseFloat(item['Total/SqFt']) || 0,
      imageUrl: item['ImageUrl'] || 'https://via.placeholder.com/50'
    }));

    await Material.deleteMany({});
    await Material.insertMany(newMaterials);
    materials = await Material.find(query).lean();
  }

  const normalizedData = materials.map((item) => ({
    colorName: item.colorName,
    vendorName: item.vendorName,
    thickness: item.thickness,
    material: item.material,
    costSqFt: item.costSqFt,
    finishedPrice: calculateFinishedPrice(item.material, item.costSqFt),
    availableSqFt: item.availableSqFt,
    imageUrl: item.imageUrl
  })).filter((item) => item.colorName && item.material && item.vendorName && item.costSqFt > 0);

  await redis.set(cacheKey, JSON.stringify(normalizedData), 'EX', 3600);
  res.json(normalizedData);
} catch (error) {
  logger.error(`Materials fetch error: ${error.message}`);
  res.status(500).json({ error: `Failed to fetch materials: ${error.message}` });
}
});

// Fetch Labor Costs
app.get('/api/labor', async (req, res) => {
try {
  const cacheKey = 'labor:data';
  const cachedData = await redis.get(cacheKey);
  if (cachedData) {
    return res.json(JSON.parse(cachedData));
  }

  let laborCosts = await Labor.find({}).lean();
  if (!laborCosts.length) {
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
  res.status(500).json({ error: `Failed to fetch labor costs: ${error.message}` });
}
});

// Health Check
app.get('/health', async (req, res) => {
const health = {
  status: 'OK',
  mongodb: 'disconnected',
  redis: 'disconnected',
  openai: 'unknown',
  shopify: 'unknown'
};
try {
  await mongoose.connection.db.admin().ping();
  health.mongodb = 'connected';
} catch (err) {
  health.mongodb = `error: ${err.message}`;
}
try {
  await redis.ping();
  health.redis = 'connected';
} catch (err) {
  health.redis = `error: ${err.message}`;
}
try {
  await axios.get('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
  });
  health.openai = 'connected';
} catch (err) {
  health.openai = `error: ${err.message}`;
}
if (shopify) {
  try {
    await shopify.product.list({ limit: 1 });
    health.shopify = 'connected';
  } catch (err) {
    health.shopify = `error: ${err.message}`;
  }
} else {
  health.shopify = 'not configured';
}
res.status(200).json(health);
});

// Root Route
app.get('/', (req, res) => {
res.status(200).json({ message: 'Surprise Granite API' });
});

// Error Handling
app.use((err, req, res, next) => {
logger.error(`Server error: ${err.stack}`);
res.status(500).json({ error: `Internal server error: ${err.message}` });
});

// Startup validation
async function validateServices() {
try {
  await mongoose.connection.db.admin().ping();
  logger.info('MongoDB connection validated');
} catch (err) {
  logger.error(`MongoDB validation failed: ${err.message}`);
  process.exit(1);
}
try {
  await redis.ping();
  logger.info('Redis connection validated');
} catch (err) {
  logger.error(`Redis validation failed: ${err.message}`);
}
try {
  await axios.get(process.env.PUBLISHED_CSV_MATERIALS);
  await axios.get(process.env.PUBLISHED_CSV_LABOR);
  logger.info('CSV URLs validated');
} catch (err) {
  logger.error(`CSV validation failed: ${err.message}`);
  process.exit(1);
}
try {
  await axios.get('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
  });
  logger.info('OpenAI API validated');
} catch (err) {
  logger.error(`OpenAI validation failed: ${err.message}`);
  process.exit(1);
}
if (shopify) {
  try {
    await shopify.product.list({ limit: 1 });
    logger.info('Shopify API validated');
  } catch (err) {
    logger.error(`Shopify validation failed: ${err.message}`);
  }
}
}

mongoose
.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
.then(() => {
  logger.info('MongoDB connected');
  validateServices();
})
.catch((err) => {
  logger.error(`MongoDB connection error: ${err.message}`);
  process.exit(1);
});

// Start Server
app.listen(port, () => logger.info(`Server running on port ${port}`));
