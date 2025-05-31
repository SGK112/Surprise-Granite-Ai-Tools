require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const NodeCache = require('node-cache');
const { parse } = require('csv-parse/sync');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');

// --- Initialize App ---
const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// --- Debug Startup ---
console.log('Starting server...');
console.log('Environment Variables:', {
  MONGO_URI: !!process.env.MONGO_URI,
  GOOGLE_SHEET_CSV_URL: !!process.env.GOOGLE_SHEET_CSV_URL,
  PUBLISHED_CSV_LABOR: !!process.env.PUBLISHED_CSV_LABOR,
  SHOPIFY_ACCESS_TOKEN: !!process.env.SHOPIFY_ACCESS_TOKEN,
  SHOPIFY_SHOP: !!process.env.SHOPIFY_SHOP,
  OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
  EMAIL_USER: !!process.env.EMAIL_USER,
  EMAIL_PASS: !!(process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS),
});

// --- Enable CORS ---
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.set('trust proxy', true);

// --- Validate Environment Variables ---
const REQUIRED_ENV_VARS = [
  'MONGO_URI',
  'GOOGLE_SHEET_CSV_URL',
  'PUBLISHED_CSV_LABOR',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_SHOP',
  'OPENAI_API_KEY',
  'EMAIL_USER',
];

const EMAIL_PASS = process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS;
if (!EMAIL_PASS) {
  console.error('Missing required environment variable: EMAIL_PASSWORD or EMAIL_PASS');
  process.exit(1);
}
REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

// --- MongoDB Connection ---
console.log('Connecting to MongoDB...');
mongoose
  .connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('MongoDB connected!');
    // Create indexes for performance
    Countertop.createIndexes({ material: 1, thickness: 1 });
    ChatLog.createIndexes({ sessionId: 1 });
    Lead.createIndexes({ email: 1 });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// --- Define Schemas ---
const Countertop = mongoose.model(
  'Countertop',
  new mongoose.Schema({
    material: String,
    thickness: String,
    price_per_sqft: Number,
    image_url: String,
  })
);

const ChatLog = mongoose.model(
  'ChatLog',
  new mongoose.Schema(
    {
      sessionId: String,
      userId: String, // Optional: for authenticated users
      messages: [
        {
          role: String,
          content: String,
          createdAt: { type: Date, default: Date.now },
        },
      ],
      appointmentRequested: Boolean,
    },
    { timestamps: true }
  )
);

const Lead = mongoose.model(
  'Lead',
  new mongoose.Schema(
    {
      name: String,
      email: String,
      phone: String,
      projectDetails: String,
      images: [String], // Store image paths
      source: String, // e.g., "Basin", "Chat"
      createdAt: { type: Date, default: Date.now },
    },
    { timestamps: true }
  )
);

// --- Middleware ---
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Image Upload Setup ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath);
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images are allowed'));
    }
  },
});

// --- Load Company Info ---
let companyInfo = {};
try {
  companyInfo = JSON.parse(fs.readFileSync(path.join(__dirname, 'public', 'companyinfo.json')));
  console.log('Company info loaded:', companyInfo);
} catch (err) {
  console.error('Error loading companyinfo.json:', err.message);
}

// --- Utility Functions ---

// --- Utility Function for Price Formatting ---
function formatPrice(value) {
  return `$${parseFloat(value).toFixed(2)} per square foot`;
}

