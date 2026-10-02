import { randomUUID } from 'node:crypto';

import { generatePersonalAccessToken, hashToken } from '../../src/server/token';

/**
 * Seeding for the contract test, through the Supabase REST API as
 * apps/e2e/tests/utils/seed.ts does: admin user creation,
 * `create_team_account` as the user, then the rows the tools read, written
 * as the owner so RLS has had its say. Nothing here is imported by the app.
 */
export const SUPABASE_URL =
  process.env.E2E_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  'http://127.0.0.1:55321';

/** Local Supabase's published demo keys; CI and any non-local stack override them. */
export const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

export const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  'super-secret-jwt-token-with-at-least-32-characters-long';

export async function rest(
  path: string,
  init: { method?: string; body?: unknown; token?: string; prefer?: string },
) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      apikey: init.token === SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY : ANON_KEY,
      Authorization: `Bearer ${init.token ?? ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'POST'} ${path} → ${response.status}: ${text}`,
    );
  }

  return text ? JSON.parse(text) : null;
}

export interface SeededTeam {
  userId: string;
  token: string;
  accountId: string;
  slug: string;
  projectId: string;
  episodeId: string;
}

/** A team with one project and one episode in the story stage (three scenes). */
export async function seedTeam(label: string): Promise<SeededTeam> {
  const stamp = randomUUID();
  const email = `mcp-${label}-${stamp}@makerkit.dev`;

  await rest('/auth/v1/admin/users', {
    token: SERVICE_ROLE_KEY,
    body: { email, password: 'password', email_confirm: true },
  });

  const session = await rest('/auth/v1/token?grant_type=password', {
    body: { email, password: 'password' },
  });
  const token = session.access_token as string;

  const account = await rest('/rest/v1/rpc/create_team_account', {
    token,
    body: { account_name: `MCP ${label} ${stamp.slice(0, 8)}` },
  });

  const [project] = await rest('/rest/v1/projects', {
    token,
    prefer: 'return=representation',
    body: {
      account_id: account.id,
      name: `Series ${label}`,
      slug: `series-${label}-${stamp.slice(0, 8)}`,
      metadata: { genre: 'drama', contentStyle: 'balanced' },
    },
  });

  const scene = (
    number: number,
    heading: string,
    location: string,
    timeOfDay: string,
    dialogue: Array<{ character: string; text: string }>,
  ) => ({
    number,
    heading,
    location,
    timeOfDay,
    description: `Scene ${number}.`,
    dialogue,
    estimatedDuration: 20,
  });

  const [episode] = await rest('/rest/v1/episodes', {
    token,
    prefer: 'return=representation',
    body: {
      project_id: project.id,
      number: 1,
      title: `Pilot ${label}`,
      slug: `episode-1-pilot-${label}`,
      status: 'story',
      version: 1,
      metadata: {},
      story_data: {
        logline: `The ${label} pilot`,
        fullStory: 'Once upon a time.',
      },
      screenplay_data: {
        scenes: [
          scene(1, 'INT. HALL - DAY', 'Hall', 'day', [
            { character: 'Ada', text: 'Hello.' },
          ]),
          scene(2, 'EXT. PIER - DUSK', 'Pier', 'dusk', []),
          scene(3, 'INT. HALL - NIGHT', 'Hall', 'night', []),
        ],
        metadata: {
          totalScenes: 3,
          estimatedDuration: 60,
          locations: ['Hall', 'Pier'],
          characters: ['Ada'],
        },
      },
    },
  });

  return {
    userId: session.user.id as string,
    token,
    accountId: account.id as string,
    slug: account.slug as string,
    projectId: project.id as string,
    episodeId: episode.id as string,
  };
}

/** A soft-deleted episode in the team's project; the web never shows it. */
export async function seedDeletedEpisode(team: SeededTeam) {
  const [deleted] = await rest('/rest/v1/episodes', {
    token: team.token,
    prefer: 'return=representation',
    body: {
      project_id: team.projectId,
      number: 2,
      title: 'Deleted one',
      slug: 'episode-2-deleted-one',
      status: 'draft',
      version: 1,
      metadata: {},
      deleted_at: new Date().toISOString(),
    },
  });

  return deleted.id as string;
}

/** A personal access token for the team's owner, through the same function the settings page calls. */
export async function mintPat(team: SeededTeam, scopes: string[]) {
  const pat = generatePersonalAccessToken();

  await rest('/rest/v1/rpc/create_mcp_personal_access_token', {
    token: team.token,
    body: {
      p_account_id: team.accountId,
      p_name: 'contract test',
      p_scopes: scopes,
      p_token_hash: hashToken(pat),
    },
  });

  return pat;
}
