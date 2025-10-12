/**
 * OpenNext configuration for AWS Lambda deployment
 * This enables deploying Next.js to AWS using Lambda functions
 *
 * Install: pnpm add -D open-next@latest
 *
 * @see https://open-next.js.org/
 */
const config = {
  default: {
    // Use streaming for better performance
    streaming: {
      // Convert Lambda responses to streaming responses
      convertTo: 'stream',
    },
    // Override Lambda function configuration
    override: {
      wrapper: 'aws-lambda-streaming',
      // Increase memory for better performance
      queue: 'sqs',
    },
  },

  // Separate Lambda functions for different route types
  functions: {
    // API routes get their own function with higher timeout
    api: {
      routes: ['api/*'],
      // patterns: ['api/*'],
      runtime: 'node',
      override: {
        wrapper: 'aws-lambda-streaming',
      },
    },

    // Image optimization gets dedicated function
    imageOptimization: {
      // separate function for image optimization
      runtime: 'node',
    },
  },

  // Configure middleware
  middleware: {
    external: true,
    // Run middleware at edge locations
    originResolver: {
      // Use CloudFront edge locations
      name: 'cloudfront',
    },
  },

  // Build options
  buildCommand: 'pnpm build',
  packageJsonPath: './package.json',
  appPath: './',
  buildOutput: '.open-next',
};

export default config;
