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
  images: {
    remotePatterns: getRemotePatterns(),
  },
  logging: {
    fetches: {
      fullUrl: true,
    },
  },
  serverExternalPackages: [],
  // needed for supporting dynamic imports for local content
  outputFileTracingIncludes: {
    '/*': ['./content/**/*'],
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
    optimizePackageImports: [
      'recharts',
      'lucide-react',
      '@radix-ui/react-icons',
      '@radix-ui/react-avatar',
      '@radix-ui/react-select',
      'date-fns',
      ...INTERNAL_PACKAGES,
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
