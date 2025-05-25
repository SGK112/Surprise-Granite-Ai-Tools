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

// Helper functions to parse published_csv_materials_ and published_csv_labor from env
function loadCsvFromEnv(envKey) {
  const csvData = process.env[envKey] || '';
  if (!csvData.trim()) return [];
  return parse(csvData, { columns: true });
}

function formatPriceList(records) {
  return records.map(item =>
    `${item.Material || item.Task} (${item.Type || item.Category || ''}): $${item.PricePerSqFt || item.Rate || item.Cost}/sq ft${item.Notes ? " – " + item.Notes : ""}`
  ).join('\n');
}

// ONLY provide company info if user asks -- not in every prompt.
const SYSTEM_PROMPT = `
You are a friendly, dynamic virtual assistant for Surprise Granite.
You have access to up-to-date material and labor price lists and can answer specific questions about products, services, and pricing.
Only provide company contact or location info if the user asks for it.
If a user asks for a price, use the material and labor price lists below.
If a specific material or service is not found, say so and offer to help further.
Never provide medical, legal, financial, or personal advice.
Politely decline requests outside the scope of Surprise Granite's construction, remodeling, and design services.
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

  let materialsRecords, laborRecords, materialsText, laborText;
  try {
    materialsRecords = loadCsvFromEnv('PUBLISHED_CSV_MATERIALS_');
    laborRecords = loadCsvFromEnv('PUBLISHED_CSV_LABOR');
    materialsText = formatPriceList(materialsRecords) || "No materials pricing available.";
    laborText = formatPriceList(laborRecords) || "No labor pricing available.";
  } catch (e) {
    materialsText = "Price list unavailable.";
    laborText = "Labor list unavailable.";
  }

  try {
    const messages = [
      { role: "system", content:
        SYSTEM_PROMPT +
        "\n\nHere is the current materials price list:\n" +
        materialsText +
        "\n\nHere is the current labor price list:\n" +
        laborText
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
