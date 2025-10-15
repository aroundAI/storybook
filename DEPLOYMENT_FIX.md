# Fix SST Deployment - Route53 CNAME Already Exists

## Problem
```
InvalidChangeBatch: [Tried to create resource record set [name='_8679578e9de7410fb2211eec659c5036.tailorist.dev.', type='CNAME'] but it already exists]
```

This happens because ACM certificate validation records exist from a previous deployment.

## Solution Options

### Option 1: Clean Deploy (Recommended for First Deployment)
Deploy without domain first, then add domain:

```bash
# Deploy without domain
export SKIP_DOMAIN=true
pnpm sst deploy --stage staging

# After successful deploy, remove the env var and redeploy with domain
unset SKIP_DOMAIN
export DOMAIN_NAME=tailorist.dev
pnpm sst deploy --stage staging
```

### Option 2: Remove Conflicting DNS Records (If you have AWS access)
```bash
# List all validation records
aws route53 list-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --query "ResourceRecordSets[?contains(Name, '_')]"

# Delete the specific CNAME validation record
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --change-batch '{
    "Changes": [{
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "_8679578e9de7410fb2211eec659c5036.tailorist.dev.",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "ACTUAL_VALUE_FROM_LIST"}]
      }
    }]
  }'

# Then redeploy
pnpm sst deploy --stage staging
```

### Option 3: Simplify sst.config.ts (Match aroundAI-web)
Remove the ACM certificate reuse logic (lines 124-137) since aroundAI-web doesn't have it:

```typescript
// REMOVE THIS BLOCK:
// Check for existing ACM certificate to avoid conflicts
const existingCert = process.env.ACM_CERTIFICATE_ARN;

const domainConfigObj: any = {
  name: domainName,
  dns: sst.aws.dns({
    zone: hostedZoneId,
  }),
};

// Use existing certificate if provided (avoids creating duplicate validation records)
if (existingCert) {
  console.log(`✓ Using existing ACM certificate: ${existingCert.substring(0, 50)}...`);
  domainConfigObj.cert = existingCert;
}

// REPLACE WITH SIMPLE VERSION (like aroundAI-web):
return {
  config: {
    name: domainName,
    dns: sst.aws.dns({
      zone: hostedZoneId,
    }),
  },
  hostedZoneId,
};
```

## Why This Happens
SST/Pulumi tracks infrastructure state. When DNS records exist but aren't in SST's state, it tries to create them again, causing conflicts.

## Best Practice (From aroundAI-web)
Keep the SST config simple - let SST fully manage the certificate lifecycle. Don't try to reuse certificates manually.

## SST State Management

### How SST Identifies Your App

SST stores infrastructure state in AWS S3 at path: `app/<app-name>/<stage>.json`

The app name is configured in `sst.config.ts` and can be set via environment variable:

```typescript
app(input) {
  return {
    name: process.env.SST_APP_NAME || "base-saas",
    // ...
  };
}
```

### Why This Matters

- **Multiple Apps**: Different apps (e.g., `base-saas`, `aroundai-web`) can share the same S3 bucket but maintain separate state
- **Multiple Environments**: Same app with different names (e.g., `company-prod`, `company-staging`) will have isolated state
- **Team Collaboration**: All team members accessing the same app name + stage will sync to the same infrastructure state

### Configuration

Set the app name in your environment:

```bash
# deployment/config/your-app.env
SST_APP_NAME=your-app-name

# Then deploy
source deployment/config/your-app.env
pnpm sst deploy --stage staging
```

**Note**: Changing the app name creates a **new** infrastructure stack. The old stack will remain deployed under the previous name.
