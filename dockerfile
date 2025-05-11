FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY client ./client
RUN npm run build
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
