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
    },
    { timestamps: true }
  )
);

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
    });
    return response.data.products;
  } catch (error) {
    console.error('Shopify API error:', error.message);
    throw error;
  }
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

// --- Fuzzy Matching for Material Names ---
function fuzzyMatch(str, pattern) {
  const cleanStr = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanStr.includes(cleanPattern) || cleanStr.indexOf(cleanPattern) !== -1;
}

// --- Extract Dimensions from Message ---
function extractDimensions(message) {
  const dimensionRegex = /(\d+\.?\d*)\s*(x|by|\*)\s*(\d+\.?\d*)\s*(ft|feet)?/i;
  const match = message.match(dimensionRegex);
  if (match) {
    const length = parseFloat(match[1]);
    const width = parseFloat(match[3]);
    return { length, width, area: length * width };
  }
  return null;
}

// --- Email Notifications ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
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

      // --- Log User Message and Session ---
      console.log(`Request ID: ${req.headers['x-request-id'] || 'unknown'}, Session ID: ${sessionId}, User message: ${userMessage}`);

      // --- Fetch Google Sheets Price List ---
      const priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
      
      // --- Search for Material in Google Sheets with Fuzzy Matching ---
      let matchedMaterial = priceList.find((item) =>
        item.material && fuzzyMatch(item.material, userMessage)
      );

      // --- Handle Material Price Query ---
      if (matchedMaterial) {
        const { material, thickness, price_per_sqft, image_url } = matchedMaterial;
        const price = parseFloat(price_per_sqft) || 0;
        let responseMessage = `The price for ${material} (${thickness}) is $${price.toFixed(2)} per square foot.`;

        // --- Check for Dimensions and Generate Estimate ---
        const dimensions = extractDimensions(req.body.message);
        if (dimensions) {
          const { area } = dimensions;
          const materialCost = area * price;

          // --- Fetch Labor Costs ---
          const laborData = await fetchCsvData(process.env.PUBLISHED_CSV_LABOR, 'labor_costs');
          const laborCostPerSqft = parseFloat(laborData[0]?.labor_cost_per_sqft) || 10;
          const laborCost = area * laborCostPerSqft;

          const totalCost = materialCost + laborCost;
          responseMessage += `\nFor a ${dimensions.length} x ${dimensions.width} ft countertop (${area.toFixed(2)} sqft), the estimated cost is $${totalCost.toFixed(2)} (material: $${materialCost.toFixed(2)}, labor: $${laborCost.toFixed(2)}).`;
        }

        // --- Save Chat Log ---
        const newChatLog = new ChatLog({
          sessionId,
          messages: [
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage },
          ],
        });
        await newChatLog.save();

        return res.json({
          message: responseMessage,
          image: image_url || null,
        });
      }

      // --- Fetch Shopify Products ---
      const shopifyProducts = await fetchShopifyProducts();
      const matchedProduct = shopifyProducts.find((product) =>
        product.title && fuzzyMatch(product.title, userMessage)
      );

      if (matchedProduct) {
        const price = parseFloat(matchedProduct.variants[0].price) || 0;
        const responseMessage = `You can purchase "${matchedProduct.title}" for $${price.toFixed(2)}. Visit your Shopify store to buy.`;

        // --- Save Chat Log ---
        const newChatLog = new ChatLog({
          sessionId,
          messages: [
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage },
          ],
        });
        await newChatLog.save();

        return res.json({ message: responseMessage });
      }

      // --- Fallback to AI Response ---
      const systemPrompt = {
        role: 'system',
        content: `
          You are Surprise Granite's AI assistant. Your tasks include:
          - Providing prices for countertop materials from the Google Sheets price list.
          - Offering product information from the Shopify store.
          - Generating quotes for countertops based on material prices and dimensions (e.g., 5x3 ft).
          - Including labor costs in estimates (assume $10/sqft if unknown).
          - If no specific material or product is found, suggest contacting support or visiting the store.
        `,
      };

      const aiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [
            systemPrompt,
            { role: 'user', content: req.body.message },
          ],
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

      const aiMessage = aiResponse.data.choices[0].message.content;

      // --- Save Chat Log ---
      const newChatLog = new ChatLog({
        sessionId,
        messages: [
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: aiMessage },
        ],
      });
      await newChatLog.save();

      res.json({ message: aiMessage });
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

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
