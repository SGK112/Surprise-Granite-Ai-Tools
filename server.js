import express from 'express';
import { promises as fs } from 'fs';
import axios from 'axios';
import cors from 'cors';
import nodemailer from 'nodemailer';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static(join(__dirname, 'public')));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.get('/api/stone-products', (req, res) => {
    res.status(200).json([]); // No longer used
});

app.post('/api/estimate', async (req, res) => {
    const { customer_needs, email } = req.body;
    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: customer_needs }],
            max_tokens: 500
        }, {
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
        });

        const aiEstimate = {
            recommendation: response.data.choices[0].message.content
        };

        // Send email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Your Surprise Granite Estimate',
            text: `${customer_needs}\n\nRecommendation:\n${aiEstimate.recommendation}`
        };
        await transporter.sendMail(mailOptions);

        res.json(aiEstimate);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Failed to generate estimate or send email' });
    }
});

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => console.log(`Server running on port ${port}`));
