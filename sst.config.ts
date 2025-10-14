/// <reference path="./.sst/platform/config.d.ts" />

/**
 * SST Configuration for AWS Lambda Deployment
 *
 * This configuration deploys the Next.js application to AWS Lambda using OpenNext.
 * It sets up the necessary infrastructure including:
 * - Next.js application on Lambda with CloudFront CDN
 * - S3 bucket for file storage
 * - SQS queues for background jobs
 * - API Gateway WebSocket for realtime features
 * - AWS SES for email sending with domain verification
 */

export default $config({
  app(input) {
    return {
      name: process.env.SST_APP_NAME || "base-saas",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    // Get the current stage (dev, staging, production)
    const stage = $app.stage;

    /**
     * Auto-resolve Route53 hosted zone ID from domain name
     * This enables repeatable deployments without manual zone ID lookup
     */
    async function getHostedZoneId(domainName: string): Promise<string | undefined> {
      try {
        // Import AWS SDK Route53 client
        const { Route53Client, ListHostedZonesByNameCommand, ListHostedZonesCommand } =
          await import('@aws-sdk/client-route53');

        const client = new Route53Client({
          region: process.env.AWS_REGION || 'us-east-1'
        });

        // Extract root domain (e.g., staging.example.com -> example.com)
        const parts = domainName.split('.');
        const rootDomain = parts.length > 2
          ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
          : domainName;

        console.log(`🔍 Searching for Route53 hosted zone for: ${rootDomain}`);

        // Try list-hosted-zones-by-name first (more efficient)
        try {
          const byNameResponse = await client.send(
            new ListHostedZonesByNameCommand({ DNSName: rootDomain })
          );

          const zone = byNameResponse.HostedZones?.find(
            z => z.Name === `${rootDomain}.`
          );

          if (zone?.Id) {
            const zoneId = zone.Id.replace('/hostedzone/', '');
            console.log(`✓ Found hosted zone: ${zoneId}`);
            return zoneId;
          }
        } catch (err) {
          console.warn('  list-hosted-zones-by-name failed, trying list-hosted-zones');
        }

        // Fallback to list-hosted-zones
        const allZonesResponse = await client.send(new ListHostedZonesCommand({}));
        const zone = allZonesResponse.HostedZones?.find(
          z => z.Name === `${rootDomain}.`
        );

        if (zone?.Id) {
          const zoneId = zone.Id.replace('/hostedzone/', '');
          console.log(`✓ Found hosted zone: ${zoneId}`);
          return zoneId;
        }

        console.warn(`⚠️  No hosted zone found for ${rootDomain}`);
        return undefined;
      } catch (error) {
        console.error('❌ Error finding hosted zone:', error);
        return undefined;
      }
    }

    // Get domain configuration from environment
    const getDomainConfig = async () => {
      // Skip domain configuration for dev stage or if explicitly disabled
      if (stage === "dev" || process.env.SKIP_DOMAIN === "true") {
        return { config: undefined, hostedZoneId: undefined };
      }

      const domainName = process.env.DOMAIN_NAME;

      if (!domainName) {
        console.warn("⚠️  DOMAIN_NAME not set, deploying without custom domain");
        return { config: undefined, hostedZoneId: undefined };
      }

      console.log(`🌐 Configuring domain: ${domainName}`);

      // Check if HOSTED_ZONE_ID is explicitly provided
      let hostedZoneId = process.env.HOSTED_ZONE_ID;

      // If not provided, auto-resolve from domain name
      if (!hostedZoneId) {
        console.log('🔍 HOSTED_ZONE_ID not set, auto-resolving from domain...');
        hostedZoneId = await getHostedZoneId(domainName);

        if (!hostedZoneId) {
          console.warn(`⚠️  Could not find Route53 hosted zone for ${domainName}`);
          console.warn('    Deploying without custom domain and SES setup');
          return { config: undefined, hostedZoneId: undefined };
        }
      } else {
        console.log(`✓ Using explicit HOSTED_ZONE_ID: ${hostedZoneId}`);
      }

      console.log(`✓ Using hosted zone: ${hostedZoneId}`);
      return {
        config: {
          name: domainName,
          dns: sst.aws.dns({
            zone: hostedZoneId,
          }),
        },
        hostedZoneId,
      };
    };

    // Resolve domain configuration and hosted zone ID
    const { config: domainConfig, hostedZoneId: resolvedHostedZoneId } = await getDomainConfig();
    const domainName = process.env.DOMAIN_NAME;
    let sesConfigSetName: string | undefined;

    // AWS SES for email sending (only for staging/production with domain)
    if (domainName && resolvedHostedZoneId && stage !== 'dev') {
      console.log(`📧 Setting up AWS SES for domain: ${domainName}`);

      // 1. Create SES domain identity
      const sesIdentity = new aws.sesv2.EmailIdentity("EmailIdentity", {
        emailIdentity: domainName,
      });

      // 2. Create DNS verification record (TXT record for domain verification)
      new aws.route53.Record("SesVerificationRecord", {
        zoneId: resolvedHostedZoneId,
        name: `_amazonses.${domainName}`,
        type: "TXT",
        ttl: 600,
        records: [sesIdentity.dkimSigningAttributes.apply(attrs => attrs.tokens![0])],
      });

      // 3. Create DKIM records (3 CNAME records for email authentication)
      for (let i = 0; i < 3; i++) {
        new aws.route53.Record(`SesDkimRecord${i}`, {
          zoneId: resolvedHostedZoneId,
          name: sesIdentity.dkimSigningAttributes.apply(attrs => `${attrs.tokens![i]}._domainkey.${domainName}`),
          type: "CNAME",
          ttl: 600,
          records: [sesIdentity.dkimSigningAttributes.apply(attrs => `${attrs.tokens![i]}.dkim.amazonses.com`)],
        });
      }

      // 4. Configure MAIL FROM domain (improves deliverability)
      const mailFromDomain = `mail.${domainName}`;

      const mailFromAttributes = new aws.sesv2.EmailIdentityMailFromAttributes("MailFromDomain", {
        emailIdentity: sesIdentity.emailIdentity,
        mailFromDomain: mailFromDomain,
        behaviorOnMxFailure: "REJECT_MESSAGE",
      }, {
        dependsOn: [sesIdentity],
      });

      // 5. Create MX record for MAIL FROM domain
      new aws.route53.Record("SesMailFromMxRecord", {
        zoneId: resolvedHostedZoneId,
        name: mailFromDomain,
        type: "MX",
        ttl: 600,
        records: [`10 feedback-smtp.${process.env.AWS_REGION || 'us-east-1'}.amazonses.com`],
      }, {
        dependsOn: [mailFromAttributes],
      });

      // 6. Create SPF record for MAIL FROM domain
      new aws.route53.Record("SesMailFromSpfRecord", {
        zoneId: resolvedHostedZoneId,
        name: mailFromDomain,
        type: "TXT",
        ttl: 600,
        records: ["v=spf1 include:amazonses.com ~all"],
      }, {
        dependsOn: [mailFromAttributes],
      });

      // 7. Create SES configuration set for tracking metrics
      const configSet = new aws.sesv2.ConfigurationSet("EmailConfigSet", {
        configurationSetName: `${stage}-email-tracking`,
      });

      sesConfigSetName = configSet.configurationSetName;

      console.log(`✓ SES configured with domain ${domainName}`);
      console.log(`✓ MAIL FROM domain: ${mailFromDomain}`);
      // Log configuration set name safely using .apply()
      configSet.configurationSetName.apply(name =>
        console.log(`✓ Configuration set: ${name}`)
      );
    } else {
      console.log(`⚠️  Skipping SES setup (requires DOMAIN_NAME and HOSTED_ZONE_ID)`);
    }

    // AWS S3 bucket for file storage
    const bucket = new sst.aws.Bucket("Storage", {
      access: "public",
      transform: {
        bucket: {
          cors: [{
            allowedHeaders: ["*"],
            allowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
            allowedOrigins: ["*"],
            maxAge: 3000,
          }],
        },
      },
    });

    // AWS SQS queue for email sending
    const queue = new sst.aws.Queue("EmailQueue", {
      fifo: false,
      transform: {
        queue: {
          // Visibility timeout must be >= Lambda timeout (60s)
          // AWS best practice: 6x function timeout for retries
          visibilityTimeoutSeconds: 360, // 6 minutes
        },
      },
    });

    // DynamoDB table for WebSocket connection tracking
    const connectionsTable = new sst.aws.Dynamo("WebSocketConnections", {
      fields: {
        connectionId: "string",
        userId: "string",
      },
      primaryIndex: { hashKey: "connectionId" },
      globalIndexes: {
        userIdIndex: { hashKey: "userId" },
      },
      ttl: "ttl", // Auto-cleanup stale connections
    });

    // API Gateway WebSocket for real-time features
    const websocket = new sst.aws.ApiGatewayWebSocket("RealtimeWebSocket", {
      accessLog: {
        retention: "1 week",
      },
    });

    // WebSocket routes
    websocket.route("$connect", {
      handler: "apps/web/websocket/connect.handler",
      link: [connectionsTable],
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
      },
      nodejs: {
        install: [
          "@aws-sdk/client-dynamodb",
          "@aws-sdk/lib-dynamodb",
          "jose",
        ],
      },
    });

    websocket.route("$disconnect", {
      handler: "apps/web/websocket/disconnect.handler",
      link: [connectionsTable],
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
      },
      nodejs: {
        install: [
          "@aws-sdk/client-dynamodb",
          "@aws-sdk/lib-dynamodb",
        ],
      },
    });

    websocket.route("$default", {
      handler: "apps/web/websocket/default.handler",
      link: [connectionsTable],
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
      },
      nodejs: {
        install: [
          "@aws-sdk/client-dynamodb",
          "@aws-sdk/lib-dynamodb",
          "@aws-sdk/client-apigatewaymanagementapi",
        ],
      },
    });

    // Email Worker Lambda - Processes email sending jobs from SQS
    const emailWorker = queue.subscribe({
      handler: "apps/web/lambda/email-worker/index.handler",
      timeout: "60 seconds", // 60 seconds for email sending
      memory: "512 MB",
      architecture: "arm64",
      link: [bucket, queue],
      // Grant SES permissions using SST's permissions property
      permissions: [
        {
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: ["*"], // Allow sending from any verified email/domain
        },
      ],
      environment: {
        // Supabase configuration
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,

        // Email configuration
        EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || "ses",
        EMAIL_SENDER: process.env.EMAIL_SENDER || `noreply@${domainName || 'example.com'}`,
        ...(sesConfigSetName && { AWS_SES_CONFIG_SET: sesConfigSetName }),

        // AWS region is automatically provided by Lambda
      },
      nodejs: {
        install: [
          "@supabase/supabase-js",
          "@aws-sdk/client-sesv2",
        ],
      },
    });

    // Deploy Next.js application
    const web = new sst.aws.Nextjs("Web", {
      path: "apps/web",

      // Build configuration
      build: {
        command: "pnpm build",
      },

      // Deploy to single region (not Lambda@Edge)
      // SST v3 uses regional Lambda by default when regions is not set or single region
      regions: ["us-east-1"],

      // Link AWS resources
      link: [
        bucket,
        queue,
        connectionsTable,
        websocket,
      ],

      // Environment variables for the Lambda function
      environment: {
        // Node.js and Next.js config
        NODE_ENV: "production",
        DEPLOY_TARGET: "lambda",

        // Supabase configuration
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,

        // Site configuration
        NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || `https://${domainName || `${stage}.example.com`}`,
        NEXT_PUBLIC_PRODUCT_NAME: process.env.NEXT_PUBLIC_PRODUCT_NAME || "SaaS",
        NEXT_PUBLIC_SITE_DESCRIPTION: process.env.NEXT_PUBLIC_SITE_DESCRIPTION || "SaaS Application",

        // Email configuration
        EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || "ses",
        EMAIL_SENDER: process.env.EMAIL_SENDER || `noreply@${domainName || 'example.com'}`,
        ...(sesConfigSetName && { AWS_SES_CONFIG_SET: sesConfigSetName }),

        // Infrastructure providers (use AWS for production)
        STORAGE_PROVIDER: process.env.STORAGE_PROVIDER || "s3",
        QUEUE_PROVIDER: process.env.QUEUE_PROVIDER || "sqs",
        REALTIME_PROVIDER: process.env.REALTIME_PROVIDER || "websocket",

        // AWS resource ARNs and configuration
        AWS_S3_BUCKET: bucket.name,
        AWS_SQS_QUEUE_URL: queue.url,
        AWS_WEBSOCKET_ENDPOINT: websocket.url,
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
      },

      // CloudFront CDN configuration
      domain: domainConfig,

      // Lambda function configuration
      transform: {
        server: {
          // Increase memory for better performance (reduce cold starts)
          memory: "1024 MB",
          // Increase timeout for long-running requests
          timeout: "30 seconds",
          // Architecture (arm64 is cheaper and often faster)
          architecture: "arm64",
        },
      },

      // OpenNext configuration
      openNextVersion: "3.8.0", // Use latest OpenNext version
    });

    // Grant SQS SendMessage permission to web Lambda
    new aws.iam.RolePolicy(`WebServerSqsPolicy`, {
      role: web.nodes.server.role.name,
      policy: $jsonStringify({
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Action: "sqs:SendMessage",
          Resource: queue.arn,
        }],
      }),
    });

    // Output the application URL and resource info
    return {
      url: web.url,
      bucket: bucket.name,
      queue: queue.url,
      websocket: websocket.url,
      connectionsTable: connectionsTable.name,
    };
  },
});
