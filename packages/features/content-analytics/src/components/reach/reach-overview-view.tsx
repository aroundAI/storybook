import Link from 'next/link';

import type { AnalyticsPlatform } from '@kit/clickhouse';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import {
  type Counts,
  type Measured,
  REACH_WINDOWS,
  type ReachWindow,
} from '../../lib/reach-overview';
import type {
  ChannelReach,
  PostRow,
  ReachOverview,
} from '../../server/reach-overview';
import { ReachHistoryChart } from './reach-history-chart';

export type ReachTab = 'all' | AnalyticsPlatform;
export type ReachView = 'channel' | 'posts';

const PLATFORM_LABEL: Record<AnalyticsPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
};

interface ReachOverviewViewProps {
  overview: ReachOverview;
  tab: ReachTab;
  view: ReachView;
  basePath: string;
}

/**
 * The cross-platform reach page (design approved 2026-09-28). Views,
 * comments and shares add up, so the All tab totals them. Accounts reached
 * does not: it is shown per channel, side by side, and never totalled.
 */
export function ReachOverviewView({
  overview,
  tab,
  view,
  basePath,
}: ReachOverviewViewProps) {
  const href = (next: Partial<{ tab: ReachTab; view: ReachView; window: ReachWindow }>) => {
    const params = new URLSearchParams({
      tab: next.tab ?? tab,
      view: next.view ?? view,
      window: String(next.window ?? overview.window),
    });
    return `${basePath}?${params.toString()}`;
  };

  const inTab = (platform: AnalyticsPlatform) =>
    tab === 'all' || platform === tab;

  return (
    <div className="flex flex-col gap-6" data-test="reach-overview">
      <div className="flex flex-wrap items-center gap-4">
        <Segments
          label="Platform"
          items={[
            { key: 'all', label: 'All platforms' },
            ...overview.platforms.map((platform) => ({
              key: platform,
              label: PLATFORM_LABEL[platform],
            })),
          ]}
          active={tab}
          href={(key) => href({ tab: key as ReachTab })}
          testPrefix="reach-tab"
        />
        <Segments
          label="Show"
          items={[
            { key: 'channel', label: 'Channel' },
            { key: 'posts', label: 'Posts' },
          ]}
          active={view}
          href={(key) => href({ view: key as ReachView })}
          testPrefix="reach-view"
        />
        <Segments
          label="Window"
          items={REACH_WINDOWS.map((days) => ({
            key: String(days),
            label: `${days} days`,
          }))}
          active={String(overview.window)}
          href={(key) => href({ window: Number(key) as ReachWindow })}
          testPrefix="reach-window"
        />
      </div>

      <p className="text-muted-foreground text-sm" data-test="reach-range">
        {overview.from} to {overview.to}. Views, comments and shares count
        posts published through Storybook only.
      </p>

      {view === 'channel' ? (
        <ChannelView overview={overview} tab={tab} inTab={inTab} />
      ) : (
        <PostsView
          posts={overview.posts.filter((post) => inTab(post.platform))}
        />
      )}
    </div>
  );
}

