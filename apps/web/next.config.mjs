import withBundleAnalyzer from '@next/bundle-analyzer';
import { execSync } from 'child_process';

const getGitInfo = () => {
  try {
    const commit = execSync('git rev-parse HEAD').toString().trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD')
      .toString()
      .trim();
    const tag = execSync('git describe --tags --always').toString().trim();
    const date = execSync('git show -s --format=%cd HEAD').toString().trim();
    const author = execSync('git show -s --format="%an" HEAD')
      .toString()
      .trim();

    return { commit, branch, tag, date, author };
  } catch {
    return {
      commit: 'unknown',
      branch: 'unknown',
      tag: 'unknown',
      date: 'unknown',
      author: 'unknown',
    };
  }
};

const gitInfo = getGitInfo();
const buildDate = new Date().toUTCString();

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
  '@kit/llm',
  '@kit/generation',
  '@kit/content-analytics',
  '@kit/jobs',
  '@kit/storage',
];

/** @type {import('next').NextConfig} */
const config = {
  env: {
    NEXT_PUBLIC_BUILD_COMMIT: gitInfo.commit,
    NEXT_PUBLIC_BUILD_BRANCH: gitInfo.branch,
    NEXT_PUBLIC_BUILD_RELEASE_TAG: gitInfo.tag,
    NEXT_PUBLIC_BUILD_DATE: buildDate,
    NEXT_PUBLIC_BUILD_AUTHOR: gitInfo.author,
  },
  reactStrictMode: true,
  /** Enables hot reloading for local packages without a build step */
  transpilePackages: INTERNAL_PACKAGES,
  // Enable standalone output for AWS Lambda deployment
  output: process.env.DEPLOY_TARGET === 'lambda' ? 'standalone' : undefined,
  compress: process.env.DEPLOY_TARGET === 'lambda' ? false : true,
  webpack: (config, { isServer, webpack }) => {
    // Warnings from third-party packages we do not control and cannot fix
    // at source. Each is benign in this deployment; keeping the build output
    // clean means a genuine new warning is actually noticeable.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      // OpenTelemetry (via Sentry) resolves instrumentation modules with a
      // computed require, which webpack cannot statically analyse. The
      // packages are hoisted in .npmrc so resolution works at runtime.
      {
        module: /@opentelemetry\/instrumentation/,
        message:
          /Critical dependency: the request of a dependency is an expression/,
      },
      // supabase-js reads process.version(s) for its runtime check. The
      // middleware only ever uses the browser client path, so the Edge
      // runtime never reaches that code.
      {
        module: /@supabase\/(realtime-js|supabase-js)/,
        message: /A Node\.js API is used \(process\.versions?/,
      },
    ];

    // Webpack's filesystem cache logs a perf hint when it serialises its own
    // large build manifests. It says nothing about our code and cannot be
    // fixed from here; the cache is kept because the deploy builds twice and
    // the second build reuses it. Infrastructure logs are dropped to errors
    // in production only — compilation warnings use a different channel and
    // still surface.
    if (process.env.NODE_ENV === 'production') {
      config.infrastructureLogging = {
        ...config.infrastructureLogging,
        level: 'error',
      };
    }

    if (isServer) {
      // Module concatenation re-enabled on Node.js 25+ (was disabled for Node.js 24 build hangs)
      // If build hangs recur, set config.optimization.concatenateModules = false;

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
    formats: ['image/avif', 'image/webp'],
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
    // Local-first job queue packages
    'node-cron',
    'sharp',
    'bullmq',
    'ioredis',
    '@react-pdf/renderer',
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
  headers: getHeaders,
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
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      'recharts',
      'date-fns',
      'react-hook-form',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tooltip',
      'radix-ui',
      '@tanstack/react-table',
      '@tanstack/react-query',
      '@supabase/supabase-js',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
    ],
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

  remotePatterns.push({
    protocol: 'https',
    hostname: 'images.unsplash.com',
  });

  // Cloudflare R2 public bucket for project assets
  // Allow all R2 public bucket subdomains (pub-*.r2.dev)
  remotePatterns.push({
    protocol: 'https',
    hostname: '*.r2.dev',
  });

  return IS_PRODUCTION
    ? remotePatterns
    : [
        ...remotePatterns, // Include R2 patterns in development too
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
  return [];
}

/**
 * HTTP Cache-Control headers for performance
 * - Static assets: Cache forever (fingerprinted by Next.js)
 * - Manifest/icons: Cache 1 day, revalidate 1 week at CDN
 * - API routes: No cache
 */
async function getHeaders() {
  return [
    // Static assets - cache forever (fingerprinted)
    {
      source: '/_next/static/:path*',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
      ],
    },
    // Manifest - cache 1 hour browser, 1 day CDN
    {
      source: '/manifest.webmanifest',
      headers: [
        { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=86400' },
      ],
    },
    // Apple touch icons and favicons - cache 1 day browser, 1 week CDN
    {
      source: '/images/favicon/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=86400, s-maxage=604800',
        },
      ],
    },
    // Public images - cache 1 day browser, 1 week CDN
    {
      source: '/images/:path*',
      headers: [
        {
          key: 'Cache-Control',
          value: 'public, max-age=86400, s-maxage=604800',
        },
      ],
    },
    // API routes - no cache by default
    {
      source: '/api/:path*',
      headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
    },
    // Security headers
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-XSS-Protection', value: '1; mode=block' },
      ],
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
