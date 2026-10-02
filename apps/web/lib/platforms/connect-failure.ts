/**
 * What a failed platform connect is called, and how it travels from the OAuth
 * callback to the page that explains it (KB-19).
 *
 * Everything that reaches the page arrives in a URL anyone can write, so the
 * page trusts none of it: the code and the platform are looked up in the
 * lists below, and the vendor's own words are only ever shown as text.
 */

export const CONNECT_PLATFORMS = [
  'youtube',
  'tiktok',
  'meta',
  'twitter',
] as const;

export type ConnectPlatform = (typeof CONNECT_PLATFORMS)[number];

export const CONNECT_PLATFORM_LABELS: Record<ConnectPlatform, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  meta: 'Meta (Facebook and Instagram)',
  twitter: 'X (Twitter)',
};

/** Failures the vendor reported, in the `error` parameter of its redirect. */
const VENDOR_REPORTED_CODES = [
  'access_denied',
  'invalid_scope',
  'vendor_unavailable',
  'app_misconfigured',
  'vendor_error',
] as const;

export const CONNECT_FAILURE_CODES = [
  ...VENDOR_REPORTED_CODES,
  'missing_params',
  'invalid_state',
  'state_expired',
  'not_configured',
  'token_exchange_failed',
  'invalid_token_response',
  'no_channel',
  'no_pages_found',
  'account_lookup_failed',
  'storage_failed',
  'pending_connection_lost',
  'unexpected',
  'unknown',
] as const;

export type ConnectFailureCode = (typeof CONNECT_FAILURE_CODES)[number];

/**
 * The failures where a vendor said something worth reading. For the rest the
 * callback sends no vendor text, so any that arrives was typed into the URL.
 */
const SHOWS_VENDOR_TEXT: ReadonlySet<ConnectFailureCode> = new Set([
  ...VENDOR_REPORTED_CODES,
  'token_exchange_failed',
]);

export const CONNECT_FAILURE_LANDING = '/settings/platforms';

export const VENDOR_CODE_MAX_LENGTH = 64;
export const VENDOR_LOG_ID_MAX_LENGTH = 64;
export const VENDOR_MESSAGE_MAX_LENGTH = 300;

const VENDOR_ERROR_CODES: Record<string, ConnectFailureCode> = {
  access_denied: 'access_denied',
  user_denied: 'access_denied',
  user_cancelled_login: 'access_denied',
  user_cancelled_authorize: 'access_denied',
  invalid_scope: 'invalid_scope',
  server_error: 'vendor_unavailable',
  temporarily_unavailable: 'vendor_unavailable',
  invalid_request: 'app_misconfigured',
  invalid_client: 'app_misconfigured',
  unauthorized_client: 'app_misconfigured',
  unsupported_response_type: 'app_misconfigured',
  redirect_uri_mismatch: 'app_misconfigured',
};

/**
 * Our code for the `error` a vendor redirected back with. Vendors name a
 * refused scope differently (`invalid_scope` is the RFC 6749 name), so any
 * error code that mentions a scope is read as one.
 */
export function failureCodeForVendorError(error: string): ConnectFailureCode {
  const normalised = error.trim().toLowerCase();
  const known = VENDOR_ERROR_CODES[normalised];

  if (known) {
    return known;
  }

  return normalised.includes('scope') ? 'invalid_scope' : 'vendor_error';
}

/**
 * Untrusted text made safe to carry and to log: one line, no control
 * characters, and no longer than `maxLength` (an ellipsis marks a cut).
 */
export function cleanVendorText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return null;
  }

  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * The account a connect was started for, read from an OAuth `state` that has
 * NOT been verified. Good for choosing which page to land on — the landing
 * looks it up as the signed-in user — and for nothing else.
 */
export function accountIdFromUnverifiedState(state: string | null) {
  if (!state) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(state, 'base64url').toString(),
    );

    if (parsed && typeof parsed === 'object' && 'accountId' in parsed) {
      return isUuid(parsed.accountId) ? parsed.accountId : null;
    }
  } catch {
    // Not a state we wrote.
  }

  return null;
}

