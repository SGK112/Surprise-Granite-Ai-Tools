import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import authRoutes from './routes/auth.js';
import estimateRoutes from './routes/estimates.js';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';

dotenv.config();

// Initialize Firebase Admin SDK
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON)),
  });
  console.log('Firebase Admin initialized with JSON');
} else {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
  console.log('Firebase Admin initialized with default credentials');
}

const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));

// Configure Multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Cloudinary upload endpoint
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    const result = await cloudinary.uploader.upload_stream({
      public_id: `slabs/${Date.now()}_${req.file.originalname}`,
      folder: 'surprise_granite'
    }, (error, result) => {
      if (error) throw error;
      res.json({ url: result.secure_url, public_id: result.public_id });
    }).end(req.file.buffer);
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Cloudinary optimize endpoint
app.get('/api/optimize-image/:publicId', (req, res) => {
  try {
    const optimizedUrl = cloudinary.url(req.params.publicId, {
      fetch_format: 'auto',
      quality: 'auto'
    });
    res.json({ url: optimizedUrl });
  } catch (error) {
    console.error('Error optimizing image:', error);
    res.status(500).json({ error: 'Failed to optimize image' });
  }
});

// MongoDB Connection
mongoose
  .connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch((error) => {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  });

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/estimates', estimateRoutes);

// Health check for Render
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Handle 404 errors
app.use((req, res) => {
  console.log(`404: Route not found - ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(port, () => console.log(`Server running on port ${port}`));

// Handle process termination
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  mongoose.connection.close(() => {
    console.log('MongoDB connection closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
