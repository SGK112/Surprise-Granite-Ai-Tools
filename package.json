import express from 'express';
import { promises as fs } from 'fs';
import axios from 'axios';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // Enable CORS for frontend requests

let stoneProducts = [];
let projects = [];

async function loadStoneProducts() {
    try {
        const data = await fs.readFile('./materials.json', 'utf8');
        stoneProducts = JSON.parse(data);
        console.log('Stone products loaded successfully');
    } catch (error) {
        console.error('Failed to load materials.json:', error);
        stoneProducts = [
            { "Color Name": "Frost-N", "Vendor Name": "Arizona Tile", "Thickness": "3cm", "Material": "Quartz", "size": "126 x 63", "Total/SqFt": 55.13, "Cost/SqFt": 10.24 },
            { "Color Name": "Gemstone Beige-N", "Vendor Name": "Arizona Tile", "Thickness": "2cm", "Material": "Quartz", "size": "126 x 63", "Total/SqFt": 55.13, "Cost/SqFt": 7.9 }
        ];
    }
}

app.get('/api/stone-products', (req, res) => {
    res.json(stoneProducts.map(product => ({
        material: product.Material,
        colorName: product["Color Name"],
        thickness: product.Thickness,
        vendorName: product["Vendor Name"],
        size: product.size,
        costPerSqFt: product["Cost/SqFt"],
        totalSqFt: product["Total/SqFt"]
    })));
});

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
            costEstimate: { low: 2000, mid: 2500, high: 3000 },
            recommendation: response.data.choices[0].message.content
        };
        res.json(aiEstimate);
    } catch (error) {
        console.error('OpenAI Error:', error);
        res.status(500).json({ error: 'Failed to generate estimate' });
    }
});

// Start server
(async () => {
    await loadStoneProducts();
    app.listen(port, () => console.log(`Server running on port ${port}`));
})();
