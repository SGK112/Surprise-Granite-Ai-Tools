import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();

// Enable CORS for Webflow
app.use(cors({
  origin: 'https://surprisegranite.webflow.io',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Accept']
}));

// Serve static files from the public directory
app.use(express.static('public'));

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.resolve('public', 'index.html'));
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Register service worker
app.get('/sw.js', (req, res) => {
  res.sendFile(path.resolve('public', 'sw.js'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
