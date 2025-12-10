'use client';

import Link from 'next/link';

import { ArrowRight, Calendar, Film } from 'lucide-react';

import type { Episode } from '@kit/episodes/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

import { StatusBadge } from './status-badge';

interface EpisodeCardProps {
  episode: Episode;
  account: string;
  projectId: string;
}

export function EpisodeCard({ episode, account, projectId }: EpisodeCardProps) {
  const href = `/home/${account}/studio/${projectId}/episodes/${episode.id}`;

  return (
    <Link href={href}>
      <Card className="cursor-pointer transition-shadow hover:shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
              <Film className="text-primary h-5 w-5" />
            </div>
            <ArrowRight className="text-muted-foreground h-5 w-5" />
          </div>
          <div className="flex items-center gap-2">
            <CardTitle className="line-clamp-1">{episode.title}</CardTitle>
            <StatusBadge status={episode.status} />
          </div>
          <CardDescription className="line-clamp-2">
            {episode.description ?? `Episode ${episode.number}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground flex items-center gap-4 text-sm">
            <span className="font-medium">Ep. {episode.number}</span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {new Date(episode.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
