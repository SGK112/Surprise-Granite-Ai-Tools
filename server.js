import express from 'express';
import axios from 'axios';
import cors from 'cors';
import nodemailer from 'nodemailer';
import multer from 'multer';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 10000;

// MongoDB Connection
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;
async function connectToMongoDB() {
    try {
        await client.connect();
        db = client.db('surprise_granite');
        console.log('Connected to MongoDB');
    } catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}
connectToMongoDB();

// Multer configuration for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.static(join(__dirname, 'public')));

// Nodemailer configuration
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// POST /api/v1/estimate - Generate estimate and optionally email it
app.post('/api/v1/estimate', upload.array('files', 10), async (req, res) => {
    const { customer_needs, email, action = 'generate' } = req.body;
    const files = req.files;

    if (!customer_needs) {
        return res.status(400).json({ error: 'customer_needs is required' });
    }

    if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
    }

    try {
        let responseData = { id: Date.now().toString() };

        // Generate recommendation using OpenAI
        if (action === 'generate' || action === 'both') {
            const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                model: 'gpt-3.5-turbo',
                messages: [{ role: 'user', content: customer_needs }],
                max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 500
            }, {
                headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
            });
            responseData.recommendation = response.data.choices[0].message.content;

            // Store estimate in MongoDB
            const estimate = {
                id: responseData.id,
                customer_needs,
                recommendation: responseData.recommendation,
                files: files.map(f => ({ filename: f.filename, originalname: f.originalname })),
                timestamp: new Date().toISOString()
            };
            await db.collection('estimates').insertOne(estimate);
        }

        // Send email with recommendation
        if ((action === 'email' || action === 'both') && email) {
            if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
                return res.status(500).json({ error: 'Email configuration missing' });
            }

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: process.env.EMAIL_SUBJECT || 'Your Surprise Granite Estimate',
                text: `${customer_needs}\n\nRecommendation:\n${responseData.recommendation || 'N/A'}`,
                attachments: files.map(file => ({
                    filename: file.originalname,
                    path: join(__dirname, 'uploads', file.filename)
                }))
            };
            await transporter.sendMail(mailOptions);
            responseData.emailStatus = 'Email sent successfully';
        }

        res.status(200).json(responseData);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: 'Failed to process request', details: error.response?.data || error.message });
    }
});

// GET /api/v1/estimates - Retrieve all stored estimates
app.get('/api/v1/estimates', async (req, res) => {
    try {
        const estimates = await db.collection('estimates').find().toArray();
        res.status(200).json(estimates);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve estimates', details: error.message });
    }
});

// GET /api/v1/estimate/:id - Retrieve a specific estimate by ID
app.get('/api/v1/estimate/:id', async (req, res) => {
    try {
        const estimate = await db.collection('estimates').findOne({ id: req.params.id });
        if (!estimate) {
            return res.status(404).json({ error: 'Estimate not found' });
        }
        res.status(200).json(estimate);
    } catch (error) {
        res.status(500).json({ error: 'Failed to retrieve estimate', details: error.message });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(port, () => console.log(`Server running on port ${port}`));