// --- Simplified Fuzzy Matching ---
function fuzzyMatch(str, pattern, recentMaterials = []) {
  if (!str || !pattern) return 0;
  const cleanStr = str.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const cleanPattern = pattern.toLowerCase().replace(/[^a-z0-9\s]/g, '');

  // Prioritize recent materials
  const isRecent = recentMaterials.some((mat) =>
    cleanStr.includes(mat.toLowerCase().replace(/[^a-z0-9\s]/g, ''))
  );
  let score = isRecent ? 10 : 0;

  // Substring match
  if (cleanStr.includes(cleanPattern) || cleanPattern.includes(cleanStr)) {
    score += 5;
  }

  // Partial word match
  const strWords = cleanStr.split(/\s+/);
  const patternWords = cleanPattern.split(/\s+/);
  const wordMatches = strWords.some(sWord =>
    patternWords.some(pWord => sWord.includes(pWord) || pWord.includes(sWord))
  );
  if (wordMatches) score += 3;

  return score > 0 ? score : 0;
}

// --- Validate Material Existence ---
async function validateMaterial(materialName, thickness = null) {
  try {
    // Check MongoDB
    const mongoMaterial = await Countertop.findOne({
      material: { $regex: materialName, $options: 'i' },
      ...(thickness && { thickness }),
    });
    if (mongoMaterial) {
      return {
        source: 'MongoDB',
        material: mongoMaterial.material,
        thickness: mongoMaterial.thickness,
        price: mongoMaterial.price_per_sqft,
        image_url: mongoMaterial.image_url,
      };
    }

    // Check CSV
    const priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
    const csvMaterial = priceList
      .map(item => ({
        ...item,
        score: fuzzyMatch(item['Color Name'], materialName),
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)[0];

    if (csvMaterial && (!thickness || csvMaterial.Thickness?.toLowerCase().includes(thickness.toLowerCase()))) {
      return {
        source: 'CSV',
        material: csvMaterial['Color Name'],
        thickness: csvMaterial.Thickness,
        price: parseFloat(csvMaterial['Cost/SqFt']) || 0,
        image_url: csvMaterial.image_url || null,
      };
    }

    return null;
  } catch (error) {
    console.error(`Error validating material ${materialName}:`, error.message);
    return null;
  }
}

// --- Structured Logging ---
function logMaterialQuery(requestId, sessionId, userMessage, matchedMaterial) {
  console.log({
    requestId,
    sessionId,
    userMessage,
    matchedMaterial: matchedMaterial
      ? {
          material: matchedMaterial.material,
          thickness: matchedMaterial.thickness,
          price: matchedMaterial.price,
          source: matchedMaterial.source,
        }
      : null,
    timestamp: new Date().toISOString(),
  });
}

// --- Shopify API Functionality ---
async function fetchShopifyProducts(query = '') {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-10/products.json${query ? `?title=${encodeURIComponent(query)}` : ''}`;
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SHOPIFY_ACCESS_TOKEN}`,
      },
      timeout: 10000,
    });
    console.log('Shopify products fetched:', response.data.products.length);
    return response.data.products;
  } catch (error) {
    console.error('Shopify API error:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      url,
    });
    return [];
  }
}

async function fetchShopifyInventory(productId, variantId) {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-10/inventory_levels.json?inventory_item_ids=${variantId}`;
  try {
    const response = await axios.get(url, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SHOPIFY_ACCESS_TOKEN}`,
      },
      timeout: 10000,
    });
    return response.data.inventory_levels;
  } catch (error) {
    console.error('Shopify inventory error:', error.message);
    return [];
  }
}

async function createShopifyCart(customerId, items) {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-10/draft_orders.json`;
  try {
    const response = await axios.post(
      url,
      {
        draft_order: {
          line_items: items.map(item => ({
            variant_id: item.variantId,
            quantity: item.quantity,
          })),
          customer: { id: customerId },
        },
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SHOPIFY_ACCESS_TOKEN}`,
        },
        timeout: 10000,
      }
    );
    return response.data.draft_order;
  } catch (error) {
    console.error('Shopify cart error:', error.message);
    return null;
  }
}

