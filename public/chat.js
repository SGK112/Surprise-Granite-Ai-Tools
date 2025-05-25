import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { parse } from 'csv-parse/sync';

config();
const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(cors());
app.use(express.json());

function loadCsvFromEnv(envKey) {
  const csvData = process.env[envKey] || '';
  if (!csvData.trim()) return [];
  return parse(csvData, { columns: true });
}

// Give the AI a concise but complete sample of the CSVs
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
You have access to the company's current materials and labor price lists below. Use these to answer pricing questions as specifically as possible.
If a user attaches a photo, acknowledge receipt but do not attempt to analyze it. You are not able to process images, but can notify staff that a photo was received.
If a user asks about company information, answer using your stored knowledge.
Never provide medical, legal, or financial advice outside of Surprise Granite's services.
`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USERNAME,
    pass: process.env.EMAIL_PASSWORD
  }
});

let chatHistory = [];

app.post('/api/chat', upload.single('image'), async (req, res) => {
  const userMsg = req.body.message || '';
  chatHistory.push({ role: "user", content: userMsg });

  // Load and summarize CSVs
  let materialsRecords = loadCsvFromEnv('PUBLISHED_CSV_MATERIALS_');
  let laborRecords = loadCsvFromEnv('PUBLISHED_CSV_LABOR');
  let materialsSummary = getCsvSummary(materialsRecords);
  let laborSummary = getCsvSummary(laborRecords);

  // If there's an image attached, let the AI know
  let fileNotice = '';
  if (req.file) {
    fileNotice = "The user has attached a photo for this conversation. Please let them know it will be reviewed by a team member, but you cannot analyze images directly.";
  }

  try {
    const messages = [
      { role: "system", content:
        SYSTEM_PROMPT +
        "\n\nMATERIALS PRICE LIST SAMPLE:\n" +
        materialsSummary +
        "\n\nLABOR PRICE LIST SAMPLE:\n" +
        laborSummary +
        (fileNotice ? "\n\n" + fileNotice : "")
      },
      ...chatHistory
    ];
    if (req.file) {
      messages.push({ role: "user", content: "I have attached a photo for reference." });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages
    });

    const botReply = response.choices[0].message.content;
    chatHistory.push({ role: "assistant", content: botReply });

    // Email transcript so far
    const mailOptions = {
      from: process.env.EMAIL_USERNAME,
      to: "info@surprisegranite.com",
      subject: "New Chatbot Message from Website",
      html: `
        <h3>Surprise Granite Chatbot Transcript</h3>
        ${chatHistory.map(m =>
          `<b>${m.role === "user" ? "Visitor" : "AI"}:</b> ${m.content}<br><br>`
        ).join('')}
      `
    };
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) console.error(error);
    });

    res.json({ message: botReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process chat or get AI response." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Surprise Granite AI server running on port ${PORT}`);
});
