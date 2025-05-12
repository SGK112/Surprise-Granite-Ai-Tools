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
const port = process.env.PORT || 10000;

// Validate required environment variables
const requiredEnv = ['MONGODB_URI', 'PUBLISHED_CSV_MATERIALS', 'OPENAI_API_KEY'];
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

// Cache for material context
let cachedMaterialContext = null;

// Calculate finished pricing
const calculateFinishedPrice = (material, cost) => {
  const materialType = material.toLowerCase();
  let additionalCost = 0;
  if (['granite', 'quartz'].includes(materialType)) {
    additionalCost = 25;
  } else if (['quartzite', 'marble'].includes(materialType)) {
    additionalCost = 35;
  } else if (['dekton', 'porcelain'].includes(materialType)) {
    additionalCost = 45;
  } else {
    additionalCost = 25; // Default for unknown materials
  }
  // Apply markup: cost * 3.25 + additional cost
  const basePrice = cost * 3.25 + additionalCost;
  // Apply waste factor (default 10%, range 5%-15%)
  const wasteFactor = 0.10; // Adjust dynamically if user specifies complexity
  const finalPrice = basePrice * (1 + wasteFactor);
  return finalPrice.toFixed(2); // Round to 2 decimal places
};

// Chatbot Endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    logger.info(`Chat request received: ${message}`);
    if (!message) {
      logger.warn('No message provided in chat request');
      return res.status(400).json({ error: 'Message is required' });
    }

    // Fetch or use cached material context
    logger.info('Preparing material context');
    if (!cachedMaterialContext) {
      const materials = await Material.find({}).lean();
      logger.info(`Fetched ${materials.length} materials`);
      // Group by vendor to ensure all vendors are represented
      const vendors = [...new Set(materials.map(m => m.vendorName))];
      logger.info(`Found ${vendors.length} unique vendors: ${vendors.join(', ')}`);
      const limitedMaterials = vendors.flatMap(vendor => 
        materials.filter(m => m.vendorName === vendor).slice(0, 3) // 3 materials per vendor
      ).slice(0, 30); // Max 30 materials total
      cachedMaterialContext = limitedMaterials.map(m => {
        const finalPrice = calculateFinishedPrice(m.material, m.costSqFt);
        return `Color: ${m.colorName}, Vendor: ${m.vendorName}, Material: ${m.material}, Thickness: ${m.thickness}, Finished Price: $${finalPrice}/SqFt (includes 10% waste), Available: ${m.availableSqFt} SqFt`;
      }).join('\n');
      logger.info(`Cached material context with ${limitedMaterials.length} materials`);
    }

    // Branded system message
    const systemMessage = {
      role: 'system',
      content: `You are the Surprise Granite Assistant, an expert representative of Surprise Granite, a leading provider of premium granite, marble, quartz, quartzite, dekton, and porcelain for countertops and home projects. Your tone is professional, friendly, and enthusiastic. Use the following material data to answer questions accurately, including finished prices (markup: cost * 3.25 + $25 for granite/quartz, $35 for quartzite/marble, $45 for dekton/porcelain, plus 10% waste):\n${cachedMaterialContext}\nAlways reference Surprise Granite, provide concise answers with prices in $XX.XX/SqFt format, and encourage users to contact us (602) 833-3189 or info@surprisegranite.com for a personalized quote or visit our showroom located at 11560 n dysart rd. Surprise Az, 85379. Avoid generic AI responses and focus on our materials from multiple vendors. If a specific vendor or material is mentioned, prioritize that.`
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
        model: 'gpt-3.5-turbo', // Fallback to gpt-3.5-turbo
        messages: [systemMessage, ...conversationHistory],
        max_tokens: 100,
        temperature: 0.7,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const botResponse = response.data.choices[0].message.content;
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
      finishedPrice: calculateFinishedPrice(item.material, item.costSqFt),
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
