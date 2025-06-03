require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const NodeCache = require('node-cache');
const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs').promises;
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
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
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
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => {
    logger.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Schemas
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
      clientId: String, // New field for client identification
      clientEmail: String, // Store client email for linking
      messages: [{ role: String, content: String, createdAt: { type: Date, default: Date.now } }],
      appointmentRequested: Boolean,
      bids: [{
        layout: String,
        dimensions: [{ length: Number, width: Number, isInches: Boolean }],
        material: String,
        wasteFactor: Number,
        fabricationCost: Number,
        installationCost: Number,
        materialCost: Number,
        demoCost: Number,
        plumbingCost: Number,
        totalCost: Number,
        margin: Number,
        sampleSize: String,
        createdAt: { type: Date, default: Date.now },
      }],
      feedback: [{ question: String, response: String, createdAt: { type: Date, default: Date.now } }],
      abandoned: { type: Boolean, default: false },
      lastActivity: { type: Date, default: Date.now },
      estimateContext: {
        step: String,
        layout: String,
        dimensions: [{ length: Number, width: Number, isInches: Boolean }],
        material: String,
        backsplash: String,
        edge: String,
        cutouts: [String],
        demo: String,
        plumbing: Boolean,
        sampleSize: String,
      },
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
    `- Dimensions: ${bid.dimensions.map(d => `${d.length}x${d.width} ${d.isInches ? 'in' : 'ft'}`).join(', ')}\n` +
    `- Material: ${bid.material}\n` +
    `- Waste Factor: ${(bid.wasteFactor * 100).toFixed(0)}%\n` +
    `- Material Cost: $${bid.materialCost.toFixed(2)}\n` +
    `- Fabrication: $${bid.fabricationCost.toFixed(2)}\n` +
    `- Installation: $${bid.installationCost.toFixed(2)}\n` +
    `- Demo Cost: $${bid.demoCost.toFixed(2)}\n` +
    `- Plumbing Cost: $${bid.plumbingCost.toFixed(2)}\n` +
    `- Total: $${bid.totalCost.toFixed(2)}\n` +
    `- Margin: ${(bid.margin * 100).toFixed(0)}%\n` +
    `- Sample Size: ${bid.sampleSize || 'None'}`
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
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later.',
}));

