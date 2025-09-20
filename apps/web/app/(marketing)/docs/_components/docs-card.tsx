import Link from 'next/link';

import { ChevronRight } from 'lucide-react';

import { Trans } from '@kit/ui/trans';

export function DocsCard({
  title,
  subtitle,
  children,
  link,
}: React.PropsWithChildren<{
  title: string;
  subtitle?: string | null;
  link: { url: string; label?: string };
}>) {
  return (
    <div className="flex flex-col">
      <div
        className={`bg-background flex grow flex-col gap-y-2 border p-6 ${link ? 'rounded-t-lg border-b-0' : 'rounded-lg'}`}
      >
        <h3 className="mt-0 text-lg font-semibold hover:underline dark:text-white">
          <Link href={link.url}>{title}</Link>
        </h3>

        {subtitle && (
          <div className="text-muted-foreground text-sm">
            <p dangerouslySetInnerHTML={{ __html: subtitle }}></p>
          </div>
        )}

        {children && <div className="text-sm">{children}</div>}
      </div>

      {link && (
        <div className="bg-muted/50 rounded-b-lg border p-6 py-4">
          <Link
            className={
              'flex items-center space-x-2 text-sm font-medium hover:underline'
            }
            href={link.url}
          >
            <span>
              {link.label ?? <Trans i18nKey={'marketing:readMore'} />}
            </span>

            <ChevronRight className={'h-4'} />
          </Link>
        </div>
      )}
    </div>
  );
}
