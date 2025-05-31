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

// --- Initialize App ---
const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 1800 }); // Cache for 30 minutes

// --- Enable Trust Proxy ---
app.set('trust proxy', 1);

// --- Validate Environment Variables ---
const REQUIRED_ENV_VARS = [
  'MONGO_URI',
  'GOOGLE_SHEET_CSV_URL',
  'PUBLISHED_CSV_LABOR',
  'SHOPIFY_ACCESS_TOKEN',
  'SHOPIFY_SHOP',
  'OPENAI_API_KEY',
  'EMAIL_USER',
  'EMAIL_PASS',
];
REQUIRED_ENV_VARS.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
});

// --- MongoDB Connection ---
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected!'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
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
      messages: [{ role: String, content: String, createdAt: { type: Date, default: Date.now } }],
      appointmentRequested: Boolean,
    },
    { timestamps: true }
  )
);

// --- Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));

// --- Serve Static Files ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Shopify API Functionality ---
async function fetchShopifyProducts() {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-10/products.json`;
  try {
    const response = await axios.get(url, {
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
      },
      timeout: 10000,
    });
    console.log('Shopify products fetched:', response.data.products.length);
    return response.data.products;
  } catch (error) {
    console.error('Shopify API error:', error.message);
    throw error;
  }
}

// --- Fetch CSV Data ---
async function fetchCsvData(url, cacheKey) {
  let data = cache.get(cacheKey);
  if (data) {
    console.log(`Cache hit for ${cacheKey}, ${data.length} rows`);
    return data;
  }
  try {
    console.log(`Fetching CSV from ${url}`);
    const response = await axios.get(url, { timeout: 10000 });
    if (response.status !== 200) {
      throw new Error(`HTTP ${response.status}: Failed to fetch CSV from ${url}`);
    }
    if (!response.data || typeof response.data !== 'string') {
      throw new Error(`Invalid CSV data from ${url}`);
    }
    data = parse(response.data, { columns: true, skip_empty_lines: true, trim: true });
    if (!data || data.length === 0) {
      throw new Error(`Empty or invalid CSV from ${url}`);
    }
    console.log(`Parsed CSV from ${url}, ${data.length} rows`);
    console.log(`CSV columns: ${Object.keys(data[0]).join(', ')}`);
    console.log(`Sample row: ${JSON.stringify(data[0])}`);
    cache.set(cacheKey, data);
    return data;
  } catch (error) {
    console.error(`Error fetching/parsing CSV (${cacheKey}): ${error.message}`);
    cache.del(cacheKey);
    throw error;
  }
}

// --- Fuzzy Matching ---
function fuzzyMatch(str, pattern) {
  if (!str || !pattern) return false;
  const cleanStr = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  const cleanPattern = pattern.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleanStr.includes(cleanPattern) || cleanPattern.includes(cleanStr) || cleanStr.indexOf(cleanPattern) !== -1;
}

// --- Extract Dimensions ---
function extractDimensions(message) {
  const dimensionRegex = /(\d+\.?\d*)\s*(x|by|\*)\s*(\d+\.?\d*)\s*(ft|feet)?/i;
  const match = message.match(dimensionRegex);
  if (match) {
    const length = parseFloat(match[1]);
    const width = parseFloat(match[3]);
    return { length, width, area: length * width };
  }
  return null;
}

// --- Match Labor Cost ---
function getLaborCostPerSqft(laborData, materialType) {
  const materialLower = materialType.toLowerCase();
  const laborItem = laborData.find((item) => {
    const description = Object.values(item)[1] || ''; // Column 2 (e.g., "Quartz Countertop Fabrication")
    return description.toLowerCase().includes(materialLower);
  });
  if (laborItem) {
    const cost = parseFloat(Object.values(laborItem)[3]); // Column 4 (e.g., 42.00)
    return isNaN(cost) ? 10 : cost;
  }
  return 10; // Default $10/sqft
}

// --- Email Notifications ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// --- Appointment Endpoint ---
app.post('/api/appointment', async (req, res) => {
  const { name, email, date, sessionId } = req.body;
  if (!name || !email || !date) {
    return res.status(400).json({ error: 'Name, email, and date are required.' });
  }

  try {
    let chatLog = await ChatLog.findOne({ sessionId });
    if (!chatLog) {
      chatLog = new ChatLog({ sessionId, messages: [] });
    }
    chatLog.appointmentRequested = true;
    chatLog.messages.push({
      role: 'system',
      content: `Appointment requested: ${name}, ${email}, ${date}`,
    });
    await chatLog.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'info@surprisegranite.com',
      subject: 'New Appointment Request',
      text: `Name: ${name}\nEmail: ${email}\nDate: ${date}`,
    });

    res.json({ message: `Appointment booked for ${name} on ${date}! We'll confirm via email.` });
  } catch (error) {
    console.error('Appointment error:', error.message);
    res.status(500).json({ error: 'Failed to book appointment. Please try again.' });
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
      const userMessage = req.body.message.toLowerCase();
      const sessionId = req.body.sessionId || 'anonymous';
      const requestId = req.headers['x-request-id'] || 'unknown';

      console.log(`Request ID: ${requestId}, Session ID: ${sessionId}, User message: ${userMessage}`);

      let chatLog = await ChatLog.findOne({ sessionId });
      if (!chatLog) {
        chatLog = new ChatLog({ sessionId, messages: [] });
      }
      const conversationHistory = chatLog.messages.slice(-5).map((msg) => ({
        role: msg.role,
        content: msg.content,
      }));

      let priceList = [];
      try {
        priceList = await fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'price_list');
      } catch (error) {
        console.error(`Failed to fetch price list: ${error.message}`);
      }

      let matchedMaterial = priceList.find((item) => {
        const materialName = item['Color Name'];
        if (!materialName) return false;
        const matchesName = fuzzyMatch(materialName, userMessage);
        const matchesThickness = !userMessage.includes('cm') || userMessage.includes(item.Thickness?.toLowerCase() || '');
        return matchesName && matchesThickness;
      });

      if (matchedMaterial) {
        const material = matchedMaterial['Color Name'];
        const thickness = matchedMaterial.Thickness || 'unknown';
        const price = parseFloat(matchedMaterial['Cost/SqFt']) || 0;
        const materialType = matchedMaterial.Material || 'unknown';
        if (!material || price === 0) {
          console.log(`Invalid material data: ${JSON.stringify(matchedMaterial)}`);
          const responseMessage = `Sorry, I couldn’t find pricing for "${req.body.message}". Try another material or check our store!`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage });
        }

        let responseMessage = `The price for ${material} (${thickness}, ${materialType}) is $${price.toFixed(2)} per square foot.`;

        const dimensions = extractDimensions(req.body.message);
        if (dimensions) {
          const { area } = dimensions;
          const materialCost = area * price;

          let laborCostPerSqft = 10;
          try {
            const laborData = await fetchCsvData(process.env.PUBLISHED_CSV_LABOR, 'labor_costs');
            laborCostPerSqft = getLaborCostPerSqft(laborData, materialType);
          } catch (error) {
            console.error(`Failed to fetch labor costs: ${error.message}`);
          }
          const laborCost = area * laborCostPerSqft;

          const totalCost = materialCost + laborCost;
          responseMessage += `\nFor a ${dimensions.length} x ${dimensions.width} ft countertop (${area.toFixed(2)} sqft), the estimated cost is $${totalCost.toFixed(2)} (material: $${materialCost.toFixed(2)}, labor: $${laborCost.toFixed(2)}).`;
        }

        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();

        return res.json({
          message: responseMessage,
          image: matchedMaterial.image_url || null,
        });
      }

      let shopifyProducts = [];
      try {
        shopifyProducts = await fetchShopifyProducts();
      } catch (error) {
        console.error(`Failed to fetch Shopify products: ${error.message}`);
      }

      if (userMessage.includes('sink')) {
        const matchedSink = shopifyProducts.find((product) =>
          product.title &&
          fuzzyMatch(product.title, 'sink') &&
          userMessage.includes(product.title.toLowerCase())
        );
        if (matchedSink) {
          const price = parseFloat(matchedSink.variants[0].price) || 0;
          const responseMessage = `We offer "${matchedSink.title}" for $${price.toFixed(2)}. Visit your Shopify store to buy.`;
          chatLog.messages.push(
            { role: 'user', content: req.body.message },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage });
        }
      }

      const matchedProduct = shopifyProducts.find((product) =>
        product.title && fuzzyMatch(product.title, userMessage)
      );

      if (matchedProduct) {
        const price = parseFloat(matchedProduct.variants[0].price) || 0;
        const responseMessage = `You can purchase "${matchedProduct.title}" for $${price.toFixed(2)}. Visit your Shopify store to buy.`;
        chatLog.messages.push(
          { role: 'user', content: req.body.message },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({ message: responseMessage });
      }

      const systemPrompt = {
        role: 'system',
        content: `
          You are Surprise Granite's AI assistant. Your tasks include:
          - Providing prices for countertop materials from the Google Sheets price list.
          - Offering product information from the Shopify store.
          - Generating quotes for countertops based on material prices and dimensions (e.g., 5x3 ft).
          - Including labor costs in estimates using the labor price list (e.g., $42/sqft for Quartz).
          - Maintaining conversation context using the provided chat history.
          - For sinks, check Shopify products or suggest contacting support via the website footer.
          - If no specific material or product is found, suggest checking the store or contacting support via the website footer.
          - Do not include contact information (phone, email, or links) in responses; users can use the website footer for contact options.
        `,
      };

      const messages = [
        systemPrompt,
        ...conversationHistory,
        { role: 'user', content: req.body.message },
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
      console.log(`Raw AI response: ${aiMessage}`);

      // Remove all contact information
      const contactPatterns = [
        /Contact us:.*$/gi,
        /If you'd like to contact our support team.*$/gi,
        /support@surprisegranite\.com/gi,
        /\[Call \(602\) 833-3189\].*$/gi,
        /\[Message Us\].*$/gi,
        /\[Get Directions\].*$/gi,
      ];
      contactPatterns.forEach((pattern) => {
        aiMessage = aiMessage.replace(pattern, '').trim();
      });
      console.log(`Cleaned AI response: ${aiMessage}`);

      chatLog.messages.push(
        { role: 'user', content: req.body.message },
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
