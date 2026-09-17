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
  slug: string;
  accountId: string;
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

/**
 * A confirmed user who owns a team account, ready to sign in.
 *
 * The team is created through `create_team_account` as the user rather
 * than by inserting rows: that function also writes the membership and the
 * slug, and reproducing its behaviour here would mean a fixture that
 * drifts from what the product actually creates.
 */
export async function seedTeamAccount(): Promise<SeededTeam> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `revenue-${stamp}@makerkit.dev`;
  const password = 'password';

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
    { account_name: `Revenue ${stamp}` },
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
      is_active: true,
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
