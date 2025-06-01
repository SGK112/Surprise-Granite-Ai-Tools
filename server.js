require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const NodeCache = require('node-cache');
const { parse } = require('csv-parse/sync');
const path = require('path');
const nodemailer = require('nodemailer');
const winston = require('winston');

// Initialize App
const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 1800 });

// Logger Setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Enable Trust Proxy
app.set('trust proxy', 1);

// Validate Environment Variables
const REQUIRED_ENV_VARS = [
  'MONGO_URI',
  'GOOGLE_SHEET_CSV_URL',
  'PUBLISHED_CSV_LABOR',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_SHOP',
  'OPENAI_API_KEY',
  'EMAIL_USER',
  'EMAIL_PASS',
];
REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000
  })
  .then(() => logger.info('MongoDB connected!'))
  .catch((err) => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Define Schemas
const Countertop = mongoose.model(
  'Countertop',
  new mongoose.Schema({
    material: String,
    thickness: String,
    price_per_sqft: Number,
    image_url: String,
  })
);

const ChatLog = mongoose.model(
  'ChatLog',
  new mongoose.Schema(
    {
      sessionId: String,
      messages: [{ role: String, content: String, createdAt: { type: Date, default: Date.now } }],
      appointmentRequested: Boolean,
      bids: [{
        layout: String,
        dimensions: [{ length: Number, width: Number }],
        material: String,
        wasteFactor: Number,
        fabricationCost: Number,
        installationCost: Number,
        materialCost: Number,
        totalCost: Number,
        margin: Number,
        createdAt: { type: Date, default: Date.now }
      }],
      feedback: [{ question: String, response: String, createdAt: { type: Date, default: Date.now } }],
      abandoned: { type: Boolean, default: false },
      lastActivity: { type: Date, default: Date.now },
      estimateContext: {
        step: String,
        layout: String,
        dimensions: [{ length: Number, width: Number }],
        material: String
      }
    },
    { timestamps: true }
  )
);

// Nodemailer Setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send Chat Transcript
async function sendChatTranscript(chatLog) {
  const messages = chatLog.messages.map(msg => `${msg.role.toUpperCase()} (${msg.createdAt.toLocaleString()}): ${msg.content}`).join('\n');
  const bids = chatLog.bids?.map(bid => 
    `Bid (${bid.createdAt.toLocaleString()}):\n` +
    `- Layout: ${bid.layout}\n` +
    `- Dimensions: ${bid.dimensions.map(d => `${d.length}x${d.width} ft`).join(', ')}\n` +
    `- Material: ${bid.material}\n` +
    `- Waste Factor: ${(bid.wasteFactor * 100).toFixed(0)}%\n` +
    `- Material Cost: $${bid.materialCost.toFixed(2)}\n` +
    `- Fabrication: $${bid.fabricationCost.toFixed(2)}\n` +
    `- Installation: $${bid.installationCost.toFixed(2)}\n` +
    `- Total: $${bid.totalCost.toFixed(2)}\n` +
    `- Margin: ${(bid.margin * 100).toFixed(0)}%`
  ).join('\n\n') || 'No bids';
  const feedback = chatLog.feedback?.map(fb => 
    `Feedback (${fb.createdAt.toLocaleString()}): ${fb.question} -> ${fb.response}`
  ).join('\n') || 'No feedback';

  const emailContent = `
Chat Transcript (Session ID: ${chatLog.sessionId})
Status: ${chatLog.abandoned ? 'Abandoned' : 'Closed'}
Last Activity: ${chatLog.lastActivity.toLocaleString()}
Appointment Requested: ${chatLog.appointmentRequested ? 'Yes' : 'No'}

Messages:
${messages}

Bids:
${bids}

Feedback:
${feedback}
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'info@surprisegranite.com',
      subject: `Chat Transcript ${chatLog.sessionId} (${chatLog.abandoned ? 'Abandoned' : 'Closed'})`,
      text: emailContent,
    });
    logger.info(`Transcript sent for session ${chatLog.sessionId}`);
  } catch (error) {
    logger.error(`Failed to send transcript for session ${chatLog.sessionId}: ${error.message}`);
  }
}

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
}));

// Serve Static Files
app.use(express.static(path.join(__dirname, 'public')));

// Shopify API Functionality
async function fetchShopifyProducts(category = null, material = null) {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-10/products.json`;
  try {
    const response = await axios.get(url, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      },
      timeout: 10000,
    });
    let products = response.data.products;
    if (category) {
      products = products.filter(p => p.tags.toLowerCase().includes(category.toLowerCase()));
    }
    if (material) {
      products = products.filter(p => p.title.toLowerCase().includes(material.toLowerCase()));
    }
    logger.info(`Shopify products fetched: ${products.length}`);
    return products;
  } catch (error) {
    logger.error(`Shopify API error: ${error.message}`);
    throw error;
  }
}

