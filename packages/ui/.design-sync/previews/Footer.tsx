import Link from 'next/link';

import { Film, Twitter, Youtube } from 'lucide-react';

import { Footer } from '@kit/ui/marketing';

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-x-2 font-semibold">
      <Film className="h-5 w-5" />
      StoryBook
    </Link>
  );
}

export function Default() {
  return (
    <div className="max-w-3xl border-t">
      <Footer
        logo={<Logo />}
        description="The AI-powered film studio for content creators."
        copyright="© 2026 StoryBook. All rights reserved."
        sections={[
          {
            heading: 'Legal',
            links: [
              { href: '/terms-of-service', label: 'Terms of Service' },
              { href: '/privacy-policy', label: 'Privacy Policy' },
              { href: '/cookie-policy', label: 'Cookie Policy' },
            ],
          },
          {
            heading: 'Product',
            links: [
              { href: '/pricing', label: 'Pricing' },
              { href: '/docs', label: 'Documentation' },
            ],
          },
        ]}
      >
        <div className="mt-6 flex gap-4">
          <Link
            href="https://youtube.com/@storybook"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-red-500"
            aria-label="Subscribe to our YouTube channel"
          >
            <Youtube className="h-5 w-5" />
          </Link>
          <Link
            href="https://x.com/storybook"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-sky-500"
            aria-label="Follow us on X"
          >
            <Twitter className="h-5 w-5" />
          </Link>
        </div>
      </Footer>
    </div>
  );
}