function Segments(props: {
  label: string;
  items: Array<{ key: string; label: string }>;
  active: string;
  href: (key: string) => string;
  testPrefix: string;
}) {
  return (
    <nav aria-label={props.label} className="flex rounded-md border p-0.5">
      {props.items.map((item) => (
        <Link
          key={item.key}
          href={props.href(item.key)}
          data-test={`${props.testPrefix}-${item.key}`}
          aria-current={item.key === props.active ? 'page' : undefined}
          className={cn(
            'rounded px-3 py-1 text-sm',
            item.key === props.active
              ? 'bg-primary text-primary-foreground'
              : 'hover:bg-muted',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function ChannelView({
  overview,
  tab,
  inTab,
}: {
  overview: ReachOverview;
  tab: ReachTab;
  inTab: (platform: AnalyticsPlatform) => boolean;
}) {
  const platformCounts = overview.counts.byPlatform.filter((row) =>
    inTab(row.platform),
  );
  const shown: Counts =
    tab === 'all'
      ? overview.counts.total
      : (platformCounts[0] ?? { views: 0, comments: 0, shares: 0 });
  const channels = overview.channels.filter((channel) =>
    inTab(channel.platform),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 md:grid-cols-3">
        {(['views', 'comments', 'shares'] as const).map((metric) => (
          <Card key={metric} data-test={`reach-count-${metric}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium capitalize">
                {metric}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold" data-test="reach-count-value">
                {shown[metric].toLocaleString('en-US')}
              </div>
              {tab === 'all' && platformCounts.length > 0 ? (
                <ul className="text-muted-foreground mt-2 text-xs">
                  {platformCounts.map((row) => (
                    <li key={row.platform}>
                      {PLATFORM_LABEL[row.platform]}:{' '}
                      {row[metric].toLocaleString('en-US')}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Accounts reached</h2>
        <p className="text-muted-foreground text-sm">
          Different accounts that saw anything from each channel in the last{' '}
          {overview.window} days. Never added across channels or platforms: the
          same person would be counted more than once.
        </p>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => (
            <ChannelReachCard
              key={channel.connectionId}
              channel={channel}
              detailed={tab !== 'all'}
            />
          ))}
          {channels.length === 0 ? (
            <p className="text-muted-foreground text-sm">No connected channels.</p>
          ) : null}
        </div>
      </section>

      <ReachHistoryChart
        window={overview.window}
        series={channels.flatMap((channel) =>
          channel.reach.measured && channel.reach.value.history.length > 0
            ? [
                {
                  key: channel.connectionId,
                  label: `${channel.name} (${PLATFORM_LABEL[channel.platform]})`,
                  points: channel.reach.value.history.map((day) => ({
                    asOf: day.asOf,
                    value: day.accountsReached,
                  })),
                },
              ]
            : [],
        )}
      />
    </div>
  );
}

function ChannelReachCard({
  channel,
  detailed,
}: {
  channel: ChannelReach;
  detailed: boolean;
}) {
  const latest = channel.reach.measured ? channel.reach.value.latest : null;

  return (
    <Card data-test={`channel-reach-${channel.connectionId}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          {channel.name}{' '}
          <span className="text-muted-foreground font-normal">
            · {PLATFORM_LABEL[channel.platform]}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {channel.reach.measured ? (
          <>
            <div className="text-2xl font-semibold" data-test="channel-reach-value">
              {latest?.accountsReached != null
                ? latest.accountsReached.toLocaleString('en-US')
                : 'No figure yet'}
            </div>
            <p className="text-muted-foreground text-xs">
              {latest
                ? `As of ${latest.asOf}.`
                : 'Nothing recorded for this window yet; the nightly sync records it.'}
            </p>
            {detailed && latest ? (
              <p className="text-xs" data-test="channel-reach-split">
                Followers: {formatNullable(latest.followers)} · Not following:{' '}
                {formatNullable(latest.nonFollowers)}
              </p>
            ) : null}
          </>
        ) : (
          <NotMeasured reason={channel.reach.reason} test="channel-reach-reason" />
        )}
        {channel.newAccounts ? (
          <p className="text-sm" data-test="channel-new-accounts">
            New in the last 7 days (not seen in the 23 before):{' '}
            <strong>{formatMeasured(channel.newAccounts)}</strong>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function PostsView({ posts }: { posts: PostRow[] }) {
  if (posts.length === 0) {
    return (
      <p className="text-muted-foreground text-sm" data-test="reach-posts-empty">
        No published posts in this view.
      </p>
    );
  }

  return (
    <Table data-test="reach-posts">
      <TableHeader>
        <TableRow>
          <TableHead>Post</TableHead>
          <TableHead>Platform</TableHead>
          <TableHead className="text-right">Views</TableHead>
          <TableHead className="text-right">Comments</TableHead>
          <TableHead className="text-right">Shares</TableHead>
          <TableHead className="text-right">New accounts</TableHead>
          <TableHead className="text-right">Lifetime reach</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {posts.map((post) => (
          <TableRow key={post.id} data-test="reach-post-row">
            <TableCell>{post.title}</TableCell>
            <TableCell>{PLATFORM_LABEL[post.platform]}</TableCell>
            {(['views', 'comments', 'shares'] as const).map((metric) => (
              <TableCell key={metric} className="text-right">
                {post.counts ? post.counts[metric].toLocaleString('en-US') : '—'}
              </TableCell>
            ))}
            <TableCell className="text-right" data-test="reach-post-new">
              <MeasuredCell value={post.newAccounts} />
            </TableCell>
            <TableCell className="text-right" data-test="reach-post-lifetime">
              <MeasuredCell value={post.lifetimeReach} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MeasuredCell({ value }: { value: Measured<number | null> }) {
  return value.measured ? (
    <>{formatNullable(value.value)}</>
  ) : (
    <span className="text-muted-foreground" title={value.reason}>
      Not measured
    </span>
  );
}

function NotMeasured({ reason, test }: { reason: string; test: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground text-lg font-medium">Not measured</div>
      <p className="text-muted-foreground text-xs" data-test={test}>
        {reason}
      </p>
    </div>
  );
}

function formatNullable(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function formatMeasured(value: Measured<number | null>): string {
  return value.measured ? formatNullable(value.value) : 'Not measured';
}
