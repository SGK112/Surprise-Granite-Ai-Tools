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

// --- Google Sheets CSV URLs from .env ---
const CSV_MATERIALS_URL = process.env.PUBLISHED_CSV_MATERIALS;
const CSV_LABOR_URL = process.env.PUBLISHED_CSV_LABOR;

// --- Load CSVs from Google Sheets ---
let materialsData = [];
let laborData = [];

async function fetchCsvData(url) {
  const res = await fetch(url);
  const text = await res.text();
  return parse(text, { columns: true });
}

async function refreshAllData() {
  if (CSV_MATERIALS_URL) {
    try {
      materialsData = await fetchCsvData(CSV_MATERIALS_URL);
      console.log("Loaded materialsData from Google Sheets.");
    } catch (e) {
      console.error("Error loading materialsData", e);
    }
  }
  if (CSV_LABOR_URL) {
    try {
      laborData = await fetchCsvData(CSV_LABOR_URL);
      console.log("Loaded laborData from Google Sheets.");
    } catch (e) {
      console.error("Error loading laborData", e);
    }
  }
}
// Initial load and refresh every hour
await refreshAllData();
setInterval(refreshAllData, 60 * 60 * 1000);

// --- MongoDB setup ---
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
const ChatMessageSchema = new mongoose.Schema({
  sessionId: String,
  from: String,
  message: String,
  files: [Object],
  createdAt: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);

// --- App setup ---
const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));

// --- Multer setup ---
const upload = multer({ storage: multer.memoryStorage() });

// --- Cloudinary config ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// --- OpenAI config ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Image upload helper ---
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

// --- Main chat endpoint ---
app.post('/api/chat', upload.array('attachments'), async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    let files = [];
    if (req.files && req.files.length) {
      files = await Promise.all(req.files.map(uploadToCloudinary));
    }
    // Save user message
    await new ChatMessage({ sessionId, from: 'user', message, files }).save();

    // --- SYSTEM PROMPT with live Google Sheets data ---
    const systemPrompt = `
You are a friendly, expert project estimator and assistant for Surprise Granite.
Here is our current price list for materials (CSV as array of objects):
${JSON.stringify(materialsData)}
And here are our labor rates (CSV as array of objects):
${JSON.stringify(laborData)}
When a user asks for a quote, help them select a material, estimate based on dimensions (if given), and explain the price calculation using both material and labor rates.
If they upload an image, analyze it for material type or room context.
If unsure, ask clarifying questions, then give a ballpark estimate using the price list.
Always be friendly and helpful, and only use these prices and rates for calculations.
    `.trim();

    // --- User content for OpenAI Vision ---
    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });
    files.forEach(f => userContent.push({ type: "image_url", image_url: { url: f.url }}));

    // --- OpenAI Vision call ---
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent.length > 0 ? userContent : [{ type: "text", text: "(See attached images)" }] }
      ],
      max_tokens: 1024
    });
    const aiResponse = completion.choices[0].message.content;

    // Save AI response
    await new ChatMessage({ sessionId, from: 'ai', message: aiResponse }).save();

    res.json({ message: aiResponse, images: files.map(f => f.url) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// --- Serve static files (widget) ---
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Surprise Granite Chatbot running on port ${PORT}`));
