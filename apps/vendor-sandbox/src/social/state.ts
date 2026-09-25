import { type Rng, createRng } from '../rng';
import {
  type DailyRow,
  type Growth,
  avoidSentinel,
  cumulativeAt,
  dailySeries,
  reportedAt,
} from './growth';
import * as names from './names';
import {
  type Platform,
  type Profile,
  type RatioName,
  drawProfile,
  normal,
} from './profile';

/**
 * What the social sandbox holds for one run (FILM-1802 §4–5): accounts, the
 * tokens it minted, and the objects published through it or adopted from
 * the local database, each with a performance profile.
 *
 * Everything random is drawn from a stream keyed by the run's seed and the
 * thing being drawn (`account:youtube:0`, `object:tiktok:<id>`), not by the
 * order requests arrive in. So the same seed gives the same accounts and
 * profiles however the app happens to interleave its calls, and two seeds
 * give different ones.
 *
 * Tokens expire in real time, as the app's refresh cron reads `expires_in`
 * against the real clock. Growth runs in simulated time (`speed`).
 */

export type TokenKind = 'access' | 'refresh';

export interface SocialAccount {
  platform: Platform;
  id: string;
  name: string;
  handle: string;
  bio: string;
  /** Followers before anything published through the sandbox. */
  baseFollowers: number;
}

export interface SocialToken {
  value: string;
  kind: TokenKind;
  platform: Platform;
  accountId: string;
  scopes: string[];
  issuedMs: number;
  /** Real time; null never expires (a refresh token). */
  expiresMs: number | null;
  revoked: boolean;
}

export interface SocialObject {
  platform: Platform;
  id: string;
  accountId: string | null;
  title: string;
  caption: string;
  durationSeconds: number;
  publishedMs: number;
  profile: Profile;
  /** Created on first sight of an id the app already had (a seeded publish). */
  adopted: boolean;
}

export type TokenCheck =
  | { ok: true; token: SocialToken }
  | { ok: false; reason: 'unknown' | 'revoked' | 'expired' }
  | { ok: false; reason: 'scope'; missing: string[] };

export type Metric = 'views' | Exclude<RatioName, 'completion'>;

export interface SocialStateJson {
  seed: number;
  accounts: SocialAccount[];
  tokens: SocialToken[];
  objects: SocialObject[];
  counters: Record<string, number>;
}

const HOUR_MS = 3_600_000;

/** FNV-1a over a string, folded with the seed. */
function keyedSeed(seed: number, key: string) {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function token(rng: Rng, length: number) {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => rng.pick([...alphabet])).join('');
}

/** A vendor-shaped id: digits for Meta, X and TikTok, base64-ish for YouTube. */
function objectId(rng: Rng, platform: Platform) {
  switch (platform) {
    case 'youtube':
      return token(rng, 11);
    case 'linkedin':
      return `urn:li:share:${rng.int(7_000_000_000, 7_399_999_999)}${rng.int(100_000_000, 999_999_999)}`;
    default:
      return `${rng.int(17_000_000, 18_999_999)}${rng.int(100_000_000, 999_999_999)}${rng.int(10, 99)}`;
  }
}

export class SocialState {
  seed: number;
  speed: number;
  readonly now: () => number;
  private accounts = new Map<string, SocialAccount>();
  private tokens = new Map<string, SocialToken>();
  private objects = new Map<string, SocialObject>();
  private counters = new Map<string, number>();

  constructor(options: { seed: number; speed?: number; now?: () => number }) {
    this.seed = options.seed;
    this.speed = options.speed ?? 1440;
    this.now = options.now ?? Date.now;
  }

  /** A stream for one named thing, replayable from the seed. */
  rngFor(key: string) {
    return createRng(keyedSeed(this.seed, key));
  }

  private next(counter: string) {
    const n = this.counters.get(counter) ?? 0;
    this.counters.set(counter, n + 1);
    return n;
  }

  reset(seed: number) {
    this.seed = seed;
    this.accounts.clear();
    this.tokens.clear();
    this.objects.clear();
    this.counters.clear();
  }

  // ---- accounts ---------------------------------------------------------

