# Epstein Files Investigation Platform

## Quick Start

```bash
# 1. Extract to /opt/app on your server
tar -xzf epstein-platform.tar.gz
mv epstein-platform /opt/app
cd /opt/app

# 2. Run setup scripts
chmod +x scripts/*.sh
./scripts/01-base-setup.sh
./scripts/02-generate-secrets.sh
./scripts/03-cloudflare-setup.sh

# 3. Start services
docker compose up -d

# 4. Check health
./scripts/05-health-check.sh
```

## Directory Structure

```
/opt/app/
├── config/
│   ├── cloudflared/
│   ├── nginx/conf.d/
│   ├── postgres/init/
│   └── prometheus/
├── data/
│   ├── postgres/
│   ├── qdrant/
│   ├── neo4j/
│   └── redis/
├── backups/
├── logs/
├── scripts/
└── docker-compose.yml
```

## Monthly Cost: ~$100-110

| Component | Cost |
|-----------|------|
| Hetzner AX42 | $58 |
| Cloudflare Pro | $20 |
| Workers | $5 |
| R2 (500GB) | $7.50 |
| Workers AI | ~$10 |