// Fetch CSV Data
async function fetchCsvData(url, cacheKey) {
  let data = cache.get(cacheKey);
  if (data) {
    logger.info(`Cache hit for ${cacheKey}, ${data.length} rows`);
    return data;
  }
  try {
    logger.info(`Fetching CSV from ${url}`);
    const response = await axios.get(url, { timeout: 10000 });
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: Failed to fetch CSV from ${url}`);
    }
    if (!response.data || typeof response.data !== 'string') {
      throw new Error(`Invalid CSV data from ${url}`);
    }
    data = parse(response.data, { columns: true, skip_empty_lines: true, trim: true });
    if (!data || data.length === 0) {
      throw new Error(`Empty or invalid CSV from ${url}`);
    }
    logger.info(`Parsed CSV from ${url}, ${data.length} rows`);
    cache.set(cacheKey, data);
    return data;
  } catch (error) {
    logger.error(`Error fetching/parsing CSV (${cacheKey}): ${error.message}`);
    cache.del(cacheKey);
    throw error;
  }
}

// Fuzzy Matching
function fuzzyMatch(str, pattern) {
  if (!str || !pattern) return false;
  const cleanStr = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanStr.includes(cleanPattern) || cleanPattern.includes(cleanStr) || cleanStr.indexOf(cleanPattern) !== -1;
}

// Extract Dimensions
function extractDimensions(message) {
  const dimensionRegex = /(\d+\.?\d*)\s*(x|by|\*)\s*(\d+\.?\d*)\s*(ft|feet)?/gi;
  const matches = [...message.matchAll(dimensionRegex)];
  return matches.map(match => ({
    length: parseFloat(match[1]),
    width: parseFloat(match[3]),
    area: parseFloat(match[1]) * parseFloat(match[3])
  }));
}

// Match Labor Cost
function getLaborCostPerSqft(laborData, materialType) {
  const materialLower = materialType.toLowerCase();
  const laborItem = laborData.find((item) => {
    const description = item[Object.keys(item)[1]] || '';
    return description.toLowerCase().includes(materialLower);
  });
  if (laborItem) {
    const cost = parseFloat(laborItem[Object.keys(laborItem)[3]]);
    if (!isNaN(cost)) {
      logger.info(`Labor cost for ${materialType}: $${cost}/sqft`);
      return cost;
    }
  }
  logger.info(`No labor cost found for ${materialType}, using default $65/sqft`);
  return 65;
}

// Vendor Data
async function getVendorData() {
  try {
    const shopifyProducts = await fetchShopifyProducts();
    const csvMaterials = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');

    const vendors = {
      'arizona tile': {
        materials: {
          Granite: { count: 0, examples: [] },
          Quartz: { count: 0, examples: [] },
          Marble: { count: 0, examples: [] },
          Quartzite: { count: 0, examples: [] },
          Porcelain: { count: 0, examples: [] }
        },
        description: 'Arizona Tile supplies premium countertops, including Granite, Quartz, Marble, Quartzite, and Porcelain, sourced globally for quality and durability.'
      },
      'kibi usa': {
        materials: {
          'Kitchen Sinks': { count: 0, examples: [] },
          'Quartz Composite Sinks': { count: 0, examples: [] },
          'Stainless Steel Sinks': { count: 0, examples: [] },
          'Fireclay Sinks': { count: 0, examples: [] },
          'Matte Stone Sinks': { count: 0, examples: [] },
          'Kitchen Faucets': { count: 0, examples: [] },
          'Pull Down Faucets': { count: 0, examples: [] },
          'Filtration Faucets': { count: 0, examples: [] },
          'Pot Fillers': { count: 0, examples: [] },
          'Bathroom Faucets': { count: 0, examples: [] },
          'Shower Heads': { count: 0, examples: [] },
          'Shower Valves': { count: 0, examples: [] },
          'Shower Jets': { count: 0, examples: [] },
          'Soap Dispensers': { count: 0, examples: [] },
          'Sink Strainers': { count: 0, examples: [] },
          'Drain Trays': { count: 0, examples: [] },
          'Bathroom Organization': { count: 0, examples: [] },
          'Hardware': { count: 0, examples: [] },
          'Shelves': { count: 0, examples: [] },
          'Bathtubs': { count: 0, examples: [] }
        },
        description: 'Kibi USA provides luxury kitchen and bath fixtures, including sinks, faucets, shower systems, bathtubs, and accessories, designed for affordability and functionality.'
      }
    };

    // Populate Arizona Tile from CSV
    csvMaterials.forEach(item => {
      const materialName = item['Color Name'] || '';
      const materialType = item['Material'] || 'Unknown';
      if (materialName) {
        const materialKey = materialType.charAt(0).toUpperCase() + materialType.slice(1).toLowerCase();
        if (vendors['arizona tile'].materials[materialKey]) {
          vendors['arizona tile'].materials[materialKey].count++;
          if (vendors['arizona tile'].materials[materialKey].examples.length < 3) {
            vendors['arizona tile'].materials[materialKey].examples.push(materialName);
          }
        }
      }
    });

    // Populate Kibi USA from Shopify
    shopifyProducts.forEach(product => {
      const title = product.title.toLowerCase();
      const vendor = product.vendor?.toLowerCase() || '';
      const productUrl = product.online_store_url || `https://${process.env.SHOPIFY_SHOP}/products/${product.handle}`;
      if (vendor.includes('kibi') || title.includes('kibi')) {
        const categories = [
          { key: 'Kitchen Sinks', terms: ['sink', 'kitchen sink'] },
          { key: 'Quartz Composite Sinks', terms: ['quartz composite', 'composite sink'] },
          { key: 'Stainless Steel Sinks', terms: ['stainless steel', 'steel sink'] },
          { key: 'Fireclay Sinks', terms: ['fireclay', 'fireclay sink'] },
          { key: 'Matte Stone Sinks', terms: ['matte stone', 'stone sink'] },
          { key: 'Kitchen Faucets', terms: ['faucet', 'kitchen faucet'] },
          { key: 'Pull Down Faucets', terms: ['pull down', 'pull-down'] },
          { key: 'Filtration Faucets', terms: ['filtration', 'filter faucet'] },
          { key: 'Pot Fillers', terms: ['pot filler'] },
          { key: 'Bathroom Faucets', terms: ['bathroom faucet', 'bath faucet'] },
          { key: 'Shower Heads', terms: ['shower head'] },
          { key: 'Shower Valves', terms: ['shower valve'] },
          { key: 'Shower Jets', terms: ['shower jet'] },
          { key: 'Soap Dispensers', terms: ['soap dispenser'] },
          { key: 'Sink Strainers', terms: ['sink strainer', 'strainer'] },
          { key: 'Drain Trays', terms: ['drain tray'] },
          { key: 'Bathroom Organization', terms: ['bathroom organization', 'organizer'] },
          { key: 'Hardware', terms: ['hardware', 'bathroom hardware'] },
          { key: 'Shelves', terms: ['shelf', 'shelves'] },
          { key: 'Bathtubs', terms: ['bathtub', 'bath tub'] }
        ];

        categories.forEach(category => {
          if (category.terms.some(term => title.includes(term))) {
            vendors['kibi usa'].materials[category.key].count++;
            if (vendors['kibi usa'].materials[category.key].examples.length < 3) {
              vendors['kibi usa'].materials[category.key].examples.push({ name: product.title, url: productUrl });
            }
          }
        });
      }
    });

    cache.set('vendorData', vendors, 3600);
    return vendors;
  } catch (error) {
    logger.error(`Error fetching vendor data: ${error.message}`);
    return {
      'arizona tile': {
        materials: {
          Granite: { count: 70, examples: ['Silver Cloud Satin', 'Volcano', 'Alpine White'] },
          Quartz: { count: 60, examples: ['Arabescato Como', 'Montenegro', 'Calacatta Doria'] },
          Marble: { count: 50, examples: ['Calacatta', 'Carrara', 'Statuario'] },
          Quartzite: { count: 40, examples: ['Taj Mahal', 'Azul Macaubas', 'Super White'] },
          Porcelain: { count: 30, examples: ['Porcelain Slab', 'Neolith', 'Dekton'] }
        },
        description: 'Arizona Tile supplies premium countertops.'
      },
      'kibi usa': {
        materials: {
          'Kitchen Sinks': { count: 50, examples: [{ name: '30" Workstation Sink', url: 'https://store.surprisegranite.com' }] },
          'Quartz Composite Sinks': { count: 20, examples: [{ name: 'Quartz Composite Undermount', url: 'https://store.surprisegranite.com' }] },
          'Stainless Steel Sinks': { count: 30, examples: [{ name: '16-Gauge Stainless Sink', url: 'https://store.surprisegranite.com' }] },
          'Fireclay Sinks': { count: 15, examples: [{ name: 'Fireclay Farmhouse Sink', url: 'https://store.surprisegranite.com' }] },
          'Matte Stone Sinks': { count: 10, examples: [{ name: 'Matte Stone Single Bowl', url: 'https://store.surprisegranite.com' }] },
          'Kitchen Faucets': { count: 30, examples: [{ name: 'Artis Brushed Gold', url: 'https://store.surprisegranite.com' }] },
          'Pull Down Faucets': { count: 20, examples: [{ name: 'Pull Down Matte Black', url: 'https://store.surprisegranite.com' }] },
          'Filtration Faucets': { count: 10, examples: [{ name: 'Filtration Chrome', url: 'https://store.surprisegranite.com' }] },
          'Pot Fillers': { count: 5, examples: [{ name: 'Pot Filler Stainless', url: 'https://store.surprisegranite.com' }] },
          'Bathroom Faucets': { count: 25, examples: [{ name: 'Cube Widespread', url: 'https://store.surprisegranite.com' }] },
          'Shower Heads': { count: 20, examples: [{ name: 'Kibi Rain Shower Head', url: 'https://store.surprisegranite.com' }] },
          'Shower Valves': { count: 15, examples: [{ name: 'Thermostatic Valve', url: 'https://store.surprisegranite.com' }] },
          'Shower Jets': { count: 10, examples: [{ name: 'Body Spray Jet', url: 'https://store.surprisegranite.com' }] },
          'Soap Dispensers': { count: 10, examples: [{ name: 'Soap Dispenser Chrome', url: 'https://store.surprisegranite.com' }] },
          'Sink Strainers': { count: 15, examples: [{ name: 'Stainless Strainer', url: 'https://store.surprisegranite.com' }] },
          'Drain Trays': { count: 5, examples: [{ name: 'Drain Tray Black', url: 'https://store.surprisegranite.com' }] },
          'Bathroom Organization': { count: 20, examples: [{ name: 'Towel Rack', url: 'https://store.surprisegranite.com' }] },
          'Hardware': { count: 15, examples: [{ name: 'Cabinet Knob', url: 'https://store.surprisegranite.com' }] },
          'Shelves': { count: 10, examples: [{ name: 'Floating Shelf', url: 'https://store.surprisegranite.com' }] },
          'Bathtubs': { count: 8, examples: [{ name: 'Freestanding Bathtub', url: 'https://store.surprisegranite.com' }] }
        },
        description: 'Kibi USA provides luxury kitchen and bath fixtures.'
      }
    };
  }
}

