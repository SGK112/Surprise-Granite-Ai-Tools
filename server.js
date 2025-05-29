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
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

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
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected!'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// --- Define Schemas ---
const Chat = mongoose.model(
  'Chat',
  new mongoose.Schema(
    {
      sessionId: String,
      messages: [{ role: String, content: String, createdAt: { type: Date, default: Date.now } }],
    },
    { timestamps: true }
  )
);

// --- Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Default Route ---
app.get('/', (req, res) => {
  res.send('Welcome to the Surprise Granite API!');
});

// --- Rate Limiter ---
app.use(
  '/api/chat',
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests, please try again later.',
  })
);

// --- Fetch CSV Data ---
async function fetchCsvData(url, cacheKey) {
  let data = cache.get(cacheKey);
  if (!data) {
    const response = await axios.get(url);
    if (response.status !== 200) throw new Error(`Failed to fetch data from: ${url}`);
    data = parse(response.data, { columns: true });
    cache.set(cacheKey, data);
  }
  return data;
}

// --- Chat Endpoint ---
app.post(
  '/api/chat',
  [body('message').isString().trim().isLength({ max: 1000 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.error('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      if (!req.body.message) {
        return res.status(400).json({ error: 'The "message" field is required.' });
      }

      const userMessage = req.body.message.toLowerCase();
      const priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'priceList');

      // Match user query with price list
      const matchedItem = priceList.find(
        (item) =>
          item.material &&
          item.thickness &&
          userMessage.includes(item.material.toLowerCase()) &&
          userMessage.includes(item.thickness.toLowerCase())
      );

      if (matchedItem) {
        const { material, thickness, price_per_sqft: price } = matchedItem;
        return res.json({
          message: `The price for ${material} (${thickness}) is $${price} per square foot. Would you like an estimate for a specific area?`,
        });
      }

      // Generate AI Response if no match is found
      const systemPrompt = {
        role: 'system',
        content: `
          You are Surprise Granite's AI assistant. Your primary tasks include:
          - Helping users find prices for specific materials.
          - Explaining available countertop options (granite, quartz, marble).
          - Generating quotes based on dimensions and material choices.
          If the material is not found, politely ask for clarification or suggest available options.
        `,
      };

      const aiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [systemPrompt, { role: 'user', content: userMessage }],
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

      res.json({ message: aiResponse.data.choices[0].message.content });
    } catch (err) {
      console.error('Error in /api/chat:', err.message);
      res.status(500).json({
        error: 'An error occurred while processing your request. Please try again later.',
        details: err.message,
      });
    }
  }
);

// --- Catch-All Route for Undefined Paths ---
app.use((req, res) => {
  res.status(404).send('Page not found. Make sure you are accessing the correct endpoint.');
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});