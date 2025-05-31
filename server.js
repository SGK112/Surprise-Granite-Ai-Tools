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
const nodemailer = require('nodemailer');

// --- Initialize App ---
const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 1800 });

// --- Enable Trust Proxy ---
app.set('trust proxy', 1);

// --- Validate Environment Variables ---
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
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected!'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// --- Define Schemas ---
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
      lastActivity: { type: Date, default: Date.now }
    },
    { timestamps: true }
  )
);

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// --- Send Chat Transcript ---
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
    console.log(`Transcript sent for session ${chatLog.sessionId}`);
  } catch (error) {
    console.error(`Failed to send transcript for session ${chatLog.sessionId}:`, error.message);
  }
}

// --- Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Shopify API Functionality ---
async function fetchShopifyProducts() {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-10/products.json`;
  try {
    const response = await axios.get(url, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      },
      timeout: 10000,
    });
    console.log('Shopify products fetched:', response.data.products.length);
    return response.data.products;
  } catch (error) {
    console.error('Shopify API error:', error.message);
    throw error;
  }
}

// --- Fetch CSV Data ---
async function fetchCsvData(url, cacheKey) {
  let data = cache.get(cacheKey);
  if (data) {
    console.log(`Cache hit for ${cacheKey}, ${data.length} rows`);
    return data;
  }
  try {
    console.log(`Fetching CSV from ${url}`);
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
    console.log(`Parsed CSV from ${url}, ${data.length} rows`);
    console.log(`CSV columns: ${Object.keys(data[0]).join(', ')}`);
    console.log(`Sample row: ${JSON.stringify(data[0])}`);
    cache.set(cacheKey, data);
    return data;
  } catch (error) {
    console.error(`Error fetching/parsing CSV (${cacheKey}): ${error.message}`);
    cache.del(cacheKey);
    throw error;
  }
}

// --- Fuzzy Matching ---
function fuzzyMatch(str, pattern) {
  if (!str || !pattern) return false;
  const cleanStr = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanStr.includes(cleanPattern) || cleanPattern.includes(cleanStr) || cleanStr.indexOf(cleanPattern) !== -1;
}

// --- Extract Dimensions ---
function extractDimensions(message) {
  const dimensionRegex = /(\d+\.?\d*)\s*(x|by|\*)\s*(\d+\.?\d*)\s*(ft|feet)?/gi;
  const matches = [...message.matchAll(dimensionRegex)];
  return matches.map(match => ({
    length: parseFloat(match[1]),
    width: parseFloat(match[3]),
    area: parseFloat(match[1]) * parseFloat(match[3])
  }));
}

// --- Match Labor Cost ---
function getLaborCostPerSqft(laborData, materialType) {
  const materialLower = materialType.toLowerCase();
  const laborItem = laborData.find((item) => {
    const description = item[Object.keys(item)[1]] || '';
    return description.toLowerCase().includes(materialLower);
  });
  if (laborItem) {
    const cost = parseFloat(laborItem[Object.keys(laborItem)[3]]);
    if (!isNaN(cost)) {
      console.log(`Labor cost for ${materialType}: $${cost}/sqft`);
      return cost;
    }
  }
  console.log(`No labor cost found for ${materialType}, using default $65/sqft`);
  return 65; // $50 fabrication + $15 installation
}

// --- Vendor Data (Dynamic from Shopify/CSV) ---
async function getVendorData() {
  try {
    const shopifyProducts = await fetchShopifyProducts();
    const csvMaterials = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');

    const vendors = {
      'arizona tile': {
        materials: {
          Granite: { count: 0, examples: [] },
          Quartz: { count: 0, examples: [] },
          'Natural Stone': { count: 0, examples: [] }
        },
        description: 'Arizona Tile supplies premium countertops, including Granite, Quartz, and natural stones like Marble and Quartzite, sourced globally for quality and durability.'
      },
      'kibi usa': {
        materials: {
          'Kitchen Sinks': { count: 0, examples: [] },
          'Kitchen Faucets': { count: 0, examples: [] },
          'Bathroom Faucets': { count: 0, examples: [] },
          'Bath Accessories': { count: 0, examples: [] }
        },
        description: 'Kibi USA, founded in 2018, provides luxury kitchen and bath fixtures, including sinks, faucets, and accessories, designed for affordability and functionality.'
      }
    };

    // Populate Arizona Tile from CSV
    csvMaterials.forEach(item => {
      const materialName = item['Color Name'] || '';
      const materialType = item['Material'] || 'Unknown';
      if (materialName) {
        if (materialType.toLowerCase().includes('granite')) {
          vendors['arizona tile'].materials.Granite.count++;
          if (vendors['arizona tile'].materials.Granite.examples.length < 3) {
            vendors['arizona tile'].materials.Granite.examples.push(materialName);
          }
        } else if (materialType.toLowerCase().includes('quartz')) {
          vendors['arizona tile'].materials.Quartz.count++;
          if (vendors['arizona tile'].materials.Quartz.examples.length < 3) {
            vendors['arizona tile'].materials.Quartz.examples.push(materialName);
          }
        } else {
          vendors['arizona tile'].materials['Natural Stone'].count++;
          if (vendors['arizona tile'].materials['Natural Stone'].examples.length < 3) {
            vendors['arizona tile'].materials['Natural Stone'].examples.push(materialName);
          }
        }
      }
    });

    // Populate Kibi USA from Shopify
    shopifyProducts.forEach(product => {
      const title = product.title.toLowerCase();
      const vendor = product.vendor?.toLowerCase() || '';
      if (vendor.includes('kibi') || title.includes('kibi')) {
        const productUrl = product.online_store_url || `https://${process.env.SHOPIFY_SHOP}/products/${product.handle}`;
        if (title.includes('sink')) {
          vendors['kibi usa'].materials['Kitchen Sinks'].count++;
          if (vendors['kibi usa'].materials['Kitchen Sinks'].examples.length < 3) {
            vendors['kibi usa'].materials['Kitchen Sinks'].examples.push({ name: product.title, url: productUrl });
          }
        } else if (title.includes('faucet') && title.includes('kitchen')) {
          vendors['kibi usa'].materials['Kitchen Faucets'].count++;
          if (vendors['kibi usa'].materials['Kitchen Faucets'].examples.length < 3) {
            vendors['kibi usa'].materials['Kitchen Faucets'].examples.push({ name: product.title, url: productUrl });
          }
        } else if (title.includes('faucet') && title.includes('bath')) {
          vendors['kibi usa'].materials['Bathroom Faucets'].count++;
          if (vendors['kibi usa'].materials['Bathroom Faucets'].examples.length < 3) {
            vendors['kibi usa'].materials['Bathroom Faucets'].examples.push({ name: product.title, url: productUrl });
          }
        } else if (title.includes('accessory') || title.includes('mirror') || title.includes('towel')) {
          vendors['kibi usa'].materials['Bath Accessories'].count++;
          if (vendors['kibi usa'].materials['Bath Accessories'].examples.length < 3) {
            vendors['kibi usa'].materials['Bath Accessories'].examples.push({ name: product.title, url: productUrl });
          }
        }
      }
    });

    cache.set('vendorData', vendors, 3600);
    return vendors;
  } catch (error) {
    console.error('Error fetching vendor data:', error.message);
    return {
      'arizona tile': {
        materials: {
          Granite: { count: 70, examples: ['Silver Cloud Satin', 'Volcano', 'Alpine White'] },
          Quartz: { count: 60, examples: ['Arabescato Como', 'Montenegro', 'Calacatta Doria'] },
          'Natural Stone': { count: 300, examples: ['Marble', 'Quartzite', 'Limestone'] }
        },
        description: 'Arizona Tile supplies premium countertops.'
      },
      'kibi usa': {
        materials: {
          'Kitchen Sinks': { count: 50, examples: [{ name: '30" Workstation Sink (K3-S30T)', url: 'https://store.surprisegranite.com' }] },
          'Kitchen Faucets': { count: 30, examples: [{ name: 'Artis Brushed Gold', url: 'https://store.surprisegranite.com' }] },
          'Bathroom Faucets': { count: 25, examples: [{ name: 'Cube Widespread', url: 'https://store.surprisegranite.com' }] },
          'Bath Accessories': { count: 40, examples: [{ name: 'Circular Hardware Set', url: 'https://store.surprisegranite.com' }] }
        },
        description: 'Kibi USA provides luxury kitchen and bath fixtures.'
      }
    };
  }
}

