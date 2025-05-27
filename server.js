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
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Multer Setup ---
const uploadDir = path.join(__dirname, 'uploads');
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
    const data = fs.readFileSync(path.join(__dirname, 'public', 'companyinfo.json'), 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {};
  }
}

// --- Shopify Products Loader ---
async function fetchShopifyProducts() {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2023-10/products.json`;
  const response = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error('Shopify API error');
  const data = await response.json();
  return data.products || [];
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
    const sessionId = req.body.sessionId || req.headers['x-session-id'] || String(Date.now());
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
      companyInfoSummary = '\n\nCOMPANY INFORMATION:\n' +
        Object.entries(companyInfo).map(([k,v]) =>
          `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`
        ).join('\n');
    }

    // --- Shopify Products
    let shopifySummary = '';
    try {
      const products = await fetchShopifyProducts();
      if (products.length) {
        shopifySummary = '\n\nSHOPIFY PRODUCTS (sample):\n' +
          products.slice(0, 5).map(p =>
            `Title: ${p.title}, Price: ${p.variants[0]?.price}, SKU: ${p.variants[0]?.sku || 'n/a'}`
          ).join('\n');
      }
    } catch (e) {
      shopifySummary = '\n\nSHOPIFY PRODUCTS: (Could not load - API error)';
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
    console.error(err);
    res.status(500).json({ error: "AI backend error or file upload failed." });
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

// --- Shopify Products Endpoint (for widget/frontend) ---
app.get('/api/shopify-products', async (req, res) => {
  try {
    const products = await fetchShopifyProducts();
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: 'Shopify fetch error' });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Surprise Granite AI Chatbot backend running at http://localhost:${PORT}`);
});
