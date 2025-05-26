// Surprise Granite AI Chatbot Backend
// Express server with file/image upload, CORS, and ready for AI integration

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Middleware ---
app.use(cors()); // Allow all origins (configure for prod if needed)
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Prepare uploads directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    // Safer file naming: timestamp-originalname
    const unique = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, unique);
  }
});
const upload = multer({ storage });

// --- API Endpoints ---

// Chat endpoint: handles text and optional image
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    const message = req.body.message || '';
    let imageUrl = null;
    if (req.file) {
      imageUrl = `/uploads/${req.file.filename}`;
    }

    // TODO: Replace this with your AI integration (OpenAI, Azure, etc.)
    let aiReply = `You said: ${message}`;
    if (imageUrl) aiReply += " (And you attached an image!)";

    // Optionally, you can return the imageUrl for frontend use
    res.json({ message: aiReply, imageUrl });
  } catch (err) {
    res.status(500).json({ error: "AI backend error or file upload failed." });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Surprise Granite AI Chatbot backend running at http://localhost:${PORT}`);
});
