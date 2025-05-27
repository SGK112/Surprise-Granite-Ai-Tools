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

// --- CSV Loader (from ENV) ---
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

// --- COMPANY INFO Loader (from public/companyinfo.json or fallback inline) ---
function loadCompanyInfo() {
  try {
    const filePath = path.join(__dirname, 'public', 'companyinfo.json');
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsedData = JSON.parse(data);
      return parsedData;
    }
    // Fallback: use hardcoded company info
    return {
      name: "Surprise Granite",
      phone: "(602) 833-3189",
      email: "info@surprisegranite.com",
      address: "11560 N Dysart Rd. #112, Surprise, AZ 85379",
      website: "https://www.surprisegranite.com",
      store: "https://www.store.surprisegranite.com",
      about: "Surprise Granite is a licensed, bonded, and insured leader in commercial and residential countertops, cabinets, and tile wall installations. Serving the West Valley and beyond, we specialize in granite, quartz, and marble fabrication and installation. Our team delivers top-quality craftsmanship, professional service, and expert design guidance for every project.",
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
  } catch (e) {
    // Fallback in case of error
    return {
      name: "Surprise Granite",
      phone: "(602) 833-3189",
      email: "info@surprisegranite.com",
      address: "11560 N Dysart Rd. #112, Surprise, AZ 85379",
      website: "https://www.surprisegranite.com",
      store: "https://www.store.surprisegranite.com",
      about: "Surprise Granite is a licensed, bonded, and insured leader in commercial and residential countertops, cabinets, and tile wall installations. Serving the West Valley and beyond, we specialize in granite, quartz, and marble fabrication and installation. Our team delivers top-quality craftsmanship, professional service, and expert design guidance for every project.",
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
}

// --- Shopify Products Loader (with real API access) ---
async function fetchShopifyProducts() {
  try {
    const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2023-10/products.json?limit=10`;
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
    // fallback to hardcoded sample if Shopify fails
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
  }
}

// --- SYSTEM PROMPT ---
const SYSTEM_PROMPT = `
You are a professional assistant, estimator, and designer for Surprise Granite.
- Always greet the customer and offer design and estimate assistance.
- If a user shares project details, capture their name, email, phone, and project info as a lead.
- When a photo is attached, analyze it for countertop color and material type if possible, or confirm a team member will review it.
- Use company info, service offerings, and product lists provided below.
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

// --- Lead Capture Helper (Nodemailer or UseBasin) ---
async function sendLeadNotification(lead) {
  if (process.env.USEBASIN_URL) {
    // Send to UseBasin via HTTP POST
    try {
      await fetch(process.env.USEBASIN_URL, {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lead)
      });
      return true;
    } catch (err) {
      console.error('UseBasin error:', err);
      return false;
    }
  } else {
    // Default: send via Nodemailer
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
}

// --- Chat Endpoint (main AI bot) ---
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

    // MongoDB: Retrieve or Create Chat Session
    let chat = await Chat.findOne({ sessionId });
    if (!chat) chat = await Chat.create({ sessionId, messages: [] });

    // Save user message (+ image)
    chat.messages.push({ role: "user", content: userMsg, imageUrl });
    chat.messages = chat.messages.slice(-20); // Keep last 20
    await chat.save();

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
    }

    // --- Shopify Products
    let shopifySummary = '';
    const products = await fetchShopifyProducts();
    if (products.length) {
      shopifySummary = '\n\nSHOPIFY PRODUCTS:\n' +
        products.slice(0, 5).map(p =>
          `Title: ${p.title}, Price: ${p.variants[0]?.price}, SKU: ${p.variants[0]?.sku || 'n/a'}`
        ).join('\n');
    } else {
      shopifySummary = '\n\nSHOPIFY PRODUCTS: (Could not load)';
    }

    // --- Vision Analysis if image provided and enabled
    let visionAnalysis = '';
    if (imageUrl && process.env.OPENAI_VISION_ENABLED === 'true') {
      try {
        const imageFullUrl = `${req.protocol}://${req.get('host')}${imageUrl}`;
        const visionPrompt = "Analyze this image for countertop color and material type. Give a concise summary.";
        const visionMessages = [
          { role: "system", content: visionPrompt },
          { role: "user", content: [{ type: "image_url", image_url: imageFullUrl }] }
        ];
        const visionReply = await openai.chat.completions.create({
          model: "gpt-4-vision-preview",
          messages: visionMessages,
          max_tokens: 100,
        });
        visionAnalysis = visionReply.choices[0].message.content.trim();
      } catch (err) {
        console.error("OpenAI Vision error", err.message);
        visionAnalysis = "Sorry, I couldn't analyze the image.";
      }
    }

    // --- Notify customer
    let customerNotice = '';
    if (imageUrl) {
      customerNotice = "Thank you for your photo! Our team will review it and follow up. ";
      if (visionAnalysis) {
        customerNotice += "Here's what I see: " + visionAnalysis;
      } else {
        customerNotice += "If you have questions, let us know!";
      }
      // Save this as an AI message so it's part of the chat log
      chat.messages.push({ role: "ai", content: customerNotice });
      chat.messages = chat.messages.slice(-20);
      await chat.save();
    }

    // --- Construct Messages for OpenAI
    const messages = [
      { role: "system", content:
        SYSTEM_PROMPT +
        (companyInfoSummary ? '\n\n' + companyInfoSummary : '') +
        "\n\nMATERIALS PRICE LIST SAMPLE:\n" +
        materialsSummary +
        "\n\nLABOR PRICE LIST SAMPLE:\n" +
        laborSummary +
        shopifySummary +
        (visionAnalysis ? ("\n\nIMAGE ANALYSIS:\n" + visionAnalysis) : "")
      },
      ...chat.messages.map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      })),
      { role: "user", content: userMsg }
    ];

    // --- OpenAI Completion
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_VISION_ENABLED === 'true' ? "gpt-4-vision-preview" : "gpt-3.5-turbo",
      messages,
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 400,
      temperature: 0.7
    });
    const aiReply = completion.choices[0].message.content.trim();

    // Save AI response
    chat.messages.push({ role: "ai", content: aiReply });
    chat.messages = chat.messages.slice(-20);
    await chat.save();

    // --- Detect and capture leads (basic: look for contact info in last user message)
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

    res.json({ message: aiReply, customerNotice, imageUrl, visionAnalysis });
  } catch (err) {
    console.error('Chat endpoint error:', err.message);
    res.status(500).json({ error: "AI backend error or file upload failed.", details: err.message });
  }
});

