import { headers } from 'next/headers';

import { initializeAuditTransformers } from '@kit/audit-logs/transformers';
import { Toaster } from '@kit/ui/sonner';

import { RootProviders } from '~/components/root-providers';
import {
  generateBrandingStyles,
  generateGoogleFontsLink,
} from '~/lib/branding-styles';
import { getFontsClassName } from '~/lib/fonts';
import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { generateRootMetadata } from '~/lib/root-metdata';
import { getRootTheme } from '~/lib/root-theme';

import '../styles/branding.css';
import '../styles/globals.css';

// Initialize audit transformers at app startup
initializeAuditTransformers();

export const generateMetadata = () => {
  return generateRootMetadata();
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { language } = await createI18nServerInstance();
  const theme = await getRootTheme();
  const className = getFontsClassName(theme);
  const nonce = await getCspNonce();
  const brandingStyles = generateBrandingStyles();
  const googleFontsUrl = generateGoogleFontsLink();

  // Get branding config for custom font URL
  const { getBrandingConfig } = await import('@kit/branding');
  const brandingConfig = getBrandingConfig();
  const customFontUrl = brandingConfig.logo.customFont?.url;

  return (
    <html lang={language} className={className}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link rel="stylesheet" href={googleFontsUrl} />
        {customFontUrl && <link rel="stylesheet" href={customFontUrl} />}
        <style dangerouslySetInnerHTML={{ __html: brandingStyles }} />
      </head>
      <body>
        <RootProviders theme={theme} lang={language} nonce={nonce}>
          {children}
        </RootProviders>

        <Toaster richColors={true} theme={theme} position="top-center" />
      </body>
    </html>
  );
}

async function getCspNonce() {
  const headersStore = await headers();

  return headersStore.get('x-nonce') ?? undefined;
}
