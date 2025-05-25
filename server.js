import express from 'express';
import mongoose from 'mongoose';
import { join } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { parse } from 'csv-parse/sync';
import { OpenAI } from 'openai';
import { config } from 'dotenv';

config(); // Loads env variables from .env if running locally

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

const app = express();

app.use(express.static(join(__dirname, 'public')));
app.use(express.json());

// --- CSV Fetch Utility ---
async function fetchAndParseCsv(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch CSV');
  const text = await response.text();
  return parse(text, { columns: true });
}

// --- Chatbot API with Pricing Context ---
app.post('/api/chat', async (req, res) => {
  const userMsg = req.body.message;
  try {
    // Fetch CSVs from ENV URLs
    const [prices, labor] = await Promise.all([
      fetchAndParseCsv(process.env.PRICE_CSV_URL),
      fetchAndParseCsv(process.env.LABOR_CSV_URL)
    ]);

    // Optionally: Find relevant rows if possible (for big CSVs), else use a sample
    const csvContext = `
Granite Price List (sample):
${prices.slice(0, 6).map(row => JSON.stringify(row)).join('\n')}
Labor Price List (sample):
${labor.slice(0, 6).map(row => JSON.stringify(row)).join('\n')}
`;

    // Prompt for OpenAI with context
    const prompt = `
You are a countertop estimator assistant. Use the following price and labor lists to answer questions accurately and concisely. If the user asks for a price or labor rate, look it up in the data provided. Keep answers short and precise. If you can't find an exact answer, say "Sorry, I don't have that information."

${csvContext}

User: ${userMsg}
Assistant:
`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [{ role: 'system', content: prompt }]
    });

    const botReply = response.choices[0].message.content;
    res.json({ message: botReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process chat or price list." });
  }
});

// ...rest of your server.js code...
