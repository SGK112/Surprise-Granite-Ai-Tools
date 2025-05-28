require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const NodeCache = require('node-cache');
const { parse } = require('csv-parse/sync');
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
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected!'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// --- Define Schemas ---
const Chat = mongoose.model('Chat', new mongoose.Schema({
  sessionId: String,
  messages: [{ role: String, content: String, createdAt: { type: Date, default: Date.now } }]
}, { timestamps: true }));

const Countertop = mongoose.model('Countertop', new mongoose.Schema({
  name: String,
  material: String,
  color: String,
  imageBase64: String,
  filename: String,
  description: String,
}));

const QuoteState = mongoose.model('QuoteState', new mongoose.Schema({
  sessionId: String,
  step: { type: String, default: 'init' },
  dimensions: { width: Number, depth: Number },
  material: String,
  lastUpdated: { type: Date, default: Date.now },
}));

// --- Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));

// --- Rate Limiter ---
app.use(
  '/api/chat',
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests, please try again later.',
  })
);

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendEmailNotification(subject, content) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.LEADS_RECEIVER || process.env.EMAIL_USER,
      subject,
      text: content,
    });
    console.log('Email sent successfully!');
  } catch (err) {
    console.error('Error sending email:', err);
  }
}

// --- Helpers for External Data Fetch ---
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

async function fetchShopifyProducts() {
  const cacheKey = 'shopifyProducts';
  let data = cache.get(cacheKey);

  if (!data) {
    const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2023-04/products.json?limit=250&fields=id,title,handle,variants,images,tags,body_html`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json',
        },
      });

      if (!response.data || !response.data.products) {
        throw new Error('No products found in Shopify API response');
      }

      data = response.data.products;
      cache.set(cacheKey, data);
    } catch (err) {
      console.error('Error fetching Shopify products:', err.message);
      throw new Error('Failed to fetch Shopify products');
    }
  }

  return data;
}

// --- Countertop Image Endpoint ---
app.get('/api/countertops/image/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const countertop = await Countertop.findById(id);
    
    if (!countertop || !countertop.imageBase64) {
      return res.status(404).send('Image not found');
    }

    let base64 = countertop.imageBase64;
    if (base64.startsWith('data:image')) {
      base64 = base64.split(',')[1];
    }

    const imgBuffer = Buffer.from(base64, 'base64');
    res.set('Content-Type', 'image/jpeg'); // Adjust MIME type if necessary
    res.send(imgBuffer);
  } catch (err) {
    console.error('Error retrieving image:', err.message);
    res.status(500).send('Error retrieving image');
  }
});

// --- Chat Endpoint with Robust Logic ---
app.post('/api/chat', [
  body('message').isString().trim().isLength({ max: 1000 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    console.error('Validation errors:', errors.array());
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const userMessage = req.body.message;
    const pricingContext = `
      Pricing details for Surprise Granite:
      - Quartz countertops: $60 per square foot (material).
      - Installation: $45 per square foot (labor).
      - Additional features: $100 for an undermount sink cutout.
    `;
    const systemPrompt = {
      role: 'system',
      content: `
        You are Surprise Granite's AI assistant. Your primary tasks include:
        - Providing accurate quotes for countertops.
        - Explaining available materials (granite, quartz, marble).
        - Generating leads by requesting user contact information.
        Pricing and service details:
        ${pricingContext}
      `,
    };

    const aiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        systemPrompt,
        { role: 'user', content: userMessage },
      ],
      temperature: 0.6,
      max_tokens: 600,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    res.json({ message: aiResponse.data.choices[0].message.content });
  } catch (err) {
    console.error('OpenAI API error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Could not reach the server. Please try again.', details: err.message });
  }
});

// --- Error Handling ---
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});