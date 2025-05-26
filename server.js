import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';
import { OpenAI } from 'openai';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import fs from 'fs';

// --- CONFIG ---
const SHOPIFY_DOMAIN = process.env.SHOPIFY_DOMAIN; // e.g. "yourshop.myshopify.com"
const SHOPIFY_TOKEN = process.env.SHOPIFY_ADMIN_TOKEN; // Private app admin API access token
const CSV_MATERIALS_URL = process.env.PUBLISHED_CSV_MATERIALS;
const CSV_LABOR_URL = process.env.PUBLISHED_CSV_LABOR;
const COMPANY_INFO_PATH = './companyInfo.json'; // Optional

// --- LOAD COMPANY INFO & DESIGN TIPS ---
let companyInfo = {};
try {
  companyInfo = JSON.parse(fs.readFileSync(COMPANY_INFO_PATH, 'utf-8'));
} catch (e) {
  companyInfo = {
    name: "Surprise Granite",
    phone: "(480) 555-1234",
    email: "sales@surprisegranite.com",
    address: "123 Granite Way, Surprise, AZ",
    about: "Leading granite, quartz, and marble fabricator and installer in the West Valley.",
    designTips: [
      "Light colors make small kitchens feel larger.",
      "Matte finishes hide fingerprints and smudges.",
      "Coordinate your backsplash and countertop for a finished look.",
      "Edge style and sink cutouts affect price and style."
    ]
  };
}

// --- LOAD DATA FROM GOOGLE SHEETS ---
let materialsData = [];
let laborData = [];
async function fetchCsvData(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parse(text, { columns: true });
}
async function refreshAllData() {
  if (CSV_MATERIALS_URL) {
    try { materialsData = await fetchCsvData(CSV_MATERIALS_URL); } catch (e) { console.error("Error loading materialsData", e); }
  }
  if (CSV_LABOR_URL) {
    try { laborData = await fetchCsvData(CSV_LABOR_URL); } catch (e) { console.error("Error loading laborData", e); }
  }
}
await refreshAllData();
setInterval(refreshAllData, 60 * 60 * 1000); // refresh every hour

// --- MONGODB ---
mongoose.connect(process.env.MONGODB_URI);
const ChatMessageSchema = new mongoose.Schema({
  sessionId: String,
  from: String,
  message: String,
  files: [Object],
  createdAt: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);

// --- EXPRESS ---
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));

// --- MULTER FOR FILE UPLOADS ---
const upload = multer({ storage: multer.memoryStorage() });

// --- CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});
async function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    let upload_stream = cloudinary.uploader.upload_stream(
      { folder: "sg_chatbot_uploads" },
      (error, result) => {
        if (error) return reject(error);
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
          originalname: file.originalname,
          mimetype: file.mimetype
        });
      }
    );
    streamifier.createReadStream(file.buffer).pipe(upload_stream);
  });
}

