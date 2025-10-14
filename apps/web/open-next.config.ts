/**
 * OpenNext Configuration
 *
 * This configuration customizes how Next.js is adapted for AWS Lambda.
 * It's optional - if omitted, OpenNext will use sensible defaults.
 *
 * @see https://opennext.js.org/aws/config/reference
 */
const config = {
  default: {
    // Lambda configuration for main server
    override: {
      wrapper: 'aws-lambda-streaming',
      // Use Node.js 20 runtime
      runtime: 'node',
      // Architecture (arm64 is more cost-effective)
      architecture: 'arm64',
      // Optimize memory for smaller bundle
      memorySize: 1024,
    },
  },

  // Middleware configuration
  // Set external to false to bundle with server function (avoids Lambda@Edge)
  middleware: {
    external: false,
  },

  // Image optimization configuration
  imageOptimization: {
    // Use AWS Lambda for image optimization
    override: {
      wrapper: 'aws-lambda',
      runtime: 'node',
      // Increase memory for image processing
      memorySize: 1536,
    },
  },

  // ISR (Incremental Static Regeneration) configuration
  revalidate: {
    // Use SQS queue for revalidation
    override: {
      wrapper: 'aws-lambda',
      runtime: 'node',
    },
  },

  // Warmer configuration to reduce cold starts
  warmer: {
    invokeFunction: 'aws-lambda',
  },

  // Dangerous options (use with caution)
  dangerous: {
    // Enable minification for production to reduce bundle size
    disableMinification: false,
  },
};

export default config;
