#!/bin/bash
# WAF Bypass Rules Setup for Epstein API
# This script creates Cloudflare WAF rules to allow Worker-to-origin requests

set -e

# Configuration
DOMAIN="allfrontoffice.com"
SUBDOMAIN="epstein-api.allfrontoffice.com"

echo "=========================================="
echo "Cloudflare WAF Bypass Setup"
echo "=========================================="
echo ""
echo "The tunnel uses token-based auth (CLOUDFLARE_TUNNEL_TOKEN),"
echo "so WAF rules must be configured in the Cloudflare Dashboard."
echo ""
echo "=== OPTION 1: WAF Custom Rule (Recommended) ==="
echo ""
echo "1. Log into Cloudflare Dashboard: https://dash.cloudflare.com"
echo ""
echo "2. Select the zone: $DOMAIN"
echo ""
echo "3. Go to: Security > WAF > Custom rules"
echo ""
echo "4. Click 'Create rule' and configure:"
echo ""
echo "   Rule name: Allow Worker API Access"
echo ""
echo "   When incoming requests match..."
echo "   Click 'Edit expression' and paste:"
echo ""
echo '   (http.host eq "epstein-api.allfrontoffice.com" and len(http.request.headers["x-api-key"][0]) > 0)'
echo ""
echo "   Then take action: Skip"
echo "   Check these options to skip:"
echo "   - All remaining custom rules"
echo "   - All Super Bot Fight Mode rules"
echo "   - All managed rules"
echo ""
echo "5. Click 'Deploy' to activate the rule"
echo ""
echo "=== OPTION 2: Disable Managed Challenge for API ==="
echo ""
echo "If you have Bot Management or Super Bot Fight Mode enabled:"
echo ""
echo "1. Go to: Security > Bots"
echo "2. Click 'Configure Super Bot Fight Mode'"
echo "3. Add exception for requests with X-API-Key header"
echo "   OR add the API subdomain to the allow list"
echo ""
echo "=== OPTION 3: Cloudflare Access (Most Secure) ==="
echo ""
echo "1. Go to: Zero Trust > Access > Service Auth > Service Tokens"
echo "2. Create: 'epstein-worker-token'"
echo "3. Note the Client ID and Client Secret"
echo "4. Add secrets to Worker:"
echo "   cd /home/carl/project/Epstein/cloudflare-worker"
echo "   npx wrangler secret put CF_ACCESS_CLIENT_ID"
echo "   npx wrangler secret put CF_ACCESS_CLIENT_SECRET"
echo "5. Go to: Access > Applications > Add application"
echo "6. Select 'Self-hosted' for epstein-api.allfrontoffice.com"
echo "7. Add policy: Allow Service Token 'epstein-worker-token'"
echo ""
echo "Then update the Worker to include Access headers:"
echo '   headers: {'
echo '     "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID,'
echo '     "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET,'
echo '   }'
echo ""

# Check for API token for automated setup
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
    echo "=== AUTOMATED SETUP ==="
    echo ""
    echo "For automated setup, set CLOUDFLARE_API_TOKEN and re-run:"
    echo "  export CLOUDFLARE_API_TOKEN='your-token'"
    echo "  ./waf-bypass-setup.sh"
    echo ""
    exit 0
fi

# Get Zone ID
echo "Looking up Zone ID for $DOMAIN..."
ZONE_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=$DOMAIN" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" | jq -r '.result[0].id')

if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" = "null" ]; then
    echo "Error: Could not find zone for $DOMAIN"
    exit 1
fi

echo "Zone ID: $ZONE_ID"

# Create WAF Custom Rule
echo ""
echo "Creating WAF Custom Rule..."

RULE_EXPRESSION='(http.host eq "epstein-api.allfrontoffice.com" and len(http.request.headers["x-api-key"][0]) > 0)'

RESULT=$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/rulesets/phases/http_request_firewall_custom/entrypoint" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    --data '{
        "rules": [
            {
                "action": "skip",
                "action_parameters": {
                    "ruleset": "current",
                    "phases": ["http_ratelimit", "http_request_firewall_managed"]
                },
                "expression": "'"$RULE_EXPRESSION"'",
                "description": "Allow Worker API Access - Skip managed rules for API requests",
                "enabled": true
            }
        ]
    }')

if echo "$RESULT" | jq -e '.success' > /dev/null 2>&1; then
    echo "WAF rule created successfully!"
    echo ""
    echo "Rule ID: $(echo "$RESULT" | jq -r '.result.rules[0].id')"
else
    echo "Error creating rule:"
    echo "$RESULT" | jq '.errors'
fi

echo ""
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
