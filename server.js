import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { OpenAI } from 'openai';
import { v2 as cloudinary } from 'cloudinary';
import streamifier from 'streamifier';

const app = express();
app.use(express.json());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.static('public'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true, useUnifiedTopology: true
}).then(() => console.log('MongoDB connected'))
  .catch(err => { console.error('MongoDB error:', err); process.exit(1); });

// Schema and Model
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

// Multer setup (memory storage for cloud upload)
const upload = multer({ storage: multer.memoryStorage() });

// Cloudinary setup
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: Get session transcript
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

// Helper: Upload one file buffer to Cloudinary & return {url, public_id, ...}
async function uploadToCloudinary(file) {
  return new Promise((resolve, reject) => {
    let cld_upload_stream = cloudinary.uploader.upload_stream(
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
    streamifier.createReadStream(file.buffer).pipe(cld_upload_stream);
  });
}

// Chat endpoint
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

    // AI response (with OpenAI)
    let aiResponse = '';
    if (message && (!action || action === 'chat')) {
      if (process.env.OPENAI_API_KEY) {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: "You are a helpful assistant for a granite countertop business." },
            { role: "user", content: message }
          ]
        });
        aiResponse = completion.choices[0].message.content;
      } else {
        aiResponse = "AI not available.";
      }
      // Save AI message
      await new ChatMessage({
        sessionId,
        from: 'ai',
        message: aiResponse
      }).save();
    }

    // Send email on request (e.g. contact form or chat end)
    if (action === 'sendEmail' || action === 'contactForm') {
      let emailText = '';
      if (contact) {
        // If contact is JSON stringified
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
        subject: contact ? `Contact Form - ${contact.name}` : 'New Chatbot Session',
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

// For chat history (admin or user)
app.get('/api/chats/:sessionId', async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
  res.json(messages);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
