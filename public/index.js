const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const app = express();

// Enable CORS for Webflow
app.use(cors({
  origin: 'https://surprisegranite.webflow.io',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Accept']
}));

// MongoDB connection
const uri = process.env.MONGODB_URI || 'mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority';
const client = new MongoClient(uri);

// Serve static files (e.g., app.js)
app.use(express.static('public'));

// API route for materials
app.get('/api/materials', async (req, res) => {
  try {
    await client.connect();
    const db = client.db('countertops');
    const collection = db.collection('countertop_images');
    const materials = await collection.find({}).toArray();
    if (!materials.length) {
      return res.status(404).json({ error: 'No materials found' });
    }
    res.json(materials);
  } catch (error) {
    console.error('Error fetching materials:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    await client.close();
  }
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
