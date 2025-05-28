require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { parse } = require('csv-parse/sync');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const path = require('path');

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

// --- Shopify Fetch Helpers (with Images) ---
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
async function fetchShopifySamples() {
  const url = `https://${SHOPIFY_SHOP}/admin/api/2023-04/products.json?limit=250&fields=id,title,handle,variants,images,tags,body_html`;
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

// --- Countertop Image Endpoint (serves base64 as image) ---
app.get('/api/countertops/image/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const countertop = await Countertop.findById(id);
    if (!countertop || !countertop.imageBase64) {
      return res.status(404).send('Image not found');
    }
    let base64 = countertop.imageBase64;
    // Remove "data:image/jpeg;base64," if present
    if (base64.startsWith('data:image')) {
      base64 = base64.split(',')[1];
    }
    const imgBuffer = Buffer.from(base64, 'base64');
    res.set('Content-Type', 'image/jpeg');
    res.send(imgBuffer);
  } catch (err) {
    res.status(500).send('Error retrieving image');
  }
});

// --- Main Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
  try {
    const userMsg = req.body.message || '';
    const sessionId = req.body.sessionId || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));
    const lowerMsg = userMsg.toLowerCase();

    // Secretary: Leave a message
    if (lowerMsg.includes('leave a message') || lowerMsg.includes('contact') || lowerMsg.includes('message for team')) {
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
      const sqftMatch = userMsg.match(/(\d+(\.\d+)?)\s*(sq\s*ft|sqft|square\s*feet|sf)/i);
      let requestedSqFt = sqftMatch ? parseFloat(sqftMatch[1]) : null;
      let materialName = null;
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

    // Countertop (MongoDB) sample handling
    if (lowerMsg.includes('countertop') || lowerMsg.includes('slab') || lowerMsg.match(/show me (.+) (samples|countertops|slabs)/i)) {
      // Try to extract the material or color
      let query = {};
      const materialMatch = lowerMsg.match(/granite|quartzite|dekton|porcelain|quartz/i);
      if (materialMatch) query.material = new RegExp(materialMatch[0], 'i');
      const colorMatch = lowerMsg.match(/white|gray|black|blue|green|beige|brown|gold|silver|frost|navajo|calacatta|marble|onyx/i);
      if (colorMatch) query.color = new RegExp(colorMatch[0], 'i');
      const slabs = await Countertop.find(query).limit(8);
      if (slabs.length) {
        let responseMsg = "Here are some countertop options from our gallery:\n";
        slabs.forEach(slab => {
          responseMsg += `- ${slab.name}${slab.material ? ` (${slab.material})` : ''}${slab._id ? `\n[Image](/api/countertops/image/${slab._id})` : ''}\n`;
        });
        responseMsg += "\nWould you like more info, a sample, or to book a visit?";
        await saveChat(sessionId, userMsg, responseMsg);
        return res.json({
          message: responseMsg,
          countertops: slabs.map(ct => ({
            _id: ct._id,
            name: ct.name,
            material: ct.material,
            color: ct.color,
            description: ct.description,
            imageUrl: `/api/countertops/image/${ct._id}`
          }))
        });
      }
    }

    // Personal shopper: samples/products (with images)
    if (lowerMsg.includes('sample')) {
      const samples = await fetchShopifySamples();
      let responseMsg = '';
      if (samples && samples.length > 0) {
        responseMsg = "Here are some of our available samples:\n";
        samples.slice(0, 5).forEach(sample => {
          const imageUrl = sample.images && sample.images.length > 0 ? sample.images[0].src : null;
          responseMsg += `- ${sample.title}${sample.variants[0] ? ` ($${sample.variants[0].price})` : ""}${imageUrl ? `\n[Image](${imageUrl})` : ""}\n`;
        });
        responseMsg += "\nWould you like more info on any of these, or to order a sample?";
        await saveChat(sessionId, userMsg, responseMsg);
        return res.json({
          message: responseMsg,
          samples: samples.slice(0, 5).map(s => ({
            title: s.title,
            price: s.variants[0] ? s.variants[0].price : null,
            image: s.images && s.images.length > 0 ? s.images[0].src : null,
            description: s.body_html
          }))
        });
      } else {
        responseMsg = "Sorry, we couldn't find any sample products right now. Would you like to browse our main products instead?";
        await saveChat(sessionId, userMsg, responseMsg);
        return res.json({ message: responseMsg });
      }
    }

    if (lowerMsg.includes('product') || lowerMsg.includes('browse') || lowerMsg.includes('sink') || lowerMsg.includes('faucet') || lowerMsg.includes('item')) {
      const products = await fetchShopifyProducts();
      let responseMsg = '';
      if (products && products.length > 0) {
        responseMsg = "Here are some of our popular products:\n";
        products.slice(0, 5).forEach(product => {
          const imageUrl = product.images && product.images.length > 0 ? product.images[0].src : null;
          responseMsg += `- ${product.title}${product.variants[0] ? ` ($${product.variants[0].price})` : ""}${imageUrl ? `\n[Image](${imageUrl})` : ""}\n`;
        });
        responseMsg += "\nWould you like a sample of any of these, or more details?";
        await saveChat(sessionId, userMsg, responseMsg);
        return res.json({
          message: responseMsg,
          products: products.slice(0, 5).map(p => ({
            title: p.title,
            price: p.variants[0] ? p.variants[0].price : null,
            image: p.images && p.images.length > 0 ? p.images[0].src : null,
            description: p.body_html
          }))
        });
      } else {
        responseMsg = "Sorry, we couldn't find any products right now. Would you like to leave your info for a follow-up?";
        await saveChat(sessionId, userMsg, responseMsg);
        return res.json({ message: responseMsg });
      }
    }

    // General greeting/fallback
    const welcomeMsg = "Hi! I'm your Surprise Granite assistant. I can provide quotes, help you shop (with images!), take a message, or book your visit. What can I help you with today?";
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
    res.json({
      products: products.map(p => ({
        title: p.title,
        price: p.variants[0] ? p.variants[0].price : null,
        image: p.images && p.images.length > 0 ? p.images[0].src : null,
        description: p.body_html
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Shopify API error", details: err.message });
  }
});
app.get('/api/shopify/samples', async (req, res) => {
  try {
    const samples = await fetchShopifySamples();
    res.json({
      samples: samples.map(s => ({
        title: s.title,
        price: s.variants[0] ? s.variants[0].price : null,
        image: s.images && s.images.length > 0 ? s.images[0].src : null,
        description: s.body_html
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Shopify API error", details: err.message });
  }
});

// --- Countertop Gallery Endpoint (returns imageUrl for each) ---
app.get('/api/countertops', async (req, res) => {
  try {
    const { material, color } = req.query;
    const filter = {};
    if (material) filter.material = new RegExp(material, 'i');
    if (color) filter.color = new RegExp(color, 'i');
    const countertops = await Countertop.find(filter).limit(20);
    const data = countertops.map(ct => ({
      _id: ct._id,
      name: ct.name,
      material: ct.material,
      color: ct.color,
      description: ct.description,
      imageUrl: `/api/countertops/image/${ct._id}`
    }));
    res.json({ countertops: data });
  } catch (err) {
    res.status(500).json({ error: "MongoDB error", details: err.message });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Surprise Granite Assistant running at http://localhost:${PORT}`);
});
