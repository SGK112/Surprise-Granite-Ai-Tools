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
  console.log('Serving index.html for root route');
  res.sendFile(path.resolve('public', 'index.html'), (err) => {
    if (err) {
      console.error('Error serving index.html:', err);
      res.status(500).send('Error serving the application');
    }
  });
});

// Serve sw.js with the correct Content-Type
app.get('/sw.js', (req, res) => {
  console.log('Serving sw.js');
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
  console.log('Health check endpoint called');
  res.status(200).json({ status: 'OK' });
});

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
}).on('error', (err) => {
  console.error('Server startup error:', err);
  process.exit(1);
});
