// Surprise Granite AI Chatbot Backend

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

// --- MongoDB Setup ---
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

const Chat = mongoose.model('Chat', new mongoose.Schema({
  sessionId: String,
  messages: [{ role: String, content: String, imageUrl: String, createdAt: { type: Date, default: Date.now } }]
}, { timestamps: true }));

const Image = mongoose.model('Image', new mongoose.Schema({
  filename: String,
  url: String,
  uploadedAt: { type: Date, default: Date.now },
  sessionId: String
}));

// --- Middleware ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

// --- Multer Setup ---
const uploadDir = path.join(__dirname, 'Uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });

// --- CSV Loader ---
function loadCsvFromEnv(envKey) {
  const csvData = process.env[envKey] || '';
  if (!csvData.trim()) return [];
  return parse(csvData, { columns: true });
}

function getCsvSummary(records, n = 15) {
  if (!records || !records.length) return 'No data available.';
  const headers = Object.keys(records[0]);
  const rows = records.slice(0, n)
    .map(row => headers.map(h => row[h]).join(' | '))
    .join('\n');
  return `${headers.join(' | ')}\n${rows}${records.length > n ? '\n...' : ''}`;
}

// --- Company Info Loader ---
function loadCompanyInfo() {
  try {
    const filePath = path.join(__dirname, 'public', 'companyinfo.json');
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {}
  // fallback
  return {
    name: "Surprise Granite",
    phone: "(602) 833-3189",
    email: "info@surprisegranite.com",
    address: "11560 N Dysart Rd. #112, Surprise, AZ 85379",
    website: "https://www.surprisegranite.com",
    store: "https://www.store.surprisegranite.com",
    about: "Surprise Granite is a licensed, bonded, and insured leader in commercial and residential countertops, cabinets, and tile wall installations.",
    credentials: [
      "Licensed, bonded, and insured",
      "Serving commercial and residential clients"
    ],
    services: [
      "Countertops (granite, quartz, marble, and more)",
      "Cabinet installation",
      "Tile wall installation"
    ]
  };
}

// --- Shopify Products Loader (optional, can be removed if not used) ---
async function fetchShopifyProducts() {
  try {
    const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2023-10/products.json?limit=10`;
    const response = await fetch(url, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
    const data = await response.json();
    return data.products || [];
  } catch (e) {
    return [
      { title: "Sample Granite Countertop", variants: [{ price: "500.00", sku: "GRANITE001" }] },
      { title: "Sample Marble Countertop", variants: [{ price: "600.00", sku: "MARBLE001" }] }
    ];
  }
}

// --- SYSTEM PROMPT: Guide AI to use price lists for estimate ---
const SYSTEM_PROMPT = `
You are a professional assistant for Surprise Granite.
- Always greet the customer and offer design and estimate assistance.
- When a customer requests an estimate, use the MATERIALS and LABOR PRICE LIST SAMPLES provided below.
- If a requested item or service is not listed, politely inform the customer that only a partial price list is shown and suggest contacting the company for a full quote.
- Show your calculations transparently.
- Capture name, email, phone, and project details as a lead if provided.
- Use company info, service offerings, and product lists below.
Never provide medical, legal, or financial advice outside of Surprise Granite's services.
`;

// --- OpenAI Setup ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- Lead Notification ---
async function sendLeadNotification(lead) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.LEADS_RECEIVER || process.env.EMAIL_USER,
    subject: 'New Countertop Lead',
    text: `Lead:\nName: ${lead.name}\nEmail: ${lead.email}\nPhone: ${lead.phone || 'N/A'}\nMessage: ${lead.message || 'N/A'}`
  };
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('Nodemailer lead error:', err);
    return false;
  }
}

// --- Main Chat Endpoint: AI uses price lists for estimates ---
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    let sessionId = req.body.sessionId || req.headers['x-session-id'] || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));
    const userMsg = req.body.message || '';
    let imageUrl = null;
    if (req.file) imageUrl = `/uploads/${req.file.filename}`;

    // Retrieve/Create Chat Session
    let chat = await Chat.findOne({ sessionId });
    if (!chat) chat = await Chat.create({ sessionId, messages: [] });

    // Save user message (+ image)
    chat.messages.push({ role: "user", content: userMsg, imageUrl });
    chat.messages = chat.messages.slice(-20);
    await chat.save();

    if (imageUrl) await Image.create({ filename: req.file.filename, url: imageUrl, sessionId });

    // --- Load Data for Prompt ---
    const materialsRecords = loadCsvFromEnv('PUBLISHED_CSV_MATERIALS');
    const laborRecords = loadCsvFromEnv('PUBLISHED_CSV_LABOR');
    const materialsSummary = getCsvSummary(materialsRecords, 15);
    const laborSummary = getCsvSummary(laborRecords, 15);
    const companyInfo = loadCompanyInfo();
    let companyInfoSummary = Object.entries(companyInfo).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');

    // --- Optional: Shopify Product Sample ---
    let shopifySummary = '';
    const products = await fetchShopifyProducts();
    if (products.length) {
      shopifySummary = '\n\nSHOPIFY PRODUCTS:\n' +
        products.slice(0, 5).map(p =>
          `Title: ${p.title}, Price: ${p.variants[0]?.price}, SKU: ${p.variants[0]?.sku || 'n/a'}`
        ).join('\n');
    }

    // --- Construct AI Messages ---
    const messages = [
      { role: "system", content:
        SYSTEM_PROMPT +
        '\n\nCOMPANY INFORMATION:\n' + companyInfoSummary +
        "\n\nMATERIALS PRICE LIST SAMPLE:\n" + materialsSummary +
        "\n\nLABOR PRICE LIST SAMPLE:\n" + laborSummary +
        shopifySummary
      },
      ...chat.messages.map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      })),
      { role: "user", content: userMsg }
    ];

    // --- OpenAI Completion ---
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_VISION_ENABLED === 'true' ? "gpt-4-vision-preview" : "gpt-3.5-turbo",
      messages,
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 600,
      temperature: 0.7
    });
    const aiReply = completion.choices[0].message.content.trim();

    // Save AI response
    chat.messages.push({ role: "ai", content: aiReply });
    chat.messages = chat.messages.slice(-20);
    await chat.save();

    // --- Lead Detection ---
    const leadMatch = userMsg.match(/name\s*[:\-]\s*(.*)\n.*email\s*[:\-]\s*(.*)\n?.*phone\s*[:\-]?\s*(.*)?/i);
    if (leadMatch) {
      const lead = {
        name: leadMatch[1] || "",
        email: leadMatch[2] || "",
        phone: leadMatch[3] || "",
        message: userMsg
      };
      await sendLeadNotification(lead);
    }

    res.json({ message: aiReply, imageUrl });
  } catch (err) {
    console.error('Chat endpoint error:', err.message);
    res.status(500).json({ error: "AI backend error or file upload failed.", details: err.message });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Company Info Endpoint ---
app.get('/api/company-info', (req, res) => {
  res.json(loadCompanyInfo());
});

// --- Shopify Products Endpoint ---
app.get('/api/shopify-products', async (req, res) => {
  try {
    const products = await fetchShopifyProducts();
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: 'Shopify fetch error', details: err.message });
  }
});

// --- Lead Submission Endpoint ---
app.post('/api/send-lead', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'Name and email are required.' });
    const lead = { name, email, phone, message };
    const sent = await sendLeadNotification(lead);
    if (!sent) return res.status(500).json({ error: 'Failed to send lead.' });
    res.status(200).json({ message: 'Lead sent successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send lead', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Surprise Granite AI Chatbot backend running at http://localhost:${PORT}`);
});