// Fetch Shopify Products
async function fetchShopifyProducts() {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-10/products.json`;
  try {
    const response = await axios.get(url, {
      headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN },
      timeout: 10000,
    });
    logger.info(`Shopify products fetched: ${response.data.products.length}`);
    return response.data.products;
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
    cache.delete(cacheKey);
    throw error;
  }
}

// Fetch Materials with Fallback to materials.json
async function fetchMaterials() {
  try {
    const csvData = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
    return csvData.map(item => ({
      name: item['Color Name'],
      material: item['Material'] || '',
      costPerSquare: parseFloat(item['Cost/SqFt']) || 0,
      thickness: item['Thickness'] || '',
      imageUrl: item['image_url'] || ''
    })).filter(m => m.name && m.costPerSquare > 0);
  } catch (error) {
    logger.warn('Failed to fetch CSV, using fallback materials.json');
    try {
      const jsonData = await fs.readFile(path.join(__dirname, 'public', 'materials.json'), 'utf8');
      return JSON.parse(jsonData).map(item => ({
        name: item['Color Name'],
        material: item['Material'] || '',
        costPerSquare: parseFloat(item['Cost/SqFt']) || 0,
        thickness: item['Thickness'] || '',
        imageUrl: item['image_url'] || ''
      })).filter(m => m.name && m.costPerSquare > 0);
    } catch (jsonError) {
      logger.error('Failed to load materials.json:', jsonError.message);
      return [];
    }
  }
}

// Calculate Installed Price
function calculateInstalledPrice(costPerSquare) {
  return (costPerSquare * 3.25 + 26).toFixed(2);
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
  const dimensionRegex = /(\d+\.?\d*)\s*(x|by|\*)\s*(\d+\.?\d*)\s*(ft|feet|in|inch|inches)?/gi;
  const matches = [...message.matchAll(dimensionRegex)];
  return matches.map(match => ({
    length: parseFloat(match[1]),
    width: parseFloat(match[3]),
    isInches: (match[5] || '').toLowerCase().startsWith('in'),
    area: parseFloat(match[1]) * parseFloat(match[3]) / (match[5] && match[5].toLowerCase().startsWith('in') ? 144 : 1),
  }));
}

// Get Labor Cost
function getLaborCostPerSqft(laborData, materialType) {
  const materialLower = materialType.toLowerCase();
  const laborItem = laborData.find((item) => {
    const description = item[Object.keys(item)[1]] || '';
    return description.toLowerCase().includes(materialLower);
  });
  if (laborItem) {
    const cost = parseFloat(laborItem[Object.keys(item)[3]]);
    if (!isNaN(cost)) {
      logger.info(`Labor cost for ${materialType}: $${cost}/sqft`);
      return cost;
    }
  }
  logger.info(`No labor cost found for ${materialType}, using default $65/sqft`);
  return 65;
}

// Materials Endpoint
app.get('/api/materials', async (req, res) => {
  try {
    const materials = await fetchMaterials();
    res.json(materials.map(m => ({
      ...m,
      installedPrice: calculateInstalledPrice(m.costPerSquare)
    })));
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials.' });
  }
});

// Shopify Products Endpoint
app.get('/api/shopify-products', async (req, res) => {
  try {
    const products = await fetchShopifyProducts();
    const formattedProducts = products.map(product => ({
      id: product.id,
      name: product.title,
      vendor: product.vendor,
      price: parseFloat(product.variants[0]?.price) || 0,
      url: product.online_store_url || `https://${process.env.SHOPIFY_SHOP}/products/${product.handle}`,
      image: product.image?.src || 'https://via.placeholder.com/150?text=No+Image',
      description: product.body_html ? product.body_html.replace(/<[^>]+>/g, '').substring(0, 100) + '...' : 'No description available.',
    }));
    res.json(formattedProducts);
  } catch (error) {
    logger.error(`Shopify products fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch Shopify products.' });
  }
});

// Appointment Endpoint
app.post('/api/appointment', async (req, res) => {
  const { name, email, city, date, time, sessionId } = req.body;
  if (!name || !email || !date || !time) {
    return res.status(400).json({ error: 'Name, email, date, and time are required.' });
  }

  try {
    let chatLog = await ChatLog.findOne({ sessionId });
    if (!chatLog) {
      chatLog = new ChatLog({ sessionId, messages: [] });
    }
    chatLog.appointmentRequested = true;
    chatLog.messages.push({
      role: 'system',
      content: `Appointment requested: ${name}, ${email}, ${city || 'N/A'}, ${date}, ${time}`,
    });
    chatLog.lastActivity = new Date();
    await chatLog.save();

    await axios.post('https://usebasin.com/f/0e1679dd8d79', {
      name,
      email,
      city,
      date,
      time,
    });

    const responseMessage = `Appointment booked for ${name} on ${date} at ${time}! We'll confirm via email.`;
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
  const userMessage = req.body.message.toLowerCase();
  const sessionId = req.body.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const clientId = req.body.clientId || `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const clientEmail = req.body.clientEmail || null;

  logger.info(`Request ID: ${req.headers['x-request-id'] || 'unknown'}, Session ID: ${sessionId}, Client ID: ${clientId}, User message: ${userMessage}`);

  let chatLog = await ChatLog.findOne({ sessionId });
  if (!chatLog) {
    chatLog = new ChatLog({ sessionId, clientId, clientEmail, messages: [], estimateContext: {} });
  } else if (!chatLog.clientId) {
    chatLog.clientId = clientId;
    chatLog.clientEmail = clientEmail;
  }
  chatLog.lastActivity = new Date();

  // Fetch prior chats for context
  const priorChats = await ChatLog.find({ clientId, sessionId: { $ne: sessionId } })
    .sort({ updatedAt: -1 })
    .limit(3);
  const priorContext = priorChats.flatMap(log =>
    log.messages.slice(-3).map(msg => ({
      role: msg.role,
      content: msg.content
    }))
  );

  const conversationHistory = chatLog.messages.slice(-5).map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));

  // Handle material price query
  const materials = await fetchMaterials();
  const matchedMaterial = materials.find(item => fuzzyMatch(item.name, userMessage));
  if (matchedMaterial && !chatLog.estimateContext.step) {
    const installedPrice = calculateInstalledPrice(matchedMaterial.costPerSquare);
    const responseMessage = `${matchedMaterial.name} ${matchedMaterial.material} is $${installedPrice}/sqft installed. Want to start a quote with this material or explore others?`;
    chatLog.messages.push(
      { role: 'user', content: req.body.message },
      { role: 'assistant', content: responseMessage }
    );
    await chatLog.save();
    return res.json({
      message: responseMessage,
      image: matchedMaterial.imageUrl,
      quickReplies: ['Start Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
      clientId,
      sessionId
    });
  }

  // Handle browse materials request
  if (userMessage.includes('browse materials')) {
    const materialList = materials.slice(0, 5).map(m => `${m.name} (${m.material}): $${calculateInstalledPrice(m.costPerSquare)}/sqft installed`).join('\n');
    const responseMessage = `Here are some popular materials:\n${materialList}\nAsk about a specific material or start a quote!`;
    chatLog.messages.push(
      { role: 'user', content: req.body.message },
      { role: 'assistant', content: responseMessage }
    );
    await chatLog.save();
    return res.json({
      message: responseMessage,
      quickReplies: ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Start Quote'],
      clientId,
      sessionId
    });
  }

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
      quickReplies: ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
      clientId,
      sessionId
    });
  }

  // Handle estimate context
  if (chatLog.estimateContext?.step) {
    let responseMessage = '';
    let quickReplies = ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'];

    if (chatLog.estimateContext.step === 'space') {
      const spaces = ['kitchen', 'bathroom', 'other'];
      if (spaces.some(space => userMessage.includes(space))) {
        chatLog.estimateContext.space = spaces.find(space => userMessage.includes(space));
        chatLog.estimateContext.step = 'style';
        responseMessage = `Great, a ${chatLog.estimateContext.space} project! What style do you prefer? Modern, Traditional, Rustic, or Contemporary?`;
        quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
      } else {
        responseMessage = `Please specify the space, such as Kitchen, Bathroom, or Other.`;
        quickReplies = ['Kitchen', 'Bathroom', 'Other'];
      }
    } else if (chatLog.estimateContext.step === 'style') {
      const styles = ['modern', 'traditional', 'rustic', 'contemporary'];
      if (styles.some(style => userMessage.includes(style))) {
        chatLog.estimateContext.style = styles.find(style => userMessage.includes(style));
        chatLog.estimateContext.step = 'layout';
        responseMessage = `Love the ${chatLog.estimateContext.style} vibe! What’s the countertop layout? Options include L-Shape, U-Shape, Galley, or Island.`;
        quickReplies = ['L-Shape', 'U-Shape', 'Galley', 'Island'];
      } else {
        responseMessage = `Please choose a style: Modern, Traditional, Rustic, or Contemporary.`;
        quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
      }
    } else if (chatLog.estimateContext.step === 'layout') {
      const layouts = ['l-shape', 'u-shape', 'galley', 'island'];
      if (layouts.some(layout => userMessage.includes(layout))) {
        chatLog.estimateContext.layout = layouts.find(layout => userMessage.includes(layout));
        chatLog.estimateContext.step = 'dimensions';
        responseMessage = `Got it, a ${chatLog.estimateContext.layout} countertop! What are the dimensions? Provide in feet (e.g., "5x3 ft") or inches (e.g., "72x36 in"). Need help measuring?`;
        quickReplies = ['Enter Dimensions', 'Need Help?', 'Skip'];
      } else {
        responseMessage = `Please specify a layout, such as L-Shape, U-Shape, Galley, or Island.`;
        quickReplies = ['L-Shape', 'U-Shape', 'Galley', 'Island'];
      }
    } else if (chatLog.estimateContext.step === 'dimensions') {
      const dimensions = extractDimensions(req.body.message);
      if (dimensions.length > 0) {
        chatLog.estimateContext.dimensions = dimensions;
        chatLog.estimateContext.step = 'material';
        responseMessage = `Thanks for the dimensions (total: ${(dimensions.reduce((sum, dim) => sum + dim.area, 0)).toFixed(2)} sqft)! Which material would you like? Popular choices include Granite, Quartz, Marble, or Quartzite. Browse <a href="https://store.surprisegranite.com/collections/countertops" target="_blank">our collection</a>.`;
        quickReplies = ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Browse Materials'];
      } else {
        responseMessage = `I didn’t catch the dimensions. Please provide them in feet (e.g., "5x3 ft") or inches (e.g., "72x36 in"). Try our <a href="https://store.surprisegranite.com/pages/measurement-guide" target="_blank">measurement guide</a>.`;
        quickReplies = ['Enter Dimensions', 'Need Help?', 'Skip'];
      }
    } else if (chatLog.estimateContext.step === 'material') {
      const matchedMaterial = materials.find(item => fuzzyMatch(item.name, req.body.message));
      if (matchedMaterial) {
        chatLog.estimateContext.material = matchedMaterial.name;
        chatLog.estimateContext.step = 'backsplash';
        responseMessage = `Great choice with ${matchedMaterial.name} ${matchedMaterial.material}! Would you like a backsplash? Options are 4", 6", Full Height, or None.`;
        quickReplies = ['4"', '6"', 'Full Height', 'None'];
      } else {
        responseMessage = `I couldn’t find that material. Try a name like "Calacatta Gold" or browse <a href="https://store.surprisegranite.com/collections/countertops" target="_blank">our collection</a>. What material are you thinking of?`;
        quickReplies = ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Browse Materials'];
      }
    } else if (chatLog.estimateContext.step === 'backsplash') {
      const backsplashes = ['4"', '6"', 'full height', 'none'];
      if (backsplashes.some(b => userMessage.includes(b))) {
        chatLog.estimateContext.backsplash = backsplashes.find(b => userMessage.includes(b));
        chatLog.estimateContext.step = 'edge';
        responseMessage = `Backsplash set to ${chatLog.estimateContext.backsplash}! What edge style do you prefer? Eased, Bullnose, Ogee, or Waterfall?`;
        quickReplies = ['Eased', 'Bullnose', 'Ogee', 'Waterfall'];
      } else {
        responseMessage = `Please choose a backsplash: 4", 6", Full Height, or None.`;
        quickReplies = ['4"', '6"', 'Full Height', 'None'];
      }
    } else if (chatLog.estimateContext.step === 'edge') {
      const edges = ['eased', 'bullnose', 'ogee', 'waterfall'];
      if (edges.some(e => userMessage.includes(e))) {
        chatLog.estimateContext.edge = edges.find(e => userMessage.includes(e));
        chatLog.estimateContext.step = 'cutouts';
        responseMessage = `Edge style set to ${chatLog.estimateContext.edge}! Any cutouts needed? Sink, Faucet, Cooktop, or None?`;
        quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None'];
      } else {
        responseMessage = `Please choose an edge style: Eased, Bullnose, Ogee, or Waterfall.`;
        quickReplies = ['Eased', 'Bullnose', 'Ogee', 'Waterfall'];
      }
    } else if (chatLog.estimateContext.step === 'cutouts') {
      const cutouts = ['sink', 'faucet', 'cooktop', 'none'];
      if (cutouts.some(c => userMessage.includes(c))) {
        if (userMessage.includes('none')) {
          chatLog.estimateContext.cutouts = [];
          chatLog.estimateContext.step = 'demo';
          responseMessage = `No cutouts needed. Do you require demolition of an existing countertop? Options: Light ($5/sqft), Heavy ($10/sqft), or None.`;
          quickReplies = ['Light', 'Heavy', 'None'];
        } else {
          chatLog.estimateContext.cutouts = chatLog.estimateContext.cutouts || [];
          chatLog.estimateContext.cutouts.push(...cutouts.filter(c => userMessage.includes(c) && c !== 'none'));
          responseMessage = `Added ${cutouts.filter(c => userMessage.includes(c)).join(', ')} cutout(s). Any more? Sink, Faucet, Cooktop, or None.`;
          quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None'];
        }
      } else {
        responseMessage = `Please specify cutouts: Sink, Faucet, Cooktop, or None.`;
        quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None'];
      }
    } else if (chatLog.estimateContext.step === 'demo') {
      const demoOptions = ['light', 'heavy', 'none'];
      if (demoOptions.some(d => userMessage.includes(d))) {
        chatLog.estimateContext.demo = demoOptions.find(d => userMessage.includes(d));
        chatLog.estimateContext.step = 'plumbing';
        responseMessage = `Demolition set to ${chatLog.estimateContext.demo}. Will you need plumbing services to connect a new sink or faucet? (Flat rate: $500)`;
        quickReplies = ['Yes', 'No'];
      } else {
        responseMessage = `Please choose a demolition option: Light ($5/sqft), Heavy ($10/sqft), or None.`;
        quickReplies = ['Light', 'Heavy', 'None'];
      }
    } else if (chatLog.estimateContext.step === 'plumbing') {
      const plumbingOptions = ['yes', 'no'];
      if (plumbingOptions.some(p => userMessage.includes(p))) {
        chatLog.estimateContext.plumbing = userMessage.includes('yes');
        chatLog.estimateContext.step = 'sample';
        responseMessage = `Plumbing set to ${chatLog.estimateContext.plumbing ? 'Yes' : 'No'}. Would you like to order a material sample? Available sizes: 3x3" ($10), 4x6" ($15), 5x10" ($25), or None.`;
        quickReplies = ['3x3"', '4x6"', '5x10"', 'None'];
      } else {
        responseMessage = `Please specify if you need plumbing: Yes or No.`;
        quickReplies = ['Yes', 'No'];
      }
    } else if (chatLog.estimateContext.step === 'sample') {
      const sampleSizes = ['3x3"', '4x6"', '5x10"', 'none'];
      if (sampleSizes.some(s => userMessage.includes(s))) {
        chatLog.estimateContext.sampleSize = sampleSizes.find(s => userMessage.includes(s));
        const estimateData = {
          layout: chatLog.estimateContext.layout,
          dimensions: chatLog.estimateContext.dimensions,
          material: chatLog.estimateContext.material,
          sessionId,
          backsplash: chatLog.estimateContext.backsplash,
          edge: chatLog.estimateContext.edge,
          cutouts: chatLog.estimateContext.cutouts,
          demo: chatLog.estimateContext.demo,
          plumbing: chatLog.estimateContext.plumbing,
          sampleSize: chatLog.estimateContext.sampleSize,
        };
        const estimateResponse = await axios.post(`http://localhost:${PORT}/api/estimate`, estimateData);
        responseMessage = estimateResponse.data.message;
        quickReplies = estimateResponse.data.quickReplies;
        chatLog.estimateContext = {};
      } else {
        responseMessage = `Please choose a sample size: 3x3" ($10), 4x6" ($15), 5x10" ($25), or None.`;
        quickReplies = ['3x3"', '4x6"', '5x10"', 'None'];
      }
    }

    chatLog.messages.push(
      { role: 'user', content: req.body.message },
      { role: 'assistant', content: responseMessage }
    );
    await chatLog.save();
    return res.json({
      message: responseMessage,
      quickReplies,
      clientId,
      sessionId
    });
  }

  // Handle estimate request
  if (userMessage.includes('estimate') || userMessage.includes('quote') || userMessage.includes('countertop') || userMessage.includes('start quote')) {
    const matchedMaterial = materials.find(item => fuzzyMatch(item.name, userMessage));
    if (matchedMaterial) {
      chatLog.estimateContext = { step: 'space', material: matchedMaterial.name };
      const responseMessage = priorChats.length > 0
        ? `Welcome back! You previously liked ${matchedMaterial.name}. Let’s get a quote for a ${matchedMaterial.material} countertop. Is this for a Kitchen, Bathroom, or Other space?`
        : `Great choice with ${matchedMaterial.name} ${matchedMaterial.material}! Is this countertop for a Kitchen, Bathroom, or Other space?`;
      chatLog.messages.push(
        { role: 'user', content: req.body.message },
        { role: 'assistant', content: responseMessage }
      );
      await chatLog.save();
      return res.json({
        message: responseMessage,
        quickReplies: ['Kitchen', 'Bathroom', 'Other'],
        clientId,
        sessionId
      });
    } else {
      chatLog.estimateContext = { step: 'space' };
      const responseMessage = priorChats.length > 0
        ? `Welcome back! Let’s get started on another countertop estimate. Is this for a Kitchen, Bathroom, or Other space?`
        : `Let’s get started on your countertop estimate! Is this for a Kitchen, Bathroom, or Other space?`;
      chatLog.messages.push(
        { role: 'user', content: req.body.message },
        { role: 'assistant', content: responseMessage }
      );
      await chatLog.save();
      return res.json({
        message: responseMessage,
        quickReplies: ['Kitchen', 'Bathroom', 'Other'],
        clientId,
        sessionId
      });
    }
  }

  // Handle feedback
  if (['great', 'too high', 'new quote', 'order sample'].includes(userMessage)) {
    chatLog.feedback = chatLog.feedback || [];
    chatLog.feedback.push({
      question: 'Is this price fair?',
      response: userMessage,
    });
    const responseMessage = `Thanks for your feedback! ${userMessage === 'great' ? 'Glad you like the price!' : userMessage === 'too high' ? 'Let’s explore more affordable options.' : userMessage === 'order sample' ? 'Let’s order your sample!' : 'Let’s start a new quote.'} Want to browse materials or book a consultation?`;
    chatLog.messages.push(
      { role: 'user', content: req.body.message },
      { role: 'assistant', content: responseMessage }
    );
    await chatLog.save();
    return res.json({
      message: responseMessage,
      quickReplies: ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
      clientId,
      sessionId
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
    const imageUrl = matchedProduct.image?.src || 'https://via.placeholder.com/150?text=No+Image';
    const description = matchedProduct.body_html ? matchedProduct.body_html.replace(/<[^>]+>/g, '').substring(0, 100) + '...' : 'No description available.';
    logger.info(`Matched product: ${matchedProduct.title}`);
    const responseMessage = `The "${matchedProduct.title}" is priced at $${price.toFixed(2)}. ${description} <a href="${productUrl}" target="_blank">View on our store</a>. ${matchedProduct.title.toLowerCase().includes('countertop') ? 'Want a custom quote for this?' : 'Need a countertop to match?'} Let’s get an estimate or explore more!`;
    chatLog.messages.push(
      { role: 'user', content: req.body.message },
      { role: 'assistant', content: responseMessage }
    );
    await chatLog.save();
    return res.json({
      message: responseMessage,
      image: imageUrl,
      productUrl,
      quickReplies: ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
      clientId,
      sessionId
    });
  }

  // Generic response with OpenAI
  const messages = [
    systemPrompt,
    ...priorContext, // Include prior chat context
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
    quickReplies: ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
    clientId,
    sessionId
  });
} catch (err) {
  logger.error(`Error in /api/chat (Request ID: ${req.headers['x-request-id'] || 'unknown'}): ${err.message}`);
  res.status(500).json({
    error: 'An error occurred while processing your request. Please try again later.',
    details: err.message,
  });
}

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

      // Handle material price query
      const materials = await fetchMaterials();
      const matchedMaterial = materials.find(item => fuzzyMatch(item.name, userMessage));
      if (matchedMaterial && !chatLog.estimateContext.step) {
        const installedPrice = calculateInstalledPrice(matchedMaterial.costPerSquare);
        const responseMessage = `${matchedMaterial.name} ${matchedMaterial.material} is $${installedPrice}/sqft installed. Want to start a quote with this material or explore others?`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          image: matchedMaterial.imageUrl,
          quickReplies: ['Start Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
        });
      }

      // Handle browse materials request
      if (userMessage.includes('browse materials')) {
        const materialList = materials.slice(0, 5).map(m => `${m.name} (${m.material}): $${calculateInstalledPrice(m.costPerSquare)}/sqft installed`).join('\n');
        const responseMessage = `Here are some popular materials:\n${materialList}\nAsk about a specific material or start a quote!`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Start Quote'],
        });
      }

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
          quickReplies: ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
        });
      }

      // Handle estimate context
      if (chatLog.estimateContext?.step) {
        let responseMessage = '';
        let quickReplies = ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'];

        if (chatLog.estimateContext.step === 'space') {
          const spaces = ['kitchen', 'bathroom', 'other'];
          if (spaces.some(space => userMessage.includes(space))) {
            chatLog.estimateContext.space = spaces.find(space => userMessage.includes(space));
            chatLog.estimateContext.step = 'style';
            responseMessage = `Great, a ${chatLog.estimateContext.space} project! What style do you prefer? Modern, Traditional, Rustic, or Contemporary?`;
            quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
          } else {
            responseMessage = `Please specify the space, such as Kitchen, Bathroom, or Other.`;
            quickReplies = ['Kitchen', 'Bathroom', 'Other'];
          }
        } else if (chatLog.estimateContext.step === 'style') {
          const styles = ['modern', 'traditional', 'rustic', 'contemporary'];
          if (styles.some(style => userMessage.includes(style))) {
            chatLog.estimateContext.style = styles.find(style => userMessage.includes(style));
            chatLog.estimateContext.step = 'layout';
            responseMessage = `Love the ${chatLog.estimateContext.style} vibe! What’s the countertop layout? Options include L-Shape, U-Shape, Galley, or Island.`;
            quickReplies = ['L-Shape', 'U-Shape', 'Galley', 'Island'];
          } else {
            responseMessage = `Please choose a style: Modern, Traditional, Rustic, or Contemporary.`;
            quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
          }
        } else if (chatLog.estimateContext.step === 'layout') {
          const layouts = ['l-shape', 'u-shape', 'galley', 'island'];
          if (layouts.some(layout => userMessage.includes(layout))) {
            chatLog.estimateContext.layout = layouts.find(layout => userMessage.includes(layout));
            chatLog.estimateContext.step = 'dimensions';
            responseMessage = `Got it, a ${chatLog.estimateContext.layout} countertop! What are the dimensions? Provide in feet (e.g., "5x3 ft") or inches (e.g., "72x36 in"). Need help measuring?`;
            quickReplies = ['Enter Dimensions', 'Need Help?', 'Skip'];
          } else {
            responseMessage = `Please specify a layout, such as L-Shape, U-Shape, Galley, or Island.`;
            quickReplies = ['L-Shape', 'U-Shape', 'Galley', 'Island'];
          }
        } else if (chatLog.estimateContext.step === 'dimensions') {
          const dimensions = extractDimensions(req.body.message);
          if (dimensions.length > 0) {
            chatLog.estimateContext.dimensions = dimensions;
            chatLog.estimateContext.step = 'material';
            responseMessage = `Thanks for the dimensions (total: ${(dimensions.reduce((sum, dim) => sum + dim.area, 0)).toFixed(2)} sqft)! Which material would you like? Popular choices include Granite, Quartz, Marble, or Quartzite. Browse <a href="https://store.surprisegranite.com/collections/countertops" target="_blank">our collection</a>.`;
            quickReplies = ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Browse Materials'];
          } else {
            responseMessage = `I didn’t catch the dimensions. Please provide them in feet (e.g., "5x3 ft") or inches (e.g., "72x36 in"). Try our <a href="https://store.surprisegranite.com/pages/measurement-guide" target="_blank">measurement guide</a>.`;
            quickReplies = ['Enter Dimensions', 'Need Help?', 'Skip'];
          }
        } else if (chatLog.estimateContext.step === 'material') {
          const matchedMaterial = materials.find(item => fuzzyMatch(item.name, req.body.message));
          if (matchedMaterial) {
            chatLog.estimateContext.material = matchedMaterial.name;
            chatLog.estimateContext.step = 'backsplash';
            responseMessage = `Great choice with ${matchedMaterial.name} ${matchedMaterial.material}! Would you like a backsplash? Options are 4", 6", Full Height, or None.`;
            quickReplies = ['4"', '6"', 'Full Height', 'None'];
          } else {
            responseMessage = `I couldn’t find that material. Try a name like "Calacatta Gold" or browse <a href="https://store.surprisegranite.com/collections/countertops" target="_blank">our collection</a>. What material are you thinking of?`;
            quickReplies = ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Browse Materials'];
          }
        } else if (chatLog.estimateContext.step === 'backsplash') {
          const backsplashes = ['4"', '6"', 'full height', 'none'];
          if (backsplashes.some(b => userMessage.includes(b))) {
            chatLog.estimateContext.backsplash = backsplashes.find(b => userMessage.includes(b));
            chatLog.estimateContext.step = 'edge';
            responseMessage = `Backsplash set to ${chatLog.estimateContext.backsplash}! What edge style do you prefer? Eased, Bullnose, Ogee, or Waterfall?`;
            quickReplies = ['Eased', 'Bullnose', 'Ogee', 'Waterfall'];
          } else {
            responseMessage = `Please choose a backsplash: 4", 6", Full Height, or None.`;
            quickReplies = ['4"', '6"', 'Full Height', 'None'];
          }
        } else if (chatLog.estimateContext.step === 'edge') {
          const edges = ['eased', 'bullnose', 'ogee', 'waterfall'];
          if (edges.some(e => userMessage.includes(e))) {
            chatLog.estimateContext.edge = edges.find(e => userMessage.includes(e));
            chatLog.estimateContext.step = 'cutouts';
            responseMessage = `Edge style set to ${chatLog.estimateContext.edge}! Any cutouts needed? Sink, Faucet, Cooktop, or None?`;
            quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None'];
          } else {
            responseMessage = `Please choose an edge style: Eased, Bullnose, Ogee, or Waterfall.`;
            quickReplies = ['Eased', 'Bullnose', 'Ogee', 'Waterfall'];
          }
        } else if (chatLog.estimateContext.step === 'cutouts') {
          const cutouts = ['sink', 'faucet', 'cooktop', 'none'];
          if (cutouts.some(c => userMessage.includes(c))) {
            if (userMessage.includes('none')) {
              chatLog.estimateContext.cutouts = [];
              chatLog.estimateContext.step = 'demo';
              responseMessage = `No cutouts needed. Do you require demolition of an existing countertop? Options: Light ($5/sqft), Heavy ($10/sqft), or None.`;
              quickReplies = ['Light', 'Heavy', 'None'];
            } else {
              chatLog.estimateContext.cutouts = chatLog.estimateContext.cutouts || [];
              chatLog.estimateContext.cutouts.push(...cutouts.filter(c => userMessage.includes(c) && c !== 'none'));
              responseMessage = `Added ${cutouts.filter(c => userMessage.includes(c)).join(', ')} cutout(s). Any more? Sink, Faucet, Cooktop, or None.`;
              quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None'];
            }
          } else {
            responseMessage = `Please specify cutouts: Sink, Faucet, Cooktop, or None.`;
            quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None'];
          }
        } else if (chatLog.estimateContext.step === 'demo') {
          const demoOptions = ['light', 'heavy', 'none'];
          if (demoOptions.some(d => userMessage.includes(d))) {
            chatLog.estimateContext.demo = demoOptions.find(d => userMessage.includes(d));
            chatLog.estimateContext.step = 'plumbing';
            responseMessage = `Demolition set to ${chatLog.estimateContext.demo}. Will you need plumbing services to connect a new sink or faucet? (Flat rate: $500)`;
            quickReplies = ['Yes', 'No'];
          } else {
            responseMessage = `Please choose a demolition option: Light ($5/sqft), Heavy ($10/sqft), or None.`;
            quickReplies = ['Light', 'Heavy', 'None'];
          }
        } else if (chatLog.estimateContext.step === 'plumbing') {
          const plumbingOptions = ['yes', 'no'];
          if (plumbingOptions.some(p => userMessage.includes(p))) {
            chatLog.estimateContext.plumbing = userMessage.includes('yes');
            chatLog.estimateContext.step = 'sample';
            responseMessage = `Plumbing set to ${chatLog.estimateContext.plumbing ? 'Yes' : 'No'}. Would you like to order a material sample? Available sizes: 3x3" ($10), 4x6" ($15), 5x10" ($25), or None.`;
            quickReplies = ['3x3"', '4x6"', '5x10"', 'None'];
          } else {
            responseMessage = `Please specify if you need plumbing: Yes or No.`;
            quickReplies = ['Yes', 'No'];
          }
        } else if (chatLog.estimateContext.step === 'sample') {
          const sampleSizes = ['3x3"', '4x6"', '5x10"', 'none'];
          if (sampleSizes.some(s => userMessage.includes(s))) {
            chatLog.estimateContext.sampleSize = sampleSizes.find(s => userMessage.includes(s));
            const estimateData = {
              layout: chatLog.estimateContext.layout,
              dimensions: chatLog.estimateContext.dimensions,
              material: chatLog.estimateContext.material,
              sessionId,
              backsplash: chatLog.estimateContext.backsplash,
              edge: chatLog.estimateContext.edge,
              cutouts: chatLog.estimateContext.cutouts,
              demo: chatLog.estimateContext.demo,
              plumbing: chatLog.estimateContext.plumbing,
              sampleSize: chatLog.estimateContext.sampleSize,
            };
            const estimateResponse = await axios.post(`http://localhost:${PORT}/api/estimate`, estimateData);
            responseMessage = estimateResponse.data.message;
            quickReplies = estimateResponse.data.quickReplies;
            chatLog.estimateContext = {};
          } else {
            responseMessage = `Please choose a sample size: 3x3" ($10), 4x6" ($15), 5x10" ($25), or None.`;
            quickReplies = ['3x3"', '4x6"', '5x10"', 'None'];
          }
        }

        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies,
        });
      }

      // Handle estimate request
      if (userMessage.includes('estimate') || userMessage.includes('quote') || userMessage.includes('countertop') || userMessage.includes('start quote')) {
        const matchedMaterial = materials.find(item => fuzzyMatch(item.name, userMessage));
        if (matchedMaterial) {
          chatLog.estimateContext = { step: 'space', material: matchedMaterial.name };
          const responseMessage = `Great choice with ${matchedMaterial.name} ${matchedMaterial.material}! Is this countertop for a Kitchen, Bathroom, or Other space?`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({
            message: responseMessage,
            quickReplies: ['Kitchen', 'Bathroom', 'Other'],
          });
        } else {
          chatLog.estimateContext = { step: 'space' };
          const responseMessage = `Let’s get started on your countertop estimate! Is this for a Kitchen, Bathroom, or Other space?`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({
            message: responseMessage,
            quickReplies: ['Kitchen', 'Bathroom', 'Other'],
          });
        }
      }

      // Handle feedback
      if (['great', 'too high', 'new quote', 'order sample'].includes(userMessage)) {
        chatLog.feedback = chatLog.feedback || [];
        chatLog.feedback.push({
          question: 'Is this price fair?',
          response: userMessage,
        });
        const responseMessage = `Thanks for your feedback! ${userMessage === 'great' ? 'Glad you like the price!' : userMessage === 'too high' ? 'Let’s explore more affordable options.' : userMessage === 'order sample' ? 'Let’s order your sample!' : 'Let’s start a new quote.'} Want to browse materials or book a consultation?`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
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
        const imageUrl = matchedProduct.image?.src || 'https://via.placeholder.com/150?text=No+Image';
        const description = matchedProduct.body_html ? matchedProduct.body_html.replace(/<[^>]+>/g, '').substring(0, 100) + '...' : 'No description available.';
        logger.info(`Matched product: ${matchedProduct.title}`);
        const responseMessage = `The "${matchedProduct.title}" is priced at $${price.toFixed(2)}. ${description} <a href="${productUrl}" target="_blank">View on our store</a>. ${matchedProduct.title.toLowerCase().includes('countertop') ? 'Want a custom quote for this?' : 'Need a countertop to match?'} Let’s get an estimate or explore more!`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          image: imageUrl,
          productUrl,
          quickReplies: ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
        });
      }

      // Generic response with OpenAI
      const systemPrompt = {
  role: 'system',
  content: `
    You are Surprise Granite's AI assistant, located at 11560 N Dysart Rd, Surprise, AZ 85379. We specialize in custom countertops (Granite, Quartz, Marble, Quartzite) and remodeling solutions like tile, semi-custom cabinetry, and kitchen/bath fixtures (sinks, faucets, shower heads, accessories). Your tasks include:
    - Engaging users with a warm, conversational tone, like a friendly expert guiding a neighbor.
    - Personalizing responses using client data (e.g., name, previous material preferences) when available.
    - Assisting with Shopify store navigation (store.surprisegranite.com), linking products/services with images and descriptions.
    - Guiding users through countertop estimates (space, style, layout, dimensions, material, backsplash, edge, cutouts, demo, plumbing, sample) or suggesting the "Get Quote" button.
    - Providing accurate material pricing (e.g., $${materialPrice}/sqft installed) using the cost * 3.25 + $26 model.
    - Saving bids in MongoDB and asking for feedback (e.g., "Does this quote work for you?").
    - Offering sample sizes (3x3" for $10, 4x6" for $15, 5x10" for $25).
    - Suggesting complementary products (e.g., sinks for countertops) with hyperlinks.
    - Avoiding contact info; direct users to footer buttons for calling (602) 833-3189 or messaging.
    - Referencing past chats to maintain context (e.g., "Last time, you liked Quartz. Still interested?").
  `
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
        quickReplies: ['Get Quote', 'Browse Materials', 'Design Ideas', 'Book Consultation'],
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

// Training Data Endpoint
app.get('/api/train', async (req, res) => {
  try {
    const logs = await ChatLog.find({}).limit(1000).sort({ updatedAt: -1 });
    const trainingData = logs.flatMap(log =>
      log.messages.reduce((acc, msg, idx, arr) => {
        if (msg.role === 'user' && idx + 1 < arr.length && arr[idx + 1].role === 'assistant') {
          acc.push({
            messages: [
              { role: 'system', content: systemPrompt.content },
              { role: 'user', content: msg.content },
              { role: 'assistant', content: arr[idx + 1].content }
            ]
          });
        }
        return acc;
      }, [])
    );
    const jsonl = trainingData.map(item => JSON.stringify(item)).join('\n');
    res.set('Content-Type', 'application/jsonl');
    res.send(jsonl);
  } catch (error) {
    logger.error(`Training data error: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate training data.' });
  }
});

// Default Route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sg-chatbot-widget.html'));
});

// Chatbot Widget Route
app.get('/sg-chatbot-widget.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sg-chatbot-widget.html'));
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
