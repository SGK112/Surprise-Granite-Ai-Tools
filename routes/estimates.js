import { Router } from 'express';
import OpenAI from 'openai';
import nodemailer from 'nodemailer';
import winston from 'winston';

const router = Router();

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Nodemailer transport
const transport = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Generate estimate with OpenAI
router.post('/generate-estimate', async (req, res) => {
  try {
    const { name, email, length, width, materialCost, materialName, jobType, additionalServices, totalCost } = req.body;
    if (!name || !email || !length || !width || !materialCost || !materialName || !totalCost) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const sqft = (length * width) / 144;
    const prompt = `
      You are a professional estimator for Surprise Granite, a countertop installation company. Generate a formal estimate letter for a customer named ${name} with email ${email}. The estimate should include:
      - A polite greeting and introduction.
      - Details of the countertop configuration: ${length}" x ${width}" (${sqft.toFixed(2)} sq ft), material ${materialName} at $${materialCost.toFixed(2)}/sq ft.
      - Job type: ${jobType === 'standard' ? 'Standard Installation' : 'Pro Setup ($250)'}.
      - Additional services: ${additionalServices ? 'Yes ($' + Math.max(sqft * materialCost * 1.65, 250).toFixed(2) + ')' : 'No'}.
      - Total cost: $${totalCost.toFixed(2)}.
      - A professional closing with contact info (Surprise Granite, info@surprisegranite.com, 555-123-4567).
      Use a formal, friendly tone and format the letter as plain text.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    });

    const estimateText = response.choices[0].message.content.trim();
    winston.info('Estimate generated for ' + email);
    res.status(200).json({ text: estimateText });
  } catch (err) {
    winston.error('Generate estimate error:', err);
    res.status(500).json({ error: 'Failed to generate estimate', details: err.message });
  }
});

// Send estimate
router.post('/send-estimate', async (req, res) => {
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
    await transport.sendMail(mailOptions);
    winston.info(`Estimate sent to ${email}`);
    res.status(200).json({ message: 'Estimate sent successfully' });
  } catch (err) {
    winston.error('Send estimate error:', err);
    res.status(500).json({ error: 'Failed to send estimate', details: err.message });
  }
});

// Change named export to default export
export default router;
