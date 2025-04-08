// server.js
const express = require('express');
const axios = require('axios'); // For OpenAI API calls
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mock database (replace with actual database like MongoDB)
let stoneProducts = [
    { material: 'Granite', colorName: 'Frost-N', thickness: '3cm', vendorName: 'Arizona Tile', size: '126 x 63', costPerSqFt: 50, imageBase64: '' },
    { material: 'Quartz', colorName: 'Calacatta', thickness: '2cm', vendorName: 'Caesarstone', size: '130 x 65', costPerSqFt: 60, imageBase64: '' }
];
let projects = [];

// API to get stone products
app.get('/api/stone-products', (req, res) => {
    res.json(stoneProducts);
});

// API to save and retrieve projects
app.post('/api/project', (req, res) => {
    projects = req.body.project || [];
    res.status(201).json({ message: 'Project saved', projects });
});

app.get('/api/project', (req, res) => {
    res.json({ project: projects });
});

app.delete('/api/project', (req, res) => {
    projects = [];
    res.status(204).send();
});

// OpenAI-powered estimate writer
app.post('/api/estimate', async (req, res) => {
    const { customer_needs } = req.body;
    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: `Generate an estimate based on: ${customer_needs}` }],
            max_tokens: 500
        }, {
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
        });

        const aiEstimate = {
            materialType: 'Granite', // Parse from response or customer_needs
            color: 'Frost-N',
            dimensions: '120 sq ft', // Example, parse from customer_needs
            costEstimate: { low: 2000, mid: 2500, high: 3000 },
            condition: { damage_type: 'None', severity: 'N/A' },
            edgeProfile: 'Standard',
            additionalFeatures: [],
            recommendation: response.data.choices[0].message.content,
            solutions: 'Contact us for installation details.',
            consultationPrompt: 'Call (602) 833-3189'
        };
        res.json(aiEstimate);
    } catch (error) {
        console.error('OpenAI Error:', error);
        res.status(500).json({ error: 'Failed to generate estimate' });
    }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
