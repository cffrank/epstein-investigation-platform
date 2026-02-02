FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
    git curl jq ca-certificates gnupg \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

RUN git clone --depth 1 https://github.com/openclaw/openclaw.git .

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production

RUN useradd -m -u 1000 -s /bin/bash node || true
RUN mkdir -p /home/node/.openclaw/workspace \
    && chown -R node:node /home/node/.openclaw \
    && chown -R node:node /app

USER node

EXPOSE 18789

CMD ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789"]