// --- OPENAI ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- SHOPIFY HELPER ---
async function shopifyFetch(endpoint, method = 'GET', body = null) {
  const url = `https://${SHOPIFY_DOMAIN}/admin/api/2023-04/${endpoint}`;
  const headers = {
    'X-Shopify-Access-Token': SHOPIFY_TOKEN,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
  return res.json();
}

// --- FILTER RELEVANT ROWS ---
function filterRelevantRows(data, message) {
  if (!data || !message) return [];
  const keywords = message.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  return data.filter(row =>
    Object.values(row)
      .some(val => keywords.some(kw => String(val).toLowerCase().includes(kw)))
  );
}

// --- AI SYSTEM PROMPT BUILDER ---
function buildSystemPrompt({ userMsg, relevantMaterials, relevantLabor, companyInfo, shopifyContext }) {
  return `
You are the Surprise Granite Assistant, a professional, friendly AI shopping assistant and design consultant.

Company Info:
Name: ${companyInfo.name}
Phone: ${companyInfo.phone}
Email: ${companyInfo.email}
Address: ${companyInfo.address}
About: ${companyInfo.about}

Design Tips:
${companyInfo.designTips.join('\n')}

Materials Sample Relevant to User:
${JSON.stringify(relevantMaterials)}

Labor Rates Sample Relevant to User:
${JSON.stringify(relevantLabor)}

Shopify Context (products/cart/stock):
${shopifyContext ? JSON.stringify(shopifyContext).slice(0, 1000) : "None"}

Instructions:
- Help users shop for granite, quartz, marble, etc. Suggest products based on needs and current stock.
- If user asks about a product, find it in the Shopify catalog and share price, stock, and details.
- If user wants to add to cart, do so and confirm.
- If user wants a professional estimate, use real pricing/labor and write a clear, helpful, detailed response.
- Offer design tips as needed.
- If user has design or install questions, answer with expertise.
- Always include company contact info for follow-up.
- NEVER make up info; always use live data provided.

Always be concise, inviting, and helpful.
  `.trim();
}

// --- MAIN CHATBOT ENDPOINT (AI + Shopify) ---
app.post('/api/chat', upload.array('attachments'), async (req, res) => {
  try {
    const { message, sessionId, estimator, shopifyAction, cartId, productId, quantity } = req.body;
    let files = [];
    if (req.files && req.files.length) {
      files = await Promise.all(req.files.map(uploadToCloudinary));
    }
    await new ChatMessage({ sessionId, from: 'user', message, files }).save();

    // 1. Optionally fetch Shopify data
    let shopifyContext = {};
    if (shopifyAction === 'get_cart' && cartId) {
      shopifyContext.cart = await shopifyFetch(`carts/${cartId}.json`);
    } else if (shopifyAction === 'get_product' && productId) {
      shopifyContext.product = await shopifyFetch(`products/${productId}.json`);
    } else if (shopifyAction === 'list_products') {
      shopifyContext.products = await shopifyFetch('products.json?limit=10');
    } else if (shopifyAction === 'add_to_cart' && cartId && productId && quantity) {
      // NOTE: Shopify Storefront API is recommended for carts; this is a simplified example.
      // You may need to adapt for client-side cart management if not using Plus.
      // Here we just simulate it for the AI prompt.
      shopifyContext.added = { cartId, productId, quantity };
    }

    // 2. Find relevant material/labor rows for the user's message
    const MAX_SAMPLE_ROWS = 7;
    let relevantMaterials = filterRelevantRows(materialsData, message);
    let relevantLabor = filterRelevantRows(laborData, message);
    if (relevantMaterials.length === 0) relevantMaterials = materialsData.slice(0, MAX_SAMPLE_ROWS);
    if (relevantLabor.length === 0) relevantLabor = laborData.slice(0, MAX_SAMPLE_ROWS);

    // 3. Build system prompt
    const systemPrompt = buildSystemPrompt({
      userMsg: message,
      relevantMaterials,
      relevantLabor,
      companyInfo,
      shopifyContext
    });

    // 4. Pass estimator form data to the AI too, if present
    let userContent = [];
    if (message) userContent.push({ type: "text", text: message });
    if (estimator) {
      userContent.push({ type: "text", text: `User provided estimator info: ${JSON.stringify(estimator)}` });
    }
    files.forEach(f => userContent.push({ type: "image_url", image_url: { url: f.url }}));

    // 5. Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent.length > 0 ? userContent : [{ type: "text", text: "(See attached images)" }] }
      ],
      max_tokens: 900
    });
    const aiResponse = completion.choices[0].message.content;

    await new ChatMessage({ sessionId, from: 'ai', message: aiResponse }).save();
    res.json({ message: aiResponse, images: files.map(f => f.url) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// --- OPTIONAL: Shopfiy product listing endpoint (for frontend dropdowns/autocomplete) ---
app.get('/api/shopify/products', async (req, res) => {
  try {
    const products = await shopifyFetch('products.json?limit=20');
    res.json(products.products);
  } catch (err) {
    res.status(500).json({ message: "Error fetching products", error: err.message });
  }
});

// --- STATIC FILES (WIDGET) ---
app.use(express.static('public'));
app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Surprise Granite Assistant running on port ${PORT}`));
