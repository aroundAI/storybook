# FILM-714: Twitter/X Provider

## Metadata
- **Phase:** 7 - Publishing
- **Priority:** P2 (Future Enhancement)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-708 (Publish Hub), OAuth Infrastructure
- **Blocks:** None

---

## Context

Twitter/X supports video publishing up to 2 minutes 20 seconds (140 seconds for free, longer for premium). Integrating Twitter allows creators to share short clips and teasers to drive traffic to their main content on YouTube/TikTok.

---

## Specification

### Requirements

1. **OAuth 2.0 Integration**: Connect Twitter accounts via OAuth
2. **Video Upload**: Upload videos up to 2:20 (or longer for premium)
3. **Tweet Composition**: Craft tweets with hashtags and mentions
4. **Thread Support**: Create tweet threads for longer content
5. **Scheduling**: Schedule tweets for optimal posting times
6. **Analytics Integration**: Track tweet performance metrics

### Platform Limits

```typescript
// packages/features/publishing/src/providers/twitter/limits.ts

export const TWITTER_LIMITS = {
  video: {
    maxDuration: 140, // seconds (free tier)
    maxDurationPremium: 240, // 4 minutes for premium
    maxSize: 512 * 1024 * 1024, // 512 MB
    supportedFormats: ['mp4', 'mov'],
    aspectRatios: ['16:9', '9:16', '1:1'],
  },
  tweet: {
    maxLength: 280,
    maxHashtags: 30, // Recommended max
    maxMentions: 10,
    maxMediaPerTweet: 4,
  },
  thread: {
    maxTweets: 25,
  },
  scheduling: {
    maxFutureTime: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
};
```

### Provider Implementation

```typescript
// packages/features/publishing/src/providers/twitter/twitter-provider.ts

import { PublishingProvider, PublishInput, PublishResult, PlatformConnection } from '../types';
import { TWITTER_LIMITS } from './limits';

export class TwitterProvider implements PublishingProvider {
  name = 'twitter';
  private apiKey: string;
  private apiSecret: string;
  private baseUrl = 'https://api.twitter.com/2';

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  async publish(input: PublishInput, connection: PlatformConnection): Promise<string> {
    // Validate video duration
    if (input.video.duration > TWITTER_LIMITS.video.maxDuration) {
      throw new Error(`Video too long. Maximum ${TWITTER_LIMITS.video.maxDuration} seconds.`);
    }

    // Step 1: Upload media
    const mediaId = await this.uploadMedia(input.video.url, connection);

    // Step 2: Create tweet with media
    const tweetId = await this.createTweet({
      text: input.metadata.description,
      mediaIds: [mediaId],
    }, connection);

    return tweetId;
  }

  private async uploadMedia(videoUrl: string, connection: PlatformConnection): Promise<string> {
    // Twitter uses chunked upload for large files
    const initResponse = await fetch(`${this.baseUrl}/media/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: 'INIT',
        media_type: 'video/mp4',
        media_category: 'tweet_video',
      }),
    });

    const { media_id_string } = await initResponse.json();

    // Download and upload video in chunks
    const videoBlob = await fetch(videoUrl).then((r) => r.blob());
    const chunkSize = 5 * 1024 * 1024; // 5MB chunks
    let offset = 0;

    while (offset < videoBlob.size) {
      const chunk = videoBlob.slice(offset, offset + chunkSize);
      await this.uploadChunk(media_id_string, chunk, offset / chunkSize, connection);
      offset += chunkSize;
    }

    // Finalize upload
    await fetch(`${this.baseUrl}/media/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        command: 'FINALIZE',
        media_id: media_id_string,
      }),
    });

    // Wait for processing
    await this.waitForProcessing(media_id_string, connection);

    return media_id_string;
  }

  private async createTweet(
    params: { text: string; mediaIds: string[] },
    connection: PlatformConnection
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/tweets`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${connection.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: params.text,
        media: { media_ids: params.mediaIds },
      }),
    });

    const data = await response.json();
    return data.data.id;
  }

  async getStatus(contentId: string, connection: PlatformConnection): Promise<PublishResult> {
    const response = await fetch(
      `${this.baseUrl}/tweets/${contentId}?tweet.fields=public_metrics`,
      {
        headers: { 'Authorization': `Bearer ${connection.accessToken}` },
      }
    );

    const data = await response.json();

    return {
      status: 'published',
      platformUrl: `https://twitter.com/i/status/${contentId}`,
      metrics: {
        views: data.data.public_metrics.impression_count,
        likes: data.data.public_metrics.like_count,
        comments: data.data.public_metrics.reply_count,
        shares: data.data.public_metrics.retweet_count + data.data.public_metrics.quote_count,
      },
    };
  }

  async delete(contentId: string, connection: PlatformConnection): Promise<void> {
    await fetch(`${this.baseUrl}/tweets/${contentId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${connection.accessToken}` },
    });
  }

  getAuthUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.apiKey,
      redirect_uri: redirectUri,
      scope: 'tweet.read tweet.write users.read offline.access',
      state,
      code_challenge: 'challenge', // PKCE
      code_challenge_method: 'plain',
    });
    return `https://twitter.com/i/oauth2/authorize?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<TokenResponse> {
    const response = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${this.apiKey}:${this.apiSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: 'challenge', // PKCE
      }),
    });

    return response.json();
  }

  private async waitForProcessing(mediaId: string, connection: PlatformConnection): Promise<void> {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes max

    while (attempts < maxAttempts) {
      const response = await fetch(
        `${this.baseUrl}/media/upload?command=STATUS&media_id=${mediaId}`,
        {
          headers: { 'Authorization': `Bearer ${connection.accessToken}` },
        }
      );

      const data = await response.json();

      if (data.processing_info?.state === 'succeeded') {
        return;
      }

      if (data.processing_info?.state === 'failed') {
        throw new Error('Video processing failed');
      }

      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds
      attempts++;
    }

    throw new Error('Video processing timeout');
  }
}
```

