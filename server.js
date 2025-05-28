require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { parse } = require('csv-parse/sync');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const NodeCache = require('node-cache');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
// For PDF parsing (make sure to npm install pdf-parse if using this)
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('MongoDB connected!');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// --- MongoDB Schemas ---
const Chat = mongoose.model('Chat', new mongoose.Schema({
  sessionId: String,
  messages: [{ role: String, content: String, createdAt: { type: Date, default: Date.now } }],
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

// --- Express Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static('public'));

// Rate limiting for /api/chat
app.use(
  '/api/chat',
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: 'Too many requests, please try again later.',
  }),
);

// --- GET handler for /api/chat (friendly error) ---
app.get('/api/chat', (req, res) => {
  res.status(405).json({
    error: 'The /api/chat endpoint only supports POST requests. Please use POST with a JSON body containing at least a "message" property.'
  });
});

// --- Environment Variables ---
const {
  GOOGLE_SHEET_CSV_URL,
  PUBLISHED_CSV_LABOR,
  SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_SHOP,
  EMAIL_USER,
  EMAIL_PASS,
  LEADS_RECEIVER,
  OPENAI_API_KEY,
  EMAIL_SUBJECT,
} = process.env;

if (
  !GOOGLE_SHEET_CSV_URL ||
  !PUBLISHED_CSV_LABOR ||
  !SHOPIFY_ACCESS_TOKEN ||
  !SHOPIFY_SHOP ||
  !OPENAI_API_KEY
) {
  throw new Error('Missing required environment variables!');
}

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: EMAIL_USER, pass: EMAIL_PASS },
});

async function sendLeadNotification(subject, lead) {
  const mailOptions = {
    from: EMAIL_USER,
    to: LEADS_RECEIVER || EMAIL_USER,
    subject: subject || EMAIL_SUBJECT || 'Lead Notification',
    text: Object.entries(lead).map(([k, v]) => `${k}: ${v}`).join('\n'),
  };
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('Nodemailer error:', err);
    return false;
  }
}

// --- CSV and Shopify Fetch Helpers ---
async function fetchPriceSheet() {
  const cacheKey = 'priceSheet';
  let data = cache.get(cacheKey);
  if (!data) {
    const response = await fetch(GOOGLE_SHEET_CSV_URL);
    if (!response.ok) throw new Error('Failed to fetch Google Sheet');
    const csv = await response.text();
    data = parse(csv, { columns: true });
    cache.set(cacheKey, data);
  }
  return data;
}

async function fetchLaborSheet() {
  const cacheKey = 'laborSheet';
  let data = cache.get(cacheKey);
  if (!data) {
    const response = await fetch(PUBLISHED_CSV_LABOR);
    if (!response.ok) throw new Error('Failed to fetch Labor Sheet');
    const csv = await response.text();
    data = parse(csv, { columns: true });
    cache.set(cacheKey, data);
  }
  return data;
}

async function fetchShopifyProducts() {
  const cacheKey = 'shopifyProducts';
  let data = cache.get(cacheKey);
  if (!data) {
    const url = `https://${SHOPIFY_SHOP}/admin/api/2023-04/products.json?limit=250&fields=id,title,handle,variants,images,tags,body_html`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error('Failed to fetch Shopify products');
    data = (await response.json()).products;
    cache.set(cacheKey, data);
  }
  return data;
}

