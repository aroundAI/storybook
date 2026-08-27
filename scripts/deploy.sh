#!/bin/bash

###############################################################################
# AWS Lambda Deployment Script
#
# Usage: ./scripts/deploy.sh [stage]
#   stage: dev, staging, or production (default: staging)
#
# Environment Variables Required:
#   - NEXT_PUBLIC_SUPABASE_URL
#   - NEXT_PUBLIC_SUPABASE_ANON_KEY
#   - SUPABASE_SERVICE_ROLE_KEY
#   - DOMAIN_NAME (for production)
#   - AWS credentials (via aws configure or environment)
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get stage from argument or default to staging
STAGE="${1:-staging}"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}AWS Lambda Deployment Script${NC}"
echo -e "${BLUE}Stage: ${STAGE}${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

###############################################################################
# 1. Check Prerequisites
###############################################################################

echo -e "${YELLOW}📋 Checking prerequisites...${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI is not installed${NC}"
    echo "Install it from: https://aws.amazon.com/cli/"
    exit 1
fi
echo -e "${GREEN}✓ AWS CLI installed${NC}"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js is not installed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js $(node --version) installed${NC}"

# Check if pnpm is installed
if ! command -v pnpm &> /dev/null; then
    echo -e "${RED}❌ pnpm is not installed${NC}"
    echo "Install it with: npm install -g pnpm"
    exit 1
fi
echo -e "${GREEN}✓ pnpm $(pnpm --version) installed${NC}"

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo "Run: aws configure"
    exit 1
fi

AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region || echo "us-east-1")
echo -e "${GREEN}✓ AWS credentials configured${NC}"
echo -e "  Account: ${AWS_ACCOUNT}"
echo -e "  Region: ${AWS_REGION}"

echo ""

###############################################################################
# 2. Load Environment Variables
###############################################################################

echo -e "${YELLOW}📦 Loading environment variables...${NC}"

# Load deployment config first (highest priority)
if [ -f "deployment/config/${STAGE}.env" ]; then
    echo -e "${GREEN}✓ Loading deployment/config/${STAGE}.env${NC}"
    set -a
    source "deployment/config/${STAGE}.env"
    set +a
# Fallback to legacy locations
elif [ -f ".env.${STAGE}" ]; then
    echo -e "${GREEN}✓ Loading .env.${STAGE}${NC}"
    set -a
    source ".env.${STAGE}"
    set +a
elif [ -f "apps/web/.env.${STAGE}" ]; then
    echo -e "${GREEN}✓ Loading apps/web/.env.${STAGE}${NC}"
    set -a
    source "apps/web/.env.${STAGE}"
    set +a
else
    echo -e "${YELLOW}⚠️  No deployment config found at deployment/config/${STAGE}.env${NC}"
    echo -e "  Initialize config submodule: git submodule update --init --recursive deployment/config"
    echo -e "  Then create deployment/config/${STAGE}.env in the storybook-deployment-config repo."
fi

# Set defaults
export DEPLOY_TARGET="${DEPLOY_TARGET:-lambda}"
export NODE_ENV="production"
export AWS_REGION="${AWS_REGION:-us-east-1}"

# Validate required environment variables
REQUIRED_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
)

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo -e "${RED}❌ Missing required environment variables:${NC}"
    for var in "${MISSING_VARS[@]}"; do
        echo -e "  - $var"
    done
    echo ""
    echo -e "Create deployment/config/${STAGE}.env file with these variables or set them in your environment."
    exit 1
fi

echo -e "${GREEN}✓ All required environment variables set${NC}"
echo ""

###############################################################################
# 3. Configure Domain
###############################################################################

