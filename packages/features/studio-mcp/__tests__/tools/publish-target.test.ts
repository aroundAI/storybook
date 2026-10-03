import { describe, expect, it } from 'vitest';

import { publishMetadataStage } from '@kit/generation';

import { resolveStageTarget } from '../../src/server/tools/generation/target';
import { fakeClient } from '../helpers/fake-postgrest';

/**
 * FILM-1909: publish_metadata is startable over MCP. Its titles are the
 * caller's own text, so the run locks their episode, as the web's
 * server-mode run does; the stage's own target is the items in options.
 */
const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = '11111111-1111-4111-8111-111111111111';

const items = [
  {
    id: 'full-video-es',
    contentType: 'full-video',
    title: 'The Last Signal',
    description: 'An astronaut hears her own voice.',
    targetLanguage: 'es',
  },
];

function client() {
  return fakeClient({
    episodes: [
      {
        id: EPISODE,
        project_id: PROJECT,
        title: 'The Last Signal',
        description: null,
        version: 4,
        target_duration_seconds: null,
        metadata: {},
        deleted_at: null,
        project: { id: PROJECT, account_id: ACCOUNT, name: 'P', slug: 'p' },
      },
    ],
  }) as never;
}

describe('publish_metadata over MCP', () => {
  it("locks the episode at its version; the stage's target is the items", async () => {
    const { target, runTarget } = await resolveStageTarget(
      client(),
      { accountId: ACCOUNT, userId: USER },
      publishMetadataStage,
      { episodeId: EPISODE, options: { items } },
    );

    expect(target).toEqual({ items });
    expect(runTarget).toMatchObject({
      type: 'episode',
      id: EPISODE,
      projectId: PROJECT,
      targetVersion: 4,
    });
  });

  it('needs the episode', async () => {
    await expect(
      resolveStageTarget(
        client(),
        { accountId: ACCOUNT, userId: USER },
        publishMetadataStage,
        { options: { items } },
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