// Navigation Links
const NAV_LINKS = {
  samples: 'https://store.surprisegranite.com/collections/countertop-samples',
  vendors: 'https://www.surprisegranite.com/company/vendors-list',
  visualizer: 'https://www.surprisegranite.com/tools/virtual-kitchen-design-tool',
  countertops: 'https://www.surprisegranite.com/materials/all-countertops',
  store: 'https://store.surprisegranite.com/',
  sinks: 'https://store.surprisegranite.com/collections/sinks',
  faucets: 'https://store.surprisegranite.com/collections/faucets',
  bathroom: 'https://store.surprisegranite.com/collections/bathroom',
  shower: 'https://store.surprisegranite.com/collections/shower'
};

// Design Tips
const DESIGN_TIPS = {
  kitchen: 'Pair light Quartz countertops with stainless steel sinks for a modern look. Use pull-down faucets for easy cleanup. Consider a waterfall edge for elegance.',
  bathroom: 'Marble countertops add luxury, while matte stone sinks create a spa-like feel. Install rainfall shower heads and organize with floating shelves.',
  material: 'Granite is durable for high-traffic kitchens, Quartz offers low maintenance, and Porcelain is ideal for sleek, modern designs. Match materials to your lifestyle!'
};

// Materials Endpoint
app.get('/api/materials', async (req, res) => {
  try {
    const csvMaterials = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
    const materials = csvMaterials.map(item => ({
      name: item['Color Name'],
      type: item['Material'],
      thickness: item['Thickness'],
      price_per_sqft: parseFloat(item['Cost/SqFt']) || 0,
      image_url: item['image_url'] || null
    })).filter(m => m.name && m.price_per_sqft > 0);
    res.json(materials);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials.' });
  }
});