# Check if DOMAIN_NAME is set in the config file
if [ -n "$DOMAIN_NAME" ]; then
    echo -e "${YELLOW}🌐 Configuring custom domain...${NC}"
    echo -e "  Domain: ${DOMAIN_NAME}"

    # Find Route53 hosted zone
    echo -e "  Finding Route53 hosted zone..."

    # Extract root domain from subdomain if present
    ROOT_DOMAIN=$(echo "$DOMAIN_NAME" | awk -F. '{print $(NF-1)"."$NF}')

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
        echo -e "${RED}❌ Could not find Route53 hosted zone for ${ROOT_DOMAIN}${NC}"
        echo -e "  Please create a hosted zone in Route53 first"
        echo -e "  Or set SKIP_DOMAIN=true to deploy without custom domain"

        if [ "${SKIP_DOMAIN}" != "true" ]; then
            exit 1
        else
            echo -e "${YELLOW}⚠️  Skipping domain configuration${NC}"
        fi
    else
        echo -e "${GREEN}✓ Found hosted zone: ${HOSTED_ZONE_ID}${NC}"
        export HOSTED_ZONE_ID
        export DOMAIN_NAME
    fi
else
    echo -e "${YELLOW}⚠️  DOMAIN_NAME not set in config. Deploying without custom domain.${NC}"
    echo -e "  Add DOMAIN_NAME to deployment/config/${STAGE}.env to configure a domain"
fi

echo ""

###############################################################################
# 4. Install Dependencies
###############################################################################

echo -e "${YELLOW}📦 Installing dependencies...${NC}"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "  Running pnpm install..."
    pnpm install --frozen-lockfile
else
    echo -e "${GREEN}✓ Dependencies already installed${NC}"
fi

echo ""

###############################################################################
# 5. Apply Supabase Migrations
###############################################################################

echo -e "${YELLOW}📊 Applying Supabase migrations...${NC}"

# Check if SUPABASE_PROJECT_REF is set (required for remote deployments)
if [ -n "$SUPABASE_PROJECT_REF" ]; then
    echo "  Connecting to Supabase project: ${SUPABASE_PROJECT_REF}"

    # Check if supabase CLI is installed
    if ! command -v supabase &> /dev/null; then
        echo -e "${YELLOW}⚠️  Supabase CLI not installed. Install it with:${NC}"
        echo -e "  npm install -g supabase"
        echo -e "${YELLOW}  Skipping migrations for now...${NC}"
    else
        # Apply migrations
        echo "  Applying migrations..."
        cd apps/web

        # Check Supabase CLI version
        SUPABASE_VERSION=$(supabase --version 2>&1 || echo "unknown")
        echo "  Supabase CLI version: ${SUPABASE_VERSION}"
        echo ""

        # Debug: Check environment variables
        echo "  Debug: Checking environment variables..."
        echo "    - SUPABASE_PROJECT_REF: ${SUPABASE_PROJECT_REF:0:10}..." # Show first 10 chars
        echo "    - SUPABASE_DB_PASSWORD: $([ -n "$SUPABASE_DB_PASSWORD" ] && echo 'Set' || echo 'Not set')"
        echo "    - SUPABASE_ACCESS_TOKEN: $([ -n "$SUPABASE_ACCESS_TOKEN" ] && echo 'Set' || echo 'Not set')"
        echo ""

        # Export access token for supabase CLI
        export SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN"

        # Link to Supabase project
        # Note: Using --password flag directly because --password stdin has issues with special characters
        echo "  Linking to Supabase project..."
        echo "  Command: supabase link --project-ref $SUPABASE_PROJECT_REF --password '***'"
        echo "  Output:"
        echo ""

        # Show real-time output instead of capturing silently
        set +e  # Don't exit on error
        supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
        LINK_EXIT_CODE=$?
        set -e  # Re-enable exit on error

        echo ""

        if [ $LINK_EXIT_CODE -eq 0 ]; then
            echo -e "${GREEN}✓ Successfully linked to Supabase project${NC}"
            echo ""

            # Push migrations (idempotent - only applies new migrations)
            echo "  Pushing database migrations..."
            echo "  Command: supabase db push"
            echo "  Output:"
            echo ""

            # Show real-time output
            set +e
            supabase db push
            PUSH_EXIT_CODE=$?
            set -e

            echo ""

            if [ $PUSH_EXIT_CODE -eq 0 ]; then
                echo -e "${GREEN}✓ Migrations applied successfully (idempotent)${NC}"
            else
                echo -e "${RED}✗ Failed to push database migrations (exit code: $PUSH_EXIT_CODE)${NC}"
                echo -e "  You may need to apply migrations manually"
            fi
        else
            echo -e "${RED}✗ Failed to link to Supabase project (exit code: $LINK_EXIT_CODE)${NC}"
            echo -e ""
            echo -e "  Debug info:"
            echo -e "    - SUPABASE_PROJECT_REF: ${SUPABASE_PROJECT_REF}"
            echo -e "    - SUPABASE_DB_PASSWORD is $([ -n "$SUPABASE_DB_PASSWORD" ] && echo 'set' || echo 'NOT set')"
            echo -e "    - SUPABASE_ACCESS_TOKEN is $([ -n "$SUPABASE_ACCESS_TOKEN" ] && echo 'set' || echo 'NOT set')"
            echo -e ""
            echo -e "  Common fixes:"
            echo -e "    - Ensure SUPABASE_ACCESS_TOKEN is set (get from: https://supabase.com/dashboard/account/tokens)"
            echo -e "    - Ensure SUPABASE_DB_PASSWORD is correct"
            echo -e "    - Check project ref is correct: ${SUPABASE_PROJECT_REF}"
        fi

        cd ../..
    fi