// --- Shopify Products Endpoint: returns live product info
app.get('/api/shopify-products', async (req, res) => {
  try {
    const products = await fetchShopifyProducts();
    res.json({ products });
  } catch (err) {
    console.error('Shopify products endpoint error:', err.message);
    res.status(500).json({ error: 'Shopify fetch error', details: err.message });
  }
});

// --- Email Estimate/Leads/Logs Endpoint: send an estimate, lead, or log by email
app.post('/api/send-estimate', async (req, res) => {
  try {
    const { email, estimate, lead, chatSessionId, sendChatLog } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    let mailText = '';
    let subject = process.env.EMAIL_SUBJECT || 'Your Surprise Granite Estimate';

    if (estimate?.text) {
      mailText += `Estimate:\n${estimate.text}\n\n`;
      subject = 'Your Surprise Granite Countertop Estimate';
    }

    if (lead) {
      mailText += `New Lead Details:\n${JSON.stringify(lead, null, 2)}\n\n`;
      subject = 'New Countertop Lead Submission';
    }

    // Optionally attach chat logs
    if (sendChatLog && chatSessionId) {
      const chat = await Chat.findOne({ sessionId: chatSessionId });
      if (chat && chat.messages && chat.messages.length) {
        mailText += `Chat Log:\n` +
          chat.messages.map(m =>
            `[${m.role}] ${m.createdAt ? (new Date(m.createdAt)).toISOString() : ''}:\n${m.content}\n`
          ).join('\n');
      }
    }

    if (!mailText.trim()) {
      return res.status(400).json({ error: 'No estimate, lead, or chat log provided.' });
    }

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: subject,
      text: mailText,
    };
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Message sent successfully' });
  } catch (err) {
    console.error('Send estimate/log error:', err);
    res.status(500).json({ error: 'Failed to send email', details: err.message });
  }
});

// --- Quick Lead Submission Endpoint (for frontend forms) ---
app.post('/api/send-lead', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!email || !name) {
      return res.status(400).json({ error: 'Name and email are required.' });
    }
    const lead = { name, email, phone, message };
    const sent = await sendLeadNotification(lead);
    if (!sent) {
      return res.status(500).json({ error: 'Failed to send lead.' });
    }
    res.status(200).json({ message: 'Lead sent successfully' });
  } catch (err) {
    console.error('Send lead error:', err);
    res.status(500).json({ error: 'Failed to send lead', details: err.message });
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
