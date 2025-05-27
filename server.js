require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { parse } = require('csv-parse/sync');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');

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

// --- Express Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

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
  const url = `https://${SHOPIFY_SHOP}/admin/api/2023-04/products.json?limit=250`;
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
async function fetchShopifySamples() {
  const url = `https://${SHOPIFY_SHOP}/admin/api/2023-04/products.json?limit=250&fields=id,title,handle,variants,images,tags`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error('Failed to fetch Shopify samples');
  const data = await response.json();
  return data.products.filter(p => (p.tags || '').toLowerCase().includes('sample'));
}

// --- Material Logic Helpers ---
function getMaterialType(materialName) {
  if (!materialName) return '';
  const name = materialName.toLowerCase();
  if (name.includes('granite')) return 'granite';
  if (name.includes('quartzite')) return 'quartzite';
  if (name.includes('dekton')) return 'dekton';
  if (name.includes('porcelain')) return 'porcelain';
  if (name.includes('quartz')) return 'quartz';
  return 'other';
}
function getInstallFee(materialType) {
  if (['granite', 'quartz'].includes(materialType)) return 26;
  if (['quartzite', 'dekton', 'porcelain'].includes(materialType)) return 45;
  return 26;
}

// --- SYSTEM_PROMPT for Assistant ---
const SYSTEM_PROMPT = `
You are Surprise Granite's all-in-one virtual assistant.

Your roles:
- Estimator: Calculate prices and provide estimates for countertops and surfaces, including 20% waste, $45/sq ft fabrication, and correct install fees.
- Personal Shopper: Help customers browse and select products or samples from Shopify. Suggest options and guide through ordering or requesting samples.
- Secretary: Take and email messages left by users.
- Appointment Booker: Book showroom visits or phone consultations. Collect preferred dates/times and contact info, and confirm the request.

Always:
- Be friendly and concise.
- Ask follow-up questions to clarify needs.
- If customer asks for a quote, collect material, color, and square footage.
- If they want to browse, offer products and samples.
- If they want to book, ask for name, phone, email, and preferred time.
- If they want to leave a message, collect message and contact.
- Summarize and confirm all info you collect.
- Use Shopify APIs for live product/sample data.

Example greeting:
"Hi! I'm your Surprise Granite assistant. I can provide quotes, help you shop, take a message, or book your visit. What can I help you with today?"
`;

