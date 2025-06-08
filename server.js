const express = require('express');
const cors = require('cors');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');
const Redis = require('ioredis');

const app = express();

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Redis setup
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://store.surprisegranite.com', 'http://localhost:3000'],
  methods: ['GET', 'POST'],
  credentials: true
}));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Shopify API configuration
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOPIFY_STORE_URL = 'https://surprise-granite.myshopify.com/admin/api/2023-04';

// Mock database for materials and pricing
const materials = [
  { material: 'Granite', name: 'Black Pearl', installedPrice: 65 },
  { material: 'Quartz', name: 'Calacatta Nuvo', installedPrice: 75 },
  { material: 'Marble', name: 'Carrara', installedPrice: 85 },
  { material: 'Quartzite', name: 'Taj Mahal', installedPrice: 90 },
  { material: 'Porcelain', name: 'Neolith', installedPrice: 80 },
  { material: 'Dekton', name: 'Entzo', installedPrice: 95 }
];

// Cache middleware
const cache = (duration) => async (req, res, next) => {
  const key = `__express__${req.originalUrl}`;
  const cached = await redis.get(key);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }
  res.sendResponse = res.json;
  res.json = (body) => {
    redis.setex(key, duration, JSON.stringify(body));
    res.sendResponse(body);
  };
  next();
};

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method
  });
  res.status(500).json({ error: 'Internal server error' });
};

// Chat endpoint
app.post('/api/chat', async (req, res, next) => {
  try {
    const { message, sessionId, clientId, clientEmail, quoteState } = req.body;
    if (!message || !sessionId || !clientId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store conversation
    await redis.lpush(`chat:${sessionId}`, JSON.stringify({
      message,
      clientId,
      clientEmail,
      timestamp: new Date().toISOString()
    }));

    // Basic response logic
    let responseMessage = 'I’m conjuring a response! ✨ What else can I help with?';
    let quickReplies = null;

    if (/quote|estimate/i.test(message)) {
      responseMessage = clientEmail
        ? 'Let’s refine your quote. What dimensions or materials are you considering?'
        : 'To start a quote, please provide your email via the lead form!';
      quickReplies = ['countertop_dimensions'];
    } else if (/design|style/i.test(message)) {
      responseMessage = 'For a modern look, try Quartz with a waterfall edge. Want more style tips?';
      quickReplies = ['initial'];
    }

    res.json({
      message: responseMessage,
      quickReplies,
      sessionId,
      clientId
    });

    logger.info({
      event: 'chat_message',
      sessionId,
      clientId,
      message,
      response: responseMessage
    });
  } catch (err) {
    next(err);
  }
});

// Materials endpoint
app.get('/api/materials', cache(3600), async (req, res, next) => {
  try {
    res.json(materials);
    logger.info({ event: 'materials_fetched' });
  } catch (err) {
    next(err);
  }
});

// Shopify products endpoint
app.get('/api/shopify-products', cache(1800), async (req, res, next) => {
  try {
    const response = await axios.get(`${SHOPIFY_STORE_URL}/products.json`, {
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_API_SECRET
      }
    });

    const products = response.data.products.map(product => ({
      name: product.title,
      price: product.variants[0].price,
      url: `https://store.surprisegranite.com/products/${product.handle}`
    }));

    res.json(products);
    logger.info({ event: 'shopify_products_fetched', count: products.length });
  } catch (err) {
    next(err);
  }
});

// Appointment endpoint
app.post('/api/appointment', async (req, res, next) => {
  try {
    const { name, email, city, date, time, sessionId } = req.body;
    if (!name || !email || !date || !time || !sessionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store appointment
    const appointmentId = uuidv4();
    await redis.set(`appointment:${appointmentId}`, JSON.stringify({
      name,
      email,
      city,
      date,
      time,
      sessionId,
      timestamp: new Date().toISOString()
    }));

    res.json({ message: `Appointment booked for ${name} on ${date} at ${time}!` });
    logger.info({ event: 'appointment_booked', appointmentId, sessionId });
  } catch (err) {
    next(err);
  }
});

// Wizard submission endpoint
app.post('/api/submit-wizard', async (req, res, next) => {
  try {
    const { clientId, sessionId, responses } = req.body;
    if (!clientId || !sessionId || !responses) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Store wizard responses
    await redis.set(`wizard:${clientId}:${sessionId}`, JSON.stringify({
      clientId,
      sessionId,
      responses,
      timestamp: new Date().toISOString()
    }));

    res.json({ message: 'Wizard responses submitted successfully' });
    logger.info({ event: 'wizard_submitted', clientId, sessionId });
  } catch (err) {
    next(err);
  }
});

// Close chat endpoint
app.post('/api/close-chat', async (req, res, next) => {
  try {
    const { sessionId, abandoned } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    // Archive chat
    await redis.set(`closed_chat:${sessionId}`, JSON.stringify({
      sessionId,
      abandoned,
      timestamp: new Date().toISOString()
    }));

    res.json({ message: 'Chat closed successfully' });
    logger.info({ event: 'chat_closed', sessionId, abandoned });
  } catch (err) {
    next(err);
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', uptime: process.uptime() });
});

// Error handler
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Closing server...');
  redis.quit();
  process.exit(0);
});
