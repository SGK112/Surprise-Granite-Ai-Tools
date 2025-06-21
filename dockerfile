FROM node:18.20-slim

# Install Python and pip, then upgrade all packages to reduce vulnerabilities
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node.js dependencies
COPY package.json .
RUN npm install

# Install Python dependencies
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy the application code
COPY . .

# Set environment variables
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

# Expose ports for Node.js and Flask
EXPOSE 3000
EXPOSE 5000

# Start both servers
CMD ["npm", "start"]
