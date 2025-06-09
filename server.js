require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
const axios = require('axios');
const NodeCache = require('node-cache');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: 'error.log', level: 'error' })
  ],
});

// Cache
const cache = new NodeCache({ stdTTL: 3600 }); // 1-hour TTL

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
  })
);
// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => logger.info('Connected to MongoDB'))
  .catch(err => logger.error('MongoDB connection error:', err.message));

// Mongoose Models
const chatLogSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true },
  clientId: { type: String, required: true },
  clientEmail: { type: String },
  messages: [{
    role: { type: String, enum: ['user', 'bot'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  }],
  createdAt: { type: Date, default: Date.now },
});
const ChatLog = mongoose.model('ChatLog', chatLogSchema);

// Initialize OpenAI
const openAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize Google Sheets
const credentials = process.env.GOOGLE_CREDENTIALS ? JSON.parse(process.env.GOOGLE_CREDENTIALS) : require(process.env.GOOGLE_CREDENTIALS_PATH);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });

// Shopify Configuration
const shopifyConfig = {
  shopName: process.env.SHOPIFY_SHOP_NAME,
  apiKey: process.env.SHOPIFY_API_KEY,
  password: process.env.SHOPIFY_PASSWORD,
  apiVersion: '2023-10',
};

// Helper: Fetch Materials from Google Sheets
async function fetchMaterials() {
  const cacheKey = 'materials';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Materials!A2:D',
    });
    const rows = response.data.values || [];
    const materials = rows.map(row => ({
      name: row[0],
      material: row[1],
      installedPrice: parseFloat(row[2]),
      description: row[3] || '',
    }));
    cache.set(cacheKey, materials);
    logger.info('Fetched materials from Google Sheets');
    return materials;
  } catch (error) {
    logger.error('Error fetching materials:', error.message);
    return cache.get(cacheKey) || [];
  }
}

// Helper: Fetch Shopify Products
async function fetchShopifyProducts(query = '') {
  const cacheKey = query ? `products:${query}` : 'products';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://${shopifyConfig.apiKey}:${shopifyConfig.password}@${shopifyConfig.shopName}.myshopify.com/admin/api/${shopifyConfig.apiVersion}/products.json${query ? `?title=${encodeURIComponent(query)}` : ''}`;
    const response = await axios.get(url);
    const products = response.data.products.map(product => ({
      title: product.title,
      handle: product.handle,
      variants: product.variants.map(variant => ({
        price: parseFloat(variant.price),
      })),
    }));
    cache.set(cacheKey, products);
    logger.info(`Fetched Shopify products${query ? ` for query: ${query}` : ''}`);
    return products;
  } catch (error) {
    logger.error('Error fetching Shopify products:', error.message);
    return cache.get(cacheKey) || [];
  }
}

// Initialize Cache
async function initializeCache() {
  await fetchMaterials();
  await fetchShopifyProducts();
}
initializeCache();

// Route: Serve chatbot.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chatbot.html'));
});

// Endpoint: Chat with OpenAI
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, clientId, clientEmail, quoteState } = req.body;
  if (!message || !sessionId || !clientId) {
    return res.status(400).json({ error: 'Missing message, sessionId, or clientId' });
  }

  try {
    // Fetch chat history
    const history = await ChatLog.findOne({ sessionId, clientId })
      .then(log => log ? log.messages.map(msg => ({ role: msg.role, content: msg.content })) : []);

    // Store user message
    const userMessage = { role: 'user', content: message, timestamp: new Date() };
    await ChatLog.findOneAndUpdate(
      { sessionId, clientId },
      {
        $set: { clientEmail, quoteState },
        $push: { messages: userMessage },
      },
      { upsert: true }
    );

    // Build context
    const context = `
      You are a wizard-themed AI assistant for Surprise Granite, a countertop and remodeling company.
      - Use magical, whimsical language (e.g., "conjure," "spell," "enchant").
      - Reference past interactions to provide personalized responses.
      - Access materials pricing and Shopify products when relevant.
      - Session ID: ${sessionId}, Client ID: ${clientId}, Client Email: ${clientEmail || 'N/A'}.
      - Quote State: ${JSON.stringify(quoteState)}.
      - Past Interactions: ${JSON.stringify(history.slice(-5))} (last 5 messages for context).
    `;

    const messages = [
      { role: 'system', content: context },
      ...history.slice(-5),
      { role: 'user', content: message },
    ];

    const completion = await openAI.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages,
      max_tokens: 500,
    });

    const botMessage = completion.choices[0].message.content;

    // Store bot response
    await ChatLog.findOneAndUpdate(
      { sessionId, clientId },
      { $push: { messages: { role: 'bot', content: botMessage, timestamp: new Date() } } }
    );

    res.json({ message: botMessage });
    logger.info(`Chat processed for session: ${sessionId}`);
  } catch (error) {
    logger.error('Chat error:', error.message);
    res.status(500).json({ error: 'Failed to process chat request' });
  }
});

// Endpoint: Fetch Materials
app.get('/api/materials', async (req, res) => {
  const materials = await fetchMaterials();
  res.json(materials);
});

// Endpoint: Fetch Shopify Products
app.get('/api/shopify-products', async (req, res) => {
  const query = req.query.q || '';
  const products = await fetchShopifyProducts(query);
  res.json(products);
});

// Endpoint: Close Chat Session
app.post('/api/close-chat', async (req, res) => {
  const { sessionId } = req.body;
  logger.info(`Chat session closed: ${sessionId}`);
  res.json({ status: 'Session closed' });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start Server
app.listen(port, () => {
  logger.info(`Server running at http://localhost:${port}`);
});
