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

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 1800 });

// Logger setup
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
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

app.set('trust proxy', 1);

// Environment variable validation
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
    logger.error(`Missing env var: ${key}`);
    process.exit(1);
  }
});

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => {
    logger.error('MongoDB error:', err);
    process.exit(1);
  });

// Mongoose models
const Countertop = mongoose.model('Countertop', new mongoose.Schema({
  name: String,
  material: String,
  thickness: String,
  price_per_sqft: Number,
  image_url: String,
}));

const ChatLog = mongoose.model('ChatLog', new mongoose.Schema({
  sessionId: String,
  clientId: String,
  clientEmail: String,
  location: String,
  messages: [{ role: String, content: String, createdAt: { type: Date, default: Date.now } }],
  appointmentRequested: Boolean,
  bids: [{
    type: String,
    layout: String,
    dimensions: [{ length: Number, width: Number, isInches: Boolean, area: Number }],
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
    damageType: String,
    severity: String,
    edgeType: String,
    backsplash: String,
    cutouts: [String],
    createdAt: { type: Date, default: Date.now },
  }],
  feedback: [{ question: String, response: String, createdAt: { type: Date, default: Date.now } }],
  abandoned: { type: Boolean, default: false },
  lastActivity: { type: Date, default: Date.now },
  estimateContext: {
    flow: String,
    step: String,
    space: String,
    style: String,
    layout: String,
    dimensions: [{ length: Number, width: Number, isInches: Boolean, area: Number }],
    totalArea: Number,
    material: String,
    edgeType: String,
    backsplash: String,
    cutouts: [String],
    demo: String,
    plumbing: Boolean,
    sampleSize: String,
    damageType: String,
    severity: String,
  },
}, { timestamps: true }));

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// Send chat transcript
async function sendChatTranscript(chatLog) {
  const messages = chatLog.messages.map(msg => `${msg.role.toUpperCase()} (${msg.createdAt.toLocaleString()}): ${msg.content}`).join('\n');
  const bids = chatLog.bids?.map(bid =>
    `Bid (${bid.createdAt.toLocaleString()}):\n` +
    `- Type: ${bid.type}\n` +
    `- Layout: ${bid.layout || 'N/A'}\n` +
    `- Dimensions: ${bid.dimensions?.map(d => `${d.length}x${d.width} ${d.isInches ? 'in' : 'ft'} (${d.area.toFixed(2)} sqft)`).join(', ') || 'N/A'}\n` +
    `- Material: ${bid.material || 'N/A'}\n` +
    `- Waste Factor: ${(bid.wasteFactor * 100 || 0).toFixed(0)}%\n` +
    `- Material Cost: $${(bid.materialCost || 0).toFixed(2)}\n` +
    `- Fabrication: $${(bid.fabricationCost || 0).toFixed(2)}\n` +
    `- Installation: $${(bid.installationCost || 0).toFixed(2)}\n` +
    `- Demo Cost: $${(bid.demoCost || 0).toFixed(2)}\n` +
    `- Plumbing Cost: $${(bid.plumbingCost || 0).toFixed(2)}\n` +
    `- Total: $${(bid.totalCost || 0).toFixed(2)}\n` +
    `- Margin: ${(bid.margin * 100 || 0).toFixed(0)}%\n` +
    `- Sample Size: ${bid.sampleSize || 'None'}\n` +
    `- Edge Type: ${bid.edgeType || 'N/A'}\n` +
    `- Backsplash: ${bid.backsplash || 'N/A'}\n` +
    `- Cutouts: ${bid.cutouts?.join(', ') || 'None'}\n` +
    `- Damage Type: ${bid.damageType || 'N/A'}\n` +
    `- Severity: ${bid.severity || 'N/A'}`
  ).join('\n\n') || 'No bids';
  const feedback = chatLog.feedback?.map(fb =>
    `Feedback (${fb.createdAt.toLocaleString()}): ${fb.question} -> ${fb.response}`
  ).join('\n') || 'No feedback';

  const emailContent = `
Chat Transcript (Session ID: ${chatLog.sessionId})
Status: ${chatLog.abandoned ? 'Abandoned' : 'Closed'}
Last Activity: ${chatLog.lastActivity.toLocaleString()}
Location: ${chatLog.location || 'N/A'}
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
  message: 'Too many requests.',
}));

// Utility functions
function normalizeInput(input) {
  return input.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
}

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

async function fetchCsvData(url, cacheKey) {
  let data = cache.get(cacheKey);
  if (data) {
    logger.info(`Cache hit for ${cacheKey}, ${data.length} rows`);
    return data;
  }
  try {
    logger.info(`Fetching CSV from ${url}`);
    const response = await axios.get(url, { timeout: 10000 });
    if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
    if (!response.data || typeof response.data !== 'string') throw new Error(`Invalid CSV data`);
    data = parse(response.data, { columns: true, skip_empty_lines: true, trim: true });
    if (!data || data.length === 0) throw new Error(`Empty CSV`);
    logger.info(`Parsed CSV from ${url}, ${data.length} rows`);
    cache.set(cacheKey, data);
    return data;
  } catch (error) {
    logger.error(`Error fetching CSV (${cacheKey}): ${error.message}`);
    cache.delete(cacheKey);
    throw error;
  }
}

async function fetchMaterials() {
  try {
    const csvData = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
    return csvData.map(item => ({
      name: item['Color Name'],
      material: item['Material'] || '',
      vendor: item['Vendor'] || 'Unknown Vendor',
      costPerSquare2cm: parseFloat(item['Cost/SqFt 2cm']) || 0,
      costPerSquare3cm: parseFloat(item['Cost/SqFt 3cm']) || 0,
      thickness: item['Thickness'] || '',
      imageUrl: item['image_url'] || ''
    })).filter(m => m.name && (m.costPerSquare2cm > 0 || m.costPerSquare3cm > 0));
  } catch (error) {
    logger.error('Failed to fetch materials:', error.message);
    throw new Error('Material pricing data is unavailable.');
  }
}

function calculateInstalledPrice(costPerSquare, thickness) {
  const markup = 3.25; // Your markup multiplier
  const baseFee = 45; // Base fee per sqft
  const thicknessMultiplier = thickness === '3cm' ? 1.2 : 1; // Add a multiplier for 3cm
  return ((costPerSquare * markup + baseFee) * thicknessMultiplier).toFixed(2);
}

function fuzzyMatch(str, pattern) {
  if (!str || !pattern) return false;
  const cleanStr = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanStr.includes(cleanPattern) || cleanPattern.includes(cleanStr);
}

function extractDimensions(message) {
  const dimensionRegex = /(\d+\.?\d*)\s*(x|by|\*)\s*(\d+\.?\d*)\s*(in|ft|inches|feet)?/gi;
  const matches = [...message.matchAll(dimensionRegex)];
  if (matches.length === 0) {
    return { error: 'Invalid dimensions. Please provide dimensions like "24x24 in" or "5x3 ft".' };
  }
  const dimensions = matches.map(match => {
    const length = parseFloat(match[1]);
    const width = parseFloat(match[3]);
    const unit = (match[4] || 'in').toLowerCase();
    const isInches = unit === 'in' || unit === 'inches';
    const area = isInches ? (length * width) / 144 : length * width;
    return { length, width, area, isInches };
  });
  const totalArea = dimensions.reduce((sum, dim) => sum + dim.area, 0).toFixed(2);
  return { dimensions, totalArea: parseFloat(totalArea) };
}

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

async function searchLocalFabricators(location) {
  try {
    return [
      { name: 'AZ Stone Works', address: '123 Granite Rd, Surprise, AZ', rating: 4.5 },
      { name: 'Granite Pros', address: '456 Marble St, Phoenix, AZ', rating: 4.2 },
    ];
  } catch (error) {
    logger.error(`Fabricator search error: ${error.message}`);
    return [];
  }
}

// Routes
app.get('/api/materials', async (req, res) => {
  try {
    const materials = await fetchMaterials();
    res.json(materials.map(m => ({
      ...m,
      installedPrice: calculateInstalledPrice(m.costPerSquare2cm || m.costPerSquare3cm, m.thickness)
    })));
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials.' });
  }
});

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
      description: product.body_html ? product.body_html.replace(/<[^>]+>/g, '').substring(0, 100) + '...' : 'No description.',
    }));
    res.json(formattedProducts);
  } catch (error) {
    logger.error(`Shopify products fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch Shopify products.' });
  }
});

