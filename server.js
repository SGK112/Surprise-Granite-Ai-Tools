import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import winston from 'winston';
import { fileURLToPath } from 'url';
import path from 'path';
import { v2 as cloudinary } from 'cloudinary';
import multer from 'multer';
import nodemailer from 'nodemailer';

// Set Mongoose strictQuery option
mongoose.set('strictQuery', true);

// Load environment variables
dotenv.config();

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Validate required environment variables
const requiredEnv = ['MONGODB_URI', 'EMAIL_USER', 'EMAIL_PASS'];
const optionalEnv = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'CORS_ORIGIN', 'BASE_URL', 'EMAIL_SUBJECT'];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: process.env.CORS_ORIGIN || 'https://surprisegranite.webflow.io' }));
app.use(express.static(path.join(__dirname, 'client', 'dist'))); // Serve React build

// Configure Multer for image uploads (optional)
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only images are allowed'));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

// Configure Cloudinary (optional)
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
}

// Configure Nodemailer for email notifications
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// MongoDB Schema for Materials
const materialSchema = new mongoose.Schema({
  colorName: { type: String, required: true },
  vendorName: { type: String, required: true },
  thickness: { type: String, required: true },
  material: { type: String, required: true },
  costSqFt: { type: Number, required: true },
  availableSqFt: { type: Number, default: 0 },
  imageUrl: { type: String, default: 'https://via.placeholder.com/50' },
  createdAt: { type: Date, default: Date.now }
});

const Material = mongoose.model('Material', materialSchema);

// MongoDB Schema for Estimates
const estimateSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
  material: { type: String, required: true },
  slabName: { type: String },
  slabSize: { type: String, required: true },
  slabCostSqft: { type: Number, required: true },
  clientSqft: { type: Number, required: true },
  wasteFactor: { type: Number, required: true },
  totalSlabs: { type: Number, required: true },
  stoneCost: { type: Number, required: true },
  laborCost: { type: Number, required: true },
  totalPrice: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Estimate = mongoose.model('Estimate', estimateSchema);

// Image Upload Endpoint (optional)
app.post('/api/upload-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }
    if (!cloudinary.config().cloud_name) {
      return res.status(500).json({ error: 'Cloudinary not configured' });
    }
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader
        .upload_stream(
          {
            public_id: `slabs/${Date.now()}_${req.file.originalname}`,
            folder: 'surprise_granite'
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        )
        .end(req.file.buffer);
    });
    res.json({ url: result.secure_url, public_id: result.public_id });
  } catch (error) {
    logger.error(`Upload error: ${error.message}`);
    res.status(500).json({ error: 'Failed to upload image', details: error.message });
  }
});

// Optimize Image Endpoint (optional)
app.get('/api/optimize-image/:publicId', (req, res) => {
  try {
    if (!cloudinary.config().cloud_name) {
      return res.status(500).json({ error: 'Cloudinary not configured' });
    }
    const optimizedUrl = cloudinary.url(req.params.publicId, {
      fetch_format: 'auto',
      quality: 'auto'
    });
    res.json({ url: optimizedUrl });
  } catch (error) {
    logger.error(`Optimize error: ${error.message}`);
    res.status(500).json({ error: 'Failed to optimize image', details: error.message });
  }
});

// Fetch Materials from MongoDB
app.get('/api/materials', async (req, res) => {
  try {
    logger.info('Fetching materials from MongoDB');
    const materials = await Material.find().lean();
    if (!materials || materials.length === 0) {
      throw new Error('No materials found in database');
    }
    const normalizedData = materials.map((item) => ({
      colorName: item.colorName,
      vendorName: item.vendorName,
      thickness: item.thickness,
      material: item.material,
      costSqFt: item.costSqFt,
      availableSqFt: item.availableSqFt,
      imageUrl: item.imageUrl
    }));
    logger.info(`Materials fetched successfully: ${normalizedData.length} items`);
    res.json(normalizedData);
  } catch (error) {
    logger.error(`Materials fetch error: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch materials data', details: error.message });
  }
});

// Save Estimate Endpoint with Email Notification
app.post('/api/estimates', async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      material,
      slabName,
      slabSize,
      slabCostSqft,
      clientSqft,
      wasteFactor,
      totalSlabs,
      stoneCost,
      laborCost,
      totalPrice
    } = req.body;

    if (!name || !email || !material || !slabSize || !slabCostSqft || !clientSqft || !wasteFactor || !totalSlabs || !stoneCost || !laborCost || !totalPrice) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Save estimate to MongoDB
    const estimate = new Estimate({
      name,
      email,
      phone,
      material,
      slabName,
      slabSize,
      slabCostSqft,
      clientSqft,
      wasteFactor,
      totalSlabs,
      stoneCost,
      laborCost,
      totalPrice
    });

    await estimate.save();
    logger.info(`Estimate saved: ${name}, ${email}, $${totalPrice}`);

    // Send email notification
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      cc: process.env.EMAIL_USER,
      subject: process.env.EMAIL_SUBJECT || 'Your Countertop Estimate from Surprise Granite',
      text: `
        Dear ${name},

        Thank you for using the Surprise Granite Countertop Budget Calculator! Below is your estimate:

        - Material: ${material}
        - Slab Name: ${slabName || 'N/A'}
        - Slab Size: ${slabSize}
        - Slab Cost/Sq Ft: $${slabCostSqft}
        - Countertop Sq Ft: ${clientSqft}
        - Waste Factor: ${wasteFactor}%
        - Total Slabs Needed: ${totalSlabs}
        - Stone Cost: $${parseFloat(stoneCost).toLocaleString()}
        - Labor Cost: $${parseFloat(laborCost).toLocaleString()}
        - Total Price: $${parseFloat(totalPrice).toLocaleString()}

        We'll contact you soon at ${email} to discuss next steps. For immediate assistance, call (602) 833-3189 or email info@surprisegranite.com.

        Best regards,
        Surprise Granite Team
      `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Email sent to ${email}`);

    res.status(201).json({ message: 'Estimate saved and email sent successfully', estimate });
  } catch (error) {
    logger.error(`Estimate save/email error: ${error.message}`);
    res.status(500).json({ error: 'Failed to save estimate or send email', details: error.message });
  }
});

// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// Serve React App for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client', 'dist', 'index.html'));
});

// Error Handling Middleware
app.use((req, res) => {
  logger.warn(`404: Route not found - ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found' });
});

app.use((err, req, res, next) => {
  logger.error(`Server error on ${req.method} ${req.url}: ${err.stack}`);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Connect to MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => logger.info('MongoDB connected'))
  .catch((err) => {
    logger.error(`MongoDB connection error: ${err.message}`);
    process.exit(1);
  });

// Start Server
app.listen(port, () => logger.info(`Server running on port ${port}`));
