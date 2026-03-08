FROM node:20-alpine

WORKDIR /app

# Copy workspace root and shared package for workspace resolution
COPY package.json /workspace/package.json
COPY packages/shared /workspace/packages/shared

# Copy proxy package
COPY mcp-http-proxy/package.json ./
COPY mcp-http-proxy/tsconfig.json ./
COPY mcp-http-proxy/src ./src

# Install dependencies
RUN npm install

# Build TypeScript
RUN npx tsc

EXPOSE 3002

CMD ["node", "dist/index.js"]
