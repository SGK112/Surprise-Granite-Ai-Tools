# Surprise Granite AI Tools - System Overview

This document provides a comprehensive overview of the Surprise Granite AI Tools system, its architecture, components, and how they interact.

## System Architecture

The system follows a multi-tier architecture:

1. **Frontend Tier**:
   - HTML/CSS/JavaScript for the user interface
   - Chatbot widget that can be embedded in any website
   - Material explorer and configuration interface
   
2. **API Services Tier**:
   - Node.js Express API (port 3000)
   - Python Flask API (port 5000)
   
3. **Data Storage Tier**:
   - MongoDB for persistent storage
   - CSV/JSON files for static material data

## Key Components

### 1. Chatbot Widget (`sg-chatbot-widget.html`)
- **Purpose**: Provides an interactive interface for users to ask questions and get quotes
- **Technologies**: HTML, CSS, JavaScript, ParticlesJS
- **Integration**: Can be embedded via iframe or directly included using `include-chatbot.html`

### 2. Node.js Server (`server.js`)
- **Purpose**: Main application server handling API requests and serving static files
- **Key Features**:
  - Material data access
  - Shopify product integration
  - OpenAI API integration
  - Chat history logging
- **Key Endpoints**:
  - `/api/materials` - Material information
  - `/api/shopify-products` - Products from Shopify

### 3. Python Flask Server (`app.py`)
- **Purpose**: Handles image processing, data transformation, and additional AI functionality
- **Key Features**:
  - File uploads and image optimization
  - Material data processing
  - Chat processing with more complex logic
- **Key Endpoints**:
  - `/api/countertops` - Countertop information
  - `/api/chat` - Chat message processing
  - `/api/upload-image` - Image upload handling

### 4. Data Utilities (`your-data-utils.js`)
- **Purpose**: Shared utilities for accessing and transforming data
- **Key Functions**:
  - `getMaterialPrices()` - Gets pricing for materials
  - `getShopifyProducts()` - Gets products from Shopify
  - `loadMaterials()` - Loads material data from CSV or JSON

## Data Flow

1. **User Interaction**:
   - User opens website with chatbot widget
   - User asks a question or requests a quote

2. **Request Processing**:
   - Frontend sends request to appropriate backend endpoint
   - Node.js or Flask server processes the request
   - Data is fetched from MongoDB or external services

3. **Response Generation**:
   - AI models process the request (if needed)
   - Data is formatted and returned to the frontend
   - Frontend displays the response to the user

## Integration Points

1. **OpenAI Integration**:
   - Uses OpenAI API for natural language processing
   - Configured via `OPENAI_API_KEY` environment variable

2. **MongoDB Integration**:
   - Stores chat history, user data, and material information
   - Configured via `MONGO_URI` environment variable

3. **Shopify Integration**:
   - Connects to Shopify store for product information
   - Configured via `SHOPIFY_ACCESS_TOKEN` and `SHOPIFY_SHOP` environment variables

4. **Email Integration**:
   - Sends notifications for quotes and leads
   - Configured via `EMAIL_USER` and `EMAIL_PASS` environment variables

## Deployment

The system can be deployed in several ways:

1. **Local Development**:
   - Run Node.js and Flask servers separately
   - Use local MongoDB instance

2. **Docker Containerization**:
   - Use `docker-compose.yml` to run all services
   - Containers for Node.js + Flask app and MongoDB

3. **Cloud Deployment**:
   - Configuration for Render.com provided in `render.yaml`
   - Can be adapted for other cloud providers

## Maintenance and Monitoring

- **Logging**: Winston logger configured to log to console and files
- **Error Handling**: Try/catch blocks with appropriate error responses
- **Rate Limiting**: Express rate limiter to prevent abuse
- **Security**: Helmet middleware for HTTP security headers

## Future Enhancements

1. **Enhanced AI Features**:
   - Room visualization capabilities
   - More sophisticated material recommendations

2. **Expanded Integration**:
   - CRM system integration
   - Payment processing

3. **Improved Analytics**:
   - User interaction tracking
   - Conversion metrics

4. **Performance Optimization**:
   - Edge caching for static content
   - Database query optimization
