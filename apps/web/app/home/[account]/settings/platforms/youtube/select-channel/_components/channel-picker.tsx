'use client';

import { useState, useTransition } from 'react';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

import { Check, Loader2, Youtube } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';

interface Channel {
  id: string;
  title: string;
  thumbnailUrl?: string;
  subscriberCount?: string;
}

interface ChannelPickerProps {
  channels: Channel[];
  accountSlug: string;
}

export function ChannelPicker({ channels, accountSlug }: ChannelPickerProps) {
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSelectChannel = (channelId: string) => {
    setSelectedChannelId(channelId);
  };

  const handleConnect = () => {
    if (!selectedChannelId) {
      toast.error('Please select a channel');
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch('/api/platforms/youtube/save-channel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId: selectedChannelId }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Failed to connect channel');
        }

        const data = await response.json();
        toast.success(`Connected ${data.channelName}!`);
        router.push(
          `/home/${accountSlug}/settings/platforms?success=youtube_connected&channel=${encodeURIComponent(data.channelName)}`,
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to connect channel',
        );
      }
    });
  };

  const formatSubscribers = (count?: string) => {
    if (!count) return '';
    const num = parseInt(count, 10);
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M subscribers`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K subscribers`;
    return `${num} subscribers`;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3">
        {channels.map((channel) => (
          <Card
            key={channel.id}
            className={`cursor-pointer transition-all ${
              selectedChannelId === channel.id
                ? 'ring-2 ring-primary'
                : 'hover:border-primary/50'
            }`}
            onClick={() => handleSelectChannel(channel.id)}
          >
            <CardContent className="flex items-center gap-4 p-4">
              {channel.thumbnailUrl ? (
                <Image
                  src={channel.thumbnailUrl}
                  alt={channel.title}
                  width={48}
                  height={48}
                  className="rounded-full"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  <Youtube className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1">
                <div className="font-medium">{channel.title}</div>
                {channel.subscriberCount && (
                  <div className="text-sm text-muted-foreground">
                    {formatSubscribers(channel.subscriberCount)}
                  </div>
                )}
              </div>
              {selectedChannelId === channel.id && (
                <Check className="h-5 w-5 text-primary" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Button
        className="w-full"
        size="lg"
        disabled={!selectedChannelId || isPending}
        onClick={handleConnect}
      >
        {isPending ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Connecting...
          </>
        ) : (
          'Connect Selected Channel'
        )}
      </Button>
    </div>
  );
}
