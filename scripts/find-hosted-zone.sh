#!/bin/bash

###############################################################################
# Find Route53 Hosted Zone ID by Domain Name
#
# Usage: ./scripts/find-hosted-zone.sh [domain]
#   domain: The domain name to search for (e.g., tailorist.dev)
#
# Returns: Hosted zone ID or exits with error
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Get domain from argument
DOMAIN="${1}"

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}Error: Domain name required${NC}"
    echo "Usage: $0 <domain>"
    echo "Example: $0 tailorist.dev"
    exit 1
fi

echo -e "${YELLOW}Searching for Route53 hosted zone for: ${DOMAIN}${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed${NC}"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured${NC}"
    exit 1
fi

# Extract root domain from subdomain if present
# e.g., staging.tailorist.dev -> tailorist.dev
ROOT_DOMAIN=$(echo "$DOMAIN" | awk -F. '{if (NF > 2) print $(NF-1)"."$NF; else print $0}')

echo "Root domain: $ROOT_DOMAIN"

# Find hosted zone ID
# Try list-hosted-zones-by-name first, fallback to list-hosted-zones
HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
    --dns-name "$ROOT_DOMAIN" \
    --query "HostedZones[?Name=='${ROOT_DOMAIN}.'].Id" \
    --output text 2>/dev/null | sed 's/\/hostedzone\///')

# If empty, fallback to list-hosted-zones
if [ -z "$HOSTED_ZONE_ID" ]; then
    HOSTED_ZONE_ID=$(aws route53 list-hosted-zones \
        --query "HostedZones[?Name=='${ROOT_DOMAIN}.'].Id" \
        --output text 2>/dev/null | sed 's/\/hostedzone\///')
fi

if [ -z "$HOSTED_ZONE_ID" ]; then
    echo -e "${RED}Error: Could not find hosted zone for ${ROOT_DOMAIN}${NC}"
    echo ""
    echo "Available hosted zones:"
    aws route53 list-hosted-zones --query "HostedZones[].Name" --output table
    exit 1
fi

# Get zone details
ZONE_NAME=$(aws route53 get-hosted-zone \
    --id "$HOSTED_ZONE_ID" \
    --query "HostedZone.Name" \
    --output text)

RECORD_COUNT=$(aws route53 get-hosted-zone \
    --id "$HOSTED_ZONE_ID" \
    --query "HostedZone.ResourceRecordSetCount" \
    --output text)

echo ""
echo -e "${GREEN}✓ Found hosted zone${NC}"
echo "  Zone ID: $HOSTED_ZONE_ID"
echo "  Zone Name: $ZONE_NAME"
echo "  Record Count: $RECORD_COUNT"
echo ""

# Output just the ID for scripting
echo "$HOSTED_ZONE_ID"
