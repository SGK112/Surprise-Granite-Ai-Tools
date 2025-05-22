import express from 'express';
import mongoose from 'mongoose';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, '..');

const app = express();

// Middleware to parse JSON bodies
app.use(express.json());

// Serve static files from the "public" directory
app.use(express.static(join(__dirname, 'public')));

// Basic route to serve the index.html
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Connect to MongoDB (optional, since images aren't set up yet)
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/surprise_granite', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Use the PORT environment variable provided by Render, fallback to 3000 for local development
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
