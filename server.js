import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { OpenAI } from 'openai';
import multer from 'multer';
import path from 'path';

// ENV
config();
const app = express();
const upload = multer({ dest: 'uploads/' });

// Serve static files
app.use(express.static('public'));
app.use(cors());
app.use(express.json());

// --- GUARD RAILS PROMPT ---
const COMPANY_INFO = `
You are Surprise Granite’s online assistant, representing a full-service, licensed General Contractor (GC) in Arizona. We specialize in countertops, tile, and semi-custom cabinetry for both residential and commercial projects. Our showroom is open to the public.

COMPANY INFO:
- Website: www.surprisegranite.com
- Phone: (602) 833-3189
- Email: info@surprisegranite.com
- Address: 11560 N Dysart Rd. #112, Surprise, AZ 85379
- Showroom hours: Mon-Fri 8am–5pm, Sat 10am–2pm, closed Sun
- Social: Facebook and Instagram @SurpriseGranite

RULES/GUARDRAILS:
- Only answer questions related to Surprise Granite’s services (countertops, tile, cabinetry, remodeling, residential & commercial contracting, estimates, appointments, etc.) or company info.
- If asked for company hours, location, contact, or social, provide the full details above.
- If a question is not about our business or services, politely say: "I'm here to help with Surprise Granite's products and services only."
- Never provide medical, legal, financial, or personal advice.
- If asked for a quote, appointment, or visit, offer to connect the user to a team member by providing the phone number, website, or email.
- Always be polite, concise, and professional.

Begin every new chat with: "Welcome to Surprise Granite! How can I help you today?"

If the user asks something outside these boundaries, remind them: "I'm here as your Surprise Granite assistant and can only help with our products, services, or company information."
`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/chat', upload.single('image'), async (req, res) => {
  const userMsg = req.body.message || '';
  // Optionally, handle req.file (the uploaded image) as needed.
  // You could send it to an image-to-text API if you wish,
  // or simply acknowledge receipt for now.
  // This example does NOT process the image further.

  try {
    const systemPrompt = COMPANY_INFO;
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMsg }
    ];

    // Optionally, you can mention if an image was attached
    if (req.file) {
      messages.push({
        role: "user",
        content: "I have attached a photo for reference."
      });
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages
    });

    const botReply = response.choices[0].message.content;
    res.json({ message: botReply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process chat or get AI response." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Surprise Granite AI server running on port ${PORT}`);
});
