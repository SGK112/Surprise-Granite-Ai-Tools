const { OpenAI } = require("openai");
const fs = require("fs");
const path = require("path");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Load materials data
const MATERIALS_FILE = path.join(__dirname, "materials.json");
let materialsData = [];

if (fs.existsSync(MATERIALS_FILE)) {
  try {
    materialsData = JSON.parse(fs.readFileSync(MATERIALS_FILE, "utf-8"));
  } catch (error) {
    console.error("Error loading materials.json:", error);
    materialsData = [];
  }
}

// Function to apply a 35% markup
function applyMarkup(price) {
  return (price * 1.35).toFixed(2);
}

class ChatbotController {
  /**
   * Handles text-based chat messages from users.
   */
  static async handleChat(req, res) {
    try {
      const userMessage = req.body.message;
      if (!userMessage) {
        return res.status(400).json({ error: "User message is required" });
      }

      // Restrict chatbot topics to remodeling and countertops only
      const restrictedTopics = ["travel", "flights", "cars", "insurance", "stocks", "movies"];
      if (restrictedTopics.some(topic => userMessage.toLowerCase().includes(topic))) {
        return res.json({
          message: "I'm here to assist with countertops, remodeling, and interior design. How can I help?",
        });
      }

      // Ensure materialsData is loaded correctly
      if (!materialsData || materialsData.length === 0) {
        return res.json({ message: "Material data is currently unavailable." });
      }

      // Handle material pricing requests
      const materialMatch = materialsData.find(m =>
        m.name && userMessage.toLowerCase().includes(m.name.toLowerCase())
      );

      if (materialMatch) {
        const markedUpPrice = applyMarkup(materialMatch.price);
        return res.json({
          message: `The price for ${materialMatch.name} is **$${markedUpPrice} per square foot**.`,
        });
      }

      // OpenAI chatbot response
      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo",
        messages: [
          { role: "system", content: "You are a countertop and remodeling assistant for Surprise Granite." },
          { role: "user", content: userMessage },
        ],
        max_tokens: 300,
        temperature: 0.8,
      });

      res.json({ message: response.choices[0].message.content });
    } catch (error) {
      console.error("Error during chatbot interaction:", error);
      res.status(500).json({ error: "Something went wrong while processing your request." });
    }
  }

  /**
   * Handles image uploads and uses AI to analyze the countertop material.
   */
  static async handleImageUpload(req, res) {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded." });

      const imageBase64 = fs.readFileSync(req.file.path, "base64");
      fs.unlinkSync(req.file.path);

      const response = await openai.chat.completions.create({
        model: "gpt-4-vision-preview",
        messages: [
          { role: "system", content: "You are an expert in countertop materials. Identify materials and suggest closest matches with vendor details." },
          { role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } }] },
        ],
        max_tokens: 500,
      });

      res.json({ message: response.choices[0].message.content });
    } catch (error) {
      console.error("Image processing error:", error);
      res.status(500).json({ error: "Failed to analyze the image." });
    }
  }
}

module.exports = { ChatbotController };
