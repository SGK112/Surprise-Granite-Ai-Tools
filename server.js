import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import winston from 'winston';
import axios from 'axios';
import { parse } from 'csv-parse';
import fs from 'fs/promises';
import Shopify from 'shopify-api-node';

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
const requiredEnv = ['MONGODB_URI', 'PUBLISHED_CSV_MATERIALS', 'OPENAI_API_KEY', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'SHOPIFY_STORE_DOMAIN'];
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
  imageData: { type: Buffer, default: null },
  imageHash: { type: String, default: null },
  metadata: { type: Object, default: {} },
  createdAt: { type: Date, default: Date.now }
});

const Material = mongoose.model('Material', materialSchema);

// Store conversation history for chatbot
let conversationHistory = [];

// Cache for material and service context
let cachedMaterialContext = null;
let cachedServiceContext = null;

// Shopify API setup
const shopify = new Shopify({
  shopName: process.env.SHOPIFY_STORE_DOMAIN,
  apiKey: process.env.SHOPIFY_API_KEY,
  password: process.env.SHOPIFY_API_SECRET
});

// Location and hours
const locationHours = {
  address: '11560 N Dysart Rd. Suite 112, Surprise, AZ 85379',
  hours: {
    Monday: '9:00 AM - 5:00 PM',
    Tuesday: '9:00 AM - 5:00 PM',
    Wednesday: '9:00 AM - 5:00 PM',
    Thursday: '9:00 AM - 5:00 PM',
    Friday: '9:00 AM - 5:00 PM',
    Saturday: '10:00 AM - 2:00 PM',
    Sunday: 'Closed'
  }
};

// Guardrails: Content filtering
const harmfulPatterns = [
  /\b(hate|insult|offensive|profane|toxic)\b/i,
  /\b(medical|legal|financial)\s+advice\b/i,
  /prompt\s+injection|jailbreak/i,
  /\b(pii|personal\s+information)\b/i
];

function validateInput(message) {
  for (const pattern of harmfulPatterns) {
    if (pattern.test(message)) {
      return { valid: false, reason: 'Input contains restricted content' };
    }
  }
  return { valid: true };
}

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

// Apply waste factor
function applyWasteFactor(price, message) {
  let wasteFactor = 0.10; // Default 10%
  if (message.toLowerCase().includes('complex') || message.toLowerCase().includes('intricate')) {
    wasteFactor = 0.15; // 15% for complex layouts
  } else if (message.toLowerCase().includes('simple') || message.toLowerCase().includes('basic')) {
    wasteFactor = 0.05; // 5% for simple layouts
  }
  return price * (1 + wasteFactor);
}

