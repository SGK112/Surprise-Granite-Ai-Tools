// Import the OpenAI class from the OpenAI package
const { OpenAI } = require('openai');

// Ensure you have your API key set in your environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Using your API key securely from the .env file
});

class ChatbotController {
  static async handleChat(req, res) {
    try {
      // Check if the user message is provided in the request body
      const userMessage = req.body.message;
      if (!userMessage) {
        return res.status(400).json({ error: 'User message is required' });
      }

      // Send the message to OpenAI's chat API (we're using gpt-4 for a better response)
      const response = await openai.chat.completions.create({
        model: "gpt-4-turbo", // Using GPT-4 (or use the appropriate version)
        messages: [{ role: "user", content: userMessage }],
      });

      // Extract the response from the API
      const botReply = response.choices[0].message.content;

      // Return the bot's reply to the client
      res.json({ message: botReply });
    } catch (error) {
      // Log the error and send a generic error message
      console.error('Error during chatbot interaction:', error);
      res.status(500).json({ error: 'Something went wrong while processing your request' });
    }
  }
}

module.exports = { ChatbotController };
