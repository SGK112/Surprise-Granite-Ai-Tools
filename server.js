require("dotenv").config();
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const fetch = require("node-fetch");
const fs = require("fs");
const Fuse = require("fuse.js");

const app = express();
const upload = multer({ dest: "uploads/" });

let colorsData = [];

app.use(cors());
app.use(helmet());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// === IMAGE ANALYSIS WITH GROK API ===
app.post("/api/upload-image", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded." });

    const imageBase64 = fs.readFileSync(req.file.path, "base64");
    fs.unlinkSync(req.file.path);

    // Use Grok API for image analysis
    const grokResponse = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-beta", // Use the appropriate Grok model (e.g., grok-beta, grok-2, etc.)
        messages: [
          {
            role: "system",
            content: `
You are CARI, a countertop damage analyst at Surprise Granite.

Analyze the uploaded image. Your job is to:
1. Identify the stone type (granite, quartz, marble, quartzite, etc.)
2. Describe the color and pattern (e.g., white with grey veining)
3. Detect damage (chips, cracks, scratches, breaks, discoloration)
4. Classify severity (low, moderate, severe)
5. Suggest estimated repair cost (e.g. $250–$450)
6. Make a confident recommendation:
   - Recommend full/partial replacement for cracks over 1 inch, multiple chips, or broken pieces.
   - Recommend repair for minor cosmetic damage.
   - If unclear, suggest in-person evaluation.
7. Be clear, professional, and concise.

Respond ONLY in JSON like this:
{
  "stoneType": "",
  "colorPattern": "",
  "isNaturalStone": true,
  "damageType": "",
  "severity": "",
  "estimatedCost": "",
  "recommendation": "",
  "description": ""
}
            `,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Analyze this countertop image." },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          },
        ],
        max_tokens: 800,
        temperature: 0.8,
      }),
    });

    if (!grokResponse.ok) throw new Error(`Grok API failed: ${grokResponse.status}`);

    const data = await grokResponse.json();
    const raw = data.choices[0].message.content.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    const jsonOutput = match ? match[0] : raw;
    const parsed = JSON.parse(jsonOutput);

    // Match color using Fuse.js
    if (colorsData?.length && parsed.colorPattern) {
      const fuse = new Fuse(colorsData, {
        keys: ["name", "description"],
        threshold: 0.3,
      });
      const topMatch = fuse.search(parsed.colorPattern)?.[0]?.item;
      if (topMatch) {
        parsed.matchedColor = topMatch.name;
        parsed.matchedVendor = topMatch.description;
        parsed.matchedImage = topMatch.imageUrl;
      }
    }

    res.json({ response: parsed });
  } catch (error) {
    console.error("❌ Error in /api/upload-image:", error);
    res.status(500).json({ error: "Failed to analyze image." });
  }
});

// === TEXT TO SPEECH ===
app.post("/api/speak", async (req, res) => {
  try {
    const { text, voice = "shimmer", speed = 1.0 } = req.body;
    if (!text) return res.status(400).json({ error: "Text is required." });

    const apiKey = process.env.OPENAI_API_KEY_TTS || process.env.OPENAI_API_KEY;

    const ttsResponse = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "tts-1-hd",
        input: text,
        voice,
        speed: parseFloat(speed),
        response_format: "mp3",
      }),
    });

    if (!ttsResponse.ok) throw new Error(`OpenAI TTS failed: ${ttsResponse.status}`);

    res.setHeader("Content-Type", "audio/mpeg");
    const buffer = await ttsResponse.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("❌ TTS error:", err);
    res.status(500).json({ error: "TTS request failed." });
  }
});

app.get("/", (req, res) => {
  res.send("✅ CARI API is live");
});

// === LOAD COLORS DATA FROM SCRAPER ===
function loadColorData() {
  try {
    colorsData = JSON.parse(fs.readFileSync("./colors.json", "utf8"));
    console.log(`✅ Loaded ${colorsData.length} countertop colors.`);
  } catch (err) {
    console.error("❌ Error loading colors:", err.message);
  }
}

const PORT = process.env.PORT || 5000;
loadColorData();
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
