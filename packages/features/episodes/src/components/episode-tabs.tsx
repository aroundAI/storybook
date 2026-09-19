'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

import { BookOpen, Music, Scissors, Share2, Video } from 'lucide-react';

import { Trans } from '@kit/ui/trans';
import { cn } from '@kit/ui/utils';

const iconClasses = 'h-4 w-4';

const EPISODE_TABS = [
  { labelKey: 'studio:episodeTabs.story', segment: 'story', icon: BookOpen },
  { labelKey: 'studio:episodeTabs.visual', segment: 'visual', icon: Video },
  { labelKey: 'studio:episodeTabs.audio', segment: 'audio', icon: Music },
  { labelKey: 'studio:episodeTabs.edit', segment: 'edit', icon: Scissors },
  { labelKey: 'studio:episodeTabs.publish', segment: 'publish', icon: Share2 },
] as const;

/**
 * Episode workspace tabs for navigating between Story, Visual, Audio, Edit, and Publish sections.
 * Renders a horizontal tab bar with icons and active state highlighting.
 *
 * @example
 * ```tsx
 * // In episode layout or page
 * <EpisodeTabs />
 * ```
 */
export function EpisodeTabs() {
  const pathname = usePathname() ?? '';
  const params = useParams<{
    account: string;
    projectId: string;
    episodeId: string;
  }>() ?? { account: '', projectId: '', episodeId: '' };

  const basePath = `/home/${params?.account ?? ''}/studio/${params?.projectId ?? ''}/episodes/${params?.episodeId ?? ''}`;

  return (
    <div className="border-b">
      <nav className="flex gap-1 px-4" aria-label="Episode sections">
        {EPISODE_TABS.map((tab) => {
          const href = `${basePath}/${tab.segment}`;
          const Icon = tab.icon;
          const isActive =
            pathname.endsWith(tab.segment) ||
            (tab.segment === 'story' && pathname === basePath);

          return (
            <Link
              key={tab.segment}
              href={href}
              className={cn(
                'flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className={iconClasses} />
              <Trans i18nKey={tab.labelKey} />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
