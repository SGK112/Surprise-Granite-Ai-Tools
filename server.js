// server.js
const express = require('express');
const fs = require('fs').promises; // For reading JSON file
const axios = require('axios'); // For OpenAI API calls
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Load stone products from materials.json
let stoneProducts = [];
let projects = [];

async function loadStoneProducts() {
    try {
        const data = await fs.readFile('./materials.json', 'utf8');
        stoneProducts = JSON.parse(data);
        console.log('Stone products loaded successfully');
    } catch (error) {
        console.error('Failed to load materials.json:', error);
        stoneProducts = []; // Fallback to empty array
    }
}

// API to get stone products
app.get('/api/stone-products', (req, res) => {
    res.json(stoneProducts.map(product => ({
        material: product.Material,
        colorName: product["Color Name"],
        thickness: product.Thickness,
        vendorName: product["Vendor Name"],
        size: product.size,
        costPerSqFt: product["Cost/SqFt"],
        totalSqFt: product["Total/SqFt"],
        priceGroup: product["Price Group"],
        tier: product.Tier,
        imageBase64: '' // Add if you have images
    })));
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
            materialType: 'Quartz', // Parse from customer_needs if dynamic
            color: 'Frost-N',
            dimensions: '55.13 sq ft', // Example, parse from customer_needs
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

// Start server and load data
app.listen(port, async () => {
    await loadStoneProducts();
    console.log(`Server running on port ${port}`);
});
