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
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

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

const EMAIL_PASS = process.env.EMAIL_PASSWORD || process.env.EMAIL_PASS; // Support both
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
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('MongoDB connected!'))
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

// --- Middleware ---
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Utility Functions ---

// --- Utility Function for Price Formatting ---
function formatPrice(value) {
  return `$${parseFloat(value).toFixed(2)} per square foot`;
}

// --- Improved Fuzzy Matching with Levenshtein Distance ---
function fuzzyMatch(str, pattern, recentMaterials = []) {
  if (!str || !pattern) return 0;
  const cleanStr = str.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const cleanPattern = pattern.toLowerCase().replace(/[^a-z0-9\s]/g, '');

  // Prioritize recent materials
  const isRecent = recentMaterials.some((mat) =>
    cleanStr.includes(mat.toLowerCase().replace(/[^a-z0-9\s]/g, ''))
  );
  let score = isRecent ? 10 : 0;

  // Simple substring match
  if (cleanStr.includes(cleanPattern) || cleanPattern.includes(cleanStr)) {
    score += 5;
  }

  // Levenshtein distance for partial matching
  const levenshteinDistance = (a, b) => {
    const matrix = Array(b.length + 1)
      .fill()
      .map(() => Array(a.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }
    return matrix[b.length][a.length];
  };

  const distance = levenshteinDistance(cleanStr, cleanPattern);
  score += Math.max(0, 5 - distance); // Higher score for closer matches

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
    // Sort by fuzzy match score
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
async function fetchShopifyProducts() {
  const url = `https://${process.env.SHOPIFY_SHOP}/admin/api/2024-10/products.json`;
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
    throw error;
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
    pass: EMAIL_PASS, // Use resolved EMAIL_PASS
  },
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

      // --- Log Request ---
      console.log(`Request ID: ${requestId}, Session ID: ${sessionId}, User message: ${userMessage}`);

      // --- Fetch Conversation History ---
      let chatLog = await ChatLog.findOne({ sessionId });
      if (!chatLog) {
        chatLog = new ChatLog({ sessionId, messages: [] });
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
          )} (${cheapest.Thickness}, Vendor: ${cheapest['Vendor Name'] || 'unknown'}). Would you like a quote for a specific countertop size?`;
          console.log(`AI Response: ${responseMessage}`); // Log AI response

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
        shopifyProducts = await fetchShopifyProducts();
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
          const responseMessage = `We offer "${matchedSink.title}" for $${price.toFixed(
            2
          )}. Visit our Shopify store to purchase.`;
          console.log(`AI Response: ${responseMessage}`); // Log AI response

          chatLog.messages.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: responseMessage }
          );
          await chatLog.save();
          return res.json({ message: responseMessage });
        }
      }

      const matchedProduct = shopifyProducts.find((product) =>
        product.title && fuzzyMatch(product.title, userMessage, recentMaterials)
      );

      if (matchedProduct) {
        const price = parseFloat(matchedProduct.variants[0].price) || 0;
        const responseMessage = `You can purchase "${matchedProduct.title}" for $${price.toFixed(
          2
        )}. Visit our Shopify store to purchase.`;
        console.log(`AI Response: ${responseMessage}`); // Log AI response

        chatLog.messages.push(
          { role: 'user', content: userMessage },
          { role: 'assistant', content: responseMessage }
        );
        await chatLog.save();
        return res.json({ message: responseMessage });
      }

      // --- Fallback to AI Response with Enhanced Context ---
      const systemPrompt = {
        role: 'system',
        content: `
          You are Surprise Granite's AI assistant. Your tasks include:
          - Providing prices for countertop materials from the Google Sheets price list or MongoDB.
          - Offering product information from the Shopify store.
          - Generating quotes for countertops based on material prices and dimensions (e.g., 5x3 ft).
          - Including labor costs in estimates using the labor price list (e.g., $42/sqft for Quartz).
          - Maintaining conversation context using the provided chat history and recent materials: ${recentMaterials.join(
            ', '
          )}.
          - For sinks, check Shopify products or suggest contacting support.
          - If no specific material or product is found, suggest contacting support or visiting the store.
          - Use consistent pricing format (e.g., "$10.00 per square foot").
          - If the user asks about fabrication or installation, reference previously discussed materials if available.
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
      console.log(`AI Response: ${aiMessage}`); // Log AI response

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
