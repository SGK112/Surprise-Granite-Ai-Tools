# Minimal Dockerfile for Node.js
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package files and install
COPY package.json package-lock.json* ./
RUN npm install --production

# Copy remaining files
COPY . .

# Expose port 5000 (or your preferred port)
EXPOSE 5000

# Start command
CMD ["npm", "start"]
