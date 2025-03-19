// chatbotController.js
const { OpenAI } = require('openai');  // Ensure you have this package installed
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,  // Store API key in .env
});

class ChatbotController {
  static async handleChat(req, res) {
    try {
      const userMessage = req.body.message;

      // Send the message to the OpenAI API (or other AI services you're using)
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo", // Adjust model version as needed
        messages: [{ role: "user", content: userMessage }],
      });

      // Get the bot's reply
      const botReply = response.choices[0].message.content;

      // Send back the bot's reply to the client
      res.json({ message: botReply });
    } catch (error) {
      console.error('Error during chatbot interaction:', error);
      res.status(500).send({ error: 'Something went wrong!' });
    }
  }
}

module.exports = { ChatbotController };
