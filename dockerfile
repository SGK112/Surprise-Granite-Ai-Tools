FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY server.js ./
COPY .env ./
EXPOSE 3000
CMD ["node", "server.js"]
