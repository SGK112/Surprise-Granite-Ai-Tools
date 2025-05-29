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

// --- Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Shopify API Functionality ---
async function fetchShopifyProducts() {
  const url = `https://${process.env.SHOPIFY_SHOP}.myshopify.com/admin/api/2023-01/products.json`;
  const response = await axios.get(url, {
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
    },
  });
  return response.data.products;
}

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
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const userMessage = req.body.message.toLowerCase();

      // --- Fetch Price List ---
      const priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'priceList');

      // --- Match Query with Price List ---
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

      // --- Fetch Shopify Products ---
      const shopifyProducts = await fetchShopifyProducts();
      const matchedProduct = shopifyProducts.find((product) =>
        userMessage.includes(product.title.toLowerCase())
      );

      if (matchedProduct) {
        return res.json({
          message: `You can purchase "${matchedProduct.title}" for $${matchedProduct.variants[0].price}. Here is the link to buy: ${matchedProduct.admin_graphql_api_id}`,
        });
      }

      // --- Generate AI Response ---
      const systemPrompt = {
        role: 'system',
        content: `
          You are Surprise Granite's AI assistant and personal shopper. Your tasks include:
          - Helping users find prices for specific materials.
          - Providing pricing and product information from the Shopify store.
          - Generating quotes based on dimensions and material choices.
          - Assisting with recommendations for countertop options.
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

// --- Default Route ---
app.get('/', (req, res) => {
  res.send('Welcome to the Surprise Granite API!');
});

// --- Catch-All Route for Undefined Paths ---
app.use((req, res) => {
  res.status(404).send('Page not found. Make sure you are accessing the correct endpoint.');
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});