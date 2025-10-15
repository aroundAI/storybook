#!/bin/bash

# ==================================
# AWS Parameter Store Secrets Setup
# ==================================
# This script helps you migrate secrets from .env files to AWS Systems Manager Parameter Store
# for secure secret management that prevents CloudTrail exposure.
#
# Benefits:
# - Secrets encrypted at rest with AWS KMS
# - Secrets never appear in CloudTrail logs
# - Easy secret rotation without redeployment
# - Fine-grained IAM access control
#
# Usage:
#   ./scripts/setup-secrets.sh production
#   ./scripts/setup-secrets.sh staging

set -e  # Exit on error

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if stage argument is provided
if [ -z "$1" ]; then
  echo -e "${RED}Error: Stage argument required${NC}"
  echo ""
  echo "Usage: $0 <stage>"
  echo "Example: $0 production"
  echo "         $0 staging"
  exit 1
fi

STAGE="$1"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}AWS Parameter Store Secrets Setup${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "Stage: ${GREEN}${STAGE}${NC}"
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
  echo -e "${RED}Error: AWS CLI is not installed${NC}"
  echo "Please install AWS CLI: https://aws.amazon.com/cli/"
  exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
  echo -e "${RED}Error: AWS credentials not configured${NC}"
  echo "Please run: aws configure"
  exit 1
fi

echo -e "${GREEN}✓${NC} AWS CLI configured"
echo ""

# Determine .env file to use
ENV_FILE=""
if [ "$STAGE" == "production" ]; then
  if [ -f "deployment/config/production.env" ]; then
    ENV_FILE="deployment/config/production.env"
  elif [ -f ".env.production" ]; then
    ENV_FILE=".env.production"
  elif [ -f ".env" ]; then
    ENV_FILE=".env"
  fi
elif [ "$STAGE" == "staging" ]; then
  if [ -f "deployment/config/staging.env" ]; then
    ENV_FILE="deployment/config/staging.env"
  elif [ -f ".env.staging" ]; then
    ENV_FILE=".env.staging"
  elif [ -f ".env" ]; then
    ENV_FILE=".env"
  fi
else
  # For other stages, use generic .env
  ENV_FILE=".env"
fi

if [ -z "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ]; then
  echo -e "${YELLOW}Warning: No .env file found${NC}"
  echo "Will prompt for values interactively"
  echo ""
fi

# Function to get value from .env file or prompt user
get_value() {
  local key="$1"
  local description="$2"
  local is_secret="${3:-true}"

  local value=""

  # Try to read from .env file
  if [ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ]; then
    value=$(grep "^${key}=" "$ENV_FILE" | cut -d '=' -f2- | sed 's/^"//' | sed 's/"$//')
  fi

  # If not found or empty, prompt user
  if [ -z "$value" ]; then
    if [ "$is_secret" == "true" ]; then
      read -sp "${description} (${key}): " value
      echo ""
    else
      read -p "${description} (${key}): " value
    fi
  fi

  echo "$value"
}

# Function to store parameter in SSM
store_parameter() {
  local name="$1"
  local value="$2"
  local description="$3"
  local type="${4:-SecureString}"

  if [ -z "$value" ]; then
    echo -e "${YELLOW}Skipping ${name} (no value provided)${NC}"
    return
  fi

  echo -n "Storing ${name}... "

  # Check if parameter already exists
  if aws ssm get-parameter --name "$name" &> /dev/null; then
    # Update existing parameter
    aws ssm put-parameter \
      --name "$name" \
      --value "$value" \
      --type "$type" \
      --description "$description" \
      --overwrite \
      --tier "Standard" \
      > /dev/null
  else
    # Create new parameter
    aws ssm put-parameter \
      --name "$name" \
      --value "$value" \
      --type "$type" \
      --description "$description" \
      --tier "Standard" \
      > /dev/null
  fi

  echo -e "${GREEN}✓${NC}"
}

echo -e "${BLUE}Step 1: Database Credentials${NC}"
echo "----------------------------"

DB_HOST=$(get_value "POSTGRES_HOST" "Database host" false)
DB_PORT=$(get_value "POSTGRES_PORT" "Database port" false)
DB_NAME=$(get_value "POSTGRES_DB" "Database name" false)
DB_USER=$(get_value "POSTGRES_USER" "Database user" false)
DB_PASSWORD=$(get_value "POSTGRES_PASSWORD" "Database password" true)

store_parameter "/${STAGE}/db/host" "$DB_HOST" "Database host for ${STAGE}" "String"
store_parameter "/${STAGE}/db/port" "${DB_PORT:-5432}" "Database port for ${STAGE}" "String"
store_parameter "/${STAGE}/db/name" "$DB_NAME" "Database name for ${STAGE}" "String"
store_parameter "/${STAGE}/db/user" "$DB_USER" "Database user for ${STAGE}" "String"
store_parameter "/${STAGE}/db/password" "$DB_PASSWORD" "Database password for ${STAGE}" "SecureString"

echo ""
echo -e "${BLUE}Step 2: Authentication Credentials${NC}"
echo "-----------------------------------"

AUTH_PROVIDER=$(get_value "AUTH_PROVIDER" "Auth provider (cognito/supabase)" false)

if [ "$AUTH_PROVIDER" == "cognito" ]; then
  COGNITO_USER_POOL_ID=$(get_value "COGNITO_USER_POOL_ID" "Cognito User Pool ID" false)
  COGNITO_CLIENT_ID=$(get_value "COGNITO_CLIENT_ID" "Cognito Client ID" false)
  COGNITO_CLIENT_SECRET=$(get_value "COGNITO_CLIENT_SECRET" "Cognito Client Secret" true)

  store_parameter "/${STAGE}/cognito/user-pool-id" "$COGNITO_USER_POOL_ID" "Cognito User Pool ID for ${STAGE}" "String"
  store_parameter "/${STAGE}/cognito/client-id" "$COGNITO_CLIENT_ID" "Cognito Client ID for ${STAGE}" "String"
  store_parameter "/${STAGE}/cognito/client-secret" "$COGNITO_CLIENT_SECRET" "Cognito Client Secret for ${STAGE}" "SecureString"
elif [ "$AUTH_PROVIDER" == "supabase" ]; then
  SUPABASE_SERVICE_ROLE_KEY=$(get_value "SUPABASE_SERVICE_ROLE_KEY" "Supabase Service Role Key" true)
  store_parameter "/${STAGE}/supabase/service-role-key" "$SUPABASE_SERVICE_ROLE_KEY" "Supabase Service Role Key for ${STAGE}" "SecureString"
fi

echo ""
echo -e "${BLUE}Step 3: Stripe Credentials${NC}"
echo "--------------------------"

STRIPE_SECRET_KEY=$(get_value "STRIPE_SECRET_KEY" "Stripe Secret Key" true)
STRIPE_WEBHOOK_SECRET=$(get_value "STRIPE_WEBHOOK_SECRET" "Stripe Webhook Secret" true)

store_parameter "/${STAGE}/stripe/secret-key" "$STRIPE_SECRET_KEY" "Stripe Secret Key for ${STAGE}" "SecureString"
store_parameter "/${STAGE}/stripe/webhook-secret" "$STRIPE_WEBHOOK_SECRET" "Stripe Webhook Secret for ${STAGE}" "SecureString"

echo ""
echo -e "${BLUE}Step 4: Email Provider Credentials (if using SES)${NC}"
echo "-------------------------------------------------"

EMAIL_PROVIDER=$(get_value "EMAIL_PROVIDER" "Email provider (ses/resend/sendgrid)" false)

if [ "$EMAIL_PROVIDER" == "resend" ]; then
  RESEND_API_KEY=$(get_value "RESEND_API_KEY" "Resend API Key" true)
  store_parameter "/${STAGE}/resend/api-key" "$RESEND_API_KEY" "Resend API Key for ${STAGE}" "SecureString"
elif [ "$EMAIL_PROVIDER" == "sendgrid" ]; then
  SENDGRID_API_KEY=$(get_value "SENDGRID_API_KEY" "SendGrid API Key" true)
  store_parameter "/${STAGE}/sendgrid/api-key" "$SENDGRID_API_KEY" "SendGrid API Key for ${STAGE}" "SecureString"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Secrets stored successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Verify secrets are stored:"
echo "   ${BLUE}aws ssm get-parameters-by-path --path /${STAGE}/ --recursive${NC}"
echo ""
echo "2. Grant Lambda IAM role permissions to access these parameters:"
echo "   (This is automatically configured in sst.config.ts)"
echo ""
echo "3. Deploy your Lambda functions with updated code:"
echo "   ${BLUE}pnpm sst deploy --stage ${STAGE}${NC}"
echo ""
echo "4. (Optional) Delete secrets from GitHub Actions secrets for defense-in-depth"
echo ""
echo -e "${YELLOW}Security Note:${NC}"
echo "- Secrets are encrypted at rest with AWS KMS"
echo "- Parameter names (not values) are logged in CloudTrail"
echo "- Rotate secrets periodically using: aws ssm put-parameter --overwrite"
echo ""
