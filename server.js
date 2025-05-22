import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();

// Enforce HTTPS in production
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

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

// Serve sw.js with the correct Content-Type
app.get('/sw.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.sendFile(path.resolve('public', 'sw.js'), (err) => {
    if (err) {
      console.error('Error serving sw.js:', err);
      res.status(500).send('Error serving service worker');
    }
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));
