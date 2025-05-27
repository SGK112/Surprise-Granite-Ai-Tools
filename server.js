// Surprise Granite AI Estimator Backend
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const { parse } = require('csv-parse/sync');
const OpenAI = require('openai');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('MongoDB connected!');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// --- MongoDB Schemas ---
const Chat = mongoose.model('Chat', new mongoose.Schema({
  sessionId: String,
  messages: [{ role: String, content: String, imageUrl: String, createdAt: { type: Date, default: Date.now } }]
}, { timestamps: true }));

const Image = mongoose.model('Image', new mongoose.Schema({
  filename: String,
  url: String,
  uploadedAt: { type: Date, default: Date.now },
  sessionId: String
}));

// --- Express Middleware ---
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// --- Constants ---
const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRWyYuTQxC8_fKNBg9_aJiB7NMFztw6mgdhN35lo8sRL45MvncRg4d217lopZxuw39j5aJTN6TP4Elh/pub?output=csv';

// --- Simple FAQ to Save OpenAI Calls ---
const faqs = [
  { q: /hours|open|close/i, a: "We're open Monday to Friday, 8am–5pm. (Just enough time to beat the Arizona heat!)" },
  { q: /phone|contact/i, a: "Our phone number is (602) 833-3189. Give us a ring—don't worry, we won't answer with a cactus joke. Probably." },
  { q: /address|location/i, a: "11560 N Dysart Rd. #112, Surprise, AZ 85379. Right here in the beautiful Valley of the Sun!" },
  { q: /website/i, a: "Visit us at https://www.surprisegranite.com and see some slabs worth drooling over." }
];
function checkFAQ(userMsg) {
  for (const faq of faqs) {
    if (faq.q.test(userMsg)) return faq.a;
  }
  return null;
}

// --- Fetch and Parse Google Sheet CSV ---
async function fetchPriceSheet() {
  const response = await fetch(GOOGLE_SHEET_CSV_URL);
  if (!response.ok) throw new Error('Failed to fetch Google Sheet');
  const csv = await response.text();
  return parse(csv, { columns: true });
}

// --- Nodemailer Email Setup for Lead Capture ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
});

// --- Lead Notification ---
async function sendLeadNotification(lead) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.LEADS_RECEIVER || process.env.EMAIL_USER,
    subject: 'New Countertop Lead',
    text: `Lead:\nName: ${lead.name}\nEmail: ${lead.email}\nPhone: ${lead.phone || 'N/A'}\nMessage: ${lead.message || 'N/A'}`
  };
  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (err) {
    console.error('Nodemailer lead error:', err);
    return false;
  }
}

// --- OpenAI Setup ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- Helper for state facts (add more states as desired) ---
const stateFacts = {
  arizona: "Arizona: Home of the Grand Canyon, the saguaro cactus, and summers so hot even the granite sweats.",
  california: "California: Where countertops and movie stars both shine—just don't try to surf on your new island!",
  texas: "Texas: Everything's bigger in Texas... including our slabs (figuratively speaking).",
  florida: "Florida: The only place where your countertop might see more sun than your backyard.",
  newyork: "New York: The Empire State knows good design. And pizza. But please don't cut pizza directly on the granite!"
};
function getStateFact(state) {
  if (!state) return "";
  state = state.toLowerCase();
  if (stateFacts[state]) return stateFacts[state];
  return "";
}

// --- Main Chat Endpoint ---
app.post('/api/chat', async (req, res) => {
  try {
    const userMsg = req.body.message || '';
    const sessionId = req.body.sessionId || (Date.now() + '-' + Math.random().toString(36).substr(2, 9));

    // 1. FAQ shortcut
    const faqAnswer = checkFAQ(userMsg);
    if (faqAnswer) return res.json({ message: faqAnswer });

    // 2. Fetch live pricing
    const materials = await fetchPriceSheet();

    // 3. Search for state in the user message
    let userState = null;
    const stateMatch = userMsg.match(/\b(arizona|california|texas|florida|new york|ny|az|ca|tx|fl)\b/i);
    if (stateMatch) {
      const stateMap = { az: 'arizona', ca: 'california', tx: 'texas', fl: 'florida', ny: 'newyork', 'new york': 'newyork' };
      userState = stateMap[stateMatch[0].toLowerCase()] || stateMatch[0].toLowerCase();
    }

    // 4. System Prompt (funny, AZ-aware, concise, estimator, lead gen)
    const SYSTEM_PROMPT =
`You are Surprise Granite's estimator, design assistant, and local comedian.

Your goals:
- Be brief, friendly, and inject a dash of Arizona-flavored humor when you can (but don't get in the way of business!).
- Use the live price list provided below for all estimates.
- To estimate, multiply the base cost by 3.25 and add: 26 for quartz, 35 for granite, 45 for quartzite, or 55 for dekton.
- Slab size is 120x60 inches (50 sq ft usable per slab). Calculate the number of slabs needed (area / 50, round up).
- If the user is in Arizona, show some local pride, reference the weather (hot!), or drop a friendly AZ joke. 
- If the user is in another state, acknowledge their location and, if you know a fun fact about their state, share it with a smile.
- For any estimate, show a clear line-item breakdown and total cost.
- If the user hasn't provided their location, ask for it; note that pricing may vary by region (and that Arizona's prices are as sizzling as our summers).
- If you don't have the user's name/email/phone, politely (and humorously) ask for them to send a formal estimate.
- Never answer routine business questions—those are handled automatically.
- Thank the customer and invite further questions. If they ask for a joke, you deliver a clean, countertop-related zinger!
- Keep answers short, unless the customer specifically asks for more detail.
${userState ? '\nFun Fact: ' + getStateFact(userState) : ''}
Price List Sample (first 10 rows):\n` +
      materials.slice(0, 10).map(row => Object.values(row).join(' | ')).join('\n');

    // 5. Retrieve or create Chat session in MongoDB
    let chat = await Chat.findOne({ sessionId });
    if (!chat) chat = await Chat.create({ sessionId, messages: [] });

    // 6. Save user message
    chat.messages.push({ role: "user", content: userMsg });
    chat.messages = chat.messages.slice(-20); // keep chat history manageable
    await chat.save();

    // 7. Prepare OpenAI messages
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...chat.messages.map(msg => ({
        role: msg.role === 'ai' ? 'assistant' : 'user',
        content: msg.content
      })),
      { role: "user", content: userMsg }
    ];

    // 8. Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4", // or "gpt-3.5-turbo" for lower cost
      messages,
      max_tokens: 400,
      temperature: 0.6
    });
    const aiReply = completion.choices[0].message.content.trim();

    // 9. Save AI response
    chat.messages.push({ role: "ai", content: aiReply });
    chat.messages = chat.messages.slice(-20);
    await chat.save();

    // 10. Lead detection (improve as needed)
    const leadMatch = userMsg.match(/name\s*[:\-]\s*(.*)\n.*email\s*[:\-]\s*(.*)\n?.*phone\s*[:\-]?\s*(.*)?/i);
    if (leadMatch) {
      const lead = {
        name: leadMatch[1] || "",
        email: leadMatch[2] || "",
        phone: leadMatch[3] || "",
        message: userMsg
      };
      await sendLeadNotification(lead);
    }

    res.json({ message: aiReply });

  } catch (err) {
    console.error('Chat endpoint error:', err.message);
    res.status(500).json({ error: "AI backend error.", details: err.message });
  }
});

// --- Health Check ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- (Optional) Serve Images if you use image upload ---
// app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

app.listen(PORT, () => {
  console.log(`Surprise Granite AI Estimator running at http://localhost:${PORT}`);
});
