#!/bin/bash
#
# Document Processing Pipeline Orchestrator
#
# This script manages the complete processing pipeline using Docker containers.
# It's standalone and handles all orchestration internally.
#
# Usage:
#   ./run_pipeline.sh start           # Start all processing containers
#   ./run_pipeline.sh stop            # Stop all processing containers
#   ./run_pipeline.sh status          # Show processing status
#   ./run_pipeline.sh logs [SERVICE]  # View logs
#   ./run_pipeline.sh stats           # Show database statistics
#
# Services:
#   text-extractor (x4)     - Extract text from PDFs
#   r2-uploader (x2)        - Upload PDFs to Cloudflare R2
#   embedding-generator (x2) - Generate embeddings via Workers AI
#   entity-extractor (x2)   - Extract entities to Neo4j
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
PROCESSING_COMPOSE="$PROJECT_DIR/docker-compose.processing.yml"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Processing services
TEXT_EXTRACTORS="text-extractor text-extractor-2 text-extractor-3 text-extractor-4"
R2_UPLOADERS="r2-uploader r2-uploader-2"
EMBEDDING_GENERATORS="embedding-generator embedding-generator-2"
ENTITY_EXTRACTORS="entity-extractor entity-extractor-2"

ALL_SERVICES="$TEXT_EXTRACTORS $R2_UPLOADERS $EMBEDDING_GENERATORS $ENTITY_EXTRACTORS"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_compose_files() {
    if [[ ! -f "$COMPOSE_FILE" ]]; then
        log_error "docker-compose.yml not found at $COMPOSE_FILE"
        exit 1
    fi
    if [[ ! -f "$PROCESSING_COMPOSE" ]]; then
        log_error "docker-compose.processing.yml not found at $PROCESSING_COMPOSE"
        exit 1
    fi
}

docker_compose() {
    docker compose -f "$COMPOSE_FILE" -f "$PROCESSING_COMPOSE" "$@"
}

start_services() {
    log_info "Starting processing pipeline..."

    check_compose_files

    # Build if needed
    log_info "Building containers..."
    docker_compose build $ALL_SERVICES

    # Start text extractors first (they populate data for other services)
    log_info "Starting text extractors..."
    docker_compose up -d $TEXT_EXTRACTORS
    sleep 2

    # Start R2 uploaders
    log_info "Starting R2 uploaders..."
    docker_compose up -d $R2_UPLOADERS
    sleep 2

    # Start embedding generators
    log_info "Starting embedding generators..."
    docker_compose up -d $EMBEDDING_GENERATORS
    sleep 2

    # Start entity extractors
    log_info "Starting entity extractors..."
    docker_compose up -d $ENTITY_EXTRACTORS

    log_success "All processing containers started"
    echo ""
    show_status
}

stop_services() {
    log_info "Stopping processing pipeline..."

    check_compose_files

    docker_compose stop $ALL_SERVICES

    log_success "All processing containers stopped"
}

show_status() {
    log_info "Container status:"
    echo ""

    docker_compose ps $ALL_SERVICES

    echo ""
    log_info "Quick stats:"
    show_quick_stats
}

show_logs() {
    local service="${1:-text-extractor}"

    if [[ -z "$1" ]]; then
        log_info "Showing logs for all processing containers (last 50 lines each)..."
        for svc in $ALL_SERVICES; do
            echo ""
            echo "=== $svc ==="
            docker_compose logs --tail 20 "$svc" 2>/dev/null || true
        done
    else
        log_info "Showing logs for $service..."
        docker_compose logs -f "$service"
    fi
}

show_quick_stats() {
    # Get stats from MCP HTTP proxy or direct DB query
    local stats=$(curl -s -X POST https://epstein-api.allfrontoffice.com/mcp/tools/get_stats 2>/dev/null || echo "{}")

    if [[ "$stats" == "{}" ]]; then
        log_warn "Could not fetch stats from API. Trying direct DB query..."
        stats=$(docker exec postgres psql -U investigation -d platform -t -c "
            SELECT json_build_object(
                'total', COUNT(*),
                'has_text', COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END),
                'needs_ocr', COUNT(CASE WHEN metadata->>'needs_ocr' = 'true' THEN 1 END),
                'has_r2_key', COUNT(CASE WHEN r2_key IS NOT NULL THEN 1 END),
                'has_embedding', COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END),
                'has_entities', COUNT(CASE WHEN metadata->>'entities_extracted' = 'true' THEN 1 END),
                'has_photos', COUNT(CASE WHEN metadata->>'has_photos' = 'true' THEN 1 END)
            ) FROM documents WHERE filename LIKE '%.pdf'
        " 2>/dev/null || echo "{}")
    fi

    echo "$stats" | python3 -c "
import sys, json
try:
    data = json.loads(sys.stdin.read())
    if 'content' in data:
        # API response format
        content = data['content'][0]['text'] if data.get('content') else '{}'
        data = json.loads(content) if isinstance(content, str) else content
    total = data.get('total', 0)
    has_text = data.get('has_text', 0)
    needs_ocr = data.get('needs_ocr', 0)
    has_r2 = data.get('has_r2_key', 0)
    has_embed = data.get('has_embedding', 0)
    has_entities = data.get('has_entities', 0)
    has_photos = data.get('has_photos', 0)

    print(f'  Total documents:    {total:,}')
    print(f'  Text extracted:     {has_text:,} ({100*has_text/total:.1f}%)' if total else '')
    print(f'  Needs OCR:          {needs_ocr:,}')
    print(f'  In R2:              {has_r2:,} ({100*has_r2/total:.1f}%)' if total else '')
    print(f'  Has embedding:      {has_embed:,} ({100*has_embed/total:.1f}%)' if total else '')
    print(f'  Has entities:       {has_entities:,} ({100*has_entities/total:.1f}%)' if total else '')
    print(f'  Has photos:         {has_photos:,}')
except Exception as e:
    print(f'  Error parsing stats: {e}')
" 2>/dev/null || log_warn "Could not parse stats"
}

