#!/bin/bash
# Epstein Files Investigation Platform
# Script 01: Base Server Setup
# Run as root on fresh Hetzner AX42 (Ubuntu 24.04)

set -e

echo "=========================================="
echo "Epstein Platform - Base Setup"
echo "=========================================="

if [ "$EUID" -ne 0 ]; then
    echo "Please run as root"
    exit 1
fi

echo "=== Updating System ==="
apt-get update && apt-get upgrade -y

echo "=== Installing Essential Packages ==="
apt-get install -y \
    curl wget git vim htop iotop \
    ufw fail2ban \
    python3 python3-pip python3-venv \
    jq unzip rsync \
    build-essential \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

echo "=== Configuring Firewall ==="
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw --force enable

echo "=== Configuring Fail2Ban ==="
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
EOF

systemctl enable fail2ban
systemctl restart fail2ban

echo "=== Installing Docker ==="
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

echo "=== Installing Docker Compose ==="
apt-get install -y docker-compose-v2

echo "=== Creating Directory Structure ==="
mkdir -p /opt/app/config/nginx/conf.d
mkdir -p /opt/app/config/postgres/init
mkdir -p /opt/app/config/prometheus
mkdir -p /opt/app/config/cloudflared
mkdir -p /opt/app/config/grafana/provisioning
mkdir -p /opt/app/data/postgres
mkdir -p /opt/app/data/qdrant
mkdir -p /opt/app/data/neo4j
mkdir -p /opt/app/data/redis
mkdir -p /opt/app/backups/postgres
mkdir -p /opt/app/backups/qdrant
mkdir -p /opt/app/backups/neo4j
mkdir -p /opt/app/backups/daily
mkdir -p /opt/app/logs/nginx
mkdir -p /opt/app/logs/api
mkdir -p /opt/app/logs/neo4j
mkdir -p /opt/app/scripts

chmod 700 /opt/app/backups
chmod 755 /opt/app/scripts

echo "=== Creating Swap (8GB) ==="
if [ ! -f /swapfile ]; then
    fallocate -l 8G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== Optimizing System Settings ==="
cat > /etc/sysctl.d/99-app-tuning.conf << 'EOF'
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_tw_reuse = 1
vm.swappiness = 10
vm.dirty_ratio = 60
vm.dirty_background_ratio = 2
vm.overcommit_memory = 1
fs.file-max = 2097152
fs.inotify.max_user_watches = 524288
EOF
sysctl --system

echo "=== Setting File Descriptor Limits ==="
cat >> /etc/security/limits.conf << 'EOF'
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF

echo "=== Installing AWS CLI (for R2) ==="
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "/tmp/awscliv2.zip"
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/aws /tmp/awscliv2.zip

echo "=== Installing Node.js (for Wrangler) ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g wrangler

echo "=========================================="
echo "Base Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Run: ./scripts/02-generate-secrets.sh"
echo "2. Run: ./scripts/03-cloudflare-setup.sh"
echo "3. Run: docker compose up -d"
