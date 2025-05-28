require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { parse } = require('csv-parse/sync');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB connected!');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// --- MongoDB Schemas ---
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
  description: String
}));

// --- Express Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static('public'));

// --- Environment Variables ---
const {
  GOOGLE_SHEET_CSV_URL,
  PUBLISHED_CSV_LABOR,
  SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_SHOP,
  EMAIL_USER,
  EMAIL_PASS,
  LEADS_RECEIVER
} = process.env;

if (!GOOGLE_SHEET_CSV_URL || !PUBLISHED_CSV_LABOR || !SHOPIFY_ACCESS_TOKEN || !SHOPIFY_SHOP) {
  throw new Error('Missing required environment variables!');
}

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS }
});

async function sendLeadNotification(subject, lead) {
  const mailOptions = {
    from: EMAIL_USER,
    to: LEADS_RECEIVER || EMAIL_USER,
    subject,
    text: Object.entries(lead).map(([k, v]) => `${k}: ${v}`).join('\n')
  };
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('Nodemailer error:', err);
    return false;
  }
}

// --- CSV Fetch Helpers ---
async function fetchPriceSheet() {
  const response = await fetch(GOOGLE_SHEET_CSV_URL);
  if (!response.ok) throw new Error('Failed to fetch Google Sheet');
  const csv = await response.text();
  return parse(csv, { columns: true });
}
async function fetchLaborSheet() {
  const response = await fetch(PUBLISHED_CSV_LABOR);
  if (!response.ok) throw new Error('Failed to fetch Labor Sheet');
  const csv = await response.text();
  return parse(csv, { columns: true });
}

// --- Shopify Fetch Helpers ---
async function fetchShopifyProducts() {
  const url = `https://${SHOPIFY_SHOP}/admin/api/2023-04/products.json?limit=250&fields=id,title,handle,variants,images,tags,body_html`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error('Failed to fetch Shopify products');
  const data = await response.json();
  return data.products;
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
    res.set('Content-Type', 'image/jpeg');
    res.send(imgBuffer);
  } catch (err) {
    console.error('Error retrieving image:', err.message);
    res.status(500).send('Error retrieving image');
  }
});

// --- Main Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
  try {
    const userMsg = req.body.message || '';
    const sessionId = req.body.sessionId || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));
    const lowerMsg = userMsg.toLowerCase();

    const welcomeMsg = "Hi! I'm your Surprise Granite assistant. I can provide quotes, help you shop (with images!), take a message, or book your visit. What can I help you with today?";
    await saveChat(sessionId, userMsg, welcomeMsg);
    return res.json({ message: welcomeMsg });

  } catch (err) {
    console.error('Chat endpoint error:', err.message);
    res.status(500).json({ error: "AI backend error.", details: err.message });
  }
});

// --- Save Chat Helper ---
async function saveChat(sessionId, userMsg, aiMsg) {
  let chat = await Chat.findOne({ sessionId });
  if (!chat) chat = await Chat.create({ sessionId, messages: [] });
  chat.messages.push({ role: "user", content: userMsg });
  chat.messages.push({ role: "ai", content: aiMsg });
  chat.messages = chat.messages.slice(-20);
  await chat.save();
}

// --- Pricing Endpoint ---
app.get('/pricing', async (req, res) => {
  const { materialType, laborType, markup = 0 } = req.query;

  try {
    const laborPricing = await fetchLaborSheet();
    const shopifyProducts = await fetchShopifyProducts();

    const filteredLabor = laborType ? laborPricing.filter(item => item.type === laborType) : laborPricing;
    const filteredMaterials = materialType ? shopifyProducts.filter(product => product.title.includes(materialType)) : shopifyProducts;

    const adjustedLabor = filteredLabor.map(item => ({
      ...item,
      price: (item.price * (1 + markup / 100)).toFixed(2),
    }));
    const adjustedMaterials = filteredMaterials.map(product => ({
      ...product,
      price: (parseFloat(product.price) * (1 + markup / 100)).toFixed(2),
    }));

    res.json({
      laborPricing: adjustedLabor,
      materialPricing: adjustedMaterials,
    });
  } catch (err) {
    console.error('Error fetching pricing data:', err);
    res.status(500).json({ error: 'Error fetching pricing data', details: err.message });
  }
});

// --- Company Info Endpoint ---
app.get('/api/company-info', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'companyInfo.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading companyInfo.json:', err);
      return res.status(500).json({ error: 'Error reading company information' });
    }
    try {
      const companyInfo = JSON.parse(data);
      res.json(companyInfo);
    } catch (parseErr) {
      console.error('Error parsing companyInfo.json:', parseErr);
      res.status(500).json({ error: 'Error parsing company information' });
    }
  });
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Surprise Granite Assistant running at http://localhost:${PORT}`);
});
