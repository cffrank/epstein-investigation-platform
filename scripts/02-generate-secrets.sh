#!/bin/bash
# Epstein Files Investigation Platform
# Script 02: Generate Secrets and Environment File

set -e

ENV_FILE="/opt/app/.env"

echo "=========================================="
echo "Epstein Platform - Generate Secrets"
echo "=========================================="

if [ -f "$ENV_FILE" ]; then
    read -p ".env already exists. Overwrite? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing .env file"
        exit 0
    fi
fi

generate_password() {
    openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32
}

POSTGRES_PASSWORD=$(generate_password)
NEO4J_PASSWORD=$(generate_password)
QDRANT_API_KEY=$(generate_password)
APP_SECRET_KEY=$(generate_password)
GRAFANA_PASSWORD=$(generate_password)

cat > "$ENV_FILE" << EOF
# Epstein Files Investigation Platform
# Generated: $(date -Iseconds)

# PostgreSQL
POSTGRES_USER=investigation
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=platform

# Neo4j
NEO4J_USER=neo4j
NEO4J_PASSWORD=$NEO4J_PASSWORD

# Qdrant
QDRANT_API_KEY=$QDRANT_API_KEY

# Application
APP_SECRET_KEY=$APP_SECRET_KEY

# Grafana
GRAFANA_PASSWORD=$GRAFANA_PASSWORD

# Cloudflare (fill after tunnel creation)
CLOUDFLARE_TUNNEL_TOKEN=
CF_ACCOUNT_ID=
R2_ACCESS_KEY=
R2_SECRET_KEY=

# Alert Webhook (optional)
ALERT_WEBHOOK_URL=
EOF

chmod 600 "$ENV_FILE"

echo ""
echo "=========================================="
echo "Secrets Generated!"
echo "=========================================="
echo ""
echo "Environment file: $ENV_FILE"
echo ""
echo "PostgreSQL Password: $POSTGRES_PASSWORD"
echo "Neo4j Password:      $NEO4J_PASSWORD"
echo "Qdrant API Key:      $QDRANT_API_KEY"
echo "App Secret Key:      $APP_SECRET_KEY"
echo "Grafana Password:    $GRAFANA_PASSWORD"
echo ""
echo "SAVE THESE SECURELY!"
