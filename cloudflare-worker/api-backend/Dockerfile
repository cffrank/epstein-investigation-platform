FROM node:20-alpine

RUN apk add --no-cache wget

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY index.js ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "index.js"]