// Shopify Products Endpoint
app.get('/api/shopify-products', async (req, res) => {
  try {
    const { category, material } = req.query;
    const products = await fetchShopifyProducts(category, material);
    const formattedProducts = products.map(product => ({
      id: product.id,
      title: product.title,
      vendor: product.vendor,
      price: parseFloat(product.variants[0]?.price) || 0,
      url: product.online_store_url || `https://${process.env.SHOPIFY_SHOP}/products/${product.handle}`,
      image: product.image?.src || null,
      description: product.body_html ? product.body_html.replace(/<[^>]+>/g, '').substring(0, 100) + '...' : 'No description available.',
      inStock: product.variants[0]?.inventory_quantity > 0,
      tags: product.tags.split(',').map(tag => tag.trim())
    }));
    res.json(formattedProducts);
  } catch (error) {
    logger.error(`Shopify products fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch Shopify products.' });
  }
});

// Design Tips Endpoint
app.get('/api/design-tips', async (req, res) => {
  try {
    const { category } = req.query;
    const tips = DESIGN_TIPS[category.toLowerCase()] || 'Consider coordinating colors and textures for a cohesive look. Visit our store for inspiration!';
    res.json({ tips });
  } catch (error) {
    logger.error(`Design tips error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch design tips.' });
  }
});

// Appointment Endpoint
app.post('/api/appointment', async (req, res) => {
  const { name, email, date, sessionId } = req.body;
  if (!name || !email || !date) {
    return res.status(400).json({ error: 'Name, email, and date are required.' });
  }

  try {
    let chatLog = await ChatLog.findOne({ sessionId });
    if (!chatLog) {
      chatLog = new ChatLog({ sessionId, messages: [] });
    }
    chatLog.appointmentRequested = true;
    chatLog.messages.push({
      role: 'system',
      content: `Appointment requested: ${name}, ${email}, ${date}`,
    });
    chatLog.lastActivity = new Date();
    await chatLog.save();

    await axios.post('https://usebasin.com/f/0e1679dd8d79', {
      name,
      email,
      date,
    });

    const responseMessage = `Appointment booked for ${name} on ${date}! We'll confirm via email.`;
    chatLog.messages.push({
      role: 'assistant',
      content: responseMessage,
    });
    await chatLog.save();

    res.json({ message: responseMessage });
  } catch (error) {
    logger.error(`Appointment error: ${error.message}`);
    res.status(500).json({ error: 'Failed to book appointment. Please try again.' });
  }
});

// Chat Logs Endpoint
app.get('/api/chatlogs', async (req, res) => {
  try {
    const { sessionId } = req.query;
    const query = sessionId ? { sessionId } : {};
    const logs = await ChatLog.find(query).limit(100).sort({ updatedAt: -1 });
    res.json(logs);
  } catch (error) {
    logger.error(`Chat logs error: ${error.message}`);
    res.status(500).json({ error: 'Failed to retrieve chat logs.' });
  }
});

// Close Chat Endpoint
app.post('/api/close-chat', async (req, res) => {
  const { sessionId, abandoned } = req.body;
  try {
    const chatLog = await ChatLog.findOne({ sessionId });
    if (chatLog) {
      chatLog.abandoned = abandoned || false;
      chatLog.lastActivity = new Date();
      await chatLog.save();
      await sendChatTranscript(chatLog);
      res.json({ message: 'Chat closed and transcript sent.' });
    } else {
      res.status(404).json({ error: 'Chat session not found.' });
    }
  } catch (error) {
    logger.error(`Close chat error: ${error.message}`);
    res.status(500).json({ error: 'Failed to close chat.' });
  }
});

// Estimate Endpoint
app.post('/api/estimate', async (req, res) => {
  const { layout, dimensions, material, sessionId } = req.body;
  if (!layout || !dimensions || !material || !sessionId) {
    return res.status(400).json({ error: 'Layout, dimensions, material, and sessionId are required.' });
  }

  try {
    let chatLog = await ChatLog.findOne({ sessionId });
    if (!chatLog) {
      chatLog = new ChatLog({ sessionId, messages: [] });
    }

    const priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
    const matchedMaterial = priceList.find(item => fuzzyMatch(item['Color Name'], material));

    if (!matchedMaterial) {
      const responseMessage = `Material "${material}" not found. Please select a valid material from our <a href="https://store.surprisegranite.com/collections/countertops" target="_blank">countertop collection</a>.`;
      chatLog.messages.push(
        { role: 'user', content: `Estimate request: ${layout}, ${JSON.stringify(dimensions)}, ${material}` },
        { role: 'assistant', content: responseMessage }
      );
      await chatLog.save();
      return res.json({ message: responseMessage, quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment'] });
    }

    const totalArea = dimensions.reduce((sum, dim) => sum + (dim.length * dim.width), 0);
    let wasteFactor = 0.20;
    if (material.toLowerCase().includes('waterfall')) wasteFactor = 0.30;
    if (material.toLowerCase().includes('backsplash') && material.toLowerCase().includes('full')) wasteFactor = 0.25;
    if (material.toLowerCase().includes('vanity') || material.toLowerCase().includes('small')) wasteFactor = 0.35;

    const adjustedArea = totalArea * (1 + wasteFactor);
    const materialPrice = parseFloat(matchedMaterial['Cost/SqFt']) || 0;
    const materialType = matchedMaterial['Material'] || 'unknown';
    const materialCost = adjustedArea * materialPrice * 1.04;
    let laborCostPerSqft = 65;
    try {
      const laborData = await fetchCsvData(process.env.PUBLISHED_CSV_LABOR, 'labor_costs');
      laborCostPerSqft = getLaborCostPerSqft(laborData, materialType);
    } catch (error) {
      logger.error(`Failed to fetch labor costs: ${error.message}`);
    }
    const fabricationCost = totalArea * 50;
    const installationCost = totalArea * 15;
    const laborCost = adjustedArea * laborCostPerSqft;
    const subtotal = materialCost + laborCost;
    const margin = 0.50;
    const totalCost = subtotal / (1 - margin);

    const responseMessage = `Here’s your estimate for a ${layout} countertop using ${matchedMaterial['Color Name']} (${materialType}, ${matchedMaterial['Thickness'] || 'unknown'}):\n` +
      `- Area: ${totalArea.toFixed(2)} sqft (+${(wasteFactor * 100).toFixed(0)}% waste = ${adjustedArea.toFixed(2)} sqft)\n` +
      `- Material: $${materialCost.toFixed(2)} (${materialPrice.toFixed(2)}/sqft + 4% markup)\n` +
      `- Fabrication: $${fabricationCost.toFixed(2)} ($50/sqft)\n` +
      `- Installation: $${installationCost.toFixed(2)} ($15/sqft)\n` +
      `- Total: $${totalCost.toFixed(2)} (50% margin)\n` +
      `Pair it with a Kibi USA sink: <a href="https://store.surprisegranite.com/collections/sinks" target="_blank">View Sinks</a>\n` +
      `Want to add installation or order a sample of ${matchedMaterial['Color Name']}? Let me know, or reply 'Great', 'High', or 'Low' to share feedback on the price.`;

    chatLog.bids = chatLog.bids || [];
    chatLog.bids.push({
      layout,
      dimensions,
      material: matchedMaterial['Color Name'],
      wasteFactor,
      fabricationCost,
      installationCost,
      materialCost,
      totalCost,
      margin
    });

    chatLog.messages.push(
      { role: 'user', content: `Estimate request: ${layout}, ${JSON.stringify(dimensions)}, ${material}` },
      { role: 'assistant', content: responseMessage }
    );
    chatLog.estimateContext = {};
    await chatLog.save();

    res.json({
      message: responseMessage,
      image: matchedMaterial.image_url || null,
      quickReplies: ['Great', 'High', 'Low', 'Get Estimate', 'Products', 'Explore', 'Book Appointment']
    });
  } catch (error) {
    logger.error(`Estimate error: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate estimate. Please try again.' });
  }
});

// Chat Endpoint
app.post(
  '/api/chat',
  [body('message').isString().trim().isLength({ max: 1000 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const userMessage = req.body.message.toLowerCase();
      const sessionId = req.body.sessionId || 'anonymous';
      const requestId = req.headers['x-request-id'] || 'unknown';

      logger.info(`Request ID: ${requestId}, Session ID: ${sessionId}, User message: ${userMessage}`);

      let chatLog = await ChatLog.findOne({ sessionId });
      if (!chatLog) {
        chatLog = new ChatLog({ sessionId, messages: [], estimateContext: {} });
      }
      chatLog.lastActivity = new Date();
      const conversationHistory = chatLog.messages.slice(-5).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Handle company information request
      if (userMessage.includes('about surprise granite') || userMessage.includes('company info')) {
        const responseMessage = `Surprise Granite, located at 11560 N Dysart Rd, Surprise, AZ 85379, specializes in custom countertops, sinks, faucets, and bath fixtures. We source high-quality materials from Arizona Tile and Kibi USA to create durable, stylish solutions for your home. Check out our products at <a href="https://store.surprisegranite.com" target="_blank">store.surprisegranite.com</a> or use the footer buttons to call (602) 833-3189 or message us!`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment']
        });
      }

      // Handle vendor list request
      if (userMessage.includes('list vendors') || userMessage.includes('our vendors')) {
        const vendors = await getVendorData();
        const vendorList = Object.keys(vendors).map(v => v.toUpperCase()).join(', ');
        const responseMessage = `We partner with top vendors like ${vendorList} to bring you the best in countertops and fixtures. Curious about what they offer? Ask about a specific vendor (e.g., "What does Kibi USA offer?") or explore our <a href="https://store.surprisegranite.com" target="_blank">store</a>.`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment']
        });
      }

      // Handle vendor product query
      const vendorMatch = Object.keys(await getVendorData()).find(v => userMessage.includes(v.toLowerCase()));
      if (vendorMatch) {
        const vendors = await getVendorData();
        const vendor = vendors[vendorMatch];
        const materials = Object.entries(vendor.materials)
          .filter(([_, data]) => data.count > 0)
          .map(([type, data]) => {
            const examples = data.examples.map(ex => 
              typeof ex === 'string' ? ex : `<a href="${ex.url}" target="_blank">${ex.name}</a>`
            ).join(', ');
            return `${type}: ${data.count} options, including ${examples}.`;
          }).join('\n');
        const responseMessage = `${vendor.description}\nAvailable products:\n${materials}\nSee the full range at <a href="https://store.surprisegranite.com" target="_blank">our store</a>. Want to pair these with a countertop? Try the "Get Estimate" button!`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment']
        });
      }

      // Handle product queries
      if (userMessage.includes('products') || userMessage.includes('show products')) {
        const responseMessage = `At Surprise Granite, we craft custom countertops in Granite, Quartz, Marble, Quartzite, and Porcelain from Arizona Tile, and offer premium kitchen and bath fixtures from Kibi USA, like sinks, faucets, shower systems, and accessories. Browse our collection at <a href="https://store.surprisegranite.com" target="_blank">store.surprisegranite.com</a>. Want to dive into a specific category, like sinks or countertops? Just let me know!`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment']
        });
      }

      // Handle specific category queries
      const categories = [
        'countertops', 'sinks', 'faucets', 'bathroom', 'shower', 'samples', 'tile', 'gift card',
        'quartz composite sinks', 'stainless steel sinks', 'fireclay sinks', 'matte stone sinks',
        'pull down faucets', 'filtration faucets', 'pot fillers', 'shower heads', 'shower valves',
        'shower jets', 'soap dispensers', 'sink strainers', 'drain trays', 'bathroom organization',
        'hardware', 'shelves', 'bathtubs'
      ];
      const matchedCategory = categories.find(cat => userMessage.includes(cat));
      if (matchedCategory) {
        const products = await fetchShopifyProducts(matchedCategory);
        const examples = products.slice(0, 3).map(p => 
          `<a href="${p.online_store_url || `https://${process.env.SHOPIFY_SHOP}/products/${p.handle}`}" target="_blank">${p.title}</a>`
        ).join(', ');
        const responseMessage = `${matchedCategory.charAt(0).toUpperCase() + matchedCategory.slice(1)} from ${products[0]?.vendor || 'our vendors'} include options like ${examples || 'various styles'}. Check them out at <a href="${NAV_LINKS[matchedCategory] || NAV_LINKS.store}" target="_blank">our store</a>. Want to pair with a countertop or get design tips?`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          image: products[0]?.image?.src || null,
          quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment', 'Design Tips']
        });
      }

      // Handle design tips request
      if (userMessage.includes('design') || userMessage.includes('tips') || userMessage.includes('advice')) {
        const category = userMessage.includes('bathroom') ? 'bathroom' : userMessage.includes('kitchen') ? 'kitchen' : 'material';
        const tips = DESIGN_TIPS[category];
        const responseMessage = `Here are some design tips for ${category}: ${tips} Want more inspiration or to browse related products?`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          image: null,
          message: responseMessage,
          quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment', 'Design Tips']
        });
      }

      // Handle estimate context
      if (chatLog.estimateContext?.step) {
        let responseMessage = '';
        let quickReplies = ['Get Estimate', 'Products', 'Explore', 'Book Appointment'];

        if (chatLog.estimateContext.step === 'layout') {
          const layouts = ['u-shaped', 'galley', 'l-shape', 'plateau', 'bar top'];
          if (layouts.some(layout => userMessage.includes(layout))) {
            chatLog.estimateContext.layout = layouts.find(layout => userMessage.includes(layout));
            chatLog.estimateContext.step = 'dimensions';
            responseMessage = `Got it, a ${chatLog.estimateContext.layout} countertop! What are the dimensions in feet? (e.g., "5x3 ft" or multiple like "5x3 ft, 4x2 ft")`;
          } else {
            responseMessage = `Please specify a layout, such as U-shaped, Galley, L-shape, Plateau, or Bar Top.`;
          }
        } else if (chatLog.estimateContext.step === 'dimensions') {
          const dimensions = extractDimensions(req.body.message);
          if (dimensions.length > 0) {
            chatLog.estimateContext.dimensions = dimensions;
            chatLog.estimateContext.step = 'material';
            responseMessage = `Thanks for the dimensions! Now, which material would you like? Popular choices include Sparkling White Quartz or Silver Cloud Granite. You can also browse <a href="https://store.surprisegranite.com/collections/countertops" target="_blank">our collection</a>.`;
          } else {
            responseMessage = `I didn’t catch the dimensions. Please provide them in feet, like "5x3 ft" or multiple sections like "5x3 ft, 4x2 ft".`;
          }
        } else if (chatLog.estimateContext.step === 'material') {
          const priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
          const matchedMaterial = priceList.find(item => fuzzyMatch(item['Color Name'], req.body.message));
          if (matchedMaterial) {
            chatLog.estimateContext.material = matchedMaterial['Color Name'];
            const estimateData = {
              layout: chatLog.estimateContext.layout,
              dimensions: chatLog.estimateContext.dimensions,
              material: chatLog.estimateContext.material,
              sessionId
            };
            const estimateResponse = await axios.post(`http://localhost:${PORT}/api/estimate`, estimateData);
            responseMessage = estimateResponse.data.message;
            quickReplies = estimateResponse.data.quickReplies;
            chatLog.estimateContext = {};
          } else {
            responseMessage = `I couldn’t find that material. Try a name like "Sparkling White" or browse <a href="https://store.surprisegranite.com/collections/countertops" target="_blank">our collection</a>. What material are you thinking of?`;
          }
        }

        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies
        });
      }

      // Handle estimate request
      if (userMessage.includes('estimate') || userMessage.includes('quote') || userMessage.includes('countertop')) {
        const priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
        const matchedMaterial = priceList.find(item => fuzzyMatch(item['Color Name'], userMessage));
        if (matchedMaterial) {
          chatLog.estimateContext = { step: 'layout', material: matchedMaterial['Color Name'] };
          const responseMessage = `Great choice with ${matchedMaterial['Color Name']} ${matchedMaterial['Material']}! What’s the layout of your countertop? Options include U-shaped, Galley, L-shape, Plateau, or Bar Top. Or, use the "Get Estimate" button for a quick form.`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({
            message: responseMessage,
            quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment']
          });
        } else {
          chatLog.estimateContext = { step: 'layout' };
          const responseMessage = `Let’s get started on your countertop estimate! What’s the layout? Choose from U-shaped, Galley, L-shape, Plateau, or Bar Top. You can also use the "Get Estimate" button to fill out a form.`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({
            message: responseMessage,
            quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment']
          });
        }
      }

      // Handle feedback
      if (['great', 'high', 'low'].includes(userMessage)) {
        chatLog.feedback = chatLog.feedback || [];
        chatLog.feedback.push({
          question: 'Is this price fair?',
          response: userMessage
        });
        const responseMessage = `Thanks for your feedback! ${userMessage === 'Great' ? 'Glad you like the price!' : userMessage === 'High' ? 'Let’s explore more affordable options.' : 'That’s a steal!'} Want to browse complementary products like sinks or faucets at <a href="https://store.surprisegranite.com" target="_blank">our store</a> or get another estimate?`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment']
        });
      }

      // Handle Shopify product queries
      let shopifyProducts = [];
      try {
        shopifyProducts = await fetchShopifyProducts();
      } catch (error) {
        logger.error(`Failed to fetch Shopify products: ${error.message}`);
      }

      const matchedProduct = shopifyProducts.find((product) =>
        product.title && fuzzyMatch(product.title, userMessage)
      );
      if (matchedProduct) {
        const price = parseFloat(matchedProduct.variants[0].price) || 0;
        const productUrl = matchedProduct.online_store_url || `https://${process.env.SHOPIFY_SHOP}/products/${matchedProduct.handle}`;
        const imageUrl = matchedProduct.image?.src || null;
        const description = matchedProduct.body_html ? matchedProduct.body_html.replace(/<[^>]+>/g, '').substring(0, 100) + '...' : 'No description available.';
        logger.info(`Matched product: ${matchedProduct.title}`);
        const responseMessage = `The "${matchedProduct.title}" is a fantastic choice, priced at $${price.toFixed(2)}. ${description} <a href="${productUrl}" target="_blank">View on our store</a>. ${matchedProduct.title.toLowerCase().includes('countertop') ? 'Want a custom quote for this?' : 'Need a countertop to match?'} Let’s get an estimate or explore more!`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          image: imageUrl,
          productUrl,
          quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment']
        });
      }

      // Generic response
      const systemPrompt = {
        role: 'system',
        content: `
          You are Surprise Granite's AI assistant, located at 11560 N Dysart Rd, Surprise, AZ 85379. We specialize in custom countertops (Granite, Quartz, Marble, Quartzite, Porcelain) from Arizona Tile and kitchen/bath fixtures (sinks, faucets, shower systems, bathtubs, accessories) from Kibi USA. Your tasks include:
          - Providing conversational, engaging responses with a friendly tone, avoiding repetition.
          - Offering detailed information about Surprise Granite's company, products, and vendors only when explicitly requested.
          - Assisting with Shopify store navigation (store.surprisegranite.com), recommending products/services with hyperlinks and specific details.
          - Guiding users through countertop estimates conversationally (layout, dimensions, material) or via the "Get Estimate" button, storing context in estimateContext.
          - Saving bids in MongoDB and soliciting feedback with personalized follow-ups.
          - Providing Shopify product details (title, price, description, image, stock status) with hyperlinks.
          - Suggesting related products or services (e.g., sinks with countertops, installation).
          - Offering design tips when relevant, tailored to kitchens, bathrooms, or materials.
          - Do not include navigation links in responses; use quick reply buttons or hyperlinked store URLs.
          - Do not include contact information; direct users to footer buttons for calling (602) 833-3189 or messaging.
          - Do not append vendor data unless specifically asked.
        `,
      };

      const messages = [
        systemPrompt,
        ...conversationHistory,
        { role: 'user', content: req.body.message },
      ];

      const aiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages,
          temperature: 0.7,
          max_tokens: 600,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      let aiMessage = aiResponse.data.choices[0].message.content;
      logger.info(`Raw AI response: ${aiMessage}`);

      const contactPatterns = [
        /Contact us:.*$/gi,
        /If you'd like to contact our support team.*$/gi,
        /support@surprisegranite\.com/gi,
        /\[Call \(602\) 833-3189\].*$/gi,
        /\[Message Us\].*$/gi,
        /\[Get Directions\].*$/gi,
      ];
      contactPatterns.forEach((pattern) => {
        aiMessage = aiMessage.replace(pattern, '').trim();
      });

      chatLog.messages.push(
        { role: 'user', content: req.body.message },
        { role: 'assistant', content: aiMessage }
      );
      await chatLog.save();

      res.json({
        message: aiMessage,
        quickReplies: ['Get Estimate', 'Products', 'Explore', 'Book Appointment', 'Design Tips']
      });
    } catch (err) {
      logger.error(`Error in /api/chat (Request ID: ${req.headers['x-request-id'] || 'unknown'}): ${err.message}`);
      res.status(500).json({
        error: 'An error occurred while processing your request. Please try again later.',
        details: err.message,
      });
    }
  }
);

// Default Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chatbot.html'));
});

// Chatbot Widget Route
app.get('/sg-chatbot-widget.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chatbot.html'));
});

// Catch-All Route
app.use((req, res) => {
  res.status(404).send('Page not found. Make sure you are accessing the correct endpoint.');
});

// Handle SIGTERM
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down gracefully...');
  mongoose.connection.close(() => {
    logger.info('MongoDB connection closed.');
    process.exit(0);
  });
});

// Global Error Handling
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  process.exit(1);
});

// Start Server
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
});
