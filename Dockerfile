FROM node:23.11-slim

WORKDIR /app

COPY package*.json ./
COPY src src
COPY public public
COPY .env .env

RUN npm install

CMD ["node", "src/server.js"]