  createAccount(platform: Platform): SocialAccount {
    const rng = this.rngFor(
      `account:${platform}:${this.next(`account:${platform}`)}`,
    );
    const name =
      platform === 'facebook'
        ? names.pageName(rng)
        : platform === 'linkedin'
          ? names.personName(rng)
          : names.channelName(rng);

    const account: SocialAccount = {
      platform,
      id:
        platform === 'youtube'
          ? `UC${token(rng, 22)}`
          : platform === 'linkedin'
            ? token(rng, 10)
            : objectId(rng, platform),
      name,
      handle: names.handle(rng),
      bio: names.bio(rng),
      baseFollowers: Math.max(
        23,
        Math.round(640 * Math.exp(1.4 * normal(rng))),
      ),
    };
    this.accounts.set(`${platform}:${account.id}`, account);
    return account;
  }

  account(platform: Platform, id: string) {
    return this.accounts.get(`${platform}:${id}`);
  }

  listAccounts(platform?: Platform) {
    return [...this.accounts.values()].filter(
      (a) => !platform || a.platform === platform,
    );
  }

  /** Followers now: the base plus what every object has earned so far. */
  followers(account: SocialAccount, atMs = this.now()) {
    return (
      account.baseFollowers +
      this.listObjects(account.platform)
        .filter((o) => o.accountId === account.id)
        .reduce((sum, o) => sum + this.cumulative(o, 'follows', atMs), 0)
    );
  }

  // ---- tokens -----------------------------------------------------------

  issueTokens(
    platform: Platform,
    accountId: string,
    scopes: string[],
    options: { ttlMs?: number; refresh?: boolean } = {},
  ) {
    const rng = this.rngFor(
      `token:${platform}:${this.next(`token:${platform}`)}`,
    );
    const issuedMs = this.now();
    const access: SocialToken = {
      value: `sbx.${platform}.${token(rng, 40)}`,
      kind: 'access',
      platform,
      accountId,
      scopes: [...scopes],
      issuedMs,
      expiresMs: issuedMs + (options.ttlMs ?? HOUR_MS),
      revoked: false,
    };
    this.tokens.set(access.value, access);

    if (options.refresh === false) return { access };

    const refresh: SocialToken = {
      ...access,
      value: `sbx.${platform}.r.${token(rng, 40)}`,
      kind: 'refresh',
      expiresMs: null,
    };
    this.tokens.set(refresh.value, refresh);
    return { access, refresh };
  }

  /** Is this token usable for these scopes, and if not, why not. */
  checkToken(value: string, required: readonly string[] = []): TokenCheck {
    const found = this.tokens.get(value);
    if (!found) return { ok: false, reason: 'unknown' };
    if (found.revoked) return { ok: false, reason: 'revoked' };
    if (found.expiresMs !== null && this.now() >= found.expiresMs)
      return { ok: false, reason: 'expired' };

    const missing = required.filter((scope) => !found.scopes.includes(scope));
    if (missing.length > 0) return { ok: false, reason: 'scope', missing };

    return { ok: true, token: found };
  }

  /** Revokes a token and every token minted for the same grant. */
  revoke(value: string) {
    const found = this.tokens.get(value);
    if (!found) return false;
    for (const t of this.tokens.values()) {
      if (t.platform === found.platform && t.accountId === found.accountId)
        t.revoked = true;
    }
    return true;
  }

  // ---- objects ----------------------------------------------------------

  createObject(
    platform: Platform,
    accountId: string | null,
    options: {
      title?: string;
      caption?: string;
      durationSeconds?: number;
    } = {},
  ): SocialObject {
    const rng = this.rngFor(
      `object:${platform}:${this.next(`object:${platform}`)}`,
    );
    const object: SocialObject = {
      platform,
      id: objectId(rng, platform),
      accountId,
      title: options.title ?? names.videoTitle(rng),
      caption: options.caption ?? names.caption(rng),
      durationSeconds: options.durationSeconds ?? rng.int(19, 178),
      publishedMs: this.now(),
      profile: drawProfile(rng, platform),
      adopted: false,
    };
    this.objects.set(`${platform}:${object.id}`, object);
    return object;
  }

  /**
   * The object with this id, adopting it on first sight: an id the app
   * already holds (a seeded publish) gets a profile keyed by the id itself,
   * so it is the same object every time it is asked about in this run.
   */
  object(platform: Platform, id: string): SocialObject {
    const existing = this.objects.get(`${platform}:${id}`);
    if (existing) return existing;

