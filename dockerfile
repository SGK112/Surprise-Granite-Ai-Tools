FROM node:18.20.8
RUN npm install -g npm@11.3.0
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["npm", "start"]
