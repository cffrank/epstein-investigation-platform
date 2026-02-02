#!/bin/bash
# Epstein Files Investigation Platform
# Script 05: Health Check

source /opt/app/.env 2>/dev/null || true

echo "=========================================="
echo "Health Check: $(date)"
echo "=========================================="

check_container() {
    local name=$1
    status=$(docker inspect -f '{{.State.Status}}' "$name" 2>/dev/null)
    if [ "$status" == "running" ]; then
        echo "✓ $name: running"
    else
        echo "✗ $name: $status"
    fi
}

echo ""
echo "--- Containers ---"
check_container "postgres"
check_container "qdrant"
check_container "neo4j"
check_container "redis"
check_container "nginx"
check_container "cloudflared"

echo ""
echo "--- Endpoints ---"
curl -sf http://localhost:6333/readyz > /dev/null && echo "✓ Qdrant: OK" || echo "✗ Qdrant: FAIL"
curl -sf http://localhost:7474 > /dev/null && echo "✓ Neo4j: OK" || echo "✗ Neo4j: FAIL"
curl -sf http://localhost:8080/health > /dev/null && echo "✓ Nginx: OK" || echo "✗ Nginx: FAIL"

echo ""
echo "--- Resources ---"
DISK=$(df -h / | awk 'NR==2 {print $5}')
MEM=$(free -m | awk '/Mem:/ {printf "%.0f%%", $3/$2*100}')
LOAD=$(cat /proc/loadavg | awk '{print $1}')
echo "Disk: $DISK | Memory: $MEM | Load: $LOAD"

echo ""
echo "--- Docker Stats ---"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null
