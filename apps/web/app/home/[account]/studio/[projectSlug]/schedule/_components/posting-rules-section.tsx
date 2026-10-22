'use client';

import { useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { CalendarClock, Pencil } from 'lucide-react';

import { ChannelPostingRulesDialog } from '@kit/publishing/components';
import { PLATFORM_NAMES, isPlatform } from '@kit/publishing/lib/platforms';
import {
  type CadenceSummaryInput,
  cadenceSummary,
} from '@kit/publishing/lib/schedule-view';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';

import { YouTubeLeadForm } from './youtube-lead-form';

export interface PostingRulesChannel {
  id: string;
  name: string;
  platform: string;
  cadences: CadenceSummaryInput[];
}

/**
 * FILM-2211. Each of the project's channels with how it posts, in one line,
 * and the dialog the Publish screen opens to change it.
 */
export function PostingRulesSection(props: {
  channels: PostingRulesChannel[];
  platformsHref: string;
  /** KB-214: the project's YouTube upload lead time, for its form */
  youtubeLead: { projectId: string; minutes: number } | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<PostingRulesChannel | null>(null);

  return (
    <Card data-test="posting-rules-section">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4" />
          Posting rules
        </CardTitle>
        <CardDescription>
          A channel&apos;s rules apply to every project and episode that posts
          to it.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {props.channels.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-test="posting-rules-no-channels"
          >
            This project posts to no channels yet.{' '}
            <Link href={props.platformsHref} className="underline">
              Choose its channels
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y">
            {props.channels.map((channel) => (
              <li
                key={channel.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
                data-test="posting-rules-channel"
                data-connection-id={channel.id}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {channel.name}{' '}
                    <span className="font-normal text-muted-foreground">
                      {isPlatform(channel.platform)
                        ? PLATFORM_NAMES[channel.platform]
                        : channel.platform}
                    </span>
                  </p>
                  <p
                    className="text-sm text-muted-foreground"
                    data-test="posting-rules-summary"
                  >
                    {cadenceSummary(channel.cadences, channel.platform)}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(channel)}
                  data-test="posting-rules-edit"
                  aria-label={`Edit the posting rules for ${channel.name}`}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}

        {props.youtubeLead &&
          props.channels.some((channel) => channel.platform === 'youtube') && (
            <YouTubeLeadForm
              projectId={props.youtubeLead.projectId}
              youtubeLeadMinutes={props.youtubeLead.minutes}
            />
          )}
      </CardContent>

      {editing && (
        <ChannelPostingRulesDialog
          channel={{
            id: editing.id,
            name: editing.name,
            platform: editing.platform,
          }}
          onSaved={() => {
            toast.success('Posting rules saved.');
            router.refresh();
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  );
}
