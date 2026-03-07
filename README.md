# Epstein Files Investigation Platform

## Setup

1. Copy `.env.example` to `.env` and fill in all values before running `docker compose up`.
2. Never commit `.env` to version control. All secrets must live in `.env` on the server at `/opt/app/.env`.

## Quick Start

```bash
# 1. Extract to /opt/app on your server
tar -xzf epstein-platform.tar.gz
mv epstein-platform /opt/app
cd /opt/app

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in all required values

# 3. Run setup scripts
chmod +x scripts/*.sh
./scripts/01-base-setup.sh
./scripts/02-generate-secrets.sh
./scripts/03-cloudflare-setup.sh

# 4. Start services
docker compose up -d

# 5. Check health
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

## Server Access

**Hetzner AX42 Server:**
- Public IP: `88.99.61.233`
- SSH: `ssh root@88.99.61.233`
- Location: FSN1-DC1 (Falkenstein, Germany)

**Cloudflare Zero Trust:**
- Organization: `allfrontoffice`
- Internal IP (via WARP): `192.168.1.100` (requires WARP split tunnel config)

**Services (via Cloudflare Tunnel):**
- API: https://epstein-api.allfrontoffice.com
- Health: https://epstein-api.allfrontoffice.com/health
- Stats: https://epstein-api.allfrontoffice.com/api/stats
