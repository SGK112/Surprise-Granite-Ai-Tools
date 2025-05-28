require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const NodeCache = require('node-cache');
const axios = require('axios');
const { parse } = require('csv-parse/sync');

// --- Initialize App ---
const app = express();
const PORT = process.env.PORT || 3000;
const cache = new NodeCache({ stdTTL: 3600 }); // Cache for 1 hour

// --- Validate Environment Variables ---
const REQUIRED_ENV_VARS = [
  'MONGO_URI',
  'GOOGLE_SHEET_CSV_URL',
  'PUBLISHED_CSV_LABOR',
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
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log('MongoDB connected!'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// --- Define Schemas ---
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
  description: String,
}));

const QuoteState = mongoose.model('QuoteState', new mongoose.Schema({
  sessionId: String,
  step: { type: String, default: 'init' },
  dimensions: { width: Number, depth: Number },
  material: String,
  lastUpdated: { type: Date, default: Date.now },
}));

// --- Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static('public'));
app.use('/api/chat', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests, please try again later.',
}));

// --- Health Check Endpoint ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Nodemailer Setup ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

async function sendEmailNotification(subject, content) {
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.LEADS_RECEIVER || process.env.EMAIL_USER,
      subject,
      text: content,
    });
    console.log('Email sent successfully!');
  } catch (err) {
    console.error('Error sending email:', err);
  }
}

// --- Helpers for External Data Fetch ---
async function fetchCsvData(url, cacheKey) {
  let data = cache.get(cacheKey);
  if (!data) {
    const response = await axios.get(url);
    if (response.status !== 200) throw new Error(`Failed to fetch data from: ${url}`);
    data = parse(response.data, { columns: true });
    cache.set(cacheKey, data);
  }
  return data;
}

// --- Chat API Endpoint ---
app.post('/api/chat', [
  body('message').isString().trim().isLength({ max: 1000 }).withMessage('Message too long'),
  body('sessionId').optional().isAlphanumeric().withMessage('Invalid session ID'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { message, sessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}` } = req.body;
    const chat = await Chat.findOne({ sessionId }) || await Chat.create({ sessionId, messages: [] });

    // Fetch context data
    const [priceSheet, laborSheet] = await Promise.all([
      fetchCsvData(process.env.GOOGLE_SHEET_CSV_URL, 'priceSheet'),
      fetchCsvData(process.env.PUBLISHED_CSV_LABOR, 'laborSheet'),
    ]);

    // Compose AI request
    const aiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Provide professional and friendly countertop estimation.' },
        ...chat.messages.map(({ role, content }) => ({ role, content })),
        { role: 'user', content: message },
      ],
      temperature: 0.6,
      max_tokens: 600,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const aiMessage = aiResponse.data.choices[0].message.content;

    // Save chat
    chat.messages.push({ role: 'user', content: message });
    chat.messages.push({ role: 'ai', content: aiMessage });
    chat.messages = chat.messages.slice(-20); // Keep last 20 messages
    await chat.save();

    res.json({ message: aiMessage, sessionId });
  } catch (err) {
    console.error('Error in /api/chat:', err);
    res.status(500).json({ error: 'AI backend error', details: err.message });
  }
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});