else
    echo -e "${YELLOW}⚠️  SUPABASE_PROJECT_REF not set. Skipping migrations.${NC}"
    echo -e "  To enable automatic migrations, add SUPABASE_PROJECT_REF to your deployment/config/${STAGE}.env file"
fi

echo ""

###############################################################################
# 5b. Apply ClickHouse Migrations
###############################################################################

if [ "${CLICKHOUSE_ENABLED}" = "true" ] && [ -n "$CLICKHOUSE_HOST" ]; then
    echo -e "${YELLOW}📊 Applying ClickHouse migrations...${NC}"

    MIGRATIONS_DIR="packages/clickhouse/src/migrations"

    if [ ! -d "$MIGRATIONS_DIR" ]; then
        echo -e "${YELLOW}⚠️  No ClickHouse migrations directory found at ${MIGRATIONS_DIR}${NC}"
    else
        # Collect migration files in numeric order (001_, 002_, ...)
        MIGRATION_FILES=$(ls "$MIGRATIONS_DIR"/*.ts 2>/dev/null | sort)

        if [ -z "$MIGRATION_FILES" ]; then
            echo -e "${GREEN}✓ No ClickHouse migration files found — nothing to run${NC}"
        else
            echo "  Found ClickHouse migrations:"
            for f in $MIGRATION_FILES; do
                echo "    - $(basename "$f")"
            done
            echo ""

            MIGRATION_FAILED=false
            for MIGRATION_FILE in $MIGRATION_FILES; do
                MIGRATION_NAME=$(basename "$MIGRATION_FILE")
                echo -e "  Running ${MIGRATION_NAME}..."

                set +e
                npx tsx "$MIGRATION_FILE"
                MIGRATION_EXIT=$?
                set -e

                if [ $MIGRATION_EXIT -eq 0 ]; then
                    echo -e "  ${GREEN}✓ ${MIGRATION_NAME} applied${NC}"
                else
                    echo -e "  ${RED}✗ ${MIGRATION_NAME} failed (exit code: ${MIGRATION_EXIT})${NC}"
                    MIGRATION_FAILED=true
                    break
                fi
            done

            if [ "$MIGRATION_FAILED" = true ]; then
                echo -e "${YELLOW}⚠️  ClickHouse migrations failed. Continuing deployment without ClickHouse.${NC}"
                echo -e "  Analytics features may not work until ClickHouse is reachable."
            else
                echo -e "${GREEN}✓ All ClickHouse migrations applied successfully${NC}"
            fi
        fi
    fi
else
    echo -e "${YELLOW}📊 ClickHouse migrations skipped (CLICKHOUSE_ENABLED != true)${NC}"
    echo -e "  To enable, set CLICKHOUSE_ENABLED=true and configure CLICKHOUSE_HOST in deployment/config/${STAGE}.env"
fi


###############################################################################
# 6. Build Application
###############################################################################

echo -e "${YELLOW}🔨 Building Next.js application...${NC}"

# Increase Node.js memory for build
export NODE_OPTIONS="--max-old-space-size=4096"

# Supply the commit to the build so it does not have to shell out to git.
# SST rebuilds the app in its own step, where the git fallback warns.
if [ -z "${GIT_HASH:-}" ]; then
    GIT_HASH="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
fi
export GIT_HASH

# Temporarily move .env.local out of the way during production build
# This ensures only shell-exported env vars from deployment/config/${STAGE}.env are used
if [ -f "apps/web/.env.local" ]; then
    echo "  Temporarily disabling apps/web/.env.local during build..."
    mv "apps/web/.env.local" "apps/web/.env.local.bak"
fi

# Build the web app
echo "  Building apps/web..."
pnpm --filter web build

# Restore .env.local after build
if [ -f "apps/web/.env.local.bak" ]; then
    mv "apps/web/.env.local.bak" "apps/web/.env.local"
    echo "  Restored apps/web/.env.local"
fi

echo -e "${GREEN}✓ Build completed successfully${NC}"
echo ""

###############################################################################
# 7. Deploy to AWS
###############################################################################

echo -e "${YELLOW}🚀 Deploying to AWS Lambda (stage: ${STAGE})...${NC}"

# Run SST deploy
echo "  Running sst deploy..."
pnpm sst deploy --stage "$STAGE"

DEPLOY_EXIT_CODE=$?

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}❌ Deployment failed with exit code ${DEPLOY_EXIT_CODE}${NC}"
    exit $DEPLOY_EXIT_CODE
fi

echo -e "${GREEN}✓ Deployment completed successfully${NC}"
echo ""

###############################################################################
# 8. Get Deployment Info
###############################################################################

echo -e "${YELLOW}📊 Fetching deployment information...${NC}"

# Get stack outputs
STACK_NAME="storybook-${STAGE}"

# Try to get CloudFront URL
CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='url'].OutputValue" \
    --output text 2>/dev/null || echo "")

if [ -n "$CLOUDFRONT_URL" ]; then
    echo -e "${GREEN}✓ Deployment URL: ${CLOUDFRONT_URL}${NC}"
fi

if [ -n "$DOMAIN_NAME" ] && [ "${SKIP_DOMAIN}" != "true" ]; then
    echo -e "${GREEN}✓ Custom domain: https://${DOMAIN_NAME}${NC}"
    echo -e "${YELLOW}  Note: DNS propagation may take a few minutes${NC}"
fi

echo ""

###############################################################################
# 9. Summary
###############################################################################

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Stage:        ${STAGE}"
echo -e "AWS Account:  ${AWS_ACCOUNT}"
echo -e "AWS Region:   ${AWS_REGION}"

if [ -n "$CLOUDFRONT_URL" ]; then
    echo -e "App URL:      ${CLOUDFRONT_URL}"
fi

if [ -n "$DOMAIN_NAME" ] && [ "${SKIP_DOMAIN}" != "true" ]; then
    echo -e "Domain:       https://${DOMAIN_NAME}"
fi

echo ""
echo -e "View logs:    ${BLUE}pnpm sst:logs --stage ${STAGE}${NC}"
echo -e "SST Console:  ${BLUE}pnpm sst:console --stage ${STAGE}${NC}"
echo ""

###############################################################################
# 10. Post-Deployment Checks
###############################################################################

if [ -n "$CLOUDFRONT_URL" ]; then
    echo -e "${YELLOW}🔍 Running post-deployment health check...${NC}"

    # Wait a moment for deployment to stabilize
    sleep 5

    # Try to access the health check endpoint
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${CLOUDFRONT_URL}/api/health" || echo "000")

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓ Health check passed (HTTP $HTTP_CODE)${NC}"
    else
        echo -e "${YELLOW}⚠️  Health check returned HTTP $HTTP_CODE${NC}"
        echo -e "  The app may still be initializing. Check again in a few moments."
    fi
fi

echo ""
echo -e "${GREEN}Deployment script completed successfully!${NC}"
