import express from 'express';
import axios from 'axios';
import cors from 'cors';
import nodemailer from 'nodemailer';
import multer from 'multer';
import { join } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const app = express();
const port = process.env.PORT || 10000;

const upload = multer({ dest: 'uploads/' });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.static(join(__dirname, 'public')));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.post('/api/v1/estimate', upload.array('files'), async (req, res) => {
    const { customer_needs, email, action = 'generate' } = req.body;
    const files = req.files;

    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    try {
        let responseData = {};

        if (action === 'generate' || action === 'both') {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: customer_needs }],
                max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 500
            }, {
                headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
            });
            responseData.recommendation = response.data.choices[0].message.content;
        }

        if ((action === 'email' || action === 'both') && email) {
            if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
                return res.status(500).json({ error: 'Email configuration missing' });
            }

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: process.env.EMAIL_SUBJECT || 'Your Surprise Granite Estimate',
                text: `${customer_needs}\n\nRecommendation:\n${responseData.recommendation || 'N/A'}`,
                attachments: files ? files.map(file => ({
                    filename: file.originalname,
                    path: file.path
                })) : []
            };
            await transporter.sendMail(mailOptions);
            responseData.emailStatus = 'Email sent successfully';
        }

        res.json(responseData);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Failed to process request', details: error.message });
    }
});

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => console.log(`Server running on port ${port}`));