// --- PDF Parsing Helper: Aggregate all docs in ./docs/ as string for AI context ---
async function getBusinessDocsText() {
  const docsDir = path.join(__dirname, 'docs');
  if (!fs.existsSync(docsDir)) return '';
  const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.pdf'));
  let docsText = '';
  for (const file of files) {
    const dataBuffer = fs.readFileSync(path.join(docsDir, file));
    try {
      const pdfData = await pdfParse(dataBuffer);
      docsText += `\n---\n[${file}]\n${pdfData.text.slice(0, 2000)}`; // limit to first 2000 chars per doc
    } catch (err) {
      console.error(`PDF parse error for ${file}:`, err.message);
    }
  }
  return docsText;
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

// --- Main Chat Endpoint with System Prompt and Pricing Context ---
app.post(
  '/api/chat',
  [
    body('message').trim().isLength({ max: 1000 }).withMessage('Message too long'),
    body('sessionId').optional().isAlphanumeric().withMessage('Invalid session ID'),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userMsg = req.body.message || '';
      const sessionId =
        req.body.sessionId || Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      const lowerMsg = userMsg.toLowerCase();
      let chat = await Chat.findOne({ sessionId });
      const context = chat
        ? chat.messages.slice(-10).map(msg => ({
            role: msg.role,
            content: msg.content,
          }))
        : [];

      // System prompt for AI instructions
      const systemPrompt = {
        role: "system",
        content: `
 * Surprise Granite AI Assistant Instructions (Summarized, Updated)
 * Role: Professional, friendly countertop estimator AI for Surprise Granite.
 * Functionality: Analyze uploaded images of stone countertop damage, suggest cleaning/repair solutions, provide instant estimates (material cost*3.25+$26.00 per sq ft), and generate leads.
 * 
 * 1. Image Analysis
 * - Prompt: "Please upload a clear photo of the damage or describe it (e.g., scratch, stain)."
 * - Identify damage: Scratches, cracks, chips, stains, etching, burn marks, seam separation.
 * - Assess severity: Minor (repairable), moderate (professional repair), severe (replacement).
 * - Confirm material (granite, quartz, marble) via image cues or prompt: "Could you confirm the countertop material?"
 * - Summarize findings: "The image shows a 2-inch scratch on granite. Is this correct?"
 * 
 * 2. Cleaning/Repair Solutions
 * - Cleaning (stains/etching): Suggest mild soap, baking soda poultice, or professional sealing ($100–$250).
 * - Minor repairs (scratches, small chips): Polishing/patching, $250–$500.
 * - Moderate repairs (cracks, seams): Epoxy/resin, $500–$1,000.
 * - Severe damage (large cracks): Replacement, material ($40–$155/sq. ft.) + fabrication ($45/sq. ft.) + installation ($26/sq. ft., varies by complexity).
 * - Example: "For the stain, try soap and water. If persistent, professional cleaning is $150–$250."
 * 
 * 3. Instant Estimates
 * - Repairs: Job-based, $250–$2,000 (minor to complex).
 * - Replacements: Material ($40–$155/sq. ft.) + fabrication ($45/sq. ft.) + installation ($26/sq. ft., higher for complex jobs) + $250 base.
 *   - Example: 2 sq. ft. granite ($50/sq. ft.) + $45/sq. ft. fab + $26/sq. ft. install + $250 base = $471.
 * - Additional fees: Sink cutouts ($80–$300), edgework ($10–$30/linear ft.), sealing ($100).
 * - Example: "Polishing a 2-inch scratch costs $250–$350. Replacement (2 sq. ft.) is $471."
 * 
 * 4. Lead Generation
 * - Prompt: "Please share your name and contact details for a detailed quote or technician visit."
 * - Encourage action: "I can schedule a free assessment. Would you like to proceed?"
 * - Log details (name, contact, damage, estimate) for CRM, per privacy policies.
 * 
 * 5. Professional Tone
 * - Positive: "I’m excited to help restore your countertop!"
 * - Clear: Explain terms (e.g., etching = dull spots from acid).
 * - Proactive: Offer next steps (quote, visit).
 * 
 * 6. Handling Unknowns
 * - Unclear image: "Could you upload another photo or describe the damage?"
 * - Missing data: "I’ll connect you with our team. Please share your contact details."
 * 
 * 7. Documentation
 * - Use Surprise Granite price lists, care guidelines (e.g., World Stone Group).
 * - Example: "Avoid abrasive cleaners; use mild soap (per guidelines)."
 * 
 * Example Response:
 * "The image shows a 2-inch granite scratch. Polishing costs $250–$350. Replacement (2 sq. ft.) is $471, including fabrication and installation. Please share your contact details to schedule a tech[...]
`
      };

      // Fetch price/labor sheets and business docs (PDFs)
      const [priceSheet, laborSheet, docsText] = await Promise.all([
        fetchPriceSheet(),
        fetchLaborSheet(),
        getBusinessDocsText()
      ]);

      // Summarize or truncate for context
      const priceSummary = priceSheet.slice(0, 5).map(p => `${p.material || p.Material || p.name}: $${p.price || p.Price || p.price_per_sqft || "?"}/sqft`).join('; ');
      const laborSummary = laborSheet.slice(0, 3).map(l => `${l.type || l.Type}: $${l.price || l.Price}/sqft`).join('; ');
      const docsSummary = docsText ? docsText.slice(0, 2000) : "";

      const businessContext = {
        role: "system",
        content: `
Current price list: ${priceSummary}
Labor rates: ${laborSummary}
Business documents: ${docsSummary}
`
      };

      // Compose OpenAI request
      const openaiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: [systemPrompt, businessContext, ...context, { role: 'user', content: userMsg }],
          temperature: 0.6,
          max_tokens: 600,
        },
        {
          headers: {
            'Authorization': `Bearer ${OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );

      let aiMsg = openaiResponse.data.choices[0].message.content;

      // Intent-specific logic
      if (lowerMsg.includes('quote') || lowerMsg.includes('price') || lowerMsg.includes('estimate')) {
        aiMsg = await handleQuoteRequest(userMsg, sessionId);
      } else if (lowerMsg.includes('consultation')) {
        aiMsg = await handleConsultationRequest(userMsg, sessionId);
      }

      // Save chat to MongoDB
      await saveChat(sessionId, userMsg, aiMsg);

      return res.json({ message: aiMsg, sessionId });
    } catch (err) {
      console.error('Chat endpoint error:', err.message);
      res.status(500).json({ error: 'AI backend error.', details: err.message });
    }
  },
);

// --- Save Chat Helper ---
async function saveChat(sessionId, userMsg, aiMsg) {
  let chat = await Chat.findOne({ sessionId });
  if (!chat) chat = await Chat.create({ sessionId, messages: [] });
  chat.messages.push({ role: 'user', content: userMsg });
  chat.messages.push({ role: 'ai', content: aiMsg });
  chat.messages = chat.messages.slice(-20); // Keep last 20 messages
  await chat.save();
}

// --- Handle Quote Request ---
async function handleQuoteRequest(userMsg, sessionId) {
  try {
    let state = await QuoteState.findOne({ sessionId });
    if (!state) {
      state = await QuoteState.create({ sessionId, step: 'init' });
    }

    const lowerMsg = userMsg.toLowerCase();

    if (state.step === 'init') {
      await QuoteState.updateOne({ sessionId }, { step: 'dimensions' });
      return 'Let’s get started with your quote. What are the dimensions of the countertop (e.g., 5x3 feet)?';
    }

    if (state.step === 'dimensions') {
      const dimensionsMatch = userMsg.match(/(\d+\.?\d*)\s*(x|by)\s*(\d+\.?\d*)/i);
      if (!dimensionsMatch) {
        return 'Please provide valid dimensions (e.g., 5x3 feet). Try again.';
      }
      const width = parseFloat(dimensionsMatch[1]);
      const depth = parseFloat(dimensionsMatch[3]);
      await QuoteState.updateOne(
        { sessionId },
        { step: 'material', dimensions: { width, depth }, lastUpdated: Date.now() },
      );
      return 'Great! What material would you like (e.g., granite, quartz, marble)?';
    }

    if (state.step === 'material') {
      const materialMatch = userMsg.match(/granite|quartz|marble/i);
      if (!materialMatch) {
        return 'Please choose a material (e.g., granite, quartz, marble). Try again.';
      }
      const materialType = materialMatch[0].toLowerCase();
      await QuoteState.updateOne(
        { sessionId },
        { step: 'confirm', material: materialType, lastUpdated: Date.now() },
      );

      // Calculate quote
      const area = state.dimensions.width * state.dimensions.depth;
      const shopifyProducts = await fetchShopifyProducts();
      const laborPricing = await fetchLaborSheet();

      const material = shopifyProducts.find(product =>
        product.title.toLowerCase().includes(materialType),
      );
      if (!material) {
        await QuoteState.updateOne({ sessionId }, { step: 'material' });
        return `Sorry, we don't have ${materialType} in our catalog. Available materials: granite, quartz, marble.`;
      }

      const materialPricePerSqFt = parseFloat(material.variants[0].price);
      const laborPricePerSqFt = parseFloat(
        laborPricing.find(item => item.type === 'standard')?.price || 50,
      );
      const materialCost = materialPricePerSqFt * area;
      const laborCost = laborPricePerSqFt * area;
      const totalCost = (materialCost + laborCost).toFixed(2);

      return `Here’s your quote for a ${state.dimensions.width}x${state.dimensions.depth} ft countertop in ${materialType}:
- Material: $${materialCost.toFixed(2)}
- Labor: $${laborCost.toFixed(2)}
- Total: $${totalCost}
Would you like to confirm this quote? Reply 'confirm' to proceed.`;
    }

    if (state.step === 'confirm') {
      if (lowerMsg.includes('confirm')) {
        const area = state.dimensions.width * state.dimensions.depth;
        const totalCost = ((area * 100) + 50).toFixed(2); // Simplified for notification
        await sendLeadNotification('New Quote Confirmation', {
          sessionId,
          dimensions: `${state.dimensions.width}x${state.dimensions.depth} ft`,
          material: state.material,
          totalCost: `$${totalCost}`,
        });
        await QuoteState.deleteOne({ sessionId }); // Reset state
        return 'Thank you! Your quote has been confirmed, and our team will contact you soon.';
      } else {
        await QuoteState.updateOne({ sessionId }, { step: 'init' });
        return 'Let’s start over. What are the dimensions of the countertop (e.g., 5x3 feet)?';
      }
    }

    return 'I’m not sure how to proceed. Please provide the requested details or type "start over" to begin again.';
  } catch (err) {
    console.error('Quote flow error:', err.message);
    return 'Sorry, I couldn’t process your request. Please try again or contact support.';
  }
}

