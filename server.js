import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';
import { OpenAI } from 'openai';

const app = express();
app.use(express.json());

// Allow CORS from your Webflow site or domain
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || '*' }));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Simple chat message schema
const ChatMessageSchema = new mongoose.Schema({
  sessionId: String,
  from: String,
  message: String,
  files: [Object],
  createdAt: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);

// Multer setup for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Cloudinary config
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// OpenAI config
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// Main chat endpoint
app.post('/api/chat', upload.array('attachments'), async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    let files = [];
    if (req.files && req.files.length) {
      files = await Promise.all(req.files.map(uploadToCloudinary));
    }
    // Save user message
    await new ChatMessage({ sessionId, from: 'user', message, files }).save();

    // Prepare OpenAI Vision request
    const userContent = [];
    if (message) userContent.push({ type: "text", text: message });
    files.forEach(f => userContent.push({ type: "image_url", image_url: { url: f.url }}));
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful granite countertop assistant. Analyze images if provided." },
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

// Serve static files (for the widget)
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Surprise Granite Chatbot running on port ${PORT}`));