    const rng = this.rngFor(`adopt:${platform}:${id}`);
    const adopted: SocialObject = {
      platform,
      id,
      accountId: null,
      title: names.videoTitle(rng),
      caption: names.caption(rng),
      durationSeconds: rng.int(19, 178),
      // Published some real hours before first sight, so it has history.
      publishedMs: this.now() - rng.int(1, 72) * HOUR_MS,
      profile: drawProfile(rng, platform),
      adopted: true,
    };
    this.objects.set(`${platform}:${id}`, adopted);
    return adopted;
  }

  hasObject(platform: Platform, id: string) {
    return this.objects.has(`${platform}:${id}`);
  }

  listObjects(platform?: Platform) {
    return [...this.objects.values()].filter(
      (o) => !platform || o.platform === platform,
    );
  }

  private growth(object: SocialObject): Growth {
    return {
      archetype: object.profile.archetype,
      lifetime: object.profile.lifetimeViews,
      publishedMs: object.publishedMs,
    };
  }

  /**
   * A metric's cumulative figure. Views follow the curve; every other metric
   * is its ratio of views, rounded down, so it rises with views and can
   * never exceed them.
   */
  cumulative(
    object: SocialObject,
    metric: Metric,
    atMs = this.now(),
    delaySimulatedMs = 0,
  ) {
    const views = reportedAt(
      this.growth(object),
      atMs,
      this.speed,
      delaySimulatedMs,
    );
    return avoidSentinel(
      metric === 'views'
        ? views
        : Math.floor(views * object.profile.ratios[metric]),
    );
  }

  /** Seconds watched so far: views × length × the share watched. */
  watchSeconds(object: SocialObject, atMs = this.now(), delaySimulatedMs = 0) {
    return Math.floor(
      this.cumulative(object, 'views', atMs, delaySimulatedMs) *
        object.durationSeconds *
        object.profile.ratios.completion,
    );
  }

  /** A metric per real date, each day's increase; rows sum to the total. */
  daily(
    object: SocialObject,
    metric: Metric,
    fromDate: string,
    toDate: string,
    delaySimulatedMs = 0,
  ): DailyRow[] {
    return dailySeries(
      (atMs) => this.cumulative(object, metric, atMs, delaySimulatedMs),
      fromDate,
      toDate,
      this.now(),
    );
  }

  /** Cumulative views at a real time, with no reporting delay (for tests). */
  viewsAt(object: SocialObject, atMs: number) {
    return cumulativeAt(this.growth(object), atMs, this.speed);
  }

  // ---- persistence (SANDBOX_PERSIST) -------------------------------------

  toJSON(): SocialStateJson {
    return {
      seed: this.seed,
      accounts: [...this.accounts.values()],
      tokens: [...this.tokens.values()],
      objects: [...this.objects.values()],
      counters: Object.fromEntries(this.counters),
    };
  }

  restore(json: SocialStateJson) {
    this.reset(json.seed);
    for (const a of json.accounts)
      this.accounts.set(`${a.platform}:${a.id}`, a);
    for (const t of json.tokens) this.tokens.set(t.value, t);
    for (const o of json.objects) this.objects.set(`${o.platform}:${o.id}`, o);
    for (const [k, v] of Object.entries(json.counters)) this.counters.set(k, v);
  }

  summary() {
    return {
      seed: this.seed,
      speed: this.speed,
      accounts: this.listAccounts().map((a) => ({
        platform: a.platform,
        id: a.id,
        name: a.name,
        followers: this.followers(a),
      })),
      tokens: [...this.tokens.values()].map((t) => ({
        platform: t.platform,
        kind: t.kind,
        accountId: t.accountId,
        scopes: t.scopes,
        revoked: t.revoked,
        expiresMs: t.expiresMs,
        // Never the whole token: enough to tell two apart.
        value: `${t.value.slice(0, 12)}…`,
      })),
      objects: this.listObjects().map((o) => ({
        platform: o.platform,
        id: o.id,
        accountId: o.accountId,
        title: o.title,
        adopted: o.adopted,
        publishedAt: new Date(o.publishedMs).toISOString(),
        archetype: o.profile.archetype,
        views: this.cumulative(o, 'views'),
      })),
    };
  }
}