// --- Fetch CSV Data ---
async function fetchCsvData(url, cacheKey, retries = 2) {
  let data = cache.get(cacheKey);
  if (data) {
    console.log(`Cache hit for ${cacheKey}: ${data.length} rows`);
    return data;
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Fetching CSV from ${url} (Attempt ${attempt})`);
      const response = await axios.get(url, { timeout: 10000 });
      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: Failed to fetch CSV from ${url}`);
      }
      if (!response.data || typeof response.data !== 'string') {
        throw new Error(`Invalid CSV data from ${url}`);
      }
      data = parse(response.data, { columns: true, skip_empty_lines: true, trim: true })
        .map(row => ({
          'Color Name': row['Color Name'] || '',
          'Vendor Name': row['Vendor Name'] || '',
          'Thickness': row['Thickness'] || '',
          'Material': row['Material'] || '',
          'Cost/SqFt': row['Cost/SqFt'] || '0',
          'image_url': row['image_url'] || null,
        }));
      if (!data || data.length === 0) {
        throw new Error(`Empty or invalid CSV from ${url}`);
      }
      console.log(`Parsed CSV from ${url}, ${data.length} rows`);
      console.log(`CSV columns: ${Object.keys(data[0]).join(', ')}`);
      console.log(`First 3 rows: ${JSON.stringify(data.slice(0, 3))}`);
      cache.set(cacheKey, data);
      return data;
    } catch (error) {
      console.error(`Error fetching/parsing CSV (${cacheKey}, Attempt ${attempt}): ${error.message}`);
      if (attempt === retries) {
        cache.delete(cacheKey);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// --- Extract Dimensions ---
function extractDimensions(message) {
  const regex = /(\d+\.?\d*)\s*(x|by|\*)\s*(\d+\.?\d*)\s*(ft|feet)?/i;
  const match = message.match(regex);
  if (match) {
    const length = parseFloat(match[1]);
    const width = parseFloat(match[3]);
    return { length, width, area: length * width };
  }
  return null;
}

// --- Match Labor Cost by Material ---
function getLaborCostPerMaterial(laborData, materialType) {
  const materialLower = materialType.toLowerCase();
  const laborItem = laborData.find((item) => {
    const description = item['Quartz Countertop Fabrication'] || '';
    return description.toLowerCase().includes(materialLower);
  });
  return laborItem ? parseFloat(laborItem['42.00']) : 10; // Default $10/sqft
}

// --- Email Notifications ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: EMAIL_PASS,
  },
});

// --- Image Upload Endpoint ---
app.post('/api/upload', upload.array('images', 5), async (req, res) => {
  try {
    const files = req.files;
    const { name, email, phone, projectDetails } = req.body;
    const imagePaths = files.map(file => file.path);

    const lead = new Lead({
      name,
      email,
      phone,
      projectDetails,
      images: imagePaths,
      source: 'ChatUpload',
    });
    await lead.save();

    res.status(200).json({ message: 'Images and lead details saved successfully!' });
  } catch (err) {
    console.error('Image upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload images', details: err.message });
  }
});

