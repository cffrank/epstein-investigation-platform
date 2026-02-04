FROM node:20-slim

WORKDIR /app

# Install dependencies
COPY package.json .
RUN npm install

COPY extract.js .

CMD ["node", "extract.js"]
