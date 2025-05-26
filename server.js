const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Configuration, OpenAIApi } = require('openai');
const nodemailer = require('nodemailer');
const { parse } = require('csv-parse/sync');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, unique);
  }
});
const upload = multer({ storage });

function loadCsvFromEnv(envKey) {
  const csvData = process.env[envKey] || '';
  if (!csvData.trim()) return [];
  return parse(csvData, { columns: true });
}

function getCsvSummary(records, n = 5) {
  if (!records || records.length === 0) return 'No data available.';
  const headers = Object.keys(records[0]);
  const rows = records.slice(0, n)
    .map(row => headers.map(h => row[h]).join(' | '))
    .join('\n');
  return `${headers.join(' | ')}\n${rows}${records.length > n ? '\n...' : ''}`;
}

const SYSTEM_PROMPT = `
You are a helpful virtual assistant for Surprise Granite. You can answer questions about products, services, pricing, and company information.
You have access to the company's current materials and labor price lists below—use these to answer pricing questions as specifically as possible.
If a user attaches a photo, acknowledge receipt but do not attempt to analyze it. You are not able to process images, but can notify staff that a photo was received.
If a user asks about company information, answer using your stored knowledge.
Never provide medical, legal, or financial advice outside of Surprise Granite's services.
`;

const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const response = await openai.chat.completions.create({
  model: "gpt-3.5-turbo",
  messages: [{ role: "user", content: "Hello!" }]
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sessions = {};

function getContext(sessionId, limit = 10) {
  if (!sessionId) return [];
  const history = sessions[sessionId] || [];
  return history.slice(-limit);
}

// Chat endpoint (AI, price list context, and optional image handling)
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId || req.headers['x-session-id'];
    const userMsg = req.body.message || '';
    let imageUrl = null;
    if (req.file) imageUrl = `/uploads/${req.file.filename}`;

    // Track session chat history
    if (sessionId) {
      if (!sessions[sessionId]) sessions[sessionId] = [];
      sessions[sessionId].push({ role: "user", content: userMsg, imageUrl });
      sessions[sessionId] = sessions[sessionId].slice(-20);
    }

    // Load and summarize CSVs
    const materialsRecords = loadCsvFromEnv('PUBLISHED_CSV_MATERIALS');
    const laborRecords = loadCsvFromEnv('PUBLISHED_CSV_LABOR');
    const materialsSummary = getCsvSummary(materialsRecords);
    const laborSummary = getCsvSummary(laborRecords);

    let fileNotice = '';
    if (imageUrl) {
      fileNotice = "The user has attached a photo for this conversation. Please let them know it will be reviewed by a team member, but you cannot analyze images directly.";
    }

    const messages = [
      { role: "system", content:
        SYSTEM_PROMPT +
        "\n\nMATERIALS PRICE LIST SAMPLE:\n" +
        materialsSummary +
        "\n\nLABOR PRICE LIST SAMPLE:\n" +
        laborSummary +
        (fileNotice ? "\n\n" + fileNotice : "")
      },
      ...(getContext(sessionId) ?? []).map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      })),
      { role: "user", content: userMsg }
    ];

    const completion = await openai.createChatCompletion({
      model: "gpt-3.5-turbo",
      messages,
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 200,
      temperature: 0.7
    });
    const aiReply = completion.data.choices[0].message.content.trim();

    if (sessionId) {
      sessions[sessionId].push({ role: "ai", content: aiReply });
      sessions[sessionId] = sessions[sessionId].slice(-20);
    }

    res.json({ message: aiReply, imageUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI backend error or file upload failed." });
  }
});

// Email estimate endpoint (send an estimate email)
app.post('/api/send-estimate', async (req, res) => {
  try {
    const { email, estimate } = req.body;
    if (!email || !estimate?.text) {
      return res.status(400).json({ error: 'Email and estimate text are required' });
    }
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Your Surprise Granite Countertop Estimate',
      text: estimate.text,
    };
    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: 'Estimate sent successfully' });
  } catch (err) {
    console.error('Send estimate error:', err);
    res.status(500).json({ error: 'Failed to send estimate', details: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Surprise Granite AI Chatbot backend running at http://localhost:${PORT}`);
});
