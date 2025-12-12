import withBundleAnalyzer from '@next/bundle-analyzer';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ENABLE_REACT_COMPILER = process.env.ENABLE_REACT_COMPILER === 'true';

const INTERNAL_PACKAGES = [
  '@kit/ui',
  '@kit/auth',
  '@kit/accounts',
  '@kit/admin',
  '@kit/team-accounts',
  '@kit/shared',
  '@kit/supabase',
  '@kit/i18n',
  '@kit/mailers',
  '@kit/billing-gateway',
  '@kit/email-templates',
  '@kit/database-webhooks',
  '@kit/cms',
  '@kit/monitoring',
  '@kit/next',
  '@kit/notifications',
];

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: INTERNAL_PACKAGES,
  // Enable standalone output for AWS Lambda deployment
  output: process.env.DEPLOY_TARGET === 'lambda' ? 'standalone' : undefined,
  webpack: (config, { isServer, webpack }) => {
    if (isServer) {
      // TODO: Investigate and fix build hanging issue
      // Disabling module concatenation temporarily resolves build hangs on Node.js 24
      // This may impact bundle size optimization
      // Related: OpenNext compatibility with Next.js 15 + Node.js 24
      config.optimization.concatenateModules = false;

      // Replace DEPLOY_TARGET at build time for tree-shaking
      config.plugins.push(
        new webpack.DefinePlugin({
          'process.env.DEPLOY_TARGET': JSON.stringify(
            process.env.DEPLOY_TARGET || '',
          ),
        }),
      );
    }
    return config;
  },
  images: {
    remotePatterns: getRemotePatterns(),
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  serverExternalPackages: [
    '@aws-sdk/client-s3',
    '@aws-sdk/client-sqs',
    '@aws-sdk/client-lambda',
    '@aws-sdk/lib-storage',
    '@aws-sdk/s3-request-presigner',
    'ws',
  ],
  // needed for supporting dynamic imports for local content
  outputFileTracingIncludes: {
    '/*': ['./content/**/*'],
  },
  // Exclude development tools from Lambda bundle tracing
  outputFileTracingExcludes: {
    '*': [
      'node_modules/@swc/core-*/**',
      'node_modules/webpack/**',
      'node_modules/terser/**',
    ],
  },
  redirects: getRedirects,
  turbopack: {
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx'],
    resolveAlias: getModulesAliases(),
  },
  devIndicators:
    process.env.NEXT_PUBLIC_CI === 'true'
      ? false
      : {
        position: 'bottom-right',
      },
  experimental: {
    mdxRs: true,
    reactCompiler: ENABLE_REACT_COMPILER,
    clientSegmentCache: true,
  },
  modularizeImports: {
    lodash: {
      transform: 'lodash/{{member}}',
    },
  },
  /** We already do linting and typechecking as separate tasks in CI */
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
})(config);

function getRemotePatterns() {
  /** @type {import('next').NextConfig['remotePatterns']} */
  const remotePatterns = [];

  if (SUPABASE_URL) {
    const hostname = new URL(SUPABASE_URL).hostname;

    remotePatterns.push({
      protocol: 'https',
      hostname,
    });
  }

  return IS_PRODUCTION
    ? remotePatterns
    : [
      {
        protocol: 'http',
        hostname: '127.0.0.1',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
    ];
}

async function getRedirects() {
  return [
    {
      source: '/server-sitemap.xml',
      destination: '/sitemap.xml',
      permanent: true,
    },
  ];
}

/**
 * @description Aliases modules based on the environment variables
 * This will speed up the development server by not loading the modules that are not needed
 * @returns {Record<string, string>}
 */
function getModulesAliases() {
  if (process.env.NODE_ENV !== 'development') {
    return {};
  }

  const monitoringProvider = process.env.NEXT_PUBLIC_MONITORING_PROVIDER;
  const billingProvider = process.env.NEXT_PUBLIC_BILLING_PROVIDER;
  const mailerProvider = process.env.MAILER_PROVIDER;
  const captchaProvider = process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY;

  // exclude the modules that are not needed
  const excludeSentry = monitoringProvider !== 'sentry';
  const excludeStripe = billingProvider !== 'stripe';
  const excludeNodemailer = mailerProvider !== 'nodemailer';
  const excludeTurnstile = !captchaProvider;

  /** @type {Record<string, string>} */
  const aliases = {};

  // the path to the noop module
  const noopPath = '~/lib/dev-mock-modules';

  if (excludeSentry) {
    aliases['@sentry/nextjs'] = noopPath;
  }

  if (excludeStripe) {
    aliases['stripe'] = noopPath;
    aliases['@stripe/stripe-js'] = noopPath;
  }

  if (excludeNodemailer) {
    aliases['nodemailer'] = noopPath;
  }

  if (excludeTurnstile) {
    aliases['@marsidev/react-turnstile'] = noopPath;
  }

  return aliases;
}