// --- Handle Consultation Request ---
async function handleConsultationRequest(userMsg, sessionId) {
  try {
    const nameMatch = userMsg.match(/my name is (\w+)/i);
    const name = nameMatch ? nameMatch[1] : 'Unknown';
    await sendLeadNotification('New Consultation Request', {
      sessionId,
      name,
      message: userMsg,
    });
    return 'Thank you for requesting a consultation! Our team will reach out to you soon to schedule a free session.';
  } catch (err) {
    console.error('Consultation request error:', err.message);
    return 'Sorry, I couldn’t process your consultation request. Please try again or contact support.';
  }
}

// --- Pricing Endpoint ---
app.get('/pricing', async (req, res) => {
  const { materialType, laborType, markup = 0 } = req.query;

  try {
    const laborPricing = await fetchLaborSheet();
    const shopifyProducts = await fetchShopifyProducts();

    const filteredLabor = laborType
      ? laborPricing.filter(item => item.type === laborType)
      : laborPricing;
    const filteredMaterials = materialType
      ? shopifyProducts.filter(product => product.title.includes(materialType))
      : shopifyProducts;

    const adjustedLabor = filteredLabor.map(item => ({
      ...item,
      price: (item.price * (1 + markup / 100)).toFixed(2),
    }));
    const adjustedMaterials = filteredMaterials.map(product => ({
      ...product,
      price: (parseFloat(product.variants[0].price) * (1 + markup / 100)).toFixed(2),
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

// --- FAQ Endpoint from companyInfo.json ---
app.get('/api/faq', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'companyInfo.json');
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading companyInfo.json:', err);
      return res.status(500).json({ error: 'Error reading company information' });
    }
    try {
      const companyInfo = JSON.parse(data);
      if (companyInfo.faq) {
        res.json(companyInfo.faq);
      } else {
        res.json(companyInfo);
      }
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

// --- Error Handling Middleware ---
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({
    error: 'Something went wrong!',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Surprise Granite Assistant running at http://localhost:${PORT}`);
});
