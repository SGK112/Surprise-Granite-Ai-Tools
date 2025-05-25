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

// -- CONFIG --
const CSV_MATERIALS_URL = process.env.PUBLISHED_CSV_MATERIALS;
const CSV_LABOR_URL = process.env.PUBLISHED_CSV_LABOR;

// -- LOAD DATA FROM GOOGLE SHEETS --
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

// -- MONGODB --
mongoose.connect(process.env.MONGODB_URI);
const ChatMessageSchema = new mongoose.Schema({
  sessionId: String,
  from: String,
  message: String,
  files: [Object],
  createdAt: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);

// -- EXPRESS --
const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));

// -- MULTER FOR FILE UPLOADS --
const upload = multer({ storage: multer.memoryStorage() });

// -- CLOUDINARY --
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

// -- OPENAI --
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -- Helper: Filter relevant rows from materials/labor based on user query --
function filterRelevantRows(data, message) {
  if (!data || !message) return [];
  // Simple keyword match: look for any row where any value includes a word from the user's message
  const keywords = message.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  return data.filter(row =>
    Object.values(row)
      .some(val => keywords.some(kw => String(val).toLowerCase().includes(kw)))
  );
}

// -- CHAT ENDPOINT --
app.post('/api/chat', upload.array('attachments'), async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    let files = [];
    if (req.files && req.files.length) {
      files = await Promise.all(req.files.map(uploadToCloudinary));
    }
    await new ChatMessage({ sessionId, from: 'user', message, files }).save();

    // ----- Smart: Only send relevant or a small sample of the data to OpenAI -----
    const MAX_SAMPLE_ROWS = 8;
    let relevantMaterials = filterRelevantRows(materialsData, message);
    let relevantLabor = filterRelevantRows(laborData, message);

    // If no relevant matches, send a small sample to show the structure
    if (relevantMaterials.length === 0) relevantMaterials = materialsData.slice(0, MAX_SAMPLE_ROWS);
    if (relevantLabor.length === 0) relevantLabor = laborData.slice(0, MAX_SAMPLE_ROWS);

    const systemPrompt = `
You are a friendly, expert estimator for Surprise Granite.
Here is the current product price list sample or matches for the user's inquiry:
${JSON.stringify(relevantMaterials)}
And the labor rates sample or matches:
${JSON.stringify(relevantLabor)}
When a user asks for a quote, help them select a material, estimate based on dimensions (if given), and explain the price breakdown using both material and labor.
If they upload an image, analyze it for material type or room context.
If unsure, ask clarifying questions, then give a ballpark estimate using this data.
Always be helpful, and ONLY use these prices and rates for your answers.
    `.trim();

    // User content for OpenAI Vision
    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });
    files.forEach(f => userContent.push({ type: "image_url", image_url: { url: f.url }}));

    // OpenAI Vision call
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent.length > 0 ? userContent : [{ type: "text", text: "(See attached images)" }] }
      ],
      max_tokens: 1024
    });
    const aiResponse = completion.choices[0].message.content;

    await new ChatMessage({ sessionId, from: 'ai', message: aiResponse }).save();

    res.json({ message: aiResponse, images: files.map(f => f.url) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// -- STATIC FILES (WIDGET) --
app.use(express.static('public'));
app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Surprise Granite Chatbot running on port ${PORT}`));
