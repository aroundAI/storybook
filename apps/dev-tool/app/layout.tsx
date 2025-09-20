import type { Metadata } from 'next';

import { DevToolLayout } from '@/components/app-layout';
import { RootProviders } from '@/components/root-providers';

import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Makerkit | Dev Tool',
  description: 'The dev tool for Makerkit',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <RootProviders>
          <DevToolLayout>{children}</DevToolLayout>
        </RootProviders>
      </body>
    </html>
  );
}
