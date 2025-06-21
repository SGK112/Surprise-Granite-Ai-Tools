# Test Plan for Surprise Granite AI Tools

## Prerequisites
- Node.js server running on port 3000
- Flask server running on port 5000
- MongoDB instance running (or connection to cloud MongoDB)
- Required environment variables set in .env file

## Testing Areas

### 1. Server Health Checks
- [x] Node.js server starts without errors
- [x] Flask server starts without errors
- [ ] MongoDB connection is established

### 2. API Endpoints

#### Node.js Endpoints
- [ ] GET /api/materials - Returns list of materials
- [ ] GET /api/shopify-products - Returns list of products

#### Flask Endpoints
- [ ] GET /api/countertops - Returns list of countertops
- [ ] POST /api/upload-image - Uploads an image
- [ ] GET /api/materials - Returns materials data
- [ ] GET /api/shopify-products - Returns Shopify products
- [ ] POST /api/chat - Processes chat messages and returns responses
- [ ] POST /api/close-chat - Closes a chat session
- [ ] POST /api/lead - Submits lead information

### 3. Frontend Components
- [ ] Main index.html loads correctly
- [ ] Chatbot widget loads and displays correctly
- [ ] Styling is properly applied
- [ ] Responsive design works on different screen sizes

### 4. Chatbot Functionality
- [ ] Chat widget opens and closes properly
- [ ] User can send messages
- [ ] Bot responds with appropriate messages
- [ ] Material quote functionality works
- [ ] Square footage calculation works
- [ ] Option buttons are clickable and provide responses

### 5. Integration Tests
- [ ] Chatbot can access materials data from API
- [ ] Quote generation works end-to-end
- [ ] File uploads work
- [ ] Email notification for leads works

## Test Scenarios

### Scenario 1: Material Quote Request
1. Open chatbot widget
2. Type "I want a countertop quote"
3. Bot should ask for material
4. Type "Quartz"
5. Bot should ask for square footage
6. Type "40 sq ft"
7. Bot should provide a price estimate

### Scenario 2: Image Upload
1. Navigate to image upload feature
2. Select an image file
3. Submit the form
4. Verify the image is uploaded and viewable

### Scenario 3: Lead Generation
1. Fill out quote form with contact information
2. Submit form
3. Verify lead is stored in database
4. Verify notification email is sent

## Test Results
_To be filled in after executing tests_

## Known Issues
- Missing GOOGLE_SHEET_CSV_URL environment variable (fallback to local data)
- Environment has placeholder API keys that need to be replaced with actual values
