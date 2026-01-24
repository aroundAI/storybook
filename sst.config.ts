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
      name: process.env.SST_APP_NAME || 'storybook',
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      home: 'aws',
    };
  },
  async run() {
    // Get the current stage (dev, staging, production)
    const stage = $app.stage;

    // Get AWS deployment regions from environment (comma-separated) or default to us-east-1
    const deployRegion = process.env.AWS_DEPLOY_REGION || 'us-east-1';
    const deployRegions = deployRegion.split(',').map((r) => r.trim());

    // Validate required environment variables for AWS deployment
    const requiredEnvVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];

    const missingEnvVars = requiredEnvVars.filter(
      (varName) => !process.env[varName],
    );
    if (missingEnvVars.length > 0) {
      console.error('❌ Missing required environment variables:');
      missingEnvVars.forEach((varName) => console.error(`   - ${varName}`));
      throw new Error(
        `Missing required environment variables: ${missingEnvVars.join(', ')}`,
      );
    }

    console.log(`🌍 Deploying to region(s): ${deployRegions.join(', ')}`);
    console.log(`📦 Stage: ${stage}`);

    // Get AWS account ID for IAM policies
    const callerIdentity = aws.getCallerIdentityOutput();
    const awsAccountId = callerIdentity.accountId;

    /**
     * Auto-resolve Route53 hosted zone ID from domain name
     * This enables repeatable deployments without manual zone ID lookup
     */
    async function getHostedZoneId(
      domainName: string,
    ): Promise<string | undefined> {
      try {
        // Import AWS SDK Route53 client
        const {
          Route53Client,
          ListHostedZonesByNameCommand,
          ListHostedZonesCommand,
        } = await import('@aws-sdk/client-route53');

        const client = new Route53Client({
          region: process.env.AWS_REGION || 'us-east-1',
        });

        // Extract root domain (e.g., staging.example.com -> example.com)
        const parts = domainName.split('.');
        const rootDomain =
          parts.length > 2
            ? `${parts[parts.length - 2]}.${parts[parts.length - 1]}`
            : domainName;

        console.log(`🔍 Searching for Route53 hosted zone for: ${rootDomain}`);

        // Try list-hosted-zones-by-name first (more efficient)
        try {
          const byNameResponse = await client.send(
            new ListHostedZonesByNameCommand({ DNSName: rootDomain }),
          );

          const zone = byNameResponse.HostedZones?.find(
            (z) => z.Name === `${rootDomain}.`,
          );

          if (zone?.Id) {
            const zoneId = zone.Id.replace('/hostedzone/', '');
            console.log(`✓ Found hosted zone: ${zoneId}`);
            return zoneId;
          }
        } catch (err) {
          console.warn(
            '  list-hosted-zones-by-name failed, trying list-hosted-zones',
          );
        }

        // Fallback to list-hosted-zones
        const allZonesResponse = await client.send(
          new ListHostedZonesCommand({}),
        );
        const zone = allZonesResponse.HostedZones?.find(
          (z) => z.Name === `${rootDomain}.`,
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
      if (stage === 'dev' || process.env.SKIP_DOMAIN === 'true') {
        return { config: undefined, hostedZoneId: undefined };
      }

      const domainName = process.env.DOMAIN_NAME;

      if (!domainName) {
        console.warn(
          '⚠️  DOMAIN_NAME not set, deploying without custom domain',
        );
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
          console.warn(
            `⚠️  Could not find Route53 hosted zone for ${domainName}`,
          );
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
    const { config: domainConfig, hostedZoneId: resolvedHostedZoneId } =
      await getDomainConfig();
    const domainName = process.env.DOMAIN_NAME;
    let sesConfigSetName: string | undefined;

    // AWS SES for email sending (only for staging/production with domain)
    if (domainName && resolvedHostedZoneId && stage !== 'dev') {
      console.log(`📧 Setting up AWS SES for domain: ${domainName}`);

      // 1. Create SES domain identity
      const sesIdentity = new aws.sesv2.EmailIdentity('EmailIdentity', {
        emailIdentity: domainName,
      });

      // 2. Create DNS verification record (TXT record for domain verification)
      new aws.route53.Record('SesVerificationRecord', {
        zoneId: resolvedHostedZoneId,
        name: `_amazonses.${domainName}`,
        type: 'TXT',
        ttl: 600,
        records: [
          sesIdentity.dkimSigningAttributes.apply((attrs) => attrs.tokens![0]),
        ],
      });

      // 3. Create DKIM records (3 CNAME records for email authentication)
      for (let i = 0; i < 3; i++) {
        new aws.route53.Record(`SesDkimRecord${i}`, {
          zoneId: resolvedHostedZoneId,
          name: sesIdentity.dkimSigningAttributes.apply(
            (attrs) => `${attrs.tokens![i]}._domainkey.${domainName}`,
          ),
          type: 'CNAME',
          ttl: 600,
          records: [
            sesIdentity.dkimSigningAttributes.apply(
              (attrs) => `${attrs.tokens![i]}.dkim.amazonses.com`,
            ),
          ],
        });
      }

      // 4. Configure MAIL FROM domain (improves deliverability)
      const mailFromDomain = `mail.${domainName}`;

      const mailFromAttributes = new aws.sesv2.EmailIdentityMailFromAttributes(
        'MailFromDomain',
        {
          emailIdentity: sesIdentity.emailIdentity,
          mailFromDomain: mailFromDomain,
          behaviorOnMxFailure: 'REJECT_MESSAGE',
        },
        {
          dependsOn: [sesIdentity],
        },
      );

      // 5. Create MX record for MAIL FROM domain
      new aws.route53.Record(
        'SesMailFromMxRecord',
        {
          zoneId: resolvedHostedZoneId,
          name: mailFromDomain,
          type: 'MX',
          ttl: 600,
          records: [
            `10 feedback-smtp.${process.env.AWS_REGION || 'us-east-1'}.amazonses.com`,
          ],
        },
        {
          dependsOn: [mailFromAttributes],
        },
      );

      // 6. Create SPF record for MAIL FROM domain
      new aws.route53.Record(
        'SesMailFromSpfRecord',
        {
          zoneId: resolvedHostedZoneId,
          name: mailFromDomain,
          type: 'TXT',
          ttl: 600,
          records: ['v=spf1 include:amazonses.com ~all'],
        },
        {
          dependsOn: [mailFromAttributes],
        },
      );

      // 7. Create SES configuration set for tracking metrics
      const configSet = new aws.sesv2.ConfigurationSet('EmailConfigSet', {
        configurationSetName: `storybook-${stage}-email-tracking`,
      });

      sesConfigSetName = configSet.configurationSetName;

      console.log(`✓ SES configured with domain ${domainName}`);
      console.log(`✓ MAIL FROM domain: ${mailFromDomain}`);
      // Log configuration set name safely using .apply()
      configSet.configurationSetName.apply((name) =>
        console.log(`✓ Configuration set: ${name}`),
      );
    } else {
      console.log(
        `⚠️  Skipping SES setup (requires DOMAIN_NAME and HOSTED_ZONE_ID)`,
      );
    }

    // Dynamically create S3 buckets from environment variable
    // Set S3_BUCKETS in .env to specify which buckets to create (comma-separated)
    // Example: S3_BUCKETS=avatars,documents,images
    const bucketsToCreate = (process.env.S3_BUCKETS || 'storage')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);

    console.log(
      `📦 Creating ${bucketsToCreate.length} S3 bucket(s): ${bucketsToCreate.join(', ')}`,
    );

    // Create buckets dynamically
    const buckets = new Map<string, ReturnType<typeof sst.aws.Bucket>>();
    bucketsToCreate.forEach((bucketName) => {
      const bucket = new sst.aws.Bucket(
        bucketName.charAt(0).toUpperCase() + bucketName.slice(1),
        {
          access: 'public',
          transform: {
            bucket: {
              cors: [
                {
                  allowedHeaders: ['*'],
                  allowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
                  allowedOrigins: ['*'],
                  maxAge: 3000,
                },
              ],
            },
          },
        },
      );
      buckets.set(bucketName, bucket);
      console.log(`✓ Created S3 bucket: ${bucketName}`);
    });

    // Dead Letter Queue for failed email messages
    const emailDLQ = new sst.aws.Queue('StorybookEmailDLQ', {
      fifo: false,
      transform: {
        queue: {
          // Retain messages in DLQ for 14 days for investigation
          messageRetentionPeriodSeconds: 1209600, // 14 days
        },
      },
    });

    // AWS SQS queue for email sending
    const queue = new sst.aws.Queue('StorybookEmailQueue', {
      fifo: false,
      transform: {
        queue: (args) => {
          // Visibility timeout must be >= Lambda timeout (60s)
          // AWS best practice: 6x function timeout for retries
          args.visibilityTimeoutSeconds = 360; // 6 minutes

          // Configure Dead Letter Queue
          // After 3 failed attempts, move message to DLQ for investigation
          // Use $transform to properly handle the Output value
          args.redrivePolicy = $interpolate`{"deadLetterTargetArn":"${emailDLQ.arn}","maxReceiveCount":3}`;
        },
      },
    });

    // Dead Letter Queue for failed LLM jobs
    const llmJobsDLQ = new sst.aws.Queue('StorybookLlmJobsDLQ', {
      fifo: false,
      transform: {
        queue: {
          // Retain messages in DLQ for 14 days for investigation
          messageRetentionPeriodSeconds: 1209600, // 14 days
        },
      },
    });

    // AWS SQS queue for LLM job processing (long-running tasks)
    const llmJobsQueue = new sst.aws.Queue('StorybookLlmJobsQueue', {
      fifo: false,
      transform: {
        queue: (args) => {
          // Visibility timeout must be >= Lambda timeout (15 minutes)
          // AWS best practice: 6x function timeout for retries
          args.visibilityTimeoutSeconds = 900; // 15 minutes

          // Configure Dead Letter Queue
          // After 3 failed attempts, move message to DLQ for investigation
          args.redrivePolicy = $interpolate`{"deadLetterTargetArn":"${llmJobsDLQ.arn}","maxReceiveCount":3}`;
        },
      },
    });

    console.log(
      `✓ LLM jobs queue configured with 15-minute visibility timeout`,
    );

    // Dead Letter Queue for failed publish jobs
    const publishDLQ = new sst.aws.Queue('StorybookPublishDLQ', {
      fifo: false,
      transform: {
        queue: {
          // Retain messages in DLQ for 14 days for investigation
          messageRetentionPeriodSeconds: 1209600, // 14 days
        },
      },
    });

    // AWS SQS queue for video publish processing
    const publishQueue = new sst.aws.Queue('StorybookPublishQueue', {
      fifo: false,
      transform: {
        queue: (args) => {
          // Visibility timeout must be >= Lambda timeout (5 minutes)
          args.visibilityTimeoutSeconds = 300; // 5 minutes

          // Configure Dead Letter Queue
          // After 3 failed attempts, move message to DLQ for investigation
          args.redrivePolicy = $interpolate`{"deadLetterTargetArn":"${publishDLQ.arn}","maxReceiveCount":3}`;
        },
      },
    });

    console.log(`✓ Publish queue configured with 5-minute visibility timeout`);

    // DynamoDB table for WebSocket connection tracking
    const connectionsTable = new sst.aws.Dynamo(
      'StorybookWebSocketConnections',
      {
        fields: {
          connectionId: 'string',
          userId: 'string',
        },
        primaryIndex: { hashKey: 'connectionId' },
        globalIndexes: {
          userIdIndex: { hashKey: 'userId' },
        },
        ttl: 'ttl', // Auto-cleanup stale connections
      },
    );

    // KMS Key for Lambda Environment Variable Encryption
    // Encrypts sensitive environment variables at rest
    // NOTE: Defined early because websocket routes need it
    const kmsKey = new aws.kms.Key('LambdaEnvEncryptionKey', {
      description: `KMS key for encrypting Lambda environment variables in ${stage}`,
      enableKeyRotation: false, // Disabled - requires kms:EnableKeyRotation permission
      deletionWindowInDays: 30, // Recovery window if accidentally deleted
      policy: $jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Sid: 'Enable IAM User Permissions',
            Effect: 'Allow',
            Principal: {
              AWS: $interpolate`arn:aws:iam::${awsAccountId}:root`,
            },
            Action: 'kms:*',
            Resource: '*',
          },
          {
            Sid: 'Allow Lambda to decrypt',
            Effect: 'Allow',
            Principal: {
              Service: 'lambda.amazonaws.com',
            },
            Action: ['kms:Decrypt', 'kms:DescribeKey'],
            Resource: '*',
            Condition: {
              StringEquals: {
                'kms:ViaService': `lambda.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
              },
            },
          },
        ],
      }),
    });

    // Create alias for easier management
    new aws.kms.Alias('LambdaEnvEncryptionKeyAlias', {
      name: `alias/${stage}-lambda-env-encryption`,
      targetKeyId: kmsKey.keyId,
    });

    console.log(
      `✓ KMS encryption key created for Lambda environment variables`,
    );

    // API Gateway WebSocket for real-time features
    const websocket = new sst.aws.ApiGatewayWebSocket(
      'StorybookRealtimeWebSocket',
      {
        accessLog: {
          retention: '1 week',
        },
      },
    );

    // WebSocket routes
    websocket.route('$connect', {
      handler: 'apps/web/websocket/connect.handler',
      link: [connectionsTable],
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
        // Required for JWT token verification
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
        // Required for fetching JWKS (Supabase requires apikey header)
        NEXT_PUBLIC_SUPABASE_ANON_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
      },
      transform: {
        function: {
          kmsKeyArn: kmsKey.arn,
        },
      },
      permissions: [
        {
          actions: ['kms:Decrypt'],
          resources: [kmsKey.arn],
        },
      ],
      nodejs: {
        install: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb', 'jose'],
      },
    });

    websocket.route('$disconnect', {
      handler: 'apps/web/websocket/disconnect.handler',
      link: [connectionsTable],
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
      },
      transform: {
        function: {
          kmsKeyArn: kmsKey.arn,
        },
      },
      permissions: [
        {
          actions: ['kms:Decrypt'],
          resources: [kmsKey.arn],
        },
      ],
      nodejs: {
        install: ['@aws-sdk/client-dynamodb', '@aws-sdk/lib-dynamodb'],
      },
    });

    websocket.route('$default', {
      handler: 'apps/web/websocket/default.handler',
      link: [connectionsTable],
      environment: {
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
      },
      transform: {
        function: {
          kmsKeyArn: kmsKey.arn,
        },
      },
      permissions: [
        {
          actions: ['kms:Decrypt'],
          resources: [kmsKey.arn],
        },
      ],
      nodejs: {
        install: [
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-apigatewaymanagementapi',
        ],
      },
    });

    // Email Worker Lambda - Processes email sending jobs from SQS
    const emailWorker = queue.subscribe({
      handler: 'apps/web/lambda/email-worker/index.handler',
      timeout: '60 seconds', // 60 seconds for email sending
      memory: '512 MB',
      architecture: 'arm64',
      link: [...Array.from(buckets.values()), queue],
      // Grant SES permissions using SST's permissions property
      permissions: [
        {
          actions: ['ses:SendEmail', 'ses:SendRawEmail'],
          resources: ['*'], // Allow sending from any verified email/domain
        },
        {
          actions: ['kms:Decrypt'],
          resources: [kmsKey.arn],
        },
      ],
      transform: {
        function: {
          // Enable KMS encryption for environment variables
          kmsKeyArn: kmsKey.arn,
        },
      },
      environment: {
        // Supabase configuration
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,

        // Email configuration
        EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'ses',
        EMAIL_SENDER:
          process.env.EMAIL_SENDER || `noreply@${domainName || 'example.com'}`,
        ...(sesConfigSetName && { AWS_SES_CONFIG_SET: sesConfigSetName }),

        // AWS region is automatically provided by Lambda
      },
      nodejs: {
        install: ['@supabase/supabase-js', '@aws-sdk/client-sesv2'],
      },
    });

    // LLM Worker Lambda - Processes long-running LLM jobs from SQS
    // Results are pushed to users via WebSocket
    const llmWorker = llmJobsQueue.subscribe({
      handler: 'apps/web/lambda/llm-worker/index.handler',
      timeout: '15 minutes', // 15 minutes for long LLM calls
      memory: '2048 MB', // More memory for LLM processing
      architecture: 'arm64',
      link: [connectionsTable, websocket, llmJobsQueue],
      permissions: [
        {
          // Permission to send WebSocket messages to users
          actions: ['execute-api:ManageConnections'],
          resources: ['*'],
        },
        {
          actions: ['kms:Decrypt'],
          resources: [kmsKey.arn],
        },
      ],
      transform: {
        function: {
          kmsKeyArn: kmsKey.arn,
        },
      },
      environment: {
        // Supabase configuration
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,

        // LLM API keys
        ...(process.env.OPENAI_API_KEY && {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        }),
        ...(process.env.ANTHROPIC_API_KEY && {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        }),
        ...(process.env.GOOGLE_API_KEY && {
          GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        }),
        ...(process.env.GEMINI_API_KEY && {
          GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        }),
        ...(process.env.DEEPSEEK_API_KEY && {
          DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        }),

        // LLM configuration
        LLM_PROVIDER: process.env.LLM_PROVIDER || 'gemini',
        LLM_MODEL: process.env.LLM_MODEL || '',

        // Security - needed for API key decryption
        ...(process.env.ENCRYPTION_KEY && {
          ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
        }),

        // R2 Storage configuration (for audio uploads)
        ...(process.env.R2_ACCOUNT_ID && {
          R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        }),
        ...(process.env.R2_ACCESS_KEY_ID && {
          R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        }),
        ...(process.env.R2_SECRET_ACCESS_KEY && {
          R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
        }),
        ...(process.env.R2_BUCKET_NAME && {
          R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
        }),
        ...(process.env.R2_PUBLIC_URL && {
          R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
        }),

        // WebSocket configuration
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
        WEBSOCKET_ENDPOINT: websocket.managementEndpoint,
      },
      nodejs: {
        install: [
          '@supabase/supabase-js',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-apigatewaymanagementapi',
          '@aws-sdk/client-s3',
        ],
      },
    });

    console.log(`✓ LLM Worker Lambda configured with 15-minute timeout`);

    // Publish Worker Lambda - Processes video publish jobs from SQS
    // Each message = one video upload to one platform
    const publishWorker = publishQueue.subscribe({
      handler: 'apps/web/lambda/publish-worker/index.handler',
      timeout: '5 minutes',
      memory: '512 MB',
      architecture: 'arm64',
      link: [connectionsTable, websocket, publishQueue],
      permissions: [
        {
          // Permission to send WebSocket messages to users
          actions: ['execute-api:ManageConnections'],
          resources: ['*'],
        },
        {
          actions: ['kms:Decrypt'],
          resources: [kmsKey.arn],
        },
      ],
      transform: {
        function: {
          kmsKeyArn: kmsKey.arn,
        },
      },
      environment: {
        // Supabase configuration
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,

        // Security - needed for token decryption
        ...(process.env.ENCRYPTION_KEY && {
          ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
        }),

        // WebSocket configuration
        CONNECTIONS_TABLE_NAME: connectionsTable.name,
        WEBSOCKET_ENDPOINT: websocket.managementEndpoint,
      },
      nodejs: {
        install: [
          '@supabase/supabase-js',
          '@aws-sdk/client-dynamodb',
          '@aws-sdk/lib-dynamodb',
          '@aws-sdk/client-apigatewaymanagementapi',
          'googleapis',
        ],
      },
    });

    console.log(`✓ Publish Worker Lambda configured with 5-minute timeout`);

    // Deploy Next.js application
    const web = new sst.aws.Nextjs('StorybookWeb', {
      path: 'apps/web',

      // Build configuration
      build: {
        command: 'pnpm build',
      },

      // Deploy to single region (not Lambda@Edge)
      // SST v3 uses regional Lambda by default when regions is not set or single region
      // Configure via AWS_DEPLOY_REGION environment variable (default: us-east-1)
      regions: deployRegions,

      // Link AWS resources
      link: [
        ...Array.from(buckets.values()),
        queue,
        llmJobsQueue,
        connectionsTable,
        websocket,
      ],

      // Environment variables for the Lambda function
      environment: {
        // Node.js and Next.js config
        NODE_ENV: 'production',
        DEPLOY_TARGET: 'lambda',

        // Supabase configuration
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        NEXT_PUBLIC_SUPABASE_ANON_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        ...(process.env.SUPABASE_DB_WEBHOOK_SECRET && {
          SUPABASE_DB_WEBHOOK_SECRET: process.env.SUPABASE_DB_WEBHOOK_SECRET,
        }),

        // Site configuration
        NEXT_PUBLIC_SITE_URL:
          process.env.NEXT_PUBLIC_SITE_URL ||
          `https://${domainName || `${stage}.example.com`}`,
        NEXT_PUBLIC_PRODUCT_NAME:
          process.env.NEXT_PUBLIC_PRODUCT_NAME || 'SaaS',
        NEXT_PUBLIC_SITE_TITLE: process.env.NEXT_PUBLIC_SITE_TITLE || '',
        NEXT_PUBLIC_SITE_DESCRIPTION:
          process.env.NEXT_PUBLIC_SITE_DESCRIPTION || 'SaaS Application',

        // Authentication settings
        NEXT_PUBLIC_AUTH_PASSWORD:
          process.env.NEXT_PUBLIC_AUTH_PASSWORD || 'true',
        NEXT_PUBLIC_AUTH_MAGIC_LINK:
          process.env.NEXT_PUBLIC_AUTH_MAGIC_LINK || 'true',
        NEXT_PUBLIC_AUTH_OAUTH: process.env.NEXT_PUBLIC_AUTH_OAUTH || 'true',
        NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNTS:
          process.env.NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNTS || 'false',
        NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS:
          process.env.NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS || 'true',

        // Branding (pass through all branding vars)
        ...(process.env.NEXT_PUBLIC_BRAND_PRIMARY && {
          NEXT_PUBLIC_BRAND_PRIMARY: process.env.NEXT_PUBLIC_BRAND_PRIMARY,
        }),
        ...(process.env.NEXT_PUBLIC_BRAND_PRIMARY_DARK && {
          NEXT_PUBLIC_BRAND_PRIMARY_DARK:
            process.env.NEXT_PUBLIC_BRAND_PRIMARY_DARK,
        }),
        ...(process.env.NEXT_PUBLIC_FONT_HEADING && {
          NEXT_PUBLIC_FONT_HEADING: process.env.NEXT_PUBLIC_FONT_HEADING,
        }),
        ...(process.env.NEXT_PUBLIC_FONT_BODY && {
          NEXT_PUBLIC_FONT_BODY: process.env.NEXT_PUBLIC_FONT_BODY,
        }),

        // Email configuration
        EMAIL_PROVIDER: process.env.EMAIL_PROVIDER || 'ses',
        EMAIL_SENDER:
          process.env.EMAIL_SENDER || `noreply@${domainName || 'example.com'}`,
        ...(process.env.CONTACT_EMAIL && {
          CONTACT_EMAIL: process.env.CONTACT_EMAIL,
        }),
        ...(sesConfigSetName && { AWS_SES_CONFIG_SET: sesConfigSetName }),

        // Infrastructure providers (use AWS for production)
        STORAGE_PROVIDER: process.env.STORAGE_PROVIDER || 's3',
        QUEUE_PROVIDER: process.env.QUEUE_PROVIDER || 'sqs',
        REALTIME_PROVIDER: process.env.REALTIME_PROVIDER || 'websocket',

        // Cloudflare R2 storage (for video/audio - zero egress)
        ...(process.env.R2_ACCOUNT_ID && {
          R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        }),
        ...(process.env.R2_ACCESS_KEY_ID && {
          R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        }),
        ...(process.env.R2_SECRET_ACCESS_KEY && {
          R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
        }),
        ...(process.env.R2_BUCKET_NAME && {
          R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
        }),
        ...(process.env.R2_PUBLIC_URL && {
          R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
        }),

        // AWS resource ARNs and configuration
        // Dynamically add bucket environment variables
        // Format: AWS_S3_BUCKET_<UPPERCASE_NAME> (e.g., AWS_S3_BUCKET_AVATARS, AWS_S3_BUCKET_DOCUMENTS)
        ...Object.fromEntries(
          Array.from(buckets.entries()).map(([name, bucket]) => [
            `AWS_S3_BUCKET_${name.toUpperCase().replace(/-/g, '_')}`,
            bucket.name,
          ]),
        ),
        AWS_SQS_QUEUE_URL: queue.url,
        PUBLISH_QUEUE_URL: publishQueue.url,
        AWS_WEBSOCKET_ENDPOINT: websocket.url,
        CONNECTIONS_TABLE_NAME: connectionsTable.name,

        // Cache configuration
        CACHE_PROVIDER: process.env.CACHE_PROVIDER || 'memory',
        ...(process.env.REDIS_URL && { REDIS_URL: process.env.REDIS_URL }),

        // LLM & AI Providers
        ...(process.env.DEEPSEEK_API_KEY && {
          DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        }),
        ...(process.env.GEMINI_API_KEY && {
          GEMINI_API_KEY: process.env.GEMINI_API_KEY,
        }),
        ...(process.env.GOOGLE_API_KEY && {
          GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
        }),
        ...(process.env.OPENAI_API_KEY && {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        }),
        ...(process.env.ANTHROPIC_API_KEY && {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        }),
        ...(process.env.VOYAGE_API_KEY && {
          VOYAGE_API_KEY: process.env.VOYAGE_API_KEY,
        }),
        ...(process.env.EMBEDDING_PROVIDER && {
          EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
        }),
        ...(process.env.EMBEDDING_MODEL && {
          EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
        }),

        // Security
        ...(process.env.ENCRYPTION_KEY && {
          ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
        }),
        ...(process.env.CRON_SECRET && {
          CRON_SECRET: process.env.CRON_SECRET,
        }),

        // Billing (Stripe)
        ...(process.env.NEXT_PUBLIC_BILLING_PROVIDER && {
          NEXT_PUBLIC_BILLING_PROVIDER:
            process.env.NEXT_PUBLIC_BILLING_PROVIDER,
        }),
        ...(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY && {
          NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY:
            process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
        }),
        ...(process.env.STRIPE_SECRET_KEY && {
          STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
        }),
        ...(process.env.STRIPE_WEBHOOK_SECRET && {
          STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
        }),

        // CMS
        ...(process.env.CMS_CLIENT && { CMS_CLIENT: process.env.CMS_CLIENT }),
        ...(process.env.NEXT_PUBLIC_KEYSTATIC_CONTENT_PATH && {
          NEXT_PUBLIC_KEYSTATIC_CONTENT_PATH:
            process.env.NEXT_PUBLIC_KEYSTATIC_CONTENT_PATH,
        }),

        // Monitoring
        ...(process.env.SENTRY_DSN && { SENTRY_DSN: process.env.SENTRY_DSN }),
        ...(process.env.NEXT_PUBLIC_SENTRY_DSN && {
          NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
        }),

        // WebSocket URL (from SST deployment)
        NEXT_PUBLIC_WEBSOCKET_URL: websocket.url,

        // Misc
        TZ: process.env.TZ || 'UTC',
      },

      // CloudFront CDN configuration
      domain: domainConfig,

      // Lambda configuration via transform
      // Note: Using defaults until we can properly configure increased timeouts
      transform: {
        server: {
          // Increase memory for better performance (reduce cold starts)
          memory: '1792 MB',
          // Architecture (arm64 is cheaper and often faster)
          architecture: 'arm64',
          // Enable KMS encryption for environment variables
          kmsKeyArn: kmsKey.arn,
        },
      },

      // OpenNext configuration
      openNextVersion: '3.8.0', // Use latest OpenNext version
    });

    // Grant SQS SendMessage permission to web Lambda
    new aws.iam.RolePolicy(`WebServerSqsPolicy`, {
      role: web.nodes.server.role.name,
      policy: $jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'sqs:SendMessage',
            Resource: queue.arn,
          },
        ],
      }),
    });

    // Grant KMS decrypt permission to web Lambda for environment variables
    new aws.iam.RolePolicy(`WebServerKmsPolicy`, {
      role: web.nodes.server.role.name,
      policy: $jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: ['kms:Decrypt', 'kms:DescribeKey'],
            Resource: kmsKey.arn,
          },
        ],
      }),
    });

    // Grant SSM Parameter Store read permission to web Lambda for secure secret management
    // This allows Lambda to fetch secrets at runtime instead of storing them in environment variables
    // Benefits: No CloudTrail exposure, easy secret rotation, fine-grained access control
    new aws.iam.RolePolicy(`WebServerParameterStorePolicy`, {
      role: web.nodes.server.role.name,
      policy: $jsonStringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'ssm:GetParameter',
              'ssm:GetParameters',
              'ssm:GetParametersByPath',
            ],
            Resource: $interpolate`arn:aws:ssm:${process.env.AWS_REGION || 'us-east-1'}:${awsAccountId}:parameter/${stage}/*`,
          },
          {
            Effect: 'Allow',
            Action: ['kms:Decrypt'],
            Resource: kmsKey.arn,
            Condition: {
              StringEquals: {
                'kms:ViaService': `ssm.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com`,
              },
            },
          },
        ],
      }),
    });

    // Analytics Sync Cron - Syncs YouTube, TikTok, Instagram analytics hourly
    // Uses EventBridge to trigger a Lambda that calls the analytics sync API endpoint
    const analyticsSyncCron = new sst.aws.Cron('StorybookAnalyticsSyncCron', {
      job: {
        handler: 'apps/web/lambda/analytics-sync/index.handler',
        timeout: '5 minutes',
        memory: '512 MB',
        architecture: 'arm64',
        link: [web],
        environment: {
          API_URL: web.url,
          CRON_SECRET: process.env.CRON_SECRET || '',
        },
        transform: {
          function: {
            kmsKeyArn: kmsKey.arn,
          },
        },
        permissions: [
          {
            actions: ['kms:Decrypt'],
            resources: [kmsKey.arn],
          },
        ],
      },
      schedule: 'rate(1 hour)',
    });

    console.log(`✓ Analytics sync cron configured (hourly)`);

    // Token Refresh Cron - Refreshes OAuth tokens before they expire
    // Runs every 30 minutes to catch tokens expiring within the hour
    const tokenRefreshCron = new sst.aws.Cron('StorybookTokenRefreshCron', {
      job: {
        handler: 'apps/web/lambda/token-refresh/index.handler',
        timeout: '2 minutes',
        memory: '256 MB',
        architecture: 'arm64',
        link: [web],
        environment: {
          API_URL: web.url,
          CRON_SECRET: process.env.CRON_SECRET || '',
        },
        transform: {
          function: {
            kmsKeyArn: kmsKey.arn,
          },
        },
        permissions: [
          {
            actions: ['kms:Decrypt'],
            resources: [kmsKey.arn],
          },
        ],
      },
      schedule: 'rate(30 minutes)',
    });

    console.log(`✓ Token refresh cron configured (every 30 minutes)`);

    // Scheduled Publish Cron - Queries for due publishes and queues them
    // Runs every 5 minutes, sends each publish job to SQS for processing
    const scheduledPublishCron = new sst.aws.Cron(
      'StorybookScheduledPublishCron',
      {
        job: {
          handler: 'apps/web/lambda/scheduled-publish/index.handler',
          timeout: '5 minutes',
          memory: '512 MB',
          architecture: 'arm64',
          link: [publishQueue],
          environment: {
            // Supabase for DB access
            NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
            SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            // SQS queue URL
            PUBLISH_QUEUE_URL: publishQueue.url,
          },
          transform: {
            function: {
              kmsKeyArn: kmsKey.arn,
            },
          },
          permissions: [
            {
              actions: ['kms:Decrypt'],
              resources: [kmsKey.arn],
            },
            {
              actions: ['sqs:SendMessage'],
              resources: [publishQueue.arn],
            },
          ],
          nodejs: {
            install: ['@supabase/supabase-js', '@aws-sdk/client-sqs'],
          },
        },
        schedule: 'rate(5 minutes)',
      },
    );

    console.log(`✓ Scheduled publish cron configured (every 5 minutes)`);

    // SNS Topic for CloudWatch Alarm Notifications (optional)
    // Configure email subscription via ALARM_EMAIL environment variable
    let alarmTopic: aws.sns.Topic | undefined;

    if (process.env.ALARM_EMAIL) {
      console.log(
        `📧 Configuring SNS alarm notifications for ${process.env.ALARM_EMAIL}`,
      );

      alarmTopic = new aws.sns.Topic('AlarmNotifications', {
        displayName: `${stage} CloudWatch Alarms`,
        tags: {
          Environment: stage,
          Purpose: 'CloudWatch alarm notifications',
        },
      });

      // Subscribe email to topic
      new aws.sns.TopicSubscription('AlarmEmailSubscription', {
        topic: alarmTopic.arn,
        protocol: 'email',
        endpoint: process.env.ALARM_EMAIL,
      });

      console.log(`✓ SNS alarm notifications configured`);
      console.log(
        `  ⚠️  Check your email (${process.env.ALARM_EMAIL}) to confirm subscription`,
      );
    } else {
      console.log(
        `ℹ️  ALARM_EMAIL not set - alarms will be created without notifications`,
      );
    }

    // CloudWatch Alarms for Cost Monitoring and Operational Health
    // These alarms help detect cost anomalies and operational issues early

    // 1. Monthly Cost Alarm - Alert when AWS charges exceed $250/month
    // Note: Billing metrics are ONLY available in us-east-1 region
    const awsRegion = process.env.AWS_REGION || 'us-east-1';

    if (awsRegion === 'us-east-1') {
      new aws.cloudwatch.MetricAlarm('MonthlyCostAlarm', {
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods: 1,
        metricName: 'EstimatedCharges',
        namespace: 'AWS/Billing',
        period: 21600, // 6 hours
        statistic: 'Maximum',
        threshold: 250,
        alarmDescription: `Alert when monthly AWS charges exceed $250 for ${stage} environment`,
        alarmName: `${stage}-monthly-cost-alarm`,
        dimensions: {
          Currency: 'USD',
        },
        treatMissingData: 'notBreaching',
        ...(alarmTopic && { alarmActions: [alarmTopic.arn] }),
      });
      console.log(`✓ Billing cost alarm configured (us-east-1)`);
    } else {
      console.warn(
        `⚠️  Billing cost alarm skipped (only available in us-east-1, current region: ${awsRegion})`,
      );
    }

    // 2. Lambda Invocation Spike Alarm - Detect unusual traffic patterns
    new aws.cloudwatch.MetricAlarm('LambdaInvocationSpikeAlarm', {
      comparisonOperator: 'GreaterThanThreshold',
      evaluationPeriods: 2,
      metricName: 'Invocations',
      namespace: 'AWS/Lambda',
      period: 3600, // 1 hour
      statistic: 'Sum',
      threshold: 100000,
      alarmDescription: `Alert when Lambda invocations exceed 100K/hour for ${stage} (potential infinite loop or DDoS)`,
      alarmName: `${stage}-lambda-spike-alarm`,
      treatMissingData: 'notBreaching',
      ...(alarmTopic && { alarmActions: [alarmTopic.arn] }),
    });

    // 3. Dead Letter Queue Message Alarm - Detect failed email processing
    new aws.cloudwatch.MetricAlarm('DLQMessageAlarm', {
      comparisonOperator: 'GreaterThanThreshold',
      evaluationPeriods: 1,
      metricName: 'ApproximateNumberOfMessagesVisible',
      namespace: 'AWS/SQS',
      period: 300, // 5 minutes
      statistic: 'Average',
      threshold: 10,
      alarmDescription: `Alert when DLQ has >10 messages for ${stage} (indicates persistent email failures)`,
      alarmName: `${stage}-dlq-messages-alarm`,
      dimensions: {
        QueueName: emailDLQ.name,
      },
      treatMissingData: 'notBreaching',
      ...(alarmTopic && { alarmActions: [alarmTopic.arn] }),
    });

    // 4. S3 Storage Size Alarm - Monitor storage costs
    new aws.cloudwatch.MetricAlarm('S3StorageSizeAlarm', {
      comparisonOperator: 'GreaterThanThreshold',
      evaluationPeriods: 1,
      metricName: 'BucketSizeBytes',
      namespace: 'AWS/S3',
      period: 86400, // 24 hours
      statistic: 'Average',
      threshold: 107374182400, // 100GB in bytes
      alarmDescription: `Alert when S3 storage exceeds 100GB for ${stage} (review storage costs)`,
      alarmName: `${stage}-s3-storage-alarm`,
      dimensions: {
        BucketName: buckets.get('storage')?.name || 'storybook-storage',
        StorageType: 'StandardStorage',
      },
      treatMissingData: 'notBreaching',
      ...(alarmTopic && { alarmActions: [alarmTopic.arn] }),
    });

    console.log(`✓ CloudWatch operational alarms configured for ${stage}`);

    // CloudWatch Dashboard for Cost Monitoring and Operational Metrics
    // Creates a comprehensive dashboard for tracking AWS resource usage and costs
    new aws.cloudwatch.Dashboard('CostMonitoringDashboard', {
      dashboardName: `${stage}-cost-monitoring`,
      dashboardBody: JSON.stringify({
        widgets: [
          // Row 1: Billing and Cost Overview
          {
            type: 'metric',
            x: 0,
            y: 0,
            width: 12,
            height: 6,
            properties: {
              metrics: [
                [
                  'AWS/Billing',
                  'EstimatedCharges',
                  { stat: 'Maximum', label: 'Estimated Monthly Charges' },
                ],
              ],
              view: 'timeSeries',
              stacked: false,
              region: 'us-east-1', // Billing metrics only in us-east-1
              title: '💰 Monthly AWS Cost Estimate',
              period: 21600, // 6 hours
              yAxis: {
                left: {
                  label: 'USD',
                },
              },
            },
          },
          {
            type: 'metric',
            x: 12,
            y: 0,
            width: 12,
            height: 6,
            properties: {
              metrics: [
                [
                  'AWS/Lambda',
                  'Invocations',
                  { stat: 'Sum', label: 'Total Invocations' },
                ],
                ['.', 'Errors', { stat: 'Sum', label: 'Errors' }],
                ['.', 'Throttles', { stat: 'Sum', label: 'Throttles' }],
              ],
              view: 'timeSeries',
              stacked: false,
              region: awsRegion,
              title: '⚡ Lambda Invocations (Cost Driver)',
              period: 3600, // 1 hour
              yAxis: {
                left: {
                  label: 'Count',
                },
              },
            },
          },

          // Row 2: Storage Costs
          {
            type: 'metric',
            x: 0,
            y: 6,
            width: 12,
            height: 6,
            properties: {
              metrics: [
                [
                  'AWS/S3',
                  'BucketSizeBytes',
                  { stat: 'Average', label: 'Storage Size (Bytes)' },
                ],
                [
                  '.',
                  'NumberOfObjects',
                  { stat: 'Average', label: 'Object Count' },
                ],
              ],
              view: 'timeSeries',
              stacked: false,
              region: awsRegion,
              title: '📦 S3 Storage Usage',
              period: 86400, // 24 hours
              yAxis: {
                left: {
                  label: 'Size/Count',
                },
              },
            },
          },
          {
            type: 'metric',
            x: 12,
            y: 6,
            width: 12,
            height: 6,
            properties: {
              metrics: [
                [
                  'AWS/Lambda',
                  'Duration',
                  { stat: 'Average', label: 'Avg Duration' },
                ],
                [
                  '.',
                  'ConcurrentExecutions',
                  { stat: 'Maximum', label: 'Max Concurrent' },
                ],
              ],
              view: 'timeSeries',
              stacked: false,
              region: awsRegion,
              title: '⏱️ Lambda Performance',
              period: 3600,
              yAxis: {
                left: {
                  label: 'Milliseconds / Count',
                },
              },
            },
          },

          // Row 3: Queue Metrics
          {
            type: 'metric',
            x: 0,
            y: 12,
            width: 12,
            height: 6,
            properties: {
              metrics: [
                [
                  'AWS/SQS',
                  'NumberOfMessagesSent',
                  { stat: 'Sum', label: 'Messages Sent' },
                ],
                [
                  '.',
                  'NumberOfMessagesReceived',
                  { stat: 'Sum', label: 'Messages Received' },
                ],
                [
                  '.',
                  'ApproximateNumberOfMessagesVisible',
                  { stat: 'Average', label: 'Queue Depth' },
                ],
              ],
              view: 'timeSeries',
              stacked: false,
              region: awsRegion,
              title: '📨 SQS Queue Metrics',
              period: 300, // 5 minutes
            },
          },
          {
            type: 'metric',
            x: 12,
            y: 12,
            width: 12,
            height: 6,
            properties: {
              metrics: [
                [
                  'AWS/SQS',
                  'ApproximateNumberOfMessagesVisible',
                  { stat: 'Average', label: 'DLQ Depth' },
                ],
                [
                  '.',
                  'ApproximateAgeOfOldestMessage',
                  { stat: 'Maximum', label: 'Oldest Message Age' },
                ],
              ],
              view: 'timeSeries',
              stacked: false,
              region: awsRegion,
              title: '⚠️ Dead Letter Queue Health',
              period: 300,
            },
          },

          // Row 4: Log Insights and Cost Summary
          {
            type: 'log',
            x: 0,
            y: 18,
            width: 24,
            height: 6,
            properties: {
              query: `SOURCE '/aws/lambda/${stage}-EmailQueue'
              | SOURCE '/aws/lambda/${stage}-Web-server'
              | fields @timestamp, @message
              | filter @message like /error|ERROR|Error/
              | sort @timestamp desc
              | limit 20`,
              region: awsRegion,
              title: '🔍 Recent Errors Across All Lambdas',
              stacked: false,
            },
          },
        ],
      }),
    });

    console.log(
      `✓ CloudWatch cost monitoring dashboard created: ${stage}-cost-monitoring`,
    );
    console.log(
      `  View at: https://console.aws.amazon.com/cloudwatch/home?region=${awsRegion}#dashboards:name=${stage}-cost-monitoring`,
    );

    // CloudWatch Log Retention Policies
    // Set retention to prevent unlimited log storage costs
    // Development: 7 days, Production: 30 days
    const logRetentionDays = stage === 'production' ? 30 : 7;

    // Email Worker Lambda logs
    new aws.cloudwatch.LogGroup('EmailWorkerLogs', {
      name: `/aws/lambda/${stage}-EmailQueue`,
      retentionInDays: logRetentionDays,
      tags: {
        Environment: stage,
        Purpose: 'Email worker Lambda logs',
      },
    });

    // WebSocket Connect Lambda logs
    new aws.cloudwatch.LogGroup('WebSocketConnectLogs', {
      name: `/aws/lambda/${stage}-RealtimeWebSocket-connect`,
      retentionInDays: logRetentionDays,
      tags: {
        Environment: stage,
        Purpose: 'WebSocket connect handler logs',
      },
    });

    // WebSocket Disconnect Lambda logs
    new aws.cloudwatch.LogGroup('WebSocketDisconnectLogs', {
      name: `/aws/lambda/${stage}-RealtimeWebSocket-disconnect`,
      retentionInDays: logRetentionDays,
      tags: {
        Environment: stage,
        Purpose: 'WebSocket disconnect handler logs',
      },
    });

    // WebSocket Default Lambda logs
    new aws.cloudwatch.LogGroup('WebSocketDefaultLogs', {
      name: `/aws/lambda/${stage}-RealtimeWebSocket-default`,
      retentionInDays: logRetentionDays,
      tags: {
        Environment: stage,
        Purpose: 'WebSocket default handler logs',
      },
    });

    // Next.js Server Lambda logs
    new aws.cloudwatch.LogGroup('NextjsServerLogs', {
      name: `/aws/lambda/${stage}-Web-server`,
      retentionInDays: logRetentionDays,
      tags: {
        Environment: stage,
        Purpose: 'Next.js server function logs',
      },
    });

    console.log(
      `✓ CloudWatch log retention set to ${logRetentionDays} days for ${stage}`,
    );

    // ElastiCache Redis Cluster (optional, only if CACHE_PROVIDER=redis + USE_ELASTICACHE=true)
    // For Upstash or other managed Redis, just provide REDIS_URL in environment variables
    let redisEndpoint: string | undefined;

    if (
      process.env.CACHE_PROVIDER === 'redis' &&
      process.env.USE_ELASTICACHE === 'true'
    ) {
      // Cost optimization: Warn about ElastiCache costs for non-production stages
      if (stage !== 'production') {
        console.warn(
          `⚠️  ElastiCache costs ~$12-24/month even for low-traffic ${stage} environments`,
        );
        console.warn(
          `   💡 Consider using Upstash free tier (10K commands/day) instead:`,
        );
        console.warn(`      - Set REDIS_URL to your Upstash connection string`);
        console.warn(`      - Set USE_ELASTICACHE=false or remove it`);
        console.warn(`      - Saves $12-24/month for ${stage} environment`);
        console.warn(
          `   Proceeding with ElastiCache as explicitly requested...`,
        );
      }

      console.log(`🔄 Provisioning ElastiCache Redis cluster for ${stage}...`);

      // Validate VPC configuration
      const vpcId = process.env.VPC_ID;
      const subnetIds = process.env.SUBNET_IDS?.split(',').map((s) => s.trim());

      if (!vpcId || !subnetIds || subnetIds.length === 0) {
        console.error(
          '❌ ElastiCache requires VPC_ID and SUBNET_IDS environment variables',
        );
        throw new Error(
          'ElastiCache configuration incomplete: VPC_ID and SUBNET_IDS required',
        );
      }

      // Create security group for Redis
      const redisSecurityGroup = new aws.ec2.SecurityGroup(
        'RedisSecurityGroup',
        {
          vpcId,
          description: `Security group for ${stage} ElastiCache Redis`,
          ingress: [
            {
              protocol: 'tcp',
              fromPort: 6379,
              toPort: 6379,
              cidrBlocks: [process.env.VPC_CIDR || '10.0.0.0/16'],
              description: 'Allow Redis traffic from VPC',
            },
          ],
          egress: [
            {
              protocol: '-1',
              fromPort: 0,
              toPort: 0,
              cidrBlocks: ['0.0.0.0/0'],
              description: 'Allow all outbound traffic',
            },
          ],
          tags: {
            Name: `${stage}-redis-sg`,
            Environment: stage,
          },
        },
      );

      // Create ElastiCache subnet group
      const redisSubnetGroup = new aws.elasticache.SubnetGroup(
        'RedisSubnetGroup',
        {
          subnetIds,
          description: `Subnet group for ${stage} ElastiCache Redis`,
          tags: {
            Name: `${stage}-redis-subnet-group`,
            Environment: stage,
          },
        },
      );

      // Create ElastiCache Redis replication group
      const redis = new aws.elasticache.ReplicationGroup('AuthCache', {
        replicationGroupDescription: `Redis cache for ${stage} authorization and session management`,
        engine: 'redis',
        engineVersion: '7.1',
        nodeType:
          stage === 'production' ? 'cache.t4g.small' : 'cache.t4g.micro', // Production: ~$24/month, Dev: ~$12/month
        numCacheClusters: stage === 'production' ? 2 : 1, // Multi-AZ for production
        automaticFailoverEnabled: stage === 'production',
        atRestEncryptionEnabled: true, // Encrypt data at rest
        transitEncryptionEnabled: false, // Disable TLS for Lambda (VPC security sufficient)
        subnetGroupName: redisSubnetGroup.name,
        securityGroupIds: [redisSecurityGroup.id],
        snapshotRetentionLimit: stage === 'production' ? 7 : 0, // 7-day backup retention for production
        snapshotWindow: '03:00-05:00', // Backup window (UTC)
        maintenanceWindow: 'sun:05:00-sun:07:00', // Maintenance window (UTC)
        tags: {
          Name: `${stage}-redis`,
          Environment: stage,
          Purpose: 'Authorization and session caching',
        },
      });

      // Use primary endpoint for read/write
      redisEndpoint = redis.primaryEndpointAddress.apply((addr) => addr);

      console.log(`✓ ElastiCache Redis provisioned`);
      redis.primaryEndpointAddress.apply((endpoint) =>
        console.log(`  Endpoint: ${endpoint}:6379`),
      );
    } else if (
      process.env.CACHE_PROVIDER === 'redis' &&
      process.env.REDIS_URL
    ) {
      console.log(
        `✓ Using external Redis (Upstash or self-hosted): ${process.env.REDIS_URL.replace(/:[^:]*@/, ':****@')}`,
      );
    } else if (process.env.CACHE_PROVIDER === 'memory') {
      console.log(`✓ Using in-memory cache (no Redis provisioning needed)`);
    } else {
      console.log(
        `ℹ️  Cache provider not configured (defaulting to memory cache)`,
      );
    }

    // Output the application URL and resource info
    return {
      url: web.url,
      buckets: Object.fromEntries(
        Array.from(buckets.entries()).map(([name, bucket]) => [
          name,
          bucket.name,
        ]),
      ),
      queue: queue.url,
      emailDLQ: emailDLQ.url,
      websocket: websocket.url,
      connectionsTable: connectionsTable.name,
    };
  },
});
