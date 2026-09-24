/**
 * What a YouTube upload declares about itself: who it is made for (COPPA's
 * "made for kids") and its category (KB-30).
 *
 * Both are the creator's answer, given once per channel and carried on every
 * publish. There is deliberately no fallback value here or anywhere else: an
 * upload site that cannot resolve an answer refuses, because a default is a
 * declaration made in the creator's name.
 *
 * Pure, with no imports: the web app, the in-app cron and the publish-worker
 * lambda all load it.
 */

/** YouTube's assignable video categories. */
export const YOUTUBE_CATEGORIES = [
  { id: '1', name: 'Film & Animation' },
  { id: '2', name: 'Autos & Vehicles' },
  { id: '10', name: 'Music' },
  { id: '15', name: 'Pets & Animals' },
  { id: '17', name: 'Sports' },
  { id: '19', name: 'Travel & Events' },
  { id: '20', name: 'Gaming' },
  { id: '22', name: 'People & Blogs' },
  { id: '23', name: 'Comedy' },
  { id: '24', name: 'Entertainment' },
  { id: '25', name: 'News & Politics' },
  { id: '26', name: 'Howto & Style' },
  { id: '27', name: 'Education' },
  { id: '28', name: 'Science & Technology' },
  { id: '29', name: 'Nonprofits & Activism' },
] as const;

export type YouTubeCategoryId = (typeof YOUTUBE_CATEGORIES)[number]['id'];

export const YOUTUBE_CATEGORY_IDS = YOUTUBE_CATEGORIES.map((c) => c.id) as [
  YouTubeCategoryId,
  ...YouTubeCategoryId[],
];

export function isYouTubeCategoryId(
  value: unknown,
): value is YouTubeCategoryId {
  return YOUTUBE_CATEGORY_IDS.includes(value as YouTubeCategoryId);
}

export function youtubeCategoryName(id: string) {
  return YOUTUBE_CATEGORIES.find((c) => c.id === id)?.name ?? `Category ${id}`;
}

export interface YouTubeDeclaration {
  madeForKids: boolean;
  categoryId: string;
}

/** The channel's own answer, as `platform_connections` stores it. */
export interface YouTubeChannelDeclaration {
  youtube_made_for_kids: boolean | null;
  youtube_category_id: string | null;
}

export class YouTubeDeclarationMissing extends Error {
  constructor(readonly missing: Array<'audience' | 'category'>) {
    const what = missing
      .map((m) =>
        m === 'audience' ? 'audience (made for kids or not)' : 'category',
      )
      .join(' and ');

    super(
      `YouTube ${what} not declared for this channel — choose it in Settings → Platforms, then retry.`,
    );
    this.name = 'YouTubeDeclarationMissing';
  }
}

/**
 * `requested` is a publish request's `platformSpecific`, or a publish row's
 * `metadata` snapshot; it wins field by field. `channel` answers what it does
 * not — which matters for publishes scheduled before KB-30, whose rows carry
 * no snapshot.
 */
export function resolveYouTubeDeclaration(
  requested: { madeForKids?: unknown; categoryId?: unknown },
  channel: YouTubeChannelDeclaration | null,
): YouTubeDeclaration {
  const madeForKids =
    typeof requested.madeForKids === 'boolean'
      ? requested.madeForKids
      : (channel?.youtube_made_for_kids ?? null);

  const categoryId =
    typeof requested.categoryId === 'string' &&
    /^[0-9]{1,3}$/.test(requested.categoryId)
      ? requested.categoryId
      : (channel?.youtube_category_id ?? null);

  const missing: Array<'audience' | 'category'> = [];
  if (madeForKids === null) missing.push('audience');
  if (categoryId === null) missing.push('category');

  if (madeForKids === null || categoryId === null) {
    throw new YouTubeDeclarationMissing(missing);
  }

  return { madeForKids, categoryId };
}
