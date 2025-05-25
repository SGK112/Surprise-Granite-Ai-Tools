const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const app = express();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Set up storage for Multer
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safeName = Date.now() + '-' + file.originalname.replace(/\s+/g, '');
    cb(null, safeName);
  }
});
const upload = multer({ storage });

// Serve uploaded files
app.use('/uploads', express.static(uploadDir));

// Serve static files (your chatbot.html etc)
app.use(express.static('public'));

// Chat endpoint - handles messages and files
app.post('/api/chat', upload.array('attachments'), async (req, res) => {
  try {
    const message = req.body.message || '';
    const files = req.files || [];
    // Here you could call your AI/image analysis logic

    // For demo, just echo back what was received
    res.json({
      message: `Received: "${message}" and ${files.length} file(s).`,
      images: files.map(file => ({
        url: `/uploads/${file.filename}`,
        name: file.originalname,
        type: file.mimetype
      }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error, could not process request." });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
