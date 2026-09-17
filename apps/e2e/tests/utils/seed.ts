/**
 * Seeding accounts through the API instead of the UI.
 *
 * The UI path — sign up, wait for a confirmation mail, open the account
 * selector, fill the create-team dialog — is three brittle flows deep
 * before a test can start, and two of them are the ones the admin suite
 * already flakes on. Nothing in a revenue test is served by exercising
 * them again; they have their own specs.
 *
 * Uses `fetch` rather than @supabase/supabase-js so this adds no
 * dependency to the e2e app.
 */
import { randomUUID } from 'node:crypto';

/**
 * A suffix no other seeded name can contain.
 *
 * The admin search is `ilike %query%` and rows are located with `hasText`,
 * both substring matches. `${Date.now()}${random 0-999}` was neither fixed
 * length nor unique, so one name could be a prefix of another — `…5` inside
 * `…57` — and a filter would return two rows. A UUID is both.
 */
export function uniqueStamp() {
  return randomUUID();
}

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';

/**
 * Local Supabase's well-known demo keys. These are the published values
 * every `supabase start` produces, not secrets — CI overrides them, and a
 * run against anything but a local stack must.
 */
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export interface SeededTeam {
  email: string;
  password: string;
  /** The owner's auth user id */
  userId: string;
  slug: string;
  accountId: string;
  /** The team's display name, which the admin accounts table filters on. */
  name: string;
}

async function post(path: string, key: string, body: unknown, token?: string) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${token ?? key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${path} failed (${response.status}): ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

export interface SeededUser {
  email: string;
  password: string;
  userId: string;
  /**
   * The display name the account trigger derives from the email, which is
   * what the admin accounts table shows and filters on.
   */
  name: string;
}

/**
 * A confirmed user with a personal account, ready to sign in.
 *
 * `POST /auth/v1/admin/users` with `email_confirm: true` is the whole thing —
 * no follow-up call is needed. `kit.setup_new_user`
 * (`apps/web/supabase/schemas/03-accounts.sql`) fires on every insert into
 * `auth.users`, including one made through the admin API, and writes the
 * `public.accounts` row with `is_personal_account = true`. That row is what
 * `/admin/accounts` lists.
 *
 * The trigger derives the account name from `raw_user_meta_data->>'name'`,
 * falling back to `split_part(email, '@', 1)` — so `name` below is what the
 * admin table renders, and what a test should filter on.
 *
 * This replaces driving sign-up, waiting on the confirmation mail and signing
 * out again: three flows, each an independent way for an unrelated test to
 * fail, none of them the subject of the test that needed a user.
 */
export async function seedUser(prefix = 'user'): Promise<SeededUser> {
  const stamp = uniqueStamp();
  const email = `${prefix}-${stamp}@makerkit.dev`;
  const password = 'password';

  const user = await post('/auth/v1/admin/users', SERVICE_ROLE_KEY, {
    email,
    password,
    email_confirm: true,
  });

  if (!user?.id) {
    throw new Error(`admin/users returned no id: ${JSON.stringify(user)}`);
  }

  return {
    email,
    password,
    userId: user.id as string,
    name: email.split('@')[0]!,
  };
}

/**
 * A confirmed user who owns a team account, ready to sign in.
 *
 * The team is created through `create_team_account` as the user rather
 * than by inserting rows: that function also writes the membership and the
 * slug, and reproducing its behaviour here would mean a fixture that
 * drifts from what the product actually creates.
 */
export async function seedTeamAccount(
  options: { name?: string; emailPrefix?: string } = {},
): Promise<SeededTeam> {
  const stamp = uniqueStamp();
  const email = `${options.emailPrefix ?? 'seeded'}-${stamp}@makerkit.dev`;
  const password = 'password';
  // The caller may need a specific name — several team tests assert on it.
  // The slug is whatever `create_team_account` derives, and is returned
  // rather than guessed, because guessing it is how a test ends up
  // navigating to a team that does not exist.
  const name = options.name ?? `Seeded ${stamp}`;

  await post('/auth/v1/admin/users', SERVICE_ROLE_KEY, {
    email,
    password,
    // Skips the confirmation mail entirely: this test is not about signup.
    email_confirm: true,
  });

  const session = await post('/auth/v1/token?grant_type=password', ANON_KEY, {
    email,
    password,
  });

  const account = await post(
    '/rest/v1/rpc/create_team_account',
    ANON_KEY,
    { account_name: name },
    session.access_token as string,
  );

  if (!account?.slug) {
    throw new Error(
      `create_team_account returned no slug: ${JSON.stringify(account)}`,
    );
  }

  return {
    email,
    password,
    userId: session.user.id as string,
    name,
    slug: account.slug as string,
    accountId: account.id as string,
  };
}

/**
 * An active YouTube channel on a seeded account.
 *
 * The analytics settings page lists per-channel targets from
 * `platform_connections`, and a freshly seeded team has none — without this
 * the page renders its empty state and a channel test would assert against
 * nothing while still passing.
 *
 * Written with the service-role key because the OAuth flow that normally
 * creates these rows is an entire external round trip, and nothing in a
 * settings test is served by exercising it.
 */
export async function seedYouTubeConnection(
  accountId: string,
  name = 'Seeded Channel',
  options: { isActive?: boolean } = {},
): Promise<string> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/platform_connections`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      // Without this PostgREST returns 201 and an empty body, so the id
      // would come back undefined and every later locator would miss.
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      account_id: accountId,
      platform: 'youtube',
      platform_account_name: name,
      // A disconnected channel keeps its history, so the Deep Dive filter
      // must still list it — which needs one to exist.
      is_active: options.isActive ?? true,
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `seedYouTubeConnection failed (${response.status}): ${text}`,
    );
  }

  const rows = JSON.parse(text) as Array<{ id: string }>;
  const id = rows[0]?.id;

  if (!id) {
    throw new Error(`seedYouTubeConnection returned no id: ${text}`);
  }

  return id;
}

/** Inserts one row through PostgREST and returns it. */
async function insertRow<T>(
  table: string,
  body: Record<string, unknown>,
  auth: { key: string; token?: string },
): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: auth.key,
      Authorization: `Bearer ${auth.token ?? auth.key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `insert into ${table} failed (${response.status}): ${text}`,
    );
  }

  const row = (JSON.parse(text) as T[])[0];

  if (!row) {
    throw new Error(`insert into ${table} returned no row: ${text}`);
  }

  return row;
}