show_detailed_stats() {
    log_info "Detailed processing statistics:"
    echo ""

    docker exec postgres psql -U investigation -d platform -c "
    SELECT
        source,
        COUNT(*) as total,
        COUNT(CASE WHEN metadata->>'text' IS NOT NULL THEN 1 END) as has_text,
        COUNT(CASE WHEN metadata->>'needs_ocr' = 'true' THEN 1 END) as needs_ocr,
        COUNT(CASE WHEN r2_key IS NOT NULL THEN 1 END) as in_r2,
        COUNT(CASE WHEN embedding_status = 'completed' THEN 1 END) as has_embed,
        COUNT(CASE WHEN metadata->>'has_photos' = 'true' THEN 1 END) as has_photos
    FROM documents
    WHERE filename LIKE '%.pdf'
    GROUP BY source
    ORDER BY total DESC;
    " 2>/dev/null || log_error "Could not query database"

    echo ""
    log_info "Qdrant vectors:"
    curl -s -H "api-key: $(grep QDRANT_API_KEY /opt/app/.env 2>/dev/null | cut -d= -f2)" \
        http://localhost:6333/collections/document_embeddings 2>/dev/null | \
        python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"  Points: {d.get('result',{}).get('points_count',0):,}\")" || \
        log_warn "Could not query Qdrant"

    echo ""
    log_info "Neo4j entities:"
    source /opt/app/.env 2>/dev/null
    docker exec neo4j cypher-shell -u neo4j -p "$NEO4J_PASSWORD" \
        "MATCH (n) RETURN labels(n)[0] as type, count(*) as count ORDER BY count DESC" 2>/dev/null || \
        log_warn "Could not query Neo4j"
}

restart_service() {
    local service="$1"
    if [[ -z "$service" ]]; then
        log_error "Specify service to restart"
        exit 1
    fi

    log_info "Restarting $service..."
    docker_compose restart "$service"
    log_success "Restarted $service"
}

scale_service() {
    local service="$1"
    local count="$2"

    if [[ -z "$service" ]] || [[ -z "$count" ]]; then
        log_error "Usage: ./run_pipeline.sh scale SERVICE COUNT"
        exit 1
    fi

    log_info "Scaling $service to $count instances..."
    docker_compose up -d --scale "$service=$count"
    log_success "Scaled $service to $count"
}

# Main command handler
case "${1:-}" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        stop_services
        sleep 2
        start_services
        ;;
    status)
        show_status
        ;;
    logs)
        show_logs "${2:-}"
        ;;
    stats)
        show_detailed_stats
        ;;
    scale)
        scale_service "$2" "$3"
        ;;
    restart-service)
        restart_service "$2"
        ;;
    build)
        log_info "Building all processing containers..."
        check_compose_files
        docker_compose build $ALL_SERVICES
        log_success "Build complete"
        ;;
    *)
        echo "Document Processing Pipeline Orchestrator"
        echo ""
        echo "Usage: $0 COMMAND [OPTIONS]"
        echo ""
        echo "Commands:"
        echo "  start             Start all processing containers"
        echo "  stop              Stop all processing containers"
        echo "  restart           Restart all processing containers"
        echo "  status            Show container status and quick stats"
        echo "  logs [SERVICE]    View logs (default: all, or specify service)"
        echo "  stats             Show detailed processing statistics"
        echo "  build             Build all processing containers"
        echo "  scale SVC COUNT   Scale a service to COUNT instances"
        echo "  restart-service   Restart a specific service"
        echo ""
        echo "Services:"
        echo "  text-extractor, text-extractor-2, text-extractor-3, text-extractor-4"
        echo "  r2-uploader, r2-uploader-2"
        echo "  embedding-generator, embedding-generator-2"
        echo "  entity-extractor, entity-extractor-2"
        ;;
esac