export interface ConnectFailure {
  code: ConnectFailureCode;
  platform: ConnectPlatform | null;
  vendorCode: string | null;
  vendorMessage: string | null;
  /** The vendor's own reference for the failure, to quote to its support. */
  vendorLogId: string | null;
}

function isConnectPlatform(value: unknown): value is ConnectPlatform {
  return CONNECT_PLATFORMS.some((platform) => platform === value);
}

function isConnectFailureCode(value: unknown): value is ConnectFailureCode {
  return CONNECT_FAILURE_CODES.some((code) => code === value);
}

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The failure a URL describes, or `null` when it describes none. An `error`
 * we never wrote is `unknown`, not echoed; vendor text is dropped unless the
 * failure is one a vendor reports.
 */
export function readConnectFailure(
  searchParams: SearchParams,
): ConnectFailure | null {
  const error = first(searchParams.error);

  if (!error) {
    return null;
  }

  const platformParam = first(searchParams.platform);
  // The form the callbacks used to write: `tiktok_not_configured`.
  const legacy = /^([a-z]+)_not_configured$/.exec(error);

  const code = legacy
    ? 'not_configured'
    : isConnectFailureCode(error)
      ? error
      : 'unknown';

  const platform = [platformParam, legacy?.[1]].find(isConnectPlatform) ?? null;
  const showsVendorText = SHOWS_VENDOR_TEXT.has(code);

  return {
    code,
    platform,
    vendorCode: showsVendorText
      ? cleanVendorText(first(searchParams.vendor_code), VENDOR_CODE_MAX_LENGTH)
      : null,
    vendorMessage: showsVendorText
      ? cleanVendorText(
          first(searchParams.vendor_message),
          VENDOR_MESSAGE_MAX_LENGTH,
        )
      : null,
    vendorLogId: showsVendorText
      ? cleanVendorText(
          first(searchParams.vendor_log_id),
          VENDOR_LOG_ID_MAX_LENGTH,
        )
      : null,
  };
}

/** The query string that `readConnectFailure` reads back. */
export function connectFailureQuery(failure: ConnectFailure) {
  const query = new URLSearchParams({ error: failure.code });

  if (failure.platform) {
    query.set('platform', failure.platform);
  }

  if (failure.vendorCode) {
    query.set('vendor_code', failure.vendorCode);
  }

  if (failure.vendorMessage) {
    query.set('vendor_message', failure.vendorMessage);
  }

  if (failure.vendorLogId) {
    query.set('vendor_log_id', failure.vendorLogId);
  }

  return query;
}

// What `kit.slugify` can produce.
const ACCOUNT_SLUG = /^[a-z0-9_-]{1,128}$/i;

/** Where a person with no team lands: they are sent to create one. */
export const NO_TEAM_FAILURE_PATH = '/home/teams/create';

/** Their own profile page, reachable whatever workspace they are in. */
export const NO_CHOSEN_TEAM_FAILURE_PATH = '/home/settings';

/**
 * Where a failure is shown: the account's platforms page; when no account
 * could be chosen, profile settings (several teams, none more likely) or the
 * create-team page (no team at all). Both are pages that render the message:
 * `/home` no longer does, because with personal accounts off it redirects to
 * a team and drops the query (KB-99). A path built from constants and a slug
 * that can only be one path segment — never from a parameter.
 */
export function connectFailurePath(
  accountSlug: string | null,
  hasTeams = true,
) {
  if (accountSlug && ACCOUNT_SLUG.test(accountSlug)) {
    return `/home/${accountSlug}/settings/platforms`;
  }

  return hasTeams ? NO_CHOSEN_TEAM_FAILURE_PATH : NO_TEAM_FAILURE_PATH;
}

/**
 * The workspace the connect was for; failing that, the only one this person
 * has. With several and no hint there is no right answer, so none is chosen
 * and the message is shown on the person's profile page instead.
 */
export function chooseAccountSlug(
  teams: Array<{ id: string | null; slug: string | null }>,
  accountId: string | undefined,
) {
  const hinted = isUuid(accountId)
    ? teams.find((team) => team.id === accountId)
    : undefined;

  const chosen = hinted ?? (teams.length === 1 ? teams[0] : undefined);

  return chosen?.slug ?? null;
}
