const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');
const mongoose = require('mongoose');
const fetch = require('node-fetch');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- MongoDB Models ---
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const ChatSchema = new mongoose.Schema({
  sessionId: String,
  messages: [{ role: String, content: String, imageUrl: String, createdAt: { type: Date, default: Date.now } }]
}, { timestamps: true });

const ImageSchema = new mongoose.Schema({
  filename: String,
  url: String,
  uploadedAt: { type: Date, default: Date.now },
  sessionId: String
});
const Chat = mongoose.model('Chat', ChatSchema);
const Image = mongoose.model('Image', ImageSchema);

// --- Static & Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

// --- Multer Setup ---
const uploadDir = path.join(__dirname, 'Uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, unique);
  }
});
const upload = multer({ storage });

// --- CSV Loader ---
function loadCsvFromEnv(envKey) {
  const csvData = process.env[envKey] || '';
  if (!csvData.trim()) return [];
  return parse(csvData, { columns: true });
}

function getCsvSummary(records, n = 5) {
  if (!records || records.length === 0) return 'No data available.';
  const headers = Object.keys(records[0]);
  const rows = records.slice(0, n)
    .map(row => headers.map(h => row[h]).join(' | '))
    .join('\n');
  return `${headers.join(' | ')}\n${rows}${records.length > n ? '\n...' : ''}`;
}

// --- COMPANY INFO Loader ---
function loadCompanyInfo() {
  try {
    const filePath = path.join(__dirname, 'public', 'companyinfo.json');
    if (!fs.existsSync(filePath)) {
      console.error('companyinfo.json not found at:', filePath);
      return {};
    }
    const data = fs.readFileSync(filePath, 'utf8');
    const parsedData = JSON.parse(data);
    console.log('Loaded company info:', parsedData); // Debug log
    return parsedData;
  } catch (e) {
    console.error('Error loading companyinfo.json:', e.message);
    return {};
  }
}

// --- Shopify Products Loader ---
async function fetchShopifyProducts() {
  // Bypassed Shopify API with hardcoded data to avoid errors
  console.log('Using hardcoded Shopify products (bypass)');
  return [
    {
      title: "Sample Granite Countertop",
      variants: [{ price: "500.00", sku: "GRANITE001" }]
    },
    {
      title: "Sample Marble Countertop",
      variants: [{ price: "600.00", sku: "MARBLE001" }]
    }
  ];
  /*
  try {
    const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2023-10/products.json`;
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.products || [];
  } catch (e) {
    console.error('Shopify API fetch error:', e.message);
    return [];
  }
  */
}

// --- SYSTEM PROMPT ---
const SYSTEM_PROMPT = `
You are a helpful virtual assistant for Surprise Granite. You can answer questions about products, services, pricing, and company information.
Use the company's materials and labor price lists, company info, and Shopify products provided below.
If a user attaches a photo, acknowledge receipt but do not attempt to analyze it. You are not able to process images, but can notify staff that a photo was received.
Never provide medical, legal, or financial advice outside of Surprise Granite's services.
`;

