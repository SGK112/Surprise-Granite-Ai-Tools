#!/bin/bash
# Build and run script for Surprise Granite AI Tools

# Colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Starting Surprise Granite AI Tools Build & Run Script${NC}"

# Check for required software
echo -e "${YELLOW}Checking required software...${NC}"

if ! command -v node &> /dev/null; then
    echo "Node.js is required but not installed. Please install Node.js and try again."
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "Python 3 is required but not installed. Please install Python 3 and try again."
    exit 1
fi

# Install dependencies
echo -e "${YELLOW}Installing Node.js dependencies...${NC}"
npm install

echo -e "${YELLOW}Installing Python dependencies...${NC}"
pip3 install -r requirements.txt

# Check for .env file
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file template...${NC}"
    echo "OPENAI_API_KEY=your_openai_api_key_here
MONGO_URI=mongodb://localhost:27017
DB_NAME=countertops
COLLECTION_NAME=images
BASE_URL=http://localhost:5000
SHOPIFY_ACCESS_TOKEN=your_shopify_access_token_here
SHOPIFY_SHOP=your_shopify_store_name_here.myshopify.com
EMAIL_USER=your_email_user
EMAIL_PASS=your_email_password" > .env
    
    echo -e "${YELLOW}Please edit the .env file with your actual credentials before continuing.${NC}"
    exit 1
fi

# Start services
echo -e "${YELLOW}Starting MongoDB service...${NC}"
if command -v mongod &> /dev/null; then
    mongod --fork --logpath /var/log/mongodb.log || echo "MongoDB may already be running."
else
    echo "MongoDB not found in PATH. Please make sure MongoDB is running."
fi

# Start the Node.js server in the background
echo -e "${YELLOW}Starting Node.js server...${NC}"
node server.js &
NODE_PID=$!

# Start the Python Flask server
echo -e "${YELLOW}Starting Python Flask server...${NC}"
python3 app.py &
PYTHON_PID=$!

echo -e "${GREEN}All services started!${NC}"
echo "Node.js server running with PID: $NODE_PID"
echo "Python Flask server running with PID: $PYTHON_PID"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Handle script termination
trap "echo -e '${YELLOW}Stopping services...${NC}'; kill $NODE_PID $PYTHON_PID 2>/dev/null; echo -e '${GREEN}Services stopped.${NC}'" INT TERM EXIT

# Keep the script running
wait