// --- Navigation Links (for quick replies only) ---
const NAV_LINKS = {
  samples: 'https://store.surprisegranite.com/collections/countertop-samples',
  vendors: 'https://www.surprisegranite.com/company/vendors-list',
  visualizer: 'https://www.surprisegranite.com/tools/virtual-kitchen-design-tool',
  countertops: 'https://www.surprisegranite.com/materials/all-countertops',
  store: 'https://store.surprisegranite.com/'
};

// --- Appointment Endpoint ---
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
    console.error('Appointment error:', error.message);
    res.status(500).json({ error: 'Failed to book appointment. Please try again.' });
  }
});

// --- Chat Logs Endpoint ---
app.get('/api/chatlogs', async (req, res) => {
  try {
    const { sessionId } = req.query;
    const query = sessionId ? { sessionId } : {};
    const logs = await ChatLog.find(query).limit(100).sort({ updatedAt: -1 });
    res.json(logs);
  } catch (error) {
    console.error('Chat logs error:', error.message);
    res.status(500).json({ error: 'Failed to retrieve chat logs.' });
  }
});

// --- Close Chat Endpoint ---
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
    console.error('Close chat error:', error.message);
    res.status(500).json({ error: 'Failed to close chat.' });
  }
});

// --- Chat Endpoint ---
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

      console.log(`Request ID: ${requestId}, Session ID: ${sessionId}, User message: ${userMessage}`);

      let chatLog = await ChatLog.findOne({ sessionId });
      if (!chatLog) {
        chatLog = new ChatLog({ sessionId, messages: [] });
      }
      chatLog.lastActivity = new Date();
      const conversationHistory = chatLog.messages.slice(-5).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // Handle company information request
      if (userMessage.includes('about surprise granite') || userMessage.includes('company info')) {
        const responseMessage = `Surprise Granite, located at 11560 N Dysart Rd, Surprise, AZ 85379, specializes in custom countertops, sinks, faucets, and kitchen/bath fixtures. We’re committed to delivering high-quality, durable solutions for your home, sourced from trusted vendors like Arizona Tile and Kibi USA. Use the footer buttons to call us at (602) 833-3189 or send a message to get started.`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Countertops', 'Sinks', 'Faucets', 'Vendors']
        });
      }

      // Handle vendor list request
      if (userMessage.includes('list vendors') || userMessage.includes('our vendors')) {
        const vendors = await getVendorData();
        const vendorList = Object.keys(vendors).map(v => v.toUpperCase()).join(', ');
        const responseMessage = `Our vendors include: ${vendorList}. Ask about a specific vendor (e.g., "What does Kibi USA offer?") or select a quick reply button to learn more.`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Countertops', 'Sinks', 'Faucets', 'Vendors']
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
            return `${type}: ${data.count} options available, including ${examples}.`;
          }).join('\n');
        const responseMessage = `${vendor.description}\nAvailable products:\n${materials}`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Countertops', 'Sinks', 'Faucets', 'Vendors']
        });
      }

      // Handle product queries (general)
      if (userMessage.includes('products') || userMessage.includes('what do you offer')) {
        const responseMessage = `Surprise Granite offers custom countertops in Granite, Quartz, Marble, and Quartzite from Arizona Tile, plus kitchen and bath fixtures from Kibi USA, including stainless steel, fireclay, and quartz composite sinks, brass faucets, and accessories like towel bars and mirrors. Ask about specific products (e.g., "Tell me about sinks") or select a quick reply button.`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Countertops', 'Sinks', 'Faucets', 'Vendors']
        });
      }

      // Handle sink-specific queries
      if (userMessage.includes('sink')) {
        const vendors = await getVendorData();
        const sinks = vendors['kibi usa'].materials['Kitchen Sinks'];
        const examples = sinks.examples.map(ex => 
          `<a href="${ex.url}" target="_blank">${ex.name}</a>`
        ).join(', ');
        const responseMessage = `We offer a variety of sinks from Kibi USA, including ${sinks.count} options like ${examples}. Select the Sinks button to explore our online store or ask for details about a specific type.`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Sinks', 'Countertops', 'Faucets', 'Vendors']
        });
      }

      // Handle faucet-specific queries
      if (userMessage.includes('faucet')) {
        const vendors = await getVendorData();
        const kitchenFaucets = vendors['kibi usa'].materials['Kitchen Faucets'];
        const bathroomFaucets = vendors['kibi usa'].materials['Bathroom Faucets'];
        const examples = [
          ...kitchenFaucets.examples.map(ex => `<a href="${ex.url}" target="_blank">${ex.name}</a>`),
          ...bathroomFaucets.examples.map(ex => `<a href="${ex.url}" target="_blank">${ex.name}</a>`)
        ].slice(0, 3).join(', ');
        const responseMessage = `Our Kibi USA faucets include ${kitchenFaucets.count} kitchen and ${bathroomFaucets.count} bathroom options, such as ${examples}. Select the Online Store button to view our full range or ask for more details.`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Sinks', 'Countertops', 'Faucets', 'Vendors']
        });
      }

      // Handle samples request
      if (userMessage.includes('samples')) {
        const responseMessage = `Please select the Samples button to view our countertop samples.`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Samples', 'Countertops', 'Sinks', 'Faucets']
        });
      }

      // Handle estimation request
      if (userMessage.includes('estimate') || userMessage.includes('quote') || userMessage.includes('countertop')) {
        let responseMessage = '';
        let quickReplies = ['Samples', 'Countertops', 'Sinks', 'Faucets'];

        // Prompt for layout if not provided
        if (!['u-shaped', 'galley', 'l-shape', 'plateau', 'bar top'].some(layout => userMessage.includes(layout))) {
          responseMessage = 'What is the layout of your countertop? (e.g., U-shaped, Galley, L-shape, Plateau, Bar Top)';
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage, quickReplies });
        }

        // Extract layout
        const layout = ['u-shaped', 'galley', 'l-shape', 'plateau', 'bar top'].find(l => userMessage.includes(l)) || 'unknown';

        // Prompt for dimensions if not provided
        const dimensions = extractDimensions(req.body.message);
        if (!dimensions.length) {
          responseMessage = 'Please provide the dimensions of each countertop section (e.g., 5x3 ft).';
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage, quickReplies });
        }

        // Prompt for material
        let priceList = [];
        try {
          priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
        } catch (error) {
          console.error(`Failed to fetch price list: ${error.message}`);
        }

        let matchedMaterial = priceList.find((item) => {
          const materialName = item['Color Name'];
          if (!materialName) return false;
          return fuzzyMatch(materialName, userMessage);
        });

        if (!matchedMaterial) {
          responseMessage = `Please specify a material (e.g., Frost-N, Calacatta Gold).`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage, quickReplies });
        }

        // Calculate estimate
        const material = matchedMaterial['Color Name'];
        const thickness = matchedMaterial.Thickness || 'unknown';
        const materialPrice = parseFloat(matchedMaterial['Cost/SqFt']) || 0;
        const materialType = matchedMaterial.Material || 'unknown';
        if (!material || materialPrice === 0) {
          responseMessage = `Invalid material data for "${material}". Please try another material.`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage, quickReplies });
        }

        const totalArea = dimensions.reduce((sum, dim) => sum + dim.area, 0);
        let wasteFactor = 0.20;
        if (userMessage.includes('waterfall')) wasteFactor = 0.30;
        if (userMessage.includes('backsplash') && userMessage.includes('full')) wasteFactor = 0.25;
        if (userMessage.includes('vanity') || userMessage.includes('small')) wasteFactor = 0.35;

        const adjustedArea = totalArea * (1 + wasteFactor);
        const materialCost = adjustedArea * materialPrice * 1.04;
        let laborCostPerSqft = 65;
        try {
          const laborData = await fetchCsvData(process.env.PUBLISHED_CSV_LABOR, 'labor_costs');
          laborCostPerSqft = getLaborCostPerSqft(laborData, materialType);
        } catch (error) {
          console.error(`Failed to fetch labor costs: ${error.message}`);
        }
        const fabricationCost = totalArea * 50;
        const installationCost = totalArea * 15;
        const laborCost = adjustedArea * laborCostPerSqft;
        const subtotal = materialCost + laborCost;
        const margin = 0.50;
        const totalCost = subtotal / (1 - margin);

        responseMessage = `Estimate for ${layout} countertop (${material}, ${thickness}, ${materialType}):\n` +
          `- Area: ${totalArea.toFixed(2)} sqft (+${(wasteFactor * 100).toFixed(0)}% waste = ${adjustedArea.toFixed(2)} sqft)\n` +
          `- Material: $${materialCost.toFixed(2)} (${materialPrice.toFixed(2)}/sqft + 4% markup)\n` +
          `- Fabrication: $${fabricationCost.toFixed(2)} ($50/sqft)\n` +
          `- Installation: $${installationCost.toFixed(2)} ($15/sqft)\n` +
          `- Total: $${totalCost.toFixed(2)} (50% margin)`;

        // Save bid
        chatLog.bids = chatLog.bids || [];
        chatLog.bids.push({
          layout,
          dimensions,
          material,
          wasteFactor,
          fabricationCost,
          installationCost,
          materialCost,
          totalCost,
          margin
        });

        // Solicit feedback
        responseMessage += '\nIs this price fair? (Reply: Great, High, Low)';
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();

        return res.json({
          message: responseMessage,
          image: matchedMaterial.image_url || null,
          quickReplies: ['Great', 'High', 'Low', 'Samples', 'Sinks']
        });
      }

      // Handle feedback
      if (['great', 'high', 'low'].includes(userMessage)) {
        chatLog.feedback = chatLog.feedback || [];
        chatLog.feedback.push({
          question: 'Is this price fair?',
          response: userMessage
        });
        const responseMessage = `Thank you for your feedback! How else can I assist you?`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({
          message: responseMessage,
          quickReplies: ['Countertops', 'Sinks', 'Faucets', 'Vendors']
        });
      }

      // Handle Shopify product queries
      let shopifyProducts = [];
      try {
        shopifyProducts = await fetchShopifyProducts();
      } catch (error) {
        console.error(`Failed to fetch Shopify products: ${error.message}`);
      }

      if (userMessage.includes('sink') || userMessage.includes('faucet')) {
        const matchedProduct = shopifyProducts.find((product) =>
          product.title && fuzzyMatch(product.title, userMessage)
        );
        if (matchedProduct) {
          const price = parseFloat(matchedProduct.variants[0].price) || 0;
          const productUrl = matchedProduct.online_store_url || `https://${process.env.SHOPIFY_SHOP}/products/${matchedProduct.handle}`;
          const imageUrl = matchedProduct.image?.src || null;
          const description = matchedProduct.body_html ? matchedProduct.body_html.replace(/<[^>]+>/g, '').substring(0, 100) + '...' : 'No description available.';
          console.log(`Matched product: ${matchedProduct.title}`);
          const responseMessage = `"${matchedProduct.title}" costs $${price.toFixed(2)}. ${description} <a href="${productUrl}" target="_blank">View Product</a>`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({
            message: responseMessage,
            image: imageUrl,
            productUrl,
            quickReplies: ['Sinks', 'Countertops', 'Faucets', 'Vendors']
          });
        }
      }

      // Generic response
      const systemPrompt = {
        role: 'system',
        content: `
          You are Surprise Granite's AI assistant, located at 11560 N Dysart Rd, Surprise, AZ 85379. We specialize in custom countertops (Granite, Quartz, Marble, Quartzite) from Arizona Tile and kitchen/bath fixtures (sinks, faucets, accessories) from Kibi USA. Our mission is to provide high-quality, durable solutions for home remodeling. Your tasks include:
          - Providing detailed information about Surprise Granite's company, products, and vendors (Arizona Tile, Kibi USA) only when explicitly requested.
          - Listing vendors and their products (e.g., Kibi USA's sinks, faucets) with examples and counts, using hyperlinks to store.surprisegranite.com product pages.
          - Providing countertop estimates by asking for layout, dimensions, material, and services, using CSV pricing, with a fallback to $50/sqft fabrication, $15/sqft installation, 4% stone markup, 50% margin.
          - Saving bids in MongoDB and soliciting feedback.
          - Offering Shopify product details (title, price, description, image) with hyperlinks.
          - Do not include navigation links in responses; use quick reply buttons instead.
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
      console.log(`Raw AI response: ${aiMessage}`);

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
        quickReplies: ['Countertops', 'Sinks', 'Faucets', 'Vendors']
      });
    } catch (err) {
      console.error(`Error in /api/chat (Request ID: ${req.headers['x-request-id'] || 'unknown'}):`, err.message);
      res.status(500).json({
        error: 'An error occurred while processing your request. Please try again later.',
        details: err.message,
      });
    }
  }
);

// --- Default Route ---
app.get('/', (req, res) => {
  res.send('Welcome to the Surprise Granite API!');
});

// --- Catch-All Route ---
app.use((req, res) => {
  res.status(404).send('Page not found. Make sure you are accessing the correct endpoint.');
});

// --- Handle SIGTERM ---
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Shutting down gracefully...');
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed.');
    process.exit(0);
  });
});

// --- Global Error Handling ---
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.message);
  process.exit(1);
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
