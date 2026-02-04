#!/bin/bash
# Test API Access after WAF bypass configuration
# Run this after creating the WAF rule to verify it works

API_URL="https://epstein-api.allfrontoffice.com"

echo "=========================================="
echo "Testing API Access"
echo "=========================================="
echo ""

# Get API key from server .env
API_KEY=$(ssh root@88.99.61.233 'source /opt/app/.env && echo $BACKEND_API_KEY' 2>/dev/null)

if [ -z "$API_KEY" ]; then
    echo "Warning: Could not retrieve API key from server"
    echo "Using test request without API key..."
    API_KEY="test-key"
fi

echo "Testing: $API_URL/health"
echo ""

# Test without API key (should still hit WAF)
echo "1. Request without X-API-Key header:"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health" 2>&1)
echo "   HTTP Status: $RESPONSE"

if [ "$RESPONSE" = "200" ]; then
    echo "   ✓ Health endpoint accessible"
else
    echo "   ✗ Health endpoint blocked (may still have WAF)"
fi

echo ""

# Test with API key
echo "2. Request with X-API-Key header:"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$API_URL/health" \
    -H "X-API-Key: $API_KEY" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

echo "   HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✓ API access working!"
    echo "   Response: $BODY"
else
    echo "   ✗ API access blocked"
    echo "   Response preview:"
    echo "$BODY" | head -5
fi

echo ""

# Test API endpoint that Worker uses
echo "3. Testing /api/documents/unprocessed endpoint:"
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$API_URL/api/documents/unprocessed?limit=1" \
    -H "X-API-Key: $API_KEY" 2>&1)

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | sed '/HTTP_CODE:/d')

echo "   HTTP Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    echo "   ✓ Documents endpoint working!"
    # Check if response is JSON
    if echo "$BODY" | jq -e . >/dev/null 2>&1; then
        echo "   Response is valid JSON"
        echo "$BODY" | jq -r '.documents | length' 2>/dev/null | xargs -I{} echo "   Documents returned: {}"
    fi
else
    echo "   ✗ Documents endpoint blocked"
    if echo "$BODY" | grep -q "<!DOCTYPE"; then
        echo "   ⚠ WAF challenge page detected - rule not yet active"
    fi
fi

echo ""
echo "=========================================="
echo "Test Complete"
echo "=========================================="
echo ""
echo "If tests are failing, ensure the WAF rule is deployed:"
echo "1. Go to: https://dash.cloudflare.com"
echo "2. Select zone: allfrontoffice.com"
echo "3. Security > WAF > Custom rules"
echo "4. Verify 'Allow Worker API Access' rule is active"