// --- Chat Endpoint ---
app.post(
  '/api/chat',
  [body('message').isString().trim().isLength({ max: 1000 })],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const userMessage = req.body.message;
      const sessionId = req.body.sessionId || 'anonymous';
      const requestId = req.headers['x-request-id'] || 'unknown';
      const userId = req.body.userId || null; // Optional: for authenticated users

      // --- Log Request ---
      console.log(`Request ID: ${requestId}, Session ID: ${sessionId}, User message: ${userMessage}`);

      // --- Fetch Conversation History ---
      let chatLog = await ChatLog.findOne({ sessionId });
      if (!chatLog) {
        chatLog = new ChatLog({ sessionId, userId, messages: [] });
      }
      const conversationHistory = chatLog.messages.slice(-5).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      // --- Extract Recent Materials ---
      const recentMaterials = chatLog.messages
        .filter((msg) => msg.role === 'assistant' && msg.content.includes('per square foot'))
        .map((msg) => {
          const match = msg.content.match(/The price for ([^()]+) \(/);
          return match ? match[1].trim() : null;
        })
        .filter(Boolean);

      // --- Handle Lead Capture ---
      const leadRegex = /name:\s*([\w\s]+),\s*email:\s*([\w.-]+@[\w.-]+\.\w+),\s*phone:\s*(\d{10})/i;
      const leadMatch = userMessage.match(leadRegex);
      if (leadMatch) {
        const [, name, email, phone] = leadMatch;
        const lead = new Lead({
          name,
          email,
          phone,
          projectDetails: userMessage,
          source: 'Chat',
        });
        await lead.save();
        console.log(`Lead saved: ${name}, ${email}`);
      }

      // --- Fetch Google Sheets Price List ---
      let priceList = [];
      try {
        priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
      } catch (error) {
        console.error('Failed to fetch price list:', error.message);
      }

      // --- Search for Material ---
      let matchedMaterial = null;
      const thicknessMatch = userMessage.match(/(\d+\.?\d*)\s*cm/i);
      const requestedThickness = thicknessMatch ? thicknessMatch[1] + 'cm' : null;

      if (priceList.length > 0) {
        matchedMaterial = priceList
          .map(item => ({
            ...item,
            score: fuzzyMatch(item['Color Name'], userMessage, recentMaterials),
          }))
          .filter(item => item.score > 0)
          .sort((a, b) => b.score - a.score)
          .find(item => !requestedThickness || item.Thickness?.toLowerCase().includes(requestedThickness.toLowerCase()));
      }

      // --- Cross-Reference with MongoDB ---
      if (!matchedMaterial) {
        const materialName = userMessage
          .split(' ')
          .filter((word) => !word.match(/(\d+\.?\d*)\s*cm/i))
          .join(' ');
        matchedMaterial = await validateMaterial(materialName, requestedThickness);
      }

      // --- Handle Material Price Query ---
      if (matchedMaterial) {
        logMaterialQuery(requestId, sessionId, userMessage, matchedMaterial);
        const material = matchedMaterial.material;
        const vendor = matchedMaterial.vendor || 'unknown';
        const thickness = matchedMaterial.thickness || 'unknown';
        const price = matchedMaterial.price || 0;
        const materialType = matchedMaterial.Material || 'unknown';
        let responseMessage = `The price for ${material} (${thickness}, ${materialType}, Vendor: ${vendor}) is ${formatPrice(
          price
        )}.`;

        // --- Generate Estimate with Dimensions ---
        const dimensions = extractDimensions(userMessage);
        if (dimensions) {
          const { area } = dimensions;
          const materialCost = area * price;

          // --- Fetch Labor Costs ---
          let laborCostPerSqft = 10;
          try {
            const laborData = await fetchCsvData(process.env.PUBLISHED_CSV_LABOR, 'labor_costs');
            laborCostPerSqft = getLaborCostPerMaterial(laborData, materialType);
          } catch (error) {
            console.error('Failed to fetch labor costs:', error.message);
          }
          const laborCost = area * laborCostPerSqft;

          const totalCost = materialCost + laborCost;
          responseMessage += `\nFor a ${dimensions.length} x ${dimensions.width} ft countertop (${area.toFixed(
            2
          )} sqft), the estimated cost is $${totalCost.toFixed(2)} (material: $${materialCost.toFixed(
            2
          )}, labor: $${laborCost.toFixed(2)}).`;
        }

        // --- Suggest Recent Materials for Fabrication ---
        if (userMessage.toLowerCase().includes('fabrication') || userMessage.toLowerCase().includes('installation')) {
          if (recentMaterials.length > 0) {
            responseMessage += `\nYou previously asked about ${recentMaterials.join(
              ', '
            )}. Would you like an estimate for fabrication and installation using any of these materials? Please provide the countertop dimensions (e.g., 5x3 ft).`;
          } else {
            responseMessage += `\nPlease provide the countertop dimensions (e.g., 5x3 ft) and specify a material for a fabrication and installation estimate.`;
          }
        }

        // --- Add Footer ---
        responseMessage += `\n\n---\nContact us: [Call (602) 833-3189](tel:+16028333189) | [Message Us](https://usebasin.com/f/0e9742fed801) | [Get Directions](https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379)`;

        console.log(`Response: ${responseMessage}`);

        // --- Update Chat Log ---
        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();

        return res.json({
          message: responseMessage,
          image: matchedMaterial.image_url || null,
        });
      }

      // --- Handle Cheapest Quartz Query ---
      if (userMessage.toLowerCase().includes('cheapest') && userMessage.toLowerCase().includes('quartz')) {
        const quartzMaterials = priceList.filter((item) => item.Material?.toLowerCase() === 'quartz');
        if (quartzMaterials.length > 0) {
          const cheapest = quartzMaterials.reduce((min, item) =>
            parseFloat(item['Cost/SqFt']) < parseFloat(min['Cost/SqFt']) ? item : min
          );
          const responseMessage = `The cheapest quartz we offer is "${cheapest['Color Name']}" at ${formatPrice(
            cheapest['Cost/SqFt']
          )} (${cheapest.Thickness}, Vendor: ${cheapest['Vendor Name'] || 'unknown'}). Would you like a quote for a specific countertop size?\n\n---\nContact us: [Call (602) 833-3189](tel:+16028333189) | [Message Us](https://usebasin.com/f/0e9742fed801) | [Get Directions](https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379)`;
          console.log(`Response: ${responseMessage}`);

          chatLog.messages.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();

          return res.json({ message: responseMessage, image: cheapest.image_url || null });
        }
      }

      // --- Fetch Shopify Products ---
      let shopifyProducts = [];
      try {
        shopifyProducts = await fetchShopifyProducts(userMessage);
      } catch (error) {
        console.error('Failed to fetch Shopify products:', error.message);
      }

      // --- Handle Sink Queries ---
      if (userMessage.toLowerCase().includes('sink')) {
        const matchedSink = shopifyProducts.find(
          (product) =>
            product.title &&
            fuzzyMatch(product.title, 'sink', recentMaterials) &&
            userMessage.toLowerCase().includes(product.title.toLowerCase())
        );
        if (matchedSink) {
          const price = parseFloat(matchedSink.variants[0].price) || 0;
          const inventory = await fetchShopifyInventory(matchedSink.id, matchedSink.variants[0].id);
          const inStock = inventory.length > 0 && inventory[0].available > 0;
          const responseMessage = `We offer "${matchedSink.title}" for $${price.toFixed(
            2
          )}${inStock ? ' (in stock)' : ' (out of stock)'}. Visit our store to purchase: ${matchedSink.onlineStoreUrl || 'https://store.surprise-granite.myshopify.com'}.\n\n---\nContact us: [Call (602) 833-3189](tel:+16028333189) | [Message Us](https://usebasin.com/f/0e9742fed801) | [Get Directions](https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379)`;
          console.log(`Response: ${responseMessage}`);

          chatLog.messages.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage });
        }
      }

      // --- Handle Cart Creation ---
      if (userMessage.toLowerCase().includes('add to cart')) {
        const productMatch = shopifyProducts.find((product) =>
          product.title && fuzzyMatch(product.title, userMessage, recentMaterials)
        );
        if (productMatch) {
          const cart = await createShopifyCart(null, [
            { variantId: productMatch.variants[0].id, quantity: 1 },
          ]);
          const responseMessage = cart
            ? `Added "${productMatch.title}" to your cart. Complete your purchase at our store: ${cart.invoice_url || 'https://store.surprise-granite.myshopify.com'}.\n\n---\nContact us: [Call (602) 833-3189](tel:+16028333189) | [Message Us](https://usebasin.com/f/0e9742fed801) | [Get Directions](https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379)`
            : `Failed to add "${productMatch.title}" to cart. Please try again or visit our store.\n\n---\nContact us: [Call (602) 833-3189](tel:+16028333189) | [Message Us](https://usebasin.com/f/0e9742fed801) | [Get Directions](https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379)`;
          console.log(`Response: ${responseMessage}`);

          chatLog.messages.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage });
        }
      }

      // --- Fallback to AI Response with Enhanced Context ---
      const systemPrompt = {
        role: 'system',
        content: `
          You are Surprise Granite's AI assistant, acting as a personal shopper and assistant for Joshua Breese, staff, customers, and contractors. Your tasks include:
          - Providing prices for countertop materials from the Google Sheets price list or MongoDB.
          - Offering product information (products, images, inventory, pricing, carts) from our store (Shopify).
          - Generating quotes based on material prices and dimensions (e.g., 5x3 ft).
          - Including labor costs from the labor price list (e.g., $42/sqft for Quartz).
          - Using business info from companyinfo.json: ${JSON.stringify(companyInfo)}.
          - Maintaining conversation context using chat history and recent materials: ${recentMaterials.join(', ')}.
          - Capturing leads (name, email, phone) and saving to MongoDB.
          - Handling image uploads for kitchen projects/drawings via /api/upload.
          - For sinks, check our store products or suggest contacting support.
          - If no material/product is found, suggest contacting support or visiting our store.
          - Use consistent pricing format (e.g., "$10.00 per square foot").
          - For fabrication/installation queries, reference prior materials if available.
          - For greetings like "Hello", respond with a friendly welcome and offer assistance.
          - For Joshua Breese, provide detailed technical responses if requested.
          - Be reliable, natural, and avoid literal instruction references.
          - Always include a footer with: Call (602) 833-3189, Message Us (Basin link), Get Directions (11560 N Dysart Rd, Surprise, AZ 85379).
        `,
      };

      const messages = [
        systemPrompt,
        ...conversationHistory,
        { role: 'user', content: userMessage },
      ];

      const aiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages,
          temperature: 0.7,
          max_tokens: 600,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      let aiMessage = aiResponse.data.choices[0].message.content;

      // --- Ensure Consistent Pricing in AI Response ---
      aiMessage = aiMessage.replace(/\$(\d+\.?\d*)\s*(\/sqft|per square foot)/gi, (match, price) =>
        formatPrice(price)
      );

      // --- Add Footer ---
      aiMessage += `\n\n---\nContact us: [Call (602) 833-3189](tel:+16028333189) | [Message Us](https://usebasin.com/f/0e9742fed801) | [Get Directions](https://maps.google.com/?q=11560+N+Dysart+Rd,+Surprise,+AZ+85379)`;

      console.log(`Response: ${aiMessage}`);

      // --- Update Chat Log ---
      chatLog.messages.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: aiMessage }
      );
      await chatLog.save();

      res.json({ message: aiMessage });
    } catch (err) {
      console.error(`Error in /api/chat (Request ID: ${req.headers['x-request-id'] || 'unknown'}):`, err.message);
      res.status(500).json({
        error: 'An error occurred while processing your request. Please try again later.',
        details: err.message,
      });
    }
  }
);

// --- Default Route ---
app.get('/', (req, res) => {
  res.send('Welcome to the Surprise Granite API!');
});

// --- Handle Common 404s ---
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/robots.txt', (req, res) => res.send('User-agent: *\nAllow: /'));
app.get('/apple-app-site-association', (req, res) => res.status(404).send('Not found'));

// --- Catch-All Route ---
app.use((req, res) => {
  res.status(404).send('Page not found. Make sure you are accessing the correct endpoint.');
});

// --- Handle SIGTERM ---
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Shutting down gracefully...');
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed.');
    process.exit(0);
  });
});

// --- Global Error Handling ---
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err.message);
  process.exit(1);
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
