#!/bin/bash
# Epstein Files Investigation Platform
# Script 03: Cloudflare Tunnel Setup

set -e

TUNNEL_NAME="epstein-platform"
ENV_FILE="/opt/app/.env"

echo "=========================================="
echo "Epstein Platform - Cloudflare Setup"
echo "=========================================="

if ! command -v cloudflared &> /dev/null; then
    echo "=== Installing Cloudflared ==="
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
        -o /usr/local/bin/cloudflared
    chmod +x /usr/local/bin/cloudflared
fi

echo ""
echo "=== Cloudflare Authentication ==="
echo "This will open a browser for login."
read -p "Press Enter to continue..."

cloudflared tunnel login

echo ""
echo "=== Creating Tunnel ==="
cloudflared tunnel create $TUNNEL_NAME

TUNNEL_ID=$(cloudflared tunnel list | grep $TUNNEL_NAME | awk '{print $1}')
echo "Tunnel ID: $TUNNEL_ID"

mkdir -p /opt/app/config/cloudflared
cp ~/.cloudflared/*.json /opt/app/config/cloudflared/

echo ""
echo "=== Configuring Tunnel ==="
cat > /opt/app/config/cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: /etc/cloudflared/$TUNNEL_ID.json

metrics: 0.0.0.0:2000
protocol: auto
no-autoupdate: true
loglevel: info

ingress:
  - hostname: app.epsteinfiles.org
    service: http://nginx:80
  - hostname: api.epsteinfiles.org
    service: http://nginx:80
  - hostname: admin.epsteinfiles.org
    service: http://nginx:80
  - service: http_status:404
EOF

TUNNEL_TOKEN=$(cloudflared tunnel token $TUNNEL_NAME)

if [ -f "$ENV_FILE" ]; then
    sed -i "s|CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=$TUNNEL_TOKEN|" "$ENV_FILE"
fi

echo ""
echo "=========================================="
echo "Tunnel Setup Complete!"
echo "=========================================="
echo ""
echo "Tunnel: $TUNNEL_NAME"
echo "ID: $TUNNEL_ID"
echo ""
echo "Run these DNS commands:"
echo "  cloudflared tunnel route dns $TUNNEL_NAME app.epsteinfiles.org"
echo "  cloudflared tunnel route dns $TUNNEL_NAME api.epsteinfiles.org"
echo ""
echo "Then: docker compose up -d"