app.post('/api/appointment', async (req, res) => {
  const { name, email, city, date, time, sessionId } = req.body;
  if (!name || !email || !date || !time) {
    return res.status(400).json({ error: 'Name, email, date, time required.' });
  }

  try {
    let chatLog = await ChatLog.findOne({ sessionId });
    if (!chatLog) {
      chatLog = new ChatLog({ sessionId, messages: [] });
    }
    chatLog.appointmentRequested = true;
    chatLog.location = city || chatLog.location;
    chatLog.messages.push({
      role: 'system',
      content: `Appointment: ${name}, ${email}, ${city || 'N/A'}, ${date}, ${time}`,
    });
    chatLog.lastActivity = new Date();
    await chatLog.save();

    await axios.post('https://usebasin.com/f/0e1679dd8d79', { name, email, city, date, time });

    const responseMessage = `Appointment booked for ${name} on ${date} at ${time}! We'll confirm via email.`;
    chatLog.messages.push({ role: 'assistant', content: responseMessage });
    await chatLog.save();

    res.json({ message: responseMessage });
  } catch (error) {
    logger.error(`Appointment error: ${error.message}`);
    res.status(500).json({ error: 'Failed to book appointment.' });
  }
});

app.post('/api/billing', async (req, res) => {
  const { sessionId, issue, details } = req.body;
  if (!sessionId || !issue) {
    return res.status(400).json({ error: 'Session ID, issue required.' });
  }

  try {
    let chatLog = await ChatLog.findOne({ sessionId });
    if (!chatLog) {
      return res.status(404).json({ error: 'Chat session not found.' });
    }

    const responseMessage = `Billing concern (${issue}) noted. We'll contact you at ${chatLog.clientEmail || 'provided email'}. Call (602) 833-3189 for urgent issues.`;
    chatLog.messages.push(
      { role: 'system', content: `Billing issue: ${issue}, Details: ${details || 'None'}` },
      { role: 'assistant', content: responseMessage }
    );
    chatLog.lastActivity = new Date();
    await chatLog.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'billing@surprisegranite.com',
      subject: `Billing Inquiry: Session ${sessionId}`,
      text: `Issue: ${issue}\nDetails: ${details || 'None'}\nEmail: ${chatLog.clientEmail || 'N/A'}\nSession ID: ${sessionId}`,
    });

    res.json({ message: responseMessage });
  } catch (error) {
    logger.error(`Billing error: ${error.message}`);
    res.status(500).json({ error: 'Failed to process billing inquiry.' });
  }
});

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

app.post('/api/close-chat', async (req, res) => {
  const { sessionId, abandoned } = req.body;
  try {
    const chatLog = await ChatLog.findOne({ sessionId });
    if (chatLog) {
      chatLog.abandoned = abandoned || false;
      chatLog.lastActivity = new Date();
      await chatLog.save();
      await sendChatTranscript(chatLog);
      res.json({ message: 'Chat closed.' });
    } else {
      res.status(404).json({ error: 'Chat session not found.' });
    }
  } catch (error) {
    logger.error(`Close chat error: ${error.message}`);
    res.status(500).json({ error: 'Failed to close chat.' });
  }
});