// --- OpenAI Setup ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --- Chat Endpoint ---
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    // Generate or retrieve sessionId
    let sessionId = req.body.sessionId || req.headers['x-session-id'];
    if (!sessionId) {
      sessionId = String(Date.now()) + '-' + Math.random().toString(36).substr(2, 9);
    }
    const userMsg = req.body.message || '';
    let imageUrl = null;
    if (req.file) imageUrl = `/uploads/${req.file.filename}`;

    // --- MongoDB: Retrieve or Create Chat Session
    let chat = await Chat.findOne({ sessionId });
    if (!chat) chat = await Chat.create({ sessionId, messages: [] });

    // --- MongoDB: Save user message (+ image)
    chat.messages.push({ role: "user", content: userMsg, imageUrl });
    chat.messages = chat.messages.slice(-20);
    await chat.save();

    // --- Save image metadata if uploaded
    if (imageUrl) {
      await Image.create({ filename: req.file.filename, url: imageUrl, sessionId });
    }

    // --- Load Data for Prompt
    const materialsRecords = loadCsvFromEnv('PUBLISHED_CSV_MATERIALS');
    const laborRecords = loadCsvFromEnv('PUBLISHED_CSV_LABOR');
    const materialsSummary = getCsvSummary(materialsRecords);
    const laborSummary = getCsvSummary(laborRecords);
    const companyInfo = loadCompanyInfo();
    let companyInfoSummary = '';
    if (companyInfo && typeof companyInfo === 'object' && Object.keys(companyInfo).length > 0) {
      companyInfoSummary = 'COMPANY INFORMATION:\n' +
        Object.entries(companyInfo).map(([k, v]) =>
          `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`
        ).join('\n');
    } else {
      console.warn('No valid company info loaded');
    }

    // --- Check if user is asking for company info
    const lowerMsg = userMsg.toLowerCase();
    console.log('User query:', lowerMsg); // Debug log
    if (lowerMsg.includes('company') || lowerMsg.includes('address') || lowerMsg.includes('info') || lowerMsg.includes('about')) { // Broadened trigger
      const aiReply = companyInfoSummary || 'No company information available. Please contact support for assistance.';
      console.log('Returning company info:', aiReply); // Debug log
      
      // --- MongoDB: Save AI response
      chat.messages.push({ role: "ai", content: aiReply });
      chat.messages = chat.messages.slice(-20);
      await chat.save();

      return res.json({ message: aiReply, imageUrl });
    }

    // --- Shopify Products
    let shopifySummary = '';
    const products = await fetchShopifyProducts();
    if (products.length) {
      shopifySummary = '\n\nSHOPIFY PRODUCTS (sample):\n' +
        products.slice(0, 5).map(p =>
          `Title: ${p.title}, Price: ${p.variants[0]?.price}, SKU: ${p.variants[0]?.sku || 'n/a'}`
        ).join('\n');
    } else {
      shopifySummary = '\n\nSHOPIFY PRODUCTS: (Could not load)';
    }

    let fileNotice = '';
    if (imageUrl) {
      fileNotice = "The user has attached a photo for this conversation. Please let them know it will be reviewed by a team member, but you cannot analyze images directly.";
    }

    // --- Construct Messages for OpenAI
    const messages = [
      { role: "system", content:
        SYSTEM_PROMPT +
        companyInfoSummary +
        "\n\nMATERIALS PRICE LIST SAMPLE:\n" +
        materialsSummary +
        "\n\nLABOR PRICE LIST SAMPLE:\n" +
        laborSummary +
        shopifySummary +
        (fileNotice ? "\n\n" + fileNotice : "")
      },
      ...chat.messages.map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      })),
      { role: "user", content: userMsg }
    ];

    // --- OpenAI Completion
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages,
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 200,
      temperature: 0.7
    });
    const aiReply = completion.choices[0].message.content.trim();

    // --- MongoDB: Save AI response
    chat.messages.push({ role: "ai", content: aiReply });
    chat.messages = chat.messages.slice(-20);
    await chat.save();

    res.json({ message: aiReply, imageUrl });
  } catch (err) {
    console.error('Chat endpoint error:', err.message);
    res.status(500).json({ error: "AI backend error or file upload failed.", details: err.message });
  }
});

// --- Email Estimate Endpoint ---
app.post('/api/send-estimate', async (req, res) => {
  try {
    const { email, estimate } = req.body;
    if (!email || !estimate?.text) {
      return res.status(400).json({ error: 'Email and estimate text are required' });
    }
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: process.env.EMAIL_SUBJECT || 'Your Surprise Granite Countertop Estimate',
      text: estimate.text,
    };
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Estimate sent successfully' });
  } catch (err) {
    console.error('Send estimate error:', err);
    res.status(500).json({ error: 'Failed to send estimate', details: err.message });
  }
});

// --- Shopify Products Endpoint ---
app.get('/api/shopify-products', async (req, res) => {
  try {
    const products = await fetchShopifyProducts();
    res.json({ products });
  } catch (err) {
    console.error('Shopify products endpoint error:', err.message);
    res.status(500).json({ error: 'Shopify fetch error', details: err.message });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Test Company Info Endpoint ---
app.get('/api/test-company-info', (req, res) => {
  const companyInfo = loadCompanyInfo();
  res.json(companyInfo);
});

app.listen(PORT, () => {
  console.log(`Surprise Granite AI Chatbot backend running at http://localhost:${PORT}`);
});
