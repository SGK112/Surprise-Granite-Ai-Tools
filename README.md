# Surprise Granite AI Tools

This project provides AI-powered tools for Surprise Granite, including a chatbot widget for customer interactions, countertop material explorer, quote generator, and more. The system combines a Node.js backend, Python Flask services, and MongoDB database.

## Features

- **Wizard AI Chatbot**: Interactive widget that answers customer questions about countertops and remodeling
- **Material Explorer**: Search and visualize countertop materials with pricing
- **Quote Generation**: Simple form to request quotes for countertop projects
- **OpenAI Integration**: Leverages GPT-4 for intelligent responses
- **Offline Support**: Progressive Web App with offline caching
- **Real-time Pricing**: Integration with inventory management systems

## Technology Stack

- **Frontend**: HTML, CSS, JavaScript (Vanilla)
- **Backend**: Node.js with Express, Python Flask
- **Database**: MongoDB
- **AI**: OpenAI GPT-4
- **Caching**: Node-Cache
- **Deployment**: Docker, Render.com

## Setup

1. **Clone Repository**:   ```bash
   git clone https://github.com/SGK112/Surprise-Granite-Ai-Tools.git
   cd Surprise-Granite-Ai-Tools
   ```

2. **Set Up Environment**:
   - Create a `.env` file in the root directory with the following variables:
     ```
     OPENAI_API_KEY=your_openai_api_key
     MONGO_URI=mongodb://localhost:27017
     DB_NAME=countertops
     COLLECTION_NAME=images
     BASE_URL=http://localhost:5000
     SHOPIFY_ACCESS_TOKEN=your_shopify_token
     SHOPIFY_SHOP=your_shop.myshopify.com
     EMAIL_USER=your_email
     EMAIL_PASS=your_email_password
     ```

3. **PowerShell Setup Script**:
   ```powershell
   ./setup.ps1
   ```
   This script creates necessary directories, resolves merge conflicts, and installs dependencies.

4. **Manual Setup**:
   - Install Node.js dependencies:
     ```
     npm install
     ```
   - Install Python dependencies:
     ```
     pip install -r requirements.txt
     ```

5. **Development Mode**:
   - Start the Node.js server:
     ```
     npm run dev
     ```
   - In a separate terminal, start the Flask server:
     ```
     python app.py
     ```

6. **Docker Setup** (Optional):
   ```
   docker-compose up
   ```

## Chatbot Widget Usage

To add the chatbot widget to your website:

1. Include the script tag in your HTML:
   ```html
   <script src="https://yourserver.com/js/app.js"></script>
   ```

2. The widget will automatically load and display as a chat icon in the bottom-right corner.

3. Customize the appearance by modifying the CSS variables in the widget's style section.

## API Endpoints

- `GET /api/materials` - Get all available countertop materials
- `GET /api/shopify-products` - Get products from connected Shopify store
- `POST /api/chat` - Send a message to the AI chatbot
- `POST /api/close-chat` - Close a chat session

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on how to contribute to this project.

## Testing

A comprehensive test plan is available in [TEST-PLAN.md](TEST-PLAN.md). This covers:

- API endpoint testing
- Frontend component verification
- Chatbot functionality testing
- End-to-end integration tests

## Troubleshooting

### Common Issues

1. **Missing Environment Variables**
   - Ensure all required variables in `.env` file are set
   - For missing `GOOGLE_SHEET_CSV_URL`, the system falls back to local data

2. **Port Conflicts**
   - If ports 3000 or 5000 are in use, change them in the configuration
   - For Node.js: Edit `server.js` and change `const port = process.env.PORT || 3000;`
   - For Flask: Edit `app.py` and change the port in `app.run(host='0.0.0.0', port=5000, debug=True)`

3. **MongoDB Connection Issues**
   - Verify MongoDB is running (`mongod` service)
   - Check connection string in `.env` file
   - For local development, ensure MongoDB is installed

4. **API Return Errors**
   - Check browser console for specific error messages
   - Verify that both Node.js and Flask servers are running

## License

MIT License
