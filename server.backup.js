const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory sessions for demo (replace with Redis, etc. for production)
const sessions = {}; // { sessionId: [ {role, content} ] }

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads dir exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, unique);
  }
});
const upload = multer({ storage });

// Helper: get recent N messages for a session
function getContext(sessionId, limit = 10) {
  if (!sessionId) return [];
  const history = sessions[sessionId] || [];
  return history.slice(-limit);
}

// Main chat endpoint
app.post('/api/chat', upload.single('image'), async (req, res) => {
  try {
    const sessionId = req.body.sessionId || req.headers['x-session-id'];
    const message = req.body.message || (req.body && req.body.message) || '';
    let imageUrl = null;
    if (req.file) imageUrl = `/uploads/${req.file.filename}`;

    // Store conversation in session (if sessionId given)
    if (sessionId) {
      if (!sessions[sessionId]) sessions[sessionId] = [];
      sessions[sessionId].push({ role: "user", content: message, imageUrl });
      // Keep only last 10 exchanges
      sessions[sessionId] = sessions[sessionId].slice(-20);
    }

    // --- AI Integration Example ---
    // You would use something like:
    // const context = getContext(sessionId);
    // const aiReply = await callOpenAI(context);
    // But for now, just echo:
    let aiReply = "You said: " + message;
    if (imageUrl) aiReply += " (And you attached an image!)";

    if (sessionId) {
      sessions[sessionId].push({ role: "ai", content: aiReply });
      sessions[sessionId] = sessions[sessionId].slice(-20);
    }

    res.json({ message: aiReply, imageUrl });
  } catch (err) {
    res.status(500).json({ error: "AI backend error or file upload failed." });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Surprise Granite AI Chatbot backend running at http://localhost:${PORT}`);
});
