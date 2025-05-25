import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';
import nodemailer from 'nodemailer';
import { OpenAI } from 'openai';

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true, useUnifiedTopology: true
}).then(() => console.log('MongoDB connected')).catch(err => { console.error('MongoDB error:', err); process.exit(1); });

const ChatMessageSchema = new mongoose.Schema({
  sessionId: String,
  from: String,
  message: String,
  files: [{
    url: String,
    public_id: String,
    originalname: String,
    mimetype: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);

// Multer (memory for cloud upload)
const upload = multer({ storage: multer.memoryStorage() });

// Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Utilities
async function getSessionTranscript(sessionId) {
  const messages = await ChatMessage.find({ sessionId }).sort({ createdAt: 1 });
  let transcript = '';
  messages.forEach(msg => {
    transcript += `[${msg.from}] ${msg.message || ''}\n`;
    if (msg.files?.length) {
      msg.files.forEach(f => {
        transcript += `  [file: ${f.originalname}] (${f.url})\n`;
      });
    }
  });
  return transcript;
}

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
    const { message, sessionId, action, contact } = req.body;
    let files = [];
    if (req.files && req.files.length) {
      files = await Promise.all(req.files.map(uploadToCloudinary));
    }

    // Save user message
    if (message || files.length) {
      await new ChatMessage({
        sessionId,
        from: 'user',
        message,
        files
      }).save();
    }

    // AI response with Vision support
    let aiResponse = '';
    if ((message || files.length) && (!action || action === 'chat')) {
      const systemMsg = {
        role: "system",
        content: "You are a helpful assistant for Surprise Granite. If the user uploads a photo, describe what's in it and offer relevant advice or pricing info if requested."
      };
      const userContent = [];
      if (message) userContent.push({ type: "text", text: message });
      if (files.length > 0) {
        files.forEach(f => userContent.push({
          type: "image_url",
          image_url: { url: f.url }
        }));
      }
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          systemMsg,
          {
            role: "user",
            content: userContent.length > 0 ? userContent : [{ type: "text", text: "(See attached images)" }]
          }
        ],
        max_tokens: 1024
      });
      aiResponse = completion.choices[0].message.content;
      await new ChatMessage({
        sessionId,
        from: 'ai',
        message: aiResponse
      }).save();
    }

    // Handle contact form/email
    if (action === 'sendEmail' || action === 'contactForm') {
      let emailText = '';
      if (contact) {
        let contactObj = contact;
        if (typeof contact === "string") {
          try { contactObj = JSON.parse(contact); } catch {}
        }
        emailText = `Contact Request:\nFrom: ${contactObj.name}\nEmail: ${contactObj.email}\nMessage: ${contactObj.message}\n\n`;
      }
      emailText += await getSessionTranscript(sessionId);
      await transporter.sendMail({
        from: `"Surprise Granite Bot" <${process.env.EMAIL_USER}>`,
        to: process.env.CONTACT_EMAIL || process.env.EMAIL_USER,
        subject: contact ? `Contact Form - ${contactObj.name}` : 'New Chatbot Session',
        text: emailText
      });
      return res.json({ message: "Your message has been sent! We will contact you soon.", sent: true });
    }

    res.json({
      message: aiResponse,
      images: files.map(f => f.url),
      saved: true
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// Fetch chat history (optional)
app.get('/api/chats/:sessionId', async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
  res.json(messages);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