app.post('/api/estimate', async (req, res) => {
  const { type, layout, dimensions, totalArea, material, sessionId, backsplash, edgeType, cutouts, demo, plumbing, sampleSize, damageType, severity } = req.body;
  if (!type || !sessionId || (!material && type !== 'repair') || (!dimensions && !totalArea)) {
    return res.status(400).json({ error: 'Type, sessionId, material (if not repair), dimensions or totalArea required.' });
  }

  try {
    let chatLog = await ChatLog.findOne({ sessionId });
    if (!chatLog) {
      chatLog = new ChatLog({ sessionId, messages: [] });
    }

    if (type === 'repair' && (!damageType || !severity)) {
      return res.status(400).json({ error: 'Damage type, severity required for repair.' });
    }

    let responseMessage = '';
    let bid = {};

    if (type === 'repair') {
      const baseRepairCost = severity === 'minor' ? 150 : severity === 'moderate' ? 300 : 500;
      const materialCost = damageType.includes('stain') ? 50 : damageType.includes('crack') ? 100 : 75;
      const totalCost = baseRepairCost + materialCost;

      responseMessage = `Repair estimate for ${damageType} (${severity}):\n` +
        `- Base Repair: $${baseRepairCost.toFixed(2)}\n` +
        `- Materials: $${materialCost.toFixed(2)}\n` +
        `- Total: $${totalCost.toFixed(2)}\n` +
        `Schedule a technician visit to confirm?`;

      bid = { type: 'repair', damageType, severity, materialCost, totalCost };
    } else {
      const priceList = await fetchMaterials();
      const matchedMaterial = type !== 'general' ? priceList.find(item => fuzzyMatch(item.name, material)) : null;
      if (!matchedMaterial && type !== 'general') {
        responseMessage = `I couldn’t find that material. Please visit our showroom or browse our collection online at store.surprisegranite.com.`;
        chatLog.messages.push(
          { role: 'user', content: `Estimate: ${type}, ${layout}, ${JSON.stringify(dimensions || totalArea)}, ${material}` },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({ message: responseMessage, quickReplies: ['Quote', 'Materials', 'Sinks', 'Appointment'] });
      }

      let calculatedTotalArea = totalArea;
      if (!totalArea && dimensions) {
        calculatedTotalArea = parseFloat(dimensions.reduce((sum, dim) => {
          const area = dim.area || (dim.length * dim.width) / (dim.isInches ? 144 : 1);
          return sum + parseFloat(area.toFixed(4));
        }, 0).toFixed(2));
      }

      if (type === 'general') {
        const lowCostMaterial = priceList.reduce((min, m) => (m.costPerSquare2cm || m.costPerSquare3cm) < (min.costPerSquare2cm || min.costPerSquare3cm) ? m : min, priceList[0]);
        const highCostMaterial = priceList.reduce((max, m) => (m.costPerSquare2cm || m.costPerSquare3cm) > (max.costPerSquare2cm || max.costPerSquare3cm) ? m : max, priceList[0]);
        const lowPrice = calculateInstalledPrice(lowCostMaterial.costPerSquare2cm || lowCostMaterial.costPerSquare3cm, lowCostMaterial.thickness);
        const highPrice = calculateInstalledPrice(highCostMaterial.costPerSquare2cm || highCostMaterial.costPerSquare3cm, highCostMaterial.thickness);
        const estimatedArea = calculatedTotalArea || 50;
        const wasteFactor = 0.20;
        const adjustedArea = estimatedArea * (1 + wasteFactor);

        responseMessage = `General ${layout || 'countertop'} estimate (~${estimatedArea} sqft):\n` +
          `- Low (${lowCostMaterial.name}): $${(adjustedArea * lowPrice).toFixed(2)} ($${lowPrice}/sqft)\n` +
          `- High (${highCostMaterial.name}): $${(adjustedArea * highPrice).toFixed(2)} ($${highPrice}/sqft)\n` +
          `- Includes 20% waste\n` +
          `Want a detailed quote?`;

        bid = { type: 'general', layout, wasteFactor, totalCost: (adjustedArea * highPrice).toFixed(2) };
      } else {
        const wasteFactor = 0.20;
        const adjustedArea = calculatedTotalArea * (1 + wasteFactor);
        const materialPrice = parseFloat(matchedMaterial.costPerSquare2cm || matchedMaterial.costPerSquare3cm) || 50;
        const installedPrice = calculateInstalledPrice(materialPrice, matchedMaterial.thickness);
        const materialCost = adjustedArea * parseFloat(installedPrice);
        let laborCostPerSqft = 65;
        try {
          const laborData = await fetchCsvData(process.env.PUBLISHED_CSV_LABOR, 'labor_costs');
          laborCostPerSqft = getLaborCostPerSqft(laborData, matchedMaterial.material);
        } catch (error) {
          logger.error(`Failed to fetch labor costs: ${error.message}`);
        }
        const fabricationCost = calculatedTotalArea * 50;
        const installationCost = calculatedTotalArea * 15;
        const demoCost = demo === 'Light' ? calculatedTotalArea * 5 : demo === 'Heavy' ? calculatedTotalArea * 10 : 0;
        const plumbingCost = plumbing ? 500 : 0;
        const laborCost = adjustedArea * laborCostPerSqft;
        const subtotal = materialCost + laborCost + demoCost + plumbingCost;
        const margin = 0.50;
        const totalCost = subtotal / (1 - margin);
        const sampleCost = sampleSize === '3x3"' ? 10 : sampleSize === '4x6"' ? 15 : sampleSize === '5x10"' ? 25 : 0;

        responseMessage = `Here’s your estimate for a ${layout} countertop using ${matchedMaterial.name} (${matchedMaterial.material}, ${matchedMaterial.thickness || 'unknown'}):\n` +
          `- Area: ${calculatedTotalArea.toFixed(2)} sqft (+${(wasteFactor * 100).toFixed(0)}% waste = ${adjustedArea.toFixed(2)} sqft)\n` +
          `- Material: $${materialCost.toFixed(2)} ($${installedPrice}/sqft installed)\n` +
          `- Fabrication: $${fabricationCost.toFixed(2)} ($50/sqft)\n` +
          `- Installation: $${installationCost.toFixed(2)} ($15/sqft)\n` +
          (demo ? `- Demolition (${demo}): $${demoCost.toFixed(2)}\n` : '') +
          (plumbing ? `- Plumbing: $${plumbingCost.toFixed(2)}\n` : '') +
          `- Total: $${totalCost.toFixed(2)}\n` +
          `Would you like to proceed with this estimate or make adjustments?`;

        bid = {
          type,
          layout,
          dimensions,
          material: matchedMaterial.name,
          wasteFactor,
          fabricationCost,
          installationCost,
          materialCost,
          demoCost,
          plumbingCost,
          totalCost: totalCost + sampleCost,
          margin,
          sampleSize,
          edgeType,
          backsplash,
          cutouts,
        };
      }

      try {
        chatLog.messages.push(
          { role: 'user', content: `Estimate: ${type}, ${layout || damageType}, ${JSON.stringify(dimensions || totalArea)}` },
          { role: 'assistant', content: responseMessage }
        );
        chatLog.feedback.push({ question: 'Is this quote acceptable?', response: 'Pending' });
        chatLog.estimateContext = {};
        await chatLog.save();

        logger.info(`Estimate generated: ${responseMessage}`);
        res.json({
          message: responseMessage,
          bid,
          image: bid.material ? (await fetchMaterials()).find(m => m.name === bid.material)?.imageUrl : null,
          quickReplies: type === 'general' ? ['Detailed Quote', 'Materials', 'Sinks', 'Appointment'] : ['Confirm', 'Too High', 'New Quote', 'Order Sample', 'Book Consultation'],
        });
      } catch (error) {
        logger.error(`Estimate save error: ${error.message}`);
        res.status(500).json({ error: 'Failed to generate estimate.' });
      }
    }
  } catch (error) {
    logger.error(`Estimate error: ${error.message}`);
    res.status(500).json({ error: 'Failed to generate estimate.' });
  }
});

app.post(
  '/api/chat',
  [body('message').isString().trim().isLength({ max: 1000 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const userMessage = req.body.message.toLowerCase().trim();
      const sessionId = req.body.sessionId || `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const clientId = req.body.clientId || `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const clientEmail = req.body.clientEmail || null;
      const location = req.body.location || 'Unknown';

      logger.info(`Request ID: ${req.headers['x-request-id'] || 'unknown'}, Session: ${sessionId}, Client: ${clientId}, Message: ${userMessage}`);

      let chatLog = await ChatLog.findOne({ sessionId });
      if (!chatLog) {
        chatLog = new ChatLog({ sessionId, clientId, clientEmail, location, messages: [], estimateContext: {} });
      } else if (!chatLog.clientId) {
        chatLog.clientId = clientId;
        chatLog.clientEmail = clientEmail;
        chatLog.location = location;
      }
      chatLog.lastActivity = new Date();

      const priorChats = await ChatLog.find({ clientId, sessionId: { $ne: sessionId } })
        .sort({ updatedAt: -1 })
        .limit(3);
      const priorContext = priorChats.flatMap(log =>
        log.messages.slice(-3).map(msg => ({ role: msg.role, content: msg.content }))
      );

      const conversationHistory = chatLog.messages.slice(-5).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      console.log('Current context:', chatLog.estimateContext);
      console.log('User message:', userMessage);

      const NAV_LINKS = {
        store: { url: 'https://store.surprisegranite.com/', text: 'Surprise Granite online store' },
        samples: { url: 'https://store.surprisegranite.com/collections/countertop-samples', text: 'samples' },
        countertops: { url: 'https://www.surprisegranite.com/materials/all-countertops', text: 'countertops' },
        granite: { url: 'https://store.surprisegranite.com/collections/granite', text: 'granite collection' },
        quartz: { url: 'https://store.surprisegranite.com/collections/quartz', text: 'quartz collection' },
        sinks: { url: 'https://store.surprisegranite.com/collections/sinks', text: 'sinks' },
        map: { url: 'https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379', text: 'our location' }
      };

      const resetEstimateContext = () => {
        chatLog.estimateContext = {};
        chatLog.lastActivity = new Date();
      };

      if (chatLog.lastActivity < new Date(Date.now() - 5 * 60 * 1000)) {
        resetEstimateContext();
      }

      const greetings = ['hello', 'hi', 'hey', 'greetings'];
      if (greetings.some(g => userMessage.includes(g))) {
        resetEstimateContext();
        const responseMessage = priorChats.length > 0
          ? `Welcome back! 😊 How can I assist with your countertop needs today?`
          : `Hello! Welcome to Surprise Granite! 😊 I’m here for countertop quotes, repairs, designs, or customer service. What’s up?`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Quote', 'Repair', 'Design', 'Appointment', 'Billing'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('what can you do') || userMessage.includes('how can you help')) {
        resetEstimateContext();
        const responseMessage = `I can:\n` +
          `- Quote countertops\n` +
          `- Estimate repairs\n` +
          `- Suggest designs\n` +
          `- Schedule consultations\n` +
          `- Handle billing\n` +
          `- Find local fabricators\n` +
          `- Help shop online\n` +
          `What’s next?`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Quote', 'Repair', 'Design', 'Appointment', 'Billing', 'Fabricators'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('sample size') || userMessage.includes('what size are your samples') || userMessage.includes('order sample')) {
        const responseMessage = `Our sample sizes for countertops are available in 3x3", 4x6", and 5x10" dimensions. These samples are a great way to visualize how the material will look in your space before making a decision. If you're interested in ordering samples or have any other questions, feel free to let me know!`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Quote', 'Materials', 'Sinks', 'Appointment'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('catalog') || userMessage.includes('send me a catalog')) {
        resetEstimateContext();
        const responseMessage = `Browse countertops at <a href="${NAV_LINKS.countertops.url}" target="_blank">${NAV_LINKS.countertops.text}</a>. Physical catalog? Use contact form.`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Contact', 'Quote', 'Materials', 'Sinks'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('repair') || userMessage.includes('fix') || userMessage.includes('crack') || userMessage.includes('chip') || userMessage.includes('scratch')) {
        chatLog.estimateContext = { flow: 'repair', step: 'damage_type' };
        const responseMessage = `What type of damage are we dealing with? Options: Crack, Chip, Scratch, Stain, or Other.`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Crack', 'Chip', 'Scratch', 'Stain', 'Other'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('design') || userMessage.includes('style') || userMessage.includes('modern') || userMessage.includes('rustic') || userMessage.includes('color')) {
        chatLog.estimateContext = { flow: 'design', step: 'space' };
        const responseMessage = `Let’s design! Kitchen, Bathroom, or Other space?`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
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

      if (userMessage.includes('appointment') || userMessage.includes('schedule') || userMessage.includes('consultation') || userMessage.includes('site visit') || userMessage.includes('reschedule')) {
        resetEstimateContext();
        const responseMessage = `Schedule: Showroom, Site Visit, or Reschedule?`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Showroom', 'Site Visit', 'Reschedule'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('billing') || userMessage.includes('bill') || userMessage.includes('payment') || userMessage.includes('refund') || userMessage.includes('charge')) {
        resetEstimateContext();
        const responseMessage = `Billing issue? Explain charge, make payment, refund, or other.`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Explain Charge', 'Make Payment', 'Request Refund', 'Other'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('showroom') || userMessage.includes('location') || userMessage.includes('business hours') || userMessage.includes('contact') || userMessage.includes('warranty') || userMessage.includes('brands')) {
        resetEstimateContext();
        let responseMessage = '';
        let quickReplies = ['Quote', 'Materials', 'Appointment', 'Billing'];
        if (userMessage.includes('location') || userMessage.includes('showroom')) {
          responseMessage = `Showroom: 11560 N Dysart Rd, Surprise, AZ 85379. <a href="${NAV_LINKS.map.url}" target="_blank">Directions</a>. Book a visit?`;
          quickReplies = ['Appointment', 'Quote', 'Materials', 'Sinks'];
        } else if (userMessage.includes('business hours')) {
          responseMessage = `Open Mon–Fri 9 AM–5 PM, Sat 10 AM–3 PM, closed Sun. Call (602) 833-3189. Schedule?`;
          quickReplies = ['Appointment', 'Quote', 'Materials', 'Contact'];
        } else if (userMessage.includes('contact') || userMessage.includes('warranty')) {
          responseMessage = `Contact: (602) 833-3189 or info@surprisegranite.com. Submit form?`;
          quickReplies = ['Contact', 'Quote', 'Billing', 'Appointment'];
        } else if (userMessage.includes('brands')) {
          responseMessage = `Brands: Arizona Tile, Kibi USA. Browse <a href="${NAV_LINKS.store.url}" target="_blank">${NAV_LINKS.store.text}</a>. Pick a material?`;
          quickReplies = ['Materials', 'Quote', 'Sinks', 'Appointment'];
        }
        chatLog.messages.push(
          { role: 'user', content: userMessage },
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

      if (userMessage.includes('fabricator') || userMessage.includes('installer') || userMessage.includes('local')) {
        resetEstimateContext();
        const fabricators = await searchLocalFabricators(chatLog.location || 'Surprise, AZ');
        const responseMessage = fabricators.length > 0
          ? `Local fabricators in ${chatLog.location || 'your area'}:\n` +
            fabricators.map(f => `- ${f.name} (${f.address}, Rating: ${f.rating}/5)`).join('\n') +
            `\nQuote or consult with one?`
          : `No fabricators found in ${chatLog.location || 'your area'}. Provide city (e.g., "Phoenix, AZ").`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: fabricators.length > 0 ? ['Quote', 'Appointment', 'Materials', 'Sinks'] : ['Provide Location', 'Quote', 'Materials', 'Appointment'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('how much is') || userMessage.includes('price of')) {
        const materials = await fetchMaterials();
        const matchedMaterial = materials.find(item => fuzzyMatch(item.name, userMessage));
        if (matchedMaterial) {
          if (userMessage.includes('3cm')) {
            const price3cm = calculateInstalledPrice(matchedMaterial.costPerSquare3cm, '3cm');
            responseMessage = `${matchedMaterial.name} (${matchedMaterial.material}) by ${matchedMaterial.vendor}:\n` +
              `- 3cm: $${price3cm}/sqft installed\n` +
              `Would you like a quote?`;
          } else if (userMessage.includes('2cm')) {
            const price2cm = calculateInstalledPrice(matchedMaterial.costPerSquare2cm, '2cm');
            responseMessage = `${matchedMaterial.name} (${matchedMaterial.material}) by ${matchedMaterial.vendor}:\n` +
              `- 2cm: $${price2cm}/sqft installed\n` +
              `Would you like a quote?`;
          } else {
            const price2cm = calculateInstalledPrice(matchedMaterial.costPerSquare2cm, '2cm');
            const price3cm = calculateInstalledPrice(matchedMaterial.costPerSquare3cm, '3cm');
            responseMessage = `${matchedMaterial.name} (${matchedMaterial.material}) by ${matchedMaterial.vendor}:\n` +
              `- 2cm: $${price2cm}/sqft installed\n` +
              `- 3cm: $${price3cm}/sqft installed\n` +
              `Would you like to proceed with a quote or explore more materials?`;
          }
          chatLog.messages.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({
            message: responseMessage,
            quickReplies: ['Quote', 'Materials', 'Sinks', 'Appointment'],
            clientId,
            sessionId
          });
        } else {
          const responseMessage = `I couldn’t find that material. Please provide the exact name or browse our collection online.`;
          chatLog.messages.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({
            message: responseMessage,
            quickReplies: ['Quote', 'Materials', 'Sinks', 'Appointment'],
            clientId,
            sessionId
          });
        }
      }

      const materials = await fetchMaterials();
      const matchedMaterial = materials.find(item => fuzzyMatch(item.name, userMessage));
      if (matchedMaterial && !chatLog.estimateContext.flow) {
        resetEstimateContext();
        const installedPrice = calculateInstalledPrice(matchedMaterial.costPerSquare2cm || matchedMaterial.costPerSquare3cm, matchedMaterial.thickness);
        const responseMessage = `${matchedMaterial.name} ${matchedMaterial.material}: $${installedPrice}/sqft. Quote, repair, or design?`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          image: matchedMaterial.imageUrl,
          quickReplies: ['Quote', 'Repair', 'Design', 'Order Sample'],
          clientId,
          sessionId
        });
      }

      if (userMessage.includes('quote')) {
        chatLog.estimateContext = { flow: 'quote', step: 'space' };
        responseMessage = `Let’s start your quote! Is this for a Kitchen, Bathroom, or Other space?`;
        quickReplies = ['Kitchen', 'Bathroom', 'Other'];
      }

      if (userMessage.includes('quote') || userMessage.includes('estimate') || userMessage.includes('countertop') || userMessage.includes('replace')) {
        chatLog.estimateContext = { flow: userMessage.includes('replace') ? 'replacement' : 'quote', step: 'space' };
        const responseMessage = priorChats.length > 0
          ? `Back for another ${chatLog.estimateContext.flow} estimate? Kitchen, Bathroom, or Other?`
          : `Let’s start your ${chatLog.estimateContext.flow} estimate! Kitchen, Bathroom, or Other?`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Kitchen', 'Bathroom', 'Other', 'General Estimate'],
          clientId,
          sessionId
        });
      }

      if (!chatLog.estimateContext.space) {
        responseMessage = `I didn’t quite catch that. Are you looking for a quote, materials, or something else?`;
        quickReplies = ['Quote', 'Materials', 'Sinks', 'Appointment'];
      }

      if (chatLog.estimateContext?.flow === 'quote' && chatLog.estimateContext.step === 'space') {
        const normalizedMessage = userMessage.toLowerCase().trim();
        if (normalizedMessage.includes('kitchen')) {
          chatLog.estimateContext.space = 'Kitchen';
          chatLog.estimateContext.step = 'style';
          responseMessage = `Great, a kitchen project! What style do you prefer? Modern, Traditional, Rustic, or Contemporary?`;
          quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
        } else {
          const spaces = ['kitchen', 'bathroom', 'other'];
          if (spaces.some(space => userMessage.toLowerCase().includes(space))) {
            chatLog.estimateContext.space = spaces.find(space => userMessage.toLowerCase().includes(space));
            chatLog.estimateContext.step = 'style'; // Move to the next step
            responseMessage = `Great, a ${chatLog.estimateContext.space} project! What style do you prefer? Modern, Traditional, Rustic, or Contemporary?`;
            quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
          } else {
            responseMessage = `Please specify the space, such as Kitchen, Bathroom, or Other.`;
            quickReplies = ['Kitchen', 'Bathroom', 'Other'];
          }
        }
      }

      if (chatLog.estimateContext?.flow) {
        let responseMessage = '';
        let quickReplies = ['Quote', 'Materials', 'Sinks', 'Appointment'];

        const exitIntents = ['browse', 'materials', 'sinks', 'faucets', 'showroom', 'visit', 'sample', 'appointment', 'billing', 'contact', 'catalog', 'fabricator'];
        if (exitIntents.some(intent => userMessage.includes(intent))) {
          resetEstimateContext();
          responseMessage = `Switching gears! Quote, browse materials, or else?`;
          chatLog.messages.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({
            message: responseMessage,
            quickReplies: ['Quote', 'Materials', 'Sinks', 'Appointment', 'Billing'],
            clientId,
            sessionId
          });
        }

        const areaCorrectionRegex = /(\d+\.?\d*)\s*(sq\s*ft|square\s*feet|sqft)/i;
        if ((chatLog.estimateContext.step === 'material' || chatLog.estimateContext.step === 'dimensions') && areaCorrectionRegex.test(userMessage)) {
          const correctedArea = parseFloat(userMessage.match(areaCorrectionRegex)[1]);
          chatLog.estimateContext.totalArea = correctedArea;
          chatLog.estimateContext.step = 'confirm_dimensions';
          responseMessage = `Correction noted: ${correctedArea} sqft. Confirm or re-enter dimensions (e.g., "72x26.5 in, 84x46 in").`;
          quickReplies = ['Confirm', 'Re-enter Dimensions', 'Fill Form', 'Need Help?'];
          chatLog.messages.push(
            { role: 'user', content: userMessage },
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

        if (chatLog.estimateContext.flow === 'repair') {
          if (chatLog.estimateContext.step === 'damage_type') {
            const damageTypes = ['crack', 'chip', 'scratch', 'stain', 'other'];
            if (damageTypes.some(type => userMessage.includes(type))) {
              chatLog.estimateContext.damageType = damageTypes.find(type => userMessage.includes(type));
              chatLog.estimateContext.step = 'severity';
              responseMessage = `Got it, a ${chatLog.estimateContext.damageType}. How severe is the damage? Minor, Moderate, or Major?`;
              quickReplies = ['Minor', 'Moderate', 'Major'];
            } else {
              responseMessage = `What type of damage are we dealing with? Options: Crack, Chip, Scratch, Stain, or Other.`;
              quickReplies = ['Crack', 'Chip', 'Scratch', 'Stain', 'Other'];
            }
          } else if (chatLog.estimateContext.step === 'severity') {
            const severities = ['minor', 'moderate', 'major'];
            if (severities.some(s => userMessage.includes(s))) {
              chatLog.estimateContext.severity = severities.find(s => userMessage.includes(s));
              const estimateData = {
                type: 'repair',
                sessionId,
                damageType: chatLog.estimateContext.damageType,
                severity: chatLog.estimateContext.severity,
              };
              const estimateResponse = await axios.post(`http://localhost:${PORT}/api/estimate`, estimateData);
              responseMessage = estimateResponse.data.message;
              quickReplies = estimateResponse.data.quickReplies;
              chatLog.estimateContext = {};
            } else {
              responseMessage = `Severity? Minor, Moderate, Major.`;
              quickReplies = ['Minor', 'Moderate', 'Major'];
            }
          }
        } else if (chatLog.estimateContext.flow === 'design') {
          if (chatLog.estimateContext.step === 'space') {
            const spaces = ['kitchen', 'bathroom', 'other'];
            if (spaces.some(space => userMessage.includes(space))) {
              chatLog.estimateContext.space = spaces.find(space => userMessage.includes(space));
              chatLog.estimateContext.step = 'style';
              responseMessage = `${chatLog.estimateContext.space} design! Style? Modern, Traditional, Rustic, Contemporary.`;
              quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
            } else {
              responseMessage = `Space? Kitchen, Bathroom, Other.`;
              quickReplies = ['Kitchen', 'Bathroom', 'Other'];
            }
          } else if (chatLog.estimateContext.step === 'style') {
            const styles = ['modern', 'traditional', 'rustic', 'contemporary'];
            if (styles.some(style => userMessage.includes(style))) {
              chatLog.estimateContext.style = styles.find(style => userMessage.includes(style));
              responseMessage = `${chatLog.estimateContext.style} ${chatLog.estimateContext.space}:\n` +
                `- Materials: ${chatLog.estimateContext.style === 'modern' ? 'Quartz, White Marble' : chatLog.estimateContext.style === 'rustic' ? 'Granite, Soapstone' : 'Marble, Quartzite'}\n` +
                `- Edges: ${chatLog.estimateContext.style === 'modern' ? 'Eased, Mitered' : chatLog.estimateContext.style === 'rustic' ? 'Chiseled, Rough' : 'Bullnose, Ogee'}\n` +
                `- Backsplash: ${chatLog.estimateContext.style === 'modern' ? 'Full Height Glass' : chatLog.estimateContext.style === 'rustic' ? 'Natural Stone' : '4" Tile'}\n` +
                `Materials or quote?`;
              quickReplies = ['Materials', 'Quote', 'Sinks', 'Appointment'];
              chatLog.estimateContext = {};
            } else {
              responseMessage = `Style? Modern, Traditional, Rustic, Contemporary.`;
              quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
            }
          }
        } else if (['quote', 'replacement'].includes(chatLog.estimateContext.flow)) {
          if (chatLog.estimateContext.step === 'space') {
            const spaces = ['kitchen', 'bathroom', 'other'];
            if (spaces.some(space => userMessage.includes(space))) {
              chatLog.estimateContext.space = spaces.find(space => userMessage.includes(space));
              chatLog.estimateContext.step = 'style';
              responseMessage = `${chatLog.estimateContext.space} ${chatLog.estimateContext.flow}! Style? Modern, Traditional, Rustic, Contemporary.`;
              quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
            } else if (userMessage.includes('general')) {
              const estimateData = { type: 'general', sessionId, layout: 'countertop' };
              const estimateResponse = await axios.post(`http://localhost:${PORT}/api/estimate`, estimateData);
              responseMessage = estimateResponse.data.message;
              quickReplies = estimateResponse.data.quickReplies;
              chatLog.estimateContext = {};
            } else {
              responseMessage = `Space? Kitchen, Bathroom, Other, or General Estimate.`;
              quickReplies = ['Kitchen', 'Bathroom', 'Other', 'General Estimate'];
            }
          } else if (chatLog.estimateContext.step === 'style') {
            const styles = ['modern', 'traditional', 'rustic', 'contemporary'];
            if (styles.some(style => userMessage.includes(style))) {
              chatLog.estimateContext.style = styles.find(style => userMessage.includes(style));
              chatLog.estimateContext.step = 'layout';
              responseMessage = `${chatLog.estimateContext.style} vibe! Layout? L-Shape, U-Shape, Galley, Island.`;
              quickReplies = ['L-Shape', 'U-Shape', 'Galley', 'Island'];
            } else {
              responseMessage = `Style? Modern, Traditional, Rustic, Contemporary.`;
              quickReplies = ['Modern', 'Traditional', 'Rustic', 'Contemporary'];
            }
          } else if (chatLog.estimateContext.step === 'layout') {
            const layouts = ['l-shape', 'u-shape', 'galley', 'island'];
            if (layouts.some(layout => userMessage.includes(layout))) {
              chatLog.estimateContext.layout = layouts.find(layout => userMessage.includes(layout));
              chatLog.estimateContext.step = 'dimensions';
              responseMessage = `${chatLog.estimateContext.layout} countertop! Dimensions (e.g., "72x26.5 in, 84x46 in") or total sqft? Use quote form?`;
              quickReplies = ['Enter Dimensions', 'Total Sqft', 'Fill Form', 'Need Help?'];
            } else {
              responseMessage = `Layout? L-Shape, U-Shape, Galley, Island.`;
              quickReplies = ['L-Shape', 'U-Shape', 'Galley', 'Island'];
            }
          } else if (chatLog.estimateContext.step === 'dimensions') {
            const normalizedMessage = normalizeInput(userMessage);

            if (['u shape', 'u-shape', 'ushape'].includes(normalizedMessage)) {
              chatLog.estimateContext.layout = 'U-Shape';
              chatLog.estimateContext.step = 'dimensions';
              responseMessage = `Got it, a U-Shape countertop! What are the dimensions? Provide in feet (e.g., "5x3 ft") or inches (e.g., "72x36 in"). Need help measuring?`;
            } else if (userMessage.includes('help') || userMessage.includes('measuring')) {
              responseMessage = `Measure length, width per section (e.g., "72x26.5 in, 84x46 in"). See <a href="${NAV_LINKS.store.url}/pages/measurement-guide" target="_blank">guide</a>. Enter dimensions or form?`;
              quickReplies = ['Enter Dimensions', 'Total Sqft', 'Fill Form', 'Skip'];
            } else if (userMessage.includes('form')) {
              responseMessage = `Fill out quote form for dimensions, material, etc. <a href="#" onclick="openQuoteForm()">Open Form</a>`;
              quickReplies = ['Enter Dimensions', 'Total Sqft', 'Skip'];
            } else {
              const dimensions = extractDimensions(userMessage);
              if (dimensions.totalArea || dimensions.dimensions.length > 0) {
                chatLog.estimateContext.dimensions = dimensions.dimensions;
                chatLog.estimateContext.totalArea = dimensions.totalArea;
                if (dimensions.totalArea > 100 || dimensions.totalArea < 5) {
                  chatLog.estimateContext.step = 'confirm_dimensions';
                  responseMessage = `Area: ${dimensions.totalArea} sqft, seems ${dimensions.totalArea > 100 ? 'large' : 'small'}. Confirm or re-enter?`;
                  quickReplies = ['Confirm', 'Re-enter Dimensions', 'Fill Form', 'Need Help?'];
                } else {
                  chatLog.estimateContext.step = 'material';
                  responseMessage = `Dimensions: ${dimensions.totalArea} sqft. Material? Granite, Quartz, Marble, Quartzite. Use form?`;
                  quickReplies = ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Fill Form'];
                }
              } else {
                responseMessage = `No dimensions. Enter (e.g., "72x26.5 in, 84x46 in") or sqft, or use form.`;
                quickReplies = ['Enter Dimensions', 'Total Sqft', 'Fill Form', 'Need Help?'];
              }
            }
          } else if (chatLog.estimateContext.step === 'confirm_dimensions') {
            if (userMessage.includes('confirm')) {
              chatLog.estimateContext.step = 'material';
              const totalArea = chatLog.estimateContext.totalArea.toFixed(2);
              responseMessage = `Confirmed: ${totalArea} sqft. Material? Granite, Quartz, Marble, Quartzite. Use form?`;
              quickReplies = ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Fill Form'];
            } else if (userMessage.includes('re-enter')) {
              chatLog.estimateContext.step = 'dimensions';
              responseMessage = `Re-enter dimensions (e.g., "72x26.5 in, 84x46 in") or sqft. Use form?`;
              quickReplies = ['Enter Dimensions', 'Total Sqft', 'Fill Form', 'Need Help?'];
            } else {
              responseMessage = `Confirm or re-enter dimensions. Use form?`;
              quickReplies = ['Confirm', 'Re-enter Dimensions', 'Fill Form', 'Need Help?'];
            }
          } else if (chatLog.estimateContext.step === 'material') {
            const matchedMaterial = materials.find(item => fuzzyMatch(item.name, userMessage));
            if (matchedMaterial) {
              chatLog.estimateContext.material = matchedMaterial.name;
              chatLog.estimateContext.step = 'edge_type';
              responseMessage = `${matchedMaterial.name} ${matchedMaterial.material}! Edge? Eased, Bullnose, Ogee, Waterfall.`;
              quickReplies = ['Eased', 'Bullnose', 'Ogee', 'Waterfall', 'Fill Form'];
            } else {
              responseMessage = `I couldn’t find that material. Try Granite, Quartz, Marble, Quartzite, or browse at store.surprisegranite.com.`;
              quickReplies = ['Granite', 'Quartz', 'Marble', 'Quartzite', 'Fill Form'];
            }
          } else if (chatLog.estimateContext.step === 'edge_type') {
            const edgeTypes = ['eased', 'bullnose', 'ogee', 'waterfall'];
            if (edgeTypes.some(e => userMessage.includes(e))) {
              chatLog.estimateContext.edgeType = edgeTypes.find(e => userMessage.includes(e));
              chatLog.estimateContext.step = 'backsplash';
              responseMessage = `Edge: ${chatLog.estimateContext.edgeType}. Backsplash? 4", 6", Full Height, None.`;
              quickReplies = ['4"', '6"', 'Full Height', 'None', 'Fill Form'];
            } else {
              responseMessage = `Edge? Eased, Bullnose, Ogee, Waterfall. Use form?`;
              quickReplies = ['Eased', 'Bullnose', 'Ogee', 'Waterfall', 'Fill Form'];
            }
          } else if (chatLog.estimateContext.step === 'backsplash') {
            const backsplashes = ['4"', '6"', 'full height', 'none'];
            if (backsplashes.some(b => userMessage.includes(b))) {
              chatLog.estimateContext.backsplash = backsplashes.find(b => userMessage.includes(b));
              chatLog.estimateContext.step = 'cutouts';
              responseMessage = `Backsplash: ${chatLog.estimateContext.backsplash}. Cutouts? Sink, Faucet, Cooktop, None.`;
              quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None', 'Fill Form'];
            } else {
              responseMessage = `Backsplash? 4", 6", Full Height, None. Use form?`;
              quickReplies = ['4"', '6"', 'Full Height', 'None', 'Fill Form'];
            }
          } else if (chatLog.estimateContext.step === 'cutouts') {
            const cutouts = ['sink', 'faucet', 'cooktop', 'none'];
            if (cutouts.some(c => userMessage.includes(c))) {
              if (userMessage.includes('none')) {
                chatLog.estimateContext.cutouts = [];
                chatLog.estimateContext.step = 'demo';
                responseMessage = `No cutouts. Demolition? Light ($5/sqft), Heavy ($10/sqft), None.`;
                quickReplies = ['Light', 'Heavy', 'None', 'Fill Form'];
              } else {
                chatLog.estimateContext.cutouts = chatLog.estimateContext.cutouts || [];
                chatLog.estimateContext.cutouts.push(...cutouts.filter(c => userMessage.includes(c) && c !== 'none'));
                responseMessage = `Added ${cutouts.filter(c => userMessage.includes(c)).join(', ')} cutout(s). More?`;
                quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None', 'Fill Form'];
              }
            } else {
              responseMessage = `Cutouts? Sink, Faucet, Cooktop, None. Use form?`;
              quickReplies = ['Sink', 'Faucet', 'Cooktop', 'None', 'Fill Form'];
            }
          } else if (chatLog.estimateContext.step === 'demo') {
            const demoOptions = ['light', 'heavy', 'none'];
            if (demoOptions.some(d => userMessage.includes(d))) {
              chatLog.estimateContext.demo = demoOptions.find(d => userMessage.includes(d));
              chatLog.estimateContext.step = 'plumbing';
              responseMessage = `Demolition: ${chatLog.estimateContext.demo}. Plumbing? ($500 flat).`;
              quickReplies = ['Yes', 'No', 'Fill Form'];
            } else {
              responseMessage = `Demolition? Light ($5/sqft), Heavy ($10/sqft), None. Use form?`;
              quickReplies = ['Light', 'Heavy', 'None', 'Fill Form'];
            }
          } else if (chatLog.estimateContext.step === 'plumbing') {
            const plumbingOptions = ['yes', 'no'];
            if (plumbingOptions.some(p => userMessage.includes(p))) {
              chatLog.estimateContext.plumbing = userMessage.includes('yes');
              chatLog.estimateContext.step = 'sample';
              responseMessage = `Plumbing: ${chatLog.estimateContext.plumbing ? 'Yes' : 'No'}. Sample? 3x3" ($10), 4x6" ($15), 5x10" ($25), None.`;
              quickReplies = ['3x3"', '4x6"', '5x10"', 'None', 'Fill Form'];
            } else {
              responseMessage = `Plumbing? Yes, No. Use form?`;
              quickReplies = ['Yes', 'No', 'Fill Form'];
            }
          } else if (chatLog.estimateContext.step === 'sample') {
            const sampleSizes = ['3x3"', '4x6"', '5x10"', 'none'];
            if (sampleSizes.some(s => userMessage.includes(s))) {
              chatLog.estimateContext.sampleSize = sampleSizes.find(s => userMessage.includes(s));
              const estimateData = {
                type: chatLog.estimateContext.flow,
                layout: chatLog.estimateContext.layout,
                dimensions: chatLog.estimateContext.dimensions,
                totalArea: chatLog.estimateContext.totalArea,
                material: chatLog.estimateContext.material,
                sessionId,
                backsplash: chatLog.estimateContext.backsplash,
                edgeType: chatLog.estimateContext.edgeType,
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
              responseMessage = `Sample? 3x3" ($10), 4x6" ($15), 5x10" ($25), None. Use form?`;
              quickReplies = ['3x3"', '4x6"', '5x10"', 'None', 'Fill Form'];
            }
          }
        }

        if (['confirm', 'too high', 'new quote'].includes(userMessage)) {
          const lastFeedback = chatLog.feedback[chatLog.feedback.length - 1];
          if (lastFeedback && lastFeedback.response === 'Pending') {
            lastFeedback.response = userMessage;
            let responseMessage = '';
            let quickReplies = ['Quote', 'Materials', 'Sinks', 'Appointment'];
            if (userMessage === 'confirm') {
              responseMessage = `Let’s finalize! Consult or buy online at <a href="${NAV_LINKS.store.url}" target="_blank">${NAV_LINKS.store.text}</a>?`;
              quickReplies = ['Book Consultation', 'Purchase Online', 'Order Sample', 'New Quote'];
            } else if (userMessage === 'too high') {
              responseMessage = `Feedback noted! Try different material or design?`;
              quickReplies = ['New Quote', 'Materials', 'Sinks', 'Appointment'];
            } else {
              responseMessage = `New quote! Kitchen, Bathroom, or Other?`;
              quickReplies = ['Kitchen', 'Bathroom', 'Other', 'General Estimate'];
              chatLog.estimateContext = { flow: 'quote', step: 'space' };
            }
            chatLog.messages.push(
              { role: 'user', content: userMessage },
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
        resetEstimateContext();
        const price = parseFloat(matchedProduct.variants[0].price) || 0;
        const productUrl = matchedProduct.online_store_url || `https://${process.env.SHOPIFY_SHOP}/products/${matchedProduct.handle}`;
        const imageUrl = matchedProduct.image?.src || 'https://via.placeholder.com/150?text=No+Image';
        const description = matchedProduct.body_html ? matchedProduct.body_html.replace(/<[^>]+>/g, '').substring(0, 100) + '...' : 'No description.';
        const responseMessage = `"${matchedProduct.title}": $${price.toFixed(2)}. ${description} <a href="${productUrl}" target="_blank">View</a>. Countertop?`;
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          image: imageUrl,
          productUrl,
          quickReplies: ['Quote', 'Materials', 'Sinks', 'Appointment'],
          clientId,
          sessionId
        });
      }

      const systemPrompt = {
        role: 'system',
        content: `
    You are Surprise Granite's AI assistant. Always use the provided price list and markup formula:
    - Pricing: (cost * 3.65 + $27)/sqft, with 20% waste.
    - Only recommend materials from the approved list.
    - Do not guess or provide unverified information.
    - If unsure, ask the user to clarify or refer them to the showroom.
    - Maintain a warm, professional tone.
  `
      };

      const messages = [
        systemPrompt,
        ...priorContext,
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
      logger.info(`AI response: ${aiMessage}`);

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
        quickReplies: ['Quote', 'Materials', 'Sinks', 'Appointment', 'Billing'],
        clientId,
        sessionId
      });
    } catch (err) {
      logger.error(`Chat error: ${err.message}`);
      const responseMessage = `I didn’t quite catch that. Are you looking for a repair, a quote, or something else?`;
      chatLog.messages.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: responseMessage }
      );
      await chatLog.save();
      return res.json({
        message: responseMessage,
        quickReplies: ['Repair', 'Quote', 'Materials', 'Appointment'],
        clientId,
        sessionId
      });
    }
  }
);

app.get('/api/train', async (req, res) => {
  try {
    const logs = await ChatLog.find({}).limit(1000).sort({ updatedAt: -1 });
    const trainingData = logs.flatMap(log =>
      log.messages.reduce((acc, msg, idx, arr) => {
        if (msg.role === 'user' && idx + 1 < arr.length && arr[idx + 1].role === 'assistant') {
          acc.push({
            messages: [
              { role: 'system', content: `You are Surprise Granite's AI assistant. Use provided pricing and maintain a professional tone.` },
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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sg-chatbot-widget.html'));
});

app.get('/sg-chatbot-widget.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sg-chatbot-widget.html'));
});

app.use((req, res) => {
  res.status(404).send('Page not found.');
});

// Process handlers
process.on('SIGTERM', () => {
  logger.info('SIGTERM. Shutting down...');
  mongoose.connection.close(() => {
    logger.info('MongoDB closed.');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught Exception: ${err.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  process.exit(1);
});

// Clear cache
cache.flushAll();
console.log('Cache cleared successfully.');

// Start server
app.listen(PORT, () => {
  logger.info(`Server running at http://localhost:${PORT}`);
});