### OAuth Routes

```typescript
// apps/web/app/api/platforms/connect/twitter/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { TwitterProvider } from '@kit/publishing/providers';
import { generateState, saveOAuthState } from '@kit/publishing/lib/oauth';

export async function GET(request: NextRequest) {
  const accountSlug = request.nextUrl.searchParams.get('account');

  const state = generateState();
  await saveOAuthState(state, { accountSlug, platform: 'twitter' });

  const provider = new TwitterProvider(
    process.env.TWITTER_CLIENT_ID!,
    process.env.TWITTER_CLIENT_SECRET!
  );

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/platforms/callback/twitter`;
  const authUrl = provider.getAuthUrl(state, redirectUri);

  return NextResponse.redirect(authUrl);
}
```

### Tweet Composer Component

```typescript
// packages/features/publishing/src/components/twitter-composer.tsx

'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Textarea } from '@kit/ui/textarea';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { AtSign, Hash, AlertCircle } from 'lucide-react';
import { TWITTER_LIMITS } from '../providers/twitter/limits';

interface TwitterComposerProps {
  initialText: string;
  onSave: (text: string) => void;
}

export function TwitterComposer({ initialText, onSave }: TwitterComposerProps) {
  const [text, setText] = useState(initialText);

  const charCount = text.length;
  const isOverLimit = charCount > TWITTER_LIMITS.tweet.maxLength;
  const hashtagCount = (text.match(/#\w+/g) || []).length;
  const mentionCount = (text.match(/@\w+/g) || []).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Compose Tweet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What's happening?"
          rows={4}
          className={isOverLimit ? 'border-red-500' : ''}
        />

        <div className="flex items-center justify-between">
          <div className="flex gap-2">
            <Badge variant="outline" className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {hashtagCount}
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <AtSign className="h-3 w-3" />
              {mentionCount}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-sm ${
                isOverLimit ? 'text-red-500' : 'text-muted-foreground'
              }`}
            >
              {charCount}/{TWITTER_LIMITS.tweet.maxLength}
            </span>
            <Button onClick={() => onSave(text)} disabled={isOverLimit}>
              Save
            </Button>
          </div>
        </div>

        {isOverLimit && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertCircle className="h-4 w-4" />
            Tweet is too long. Please shorten to {TWITTER_LIMITS.tweet.maxLength} characters.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/publishing/src/providers/twitter/twitter-provider.ts` |
| CREATE | `packages/features/publishing/src/providers/twitter/limits.ts` |
| CREATE | `packages/features/publishing/src/providers/twitter/index.ts` |
| CREATE | `packages/features/publishing/src/components/twitter-composer.tsx` |
| CREATE | `apps/web/app/api/platforms/connect/twitter/route.ts` |
| CREATE | `apps/web/app/api/platforms/callback/twitter/route.ts` |
| MODIFY | `packages/features/publishing/src/providers/index.ts` |

---

## Acceptance Criteria

- [ ] OAuth 2.0 connection flow works
- [ ] Video upload with chunked transfer
- [ ] Tweet composition with character limit
- [ ] Hashtag and mention tracking
- [ ] Analytics retrieval (views, likes, retweets, replies)
- [ ] Delete tweet functionality
- [ ] Video duration validation

---

## Test Plan

### Unit Tests
- [ ] Test character counting
- [ ] Test hashtag/mention extraction
- [ ] Test video duration validation

### Integration Tests
- [ ] Test OAuth flow with mock API
- [ ] Test video upload process
- [ ] Test analytics retrieval

---

## Environment Variables

```env
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
TWITTER_BEARER_TOKEN= # For app-only auth
```

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| Video too long | Show duration limit, suggest trimming |
| Tweet too long | Real-time character counter |
| Upload failed | Retry with exponential backoff |
| Rate limited | Show wait time, queue for later |
