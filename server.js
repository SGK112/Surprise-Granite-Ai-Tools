import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import nodemailer from 'nodemailer';
import { OpenAI } from 'openai';

const app = express();
const __dirname = path.resolve();
app.use(express.json());
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
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
    filename: String,
    originalname: String,
    mimetype: String,
    path: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);

// Multer setup
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, ''))
});
const upload = multer({ storage });

// Serve uploaded files
app.use('/uploads', express.static(uploadDir));

// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
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
        transcript += `  [file: ${f.originalname}] (${f.path})\n`;
      });
    }
  });
  return transcript;
}

// Chat endpoint
app.post('/api/chat', upload.array('attachments'), async (req, res) => {
  try {
    const { message, sessionId, action, contact } = req.body;
    const files = (req.files || []).map(file => ({
      filename: file.filename,
      originalname: file.originalname,
      mimetype: file.mimetype,
      path: `/uploads/${file.filename}`
    }));

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
        emailText = `Contact Request:\nFrom: ${contact.name}\nEmail: ${contact.email}\nMessage: ${contact.message}\n\n`;
      }
      emailText += await getSessionTranscript(sessionId);
      await transporter.sendMail({
        from: `"Surprise Granite Bot" <${process.env.SMTP_USER}>`,
        to: process.env.CONTACT_EMAIL || process.env.SMTP_USER,
        subject: contact ? `Contact Form - ${contact.name}` : 'New Chatbot Session',
        text: emailText
      });
      return res.json({ message: "Your message has been sent! We will contact you soon.", sent: true });
    }

    res.json({
      message: aiResponse,
      images: files.map(f => f.path),
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
