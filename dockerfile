# Use Node.js 20 Alpine as the base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy root package files and install all dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy client directory and build React app
COPY client ./client
RUN npm run build

# Copy remaining server files
COPY . .

# Expose port (Render uses 10000, not 5000 as in your Dockerfile)
EXPOSE 10000

# Start the server
CMD ["npm", "start"]