// --- Main Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
  try {
    const userMsg = req.body.message || '';
    const sessionId = req.body.sessionId || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));

    const lowerMsg = userMsg.toLowerCase();

    // Secretary: Leave a message
    if (lowerMsg.includes('leave a message') || lowerMsg.includes('contact') || lowerMsg.includes('message for team')) {
      // Extract info
      const name = (userMsg.match(/name\s*[:\-]?\s*([^\n]+)/i) || [])[1];
      const email = (userMsg.match(/email\s*[:\-]?\s*([^\n]+)/i) || [])[1];
      const phone = (userMsg.match(/phone\s*[:\-]?\s*([^\n]+)/i) || [])[1];
      const message = (userMsg.match(/message\s*[:\-]?\s*([\s\S]+)/i) || [])[1] || userMsg;

      if (name && email) {
        await sendLeadNotification("New Customer Message", { name, email, phone, message });
        await saveChat(sessionId, userMsg, "Thank you! Your message has been sent and our team will contact you soon.");
        return res.json({ message: "Thank you! Your message has been sent and our team will contact you soon." });
      }
      await saveChat(sessionId, userMsg, "Please provide your name and email so we can get back to you.");
      return res.json({ message: "Please provide your name and email so we can get back to you." });
    }

    // Appointment booking
    if (lowerMsg.includes('appointment') || lowerMsg.includes('book') || lowerMsg.includes('schedule')) {
      const name = (userMsg.match(/name\s*[:\-]?\s*([^\n]+)/i) || [])[1];
      const email = (userMsg.match(/email\s*[:\-]?\s*([^\n]+)/i) || [])[1];
      const phone = (userMsg.match(/phone\s*[:\-]?\s*([^\n]+)/i) || [])[1];
      const date = (userMsg.match(/date\s*[:\-]?\s*([^\n]+)/i) || [])[1];
      const time = (userMsg.match(/time\s*[:\-]?\s*([^\n]+)/i) || [])[1];

      if (name && email && phone && date && time) {
        await sendLeadNotification("New Appointment Request", { name, email, phone, date, time });
        await saveChat(sessionId, userMsg, `Appointment requested for ${date} at ${time}. We'll confirm with you soon!`);
        return res.json({ message: `Appointment requested for ${date} at ${time}. We'll confirm with you soon!` });
      }
      await saveChat(sessionId, userMsg, "To book, please provide your name, email, phone, and preferred date and time.");
      return res.json({ message: "To book, please provide your name, email, phone, and preferred date and time." });
    }

    // Estimator: Give a quote
    if (lowerMsg.includes('estimate') || lowerMsg.includes('quote') || lowerMsg.match(/\d+\s*(sq\s*ft|sqft|square\s*feet|sf)/)) {
      // Try to extract material, sqft
      const sqftMatch = userMsg.match(/(\d+(\.\d+)?)\s*(sq\s*ft|sqft|square\s*feet|sf)/i);
      let requestedSqFt = sqftMatch ? parseFloat(sqftMatch[1]) : null;
      let materialName = null;

      // Try to match a material name from the message
      if (/quartzite|dekton|porcelain|granite|quartz/i.test(userMsg)) {
        materialName = userMsg.match(/quartzite|dekton|porcelain|granite|quartz/i)[0];
      }
      if (!requestedSqFt || !materialName) {
        await saveChat(sessionId, userMsg, "To provide an estimate, please tell me the material type and total square footage.");
        return res.json({ message: "To provide an estimate, please tell me the material type and total square footage." });
      }
      const materialType = getMaterialType(materialName);
      const totalSqFt = Math.ceil(requestedSqFt * 1.2); // Add 20% waste, round up
      const fabricationCost = totalSqFt * 45; // $45/sqft
      const installFee = getInstallFee(materialType);
      const total = fabricationCost + installFee;

      const estimateSummary =
        `Estimate: $${total.toLocaleString()} for ${totalSqFt} sq ft of ${materialName} (includes 20% waste, fabrication, and installation). Would you like to see samples, book an appointment, or leave your info for follow up?`;

      await saveChat(sessionId, userMsg, estimateSummary);
      return res.json({ message: estimateSummary });
    }

    // Personal shopper: samples/products
    if (lowerMsg.includes('sample')) {
      const samples = await fetchShopifySamples();
      let responseMsg;
      if (samples && samples.length > 0) {
        responseMsg = "Here are some of our available samples:\n";
        samples.slice(0, 5).forEach(sample => {
          responseMsg += `- ${sample.title}${sample.variants[0] ? ` ($${sample.variants[0].price})` : ""}\n`;
        });
        responseMsg += "\nWould you like more info on any of these, or to order a sample?";
      } else {
        responseMsg = "Sorry, we couldn't find any sample products right now. Would you like to browse our main products instead?";
      }
      await saveChat(sessionId, userMsg, responseMsg);
      return res.json({ message: responseMsg });
    }
    if (lowerMsg.includes('product') || lowerMsg.includes('countertop') || lowerMsg.includes('browse')) {
      const products = await fetchShopifyProducts();
      let responseMsg;
      if (products && products.length > 0) {
        responseMsg = "Here are some of our popular products:\n";
        products.slice(0, 5).forEach(product => {
          responseMsg += `- ${product.title}${product.variants[0] ? ` ($${product.variants[0].price})` : ""}\n`;
        });
        responseMsg += "\nWould you like a sample of any of these, or more details?";
      } else {
        responseMsg = "Sorry, we couldn't find any products right now. Would you like to leave your info for a follow-up?";
      }
      await saveChat(sessionId, userMsg, responseMsg);
      return res.json({ message: responseMsg });
    }

    // General greeting/fallback
    const welcomeMsg = "Hi! I'm your Surprise Granite assistant. I can provide quotes, help you shop, take a message, or book your visit. What can I help you with today?";
    await saveChat(sessionId, userMsg, welcomeMsg);
    return res.json({ message: welcomeMsg });

  } catch (err) {
    console.error('Chat endpoint error:', err.message);
    res.status(500).json({ error: "AI backend error.", details: err.message });
  }
});

// --- Save chat helper ---
async function saveChat(sessionId, userMsg, aiMsg) {
  let chat = await Chat.findOne({ sessionId });
  if (!chat) chat = await Chat.create({ sessionId, messages: [] });
  chat.messages.push({ role: "user", content: userMsg });
  chat.messages.push({ role: "ai", content: aiMsg });
  chat.messages = chat.messages.slice(-20);
  await chat.save();
}

// --- Shopify Endpoints (Direct) ---
app.get('/api/shopify/products', async (req, res) => {
  try {
    const products = await fetchShopifyProducts();
    res.json({ products });
  } catch (err) {
    res.status(500).json({ error: "Shopify API error", details: err.message });
  }
});
app.get('/api/shopify/samples', async (req, res) => {
  try {
    const samples = await fetchShopifySamples();
    res.json({ samples });
  } catch (err) {
    res.status(500).json({ error: "Shopify API error", details: err.message });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Surprise Granite Assistant running at http://localhost:${PORT}`);
});
