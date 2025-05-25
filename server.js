require('dotenv').config();
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/surprisegranite', { useNewUrlParser: true, useUnifiedTopology: true });

// Mongoose schema
const ChatMessageSchema = new mongoose.Schema({
  sessionId: String, // to group messages by session/user
  from: String,      // 'user' or 'ai' or 'system'
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

// Multer storage on disk
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, ''))
});
const upload = multer({ storage });

// Serve uploads
app.use('/uploads', express.static(uploadDir));

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Nodemailer setup
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

// Utility: get all messages for a session
async function getSessionTranscript(sessionId) {
  const messages = await ChatMessage.find({ sessionId }).sort({ createdAt: 1 });
  let transcript = '';
  messages.forEach(msg => {
    transcript += `[${msg.from}] ${msg.message || ''}\n`;
    if (msg.files && msg.files.length) {
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

    // AI response (simple, can expand to use OpenAI with files)
    let aiResponse = '';
    if (message && (!action || action === 'chat')) {
      // Call OpenAI for response if enabled
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
        aiResponse = "AI is not connected. Please contact us for more info.";
      }

      // Save AI message
      await new ChatMessage({
        sessionId,
        from: 'ai',
        message: aiResponse
      }).save();
    }

    // Handle sending chat/contact via email (action: "sendEmail")
    if (action === 'sendEmail' || action === 'contactForm') {
      // Compose transcript or contact form
      let emailText = '';
      if (contact) {
        emailText = `Contact Request:\nFrom: ${contact.name}\nEmail: ${contact.email}\nMessage: ${contact.message}\n\n`;
      }
      emailText += await getSessionTranscript(sessionId);
      await transporter.sendMail({
        from: `"Surprise Granite Bot" <${process.env.SMTP_USER}>`,
        to: process.env.CONTACT_EMAIL || process.env.SMTP_USER,
        subject: contact ? `Contact Form Submission - ${contact.name}` : 'New Chatbot Session',
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

// (Optional) Endpoint to fetch previous chats by sessionId (for admin/future use)
app.get('/api/chats/:sessionId', async (req, res) => {
  const messages = await ChatMessage.find({ sessionId: req.params.sessionId }).sort({ createdAt: 1 });
  res.json(messages);
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