export interface SeededProject {
  id: string;
  slug: string;
  name: string;
}

/**
 * A project on a seeded team, created **as the team's owner**.
 *
 * Not with the service role: `projects.created_by` defaults to the session
 * user and `add_project_owner` inserts the owner membership from it, so a
 * service-role insert leaves a project nobody is a member of. Slugs are
 * unique per account, not generated, so one is set explicitly.
 */
export async function seedProject(
  team: Pick<SeededTeam, 'email' | 'password' | 'accountId'>,
  options: { name?: string; slug?: string } = {},
): Promise<SeededProject> {
  const session = await post('/auth/v1/token?grant_type=password', ANON_KEY, {
    email: team.email,
    password: team.password,
  });

  const stamp = uniqueStamp().slice(0, 8);
  const name = options.name ?? `Seeded Project ${stamp}`;
  const slug = options.slug ?? `seeded-project-${stamp}`;

  const row = await insertRow<{ id: string; slug: string; name: string }>(
    'projects',
    { account_id: team.accountId, name, slug },
    { key: ANON_KEY, token: session.access_token as string },
  );

  return { id: row.id, slug: row.slug, name: row.name };
}

/**
 * An episode with one published publish to a channel.
 *
 * `listProjectChannels` derives a project's channels from its *published*
 * publishes, not from the account's connections, so a channel only appears
 * on the project's Deep Dive tab once something has been published to it.
 */
export async function seedPublishedEpisode(
  projectId: string,
  connectionId: string,
  options: { number?: number; platform?: string } = {},
): Promise<{ episodeId: string; publishId: string }> {
  const auth = { key: SERVICE_ROLE_KEY };

  const episode = await insertRow<{ id: string }>(
    'episodes',
    {
      project_id: projectId,
      number: options.number ?? 1,
      title: `Seeded Episode ${options.number ?? 1}`,
    },
    auth,
  );

  const publish = await insertRow<{ id: string }>(
    'publishes',
    {
      episode_id: episode.id,
      platform_connection_id: connectionId,
      platform: options.platform ?? 'youtube',
      status: 'published',
      published_at: new Date().toISOString(),
    },
    auth,
  );

  return { episodeId: episode.id, publishId: publish.id };
}

/**
 * Adds an existing user to another team as a member, skipping the invitation
 * flow — which has its own specs, and is not the subject of a test that only
 * needs someone to belong to two teams.
 */
export async function seedMembership(
  userId: string,
  accountId: string,
  role = 'member',
): Promise<void> {
  await insertRow(
    'accounts_memberships',
    { user_id: userId, account_id: accountId, account_role: role },
    { key: SERVICE_ROLE_KEY },
  );
}

/**
 * An `analytics_settings` row for an account, written with the service role.
 *
 * Bypasses the settings schema deliberately: some tests need a value the form
 * would now refuse, to prove a row saved before that refusal still works.
 */
export async function seedAnalyticsSettings(
  accountId: string,
  row: {
    tag_min_sample?: number | null;
    ypp_target_watch_hours?: number | null;
    ypp_target_subscribers?: number | null;
  },
): Promise<void> {
  await insertRow(
    'analytics_settings',
    { account_id: accountId, ...row },
    { key: SERVICE_ROLE_KEY },
  );
}

/**
 * A `channel_analytics_settings` row, written with the service role.
 *
 * Bypasses the settings schema on purpose: a test needs a row holding a value
 * the form would now refuse, to prove such a row can still be edited.
 */
export async function seedChannelSettings(
  connectionId: string,
  accountId: string,
  row: {
    joined_ypp_at?: string | null;
    ypp_target_watch_hours?: number | null;
    ypp_target_subscribers?: number | null;
    ypp_applicant_status?: string;
  },
): Promise<void> {
  await insertRow(
    'channel_analytics_settings',
    { connection_id: connectionId, account_id: accountId, ...row },
    { key: SERVICE_ROLE_KEY },
  );
}
