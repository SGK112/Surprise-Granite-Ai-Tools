require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { OpenAI } = require('openai');
const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs').promises;

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize OpenAI
const openAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize Google Sheets
const auth = new google.auth.GoogleAuth({
  keyFile: process.env.GOOGLE_CREDENTIALS_PATH,
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

// In-memory cache
let materialsCache = [];
let productsCache = [];

// File-based cache
const CACHE_FILE = 'cache.json';
async function loadCache() {
  try {
    const data = await fs.readFile(CACHE_FILE, 'utf8');
    const cache = JSON.parse(data);
    materialsCache = cache.materials || [];
    productsCache = cache.products || [];
  } catch (e) {
    console.log('No cache file found, starting fresh.');
  }
}
async function saveCache() {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify({ materials: materialsCache, products: productsCache }));
  } catch (e) {
    console.error('Error saving cache:', e.message);
  }
}

// Helper: Fetch Materials from Google Sheets
async function fetchMaterials() {
  if (materialsCache.length) return materialsCache;
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Materials!A2:D',
    });
    const rows = response.data.values || [];
    materialsCache = rows.map(row => ({
      name: row[0],
      material: row[1],
      installedPrice: parseFloat(row[2]),
      description: row[3] || '',
    }));
    await saveCache();
    return materialsCache;
  } catch (error) {
    console.error('Error fetching materials:', error.message);
    return materialsCache;
  }
}

// Helper: Fetch Shopify Products
async function fetchShopifyProducts(query = '') {
  if (!query && productsCache.length) return productsCache;
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
    if (!query) {
      productsCache = products;
      await saveCache();
    }
    return products;
  } catch (error) {
    console.error('Error fetching Shopify products:', error.message);
    return query ? [] : productsCache;
  }
}

// Initialize Cache
async function initializeCache() {
  await loadCache();
  await fetchMaterials();
  await fetchShopifyProducts();
}
initializeCache();

// Endpoint: Chat with OpenAI
app.post('/api/chat', async (req, res) => {
  const { message, sessionId, clientId, clientEmail, quoteState } = req.body;
  try {
    const context = `
      You are a wizard-themed AI assistant for Surprise Granite.
      - Use magical, whimsical language.
      - Session ID: ${sessionId}, Client ID: ${clientId}, Client Email: ${clientEmail || 'N/A'}.
      - Quote State: ${JSON.stringify(quoteState)}.
    `;
    const completion = await openAI.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: context },
        { role: 'user', content: message },
      ],
      max_tokens: 500,
    });
    res.json({ message: completion.choices[0].message.content });
  } catch (error) {
    console.error('Chat error:', error.message);
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
  console.log(`Chat session closed: ${sessionId}`);
  res.json({ status: 'Session closed' });
});

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start Server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