// Chatbot Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    logger.info(`Chat request received: ${message}`);
    if (!message) {
      logger.warn('No message provided in chat request');
      return res.status(400).json({ error: 'Message is required' });
    }

    // Apply guardrails
    const validation = validateInput(message);
    if (!validation.valid) {
      logger.warn(`Invalid input: ${validation.reason}`);
      return res.status(400).json({ error: 'Sorry, your message contains restricted content. Please rephrase.' });
    }

    // Fetch or use cached material context
    logger.info('Preparing material context');
    if (!cachedMaterialContext) {
      const materials = await Material.find({}).lean();
      logger.info(`Fetched ${materials.length} materials`);
      const vendors = [...new Set(materials.map(m => m.vendorName))];
      logger.info(`Found ${vendors.length} unique vendors: ${vendors.join(', ')}`);
      const limitedMaterials = vendors.flatMap(vendor => 
        materials.filter(m => m.vendorName === vendor).slice(0, 3)
      ).slice(0, 30);
      cachedMaterialContext = limitedMaterials.map(m => {
        const finishedPrice = calculateFinishedPrice(m.material, m.costSqFt);
        const finalPrice = applyWasteFactor(finishedPrice, message).toFixed(2);
        return `Color: ${m.colorName}, Vendor: ${m.vendorName}, Material: ${m.material}, Thickness: ${m.thickness}, Finished Price/SqFt: $${finalPrice}, Available: ${m.availableSqFt} SqFt`;
      }).join('\n');
      logger.info(`Cached material context with ${limitedMaterials.length} materials`);
    }

    // Fetch or use cached service context
    if (!cachedServiceContext) {
      try {
        const laborData = await fs.readFile('data/labor.json', 'utf8');
        const services = JSON.parse(laborData);
        cachedServiceContext = services.map(s => 
          `Service: ${s.service}, Description: ${s.description}, Price: $${s.price}`
        ).join('\n');
        logger.info('Cached service context from labor.json');
      } catch (error) {
        logger.error(`Failed to load labor.json: ${error.message}`);
        cachedServiceContext = 'No service data available.';
      }
    }

    // Fetch Shopify product data
    let shopifyContext = '';
    try {
      const products = await shopify.product.list({ limit: 10 });
      shopifyContext = products.map(p => 
        `Product: ${p.title}, Price: $${p.variants[0].price}, Inventory: ${p.variants[0].inventory_quantity}`
      ).join('\n');
      logger.info('Fetched Shopify product data');
    } catch (error) {
      logger.error(`Shopify API error: ${error.message}`);
      shopifyContext = 'No Shopify product data available.';
    }

    // Branded system message
    const systemMessage = {
      role: 'system',
      content: `You are the Surprise Granite Assistant, an expert representative of Surprise Granite, a premier provider of high-quality granite, marble, and other materials for countertops and home projects. Your primary goals are lead generation and exceptional customer service. Use a professional, friendly, and enthusiastic tone to engage users, answer questions accurately, and drive interest in our products and services.

Available Data:
- Materials (finished prices include markup and 5-15% waste factor):\n${cachedMaterialContext}
- Services:\n${cachedServiceContext}
- Shopify Products:\n${shopifyContext}
- Location: ${locationHours.address}
- Hours: Mon-Fri 9:00 AM-5:00 PM, Sat 10:00 AM-2:00 PM, Sun Closed

Guidelines:
- Always reference Surprise Granite and highlight our premium offerings.
- For pricing questions, provide finished prices, note the waste factor (5-15% based on layout), and suggest contacting us for a precise quote.
- Encourage users to visit our showroom at ${locationHours.address}, request a quote, or share contact info (e.g., email) for follow-up.
- Handle customer service queries (e.g., hours, services, product availability) promptly and accurately.
- Offer to connect users with our team for complex questions or to schedule a consultation.
- Avoid medical, legal, or financial advice, and redirect off-topic questions to Surprise Granite’s services or products.
- Keep responses concise (2-3 sentences) and actionable, ending with a call to action (e.g., “Visit our showroom!” or “Request a quote today!”).
- If a user provides an email or expresses interest, acknowledge it and suggest a follow-up (e.g., “Thanks for sharing! We’ll contact you with a quote.”).

Example Responses:
- Pricing: “At Surprise Granite, our Black Granite from [Vendor] has a finished price of $X.XX/SqFt (includes 10% waste factor). Contact us for a custom quote!”
- Hours: “We’re open Mon-Fri 9:00 AM-5:00 PM, Sat 10:00 AM-2:00 PM, closed Sun. Visit us at ${locationHours.address}!”
- Lead: “Interested in granite? Share your email, and we’ll send a personalized quote or schedule a showroom visit!”`
    };

    // Add user message to history
    conversationHistory.push({ role: 'user', content: message });

    // Limit history to avoid excessive token usage
    if (conversationHistory.length > 10) {
      conversationHistory = conversationHistory.slice(-10);
    }

    // Call OpenAI API
    logger.info('Sending request to OpenAI API');
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo', // Switch to 'gpt-4' if accessible
        messages: [systemMessage, ...conversationHistory],
        max_tokens: 100,
        temperature: 0.5, // Lower for consistency
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const botResponse = response.data.choices[0].message.content;
    // Validate output
    const outputValidation = validateInput(botResponse);
    if (!outputValidation.valid) {
      logger.warn(`Invalid output: ${outputValidation.reason}`);
      return res.status(500).json({ error: 'Sorry, the response contains restricted content. Please try again.' });
    }

    conversationHistory.push({ role: 'assistant', content: botResponse });

    logger.info(`Chatbot response: ${botResponse}`);
    res.json({ message: botResponse });
  } catch (error) {
    logger.error('Chat endpoint error:', {
      message: error.message,
      stack: error.stack,
      response: error.response ? error.response.data : null,
      code: error.code
    });
    res.status(500).json({ error: 'Failed to process chat request', details: error.message });
  }
});

// Fetch Materials from MongoDB with CSV fallback
app.get('/api/materials', async (req, res) => {
  try {
    logger.info('Fetching materials from MongoDB');
    let materials = await Material.find({}).lean();
    
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
      logger.info(`Saved ${materials.length} materials from CSV to MongoDB`);
    }

    const normalizedData = materials.map((item) => ({
      colorName: item.colorName,
      vendorName: item.vendorName,
      thickness: item.thickness,
      material: item.material,
      costSqFt: item.costSqFt,
      finishedPrice: applyWasteFactor(calculateFinishedPrice(item.material, item.costSqFt), '').toFixed(2),
      availableSqFt: item.availableSqFt,
      imageUrl: item.imageData ? `/api/materials/${item._id}/image` : item.imageUrl
    })).filter((item) => item.colorName && item.material && item.vendorName && item.costSqFt > 0);

    if (normalizedData.length === 0) {
      logger.error('No valid materials data after filtering');
      return res.status(404).json({ error: 'No valid materials data available' });
    }

    logger.info(`Materials fetched successfully: ${normalizedData.length} items`);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials data', details: error.message });
  }
});

// Serve Material Image
app.get('/api/materials/:id/image', async (req, res) => {
  try {
    logger.info(`Fetching image for material ID: ${req.params.id}`);
    const material = await Material.findById(req.params.id).select('imageData metadata.mimeType');
    if (!material) {
      logger.warn(`Material not found for ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Material not found' });
    }
    if (!material.imageData) {
      logger.warn(`No image data for material ID: ${req.params.id}`);
      return res.status(404).json({ error: 'Image data not found' });
    }
    res.set('Content-Type', material.metadata.mimeType || 'image/jpeg');
    res.send(material.imageData);
  } catch (error) {
    logger.error(`Image fetch error for ID ${req.params.id}: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch image', details: error.message });
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
