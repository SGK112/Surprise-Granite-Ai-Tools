import express from 'express';
import mongoose from 'mongoose';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

const app = express();

// Middleware to set correct MIME type for JavaScript files
app.use((req, res, next) => {
  if (req.url.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript');
  }
  next();
});

// Serve static files from the "public" directory
app.use(express.static(join(__dirname, 'public')));

// Middleware to parse JSON bodies
app.use(express.json());

// MongoDB Schema for Images
const ImageSchema = new mongoose.Schema({
  colorName: { type: String, required: true },
  imageUrl: { type: String, required: true },
});

const Image = mongoose.model('Image', ImageSchema, 'images');

// Connect to MongoDB with error handling and timeout
const MONGO_URI = 'mongodb+srv://CARI:%4011560Ndysart@cluster1.s4iodnn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster1';
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 5000 // Timeout after 5 seconds
}).then(() => {
  console.log('Connected to MongoDB');
}).catch((err) => {
  console.error('MongoDB connection error:', err);
  // Continue running the app even if MongoDB connection fails
});

// API endpoint to fetch image URL by colorName
app.get('/api/images/:colorName', async (req, res) => {
  try {
    const colorName = req.params.colorName.trim();
    console.log(`Querying image for colorName: ${colorName}`);
    const image = await Image.findOne({ colorName: { $regex: `^${colorName}$`, $options: 'i' } });
    if (image) {
      console.log(`Found image for ${colorName}: ${image.imageUrl}`);
      res.json({ imageUrl: image.imageUrl });
    } else {
      console.log(`No image found for ${colorName}`);
      res.status(404).json({ imageUrl: null });
    }
  } catch (err) {
    console.error('Error fetching image:', err);
    res.status(500).json({ imageUrl: null });
  }
});

// Basic route to serve the index.html
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Use the PORT environment variable provided by Render, fallback to 3000 for local development
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Handle uncaught exceptions to prevent crashing
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
