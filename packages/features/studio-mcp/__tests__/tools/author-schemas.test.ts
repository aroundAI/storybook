import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { upsertAssetTool } from '../../src/server/tools/author/assets';
import {
  createEpisodeTool,
  updateEpisodeTool,
} from '../../src/server/tools/author/episodes';
import {
  createProjectTool,
  updateProjectTool,
} from '../../src/server/tools/author/projects';

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const schemaOf = (shape: z.ZodRawShape) => z.object(shape);

/**
 * FILM-1905: each author tool is validated by the same Zod schema as its web
 * form. One case per rule the form refuses, so a tool that loosened a rule
 * would fail here before a client ever saw it.
 */
describe('create_project rejects what the create-project form rejects', () => {
  const schema = schemaOf(createProjectTool.inputSchema);

  it('refuses an empty name and a name over 255 characters', () => {
    expect(schema.safeParse({ name: '' }).success).toBe(false);
    expect(schema.safeParse({ name: 'x'.repeat(256) }).success).toBe(false);
    expect(schema.safeParse({ name: 'x'.repeat(255) }).success).toBe(true);
  });

  it('refuses a slug with capitals or spaces, as the form does', () => {
    expect(schema.safeParse({ name: 'ok', slug: 'Bad Slug' }).success).toBe(
      false,
    );
    expect(schema.safeParse({ name: 'ok', slug: 'good-slug-1' }).success).toBe(
      true,
    );
  });

  it('refuses a description over 1000 characters', () => {
    expect(
      schema.safeParse({ name: 'ok', description: 'd'.repeat(1001) }).success,
    ).toBe(false);
  });

  it('does not take account_id: the team comes from the connection', () => {
    expect('account_id' in createProjectTool.inputSchema).toBe(false);
    expect('accountId' in createProjectTool.inputSchema).toBe(false);
  });
});

describe('update_project rejects what the project and studio settings forms reject', () => {
  const schema = schemaOf(updateProjectTool.inputSchema);

  it('refuses a non-uuid project id and an unknown status', () => {
    expect(schema.safeParse({ projectId: 'nope' }).success).toBe(false);
    expect(
      schema.safeParse({ projectId: PROJECT_ID, status: 'bogus' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ projectId: PROJECT_ID, status: 'archived' }).success,
    ).toBe(true);
  });

  it('refuses an unknown genre, video style or content style', () => {
    expect(
      schema.safeParse({ projectId: PROJECT_ID, genre: 'bogus' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ projectId: PROJECT_ID, videoStyle: 'bogus' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ projectId: PROJECT_ID, contentStyle: 'bogus' })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        genre: 'drama',
        videoStyle: 'cinematic',
        contentStyle: 'balanced',
      }).success,
    ).toBe(true);
  });

  it('refuses a default episode duration under 60s or over 7200s', () => {
    expect(
      schema.safeParse({ projectId: PROJECT_ID, defaultEpisodeDuration: 30 })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ projectId: PROJECT_ID, defaultEpisodeDuration: 7201 })
        .success,
    ).toBe(false);
  });

  it('never takes raw metadata: settings are named fields, as on the settings page', () => {
    expect('metadata' in updateProjectTool.inputSchema).toBe(false);
  });
});

describe('create_episode rejects what the episode dialog and wizard reject', () => {
  const schema = schemaOf(createEpisodeTool.inputSchema);

  it('refuses an empty or over-long title and an over-long description', () => {
    expect(schema.safeParse({ projectId: PROJECT_ID, title: '' }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ projectId: PROJECT_ID, title: 't'.repeat(256) })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        title: 'ok',
        description: 'd'.repeat(2001),
      }).success,
    ).toBe(false);
  });

  it('refuses episode number 0 and a target duration under a minute', () => {
    expect(
      schema.safeParse({ projectId: PROJECT_ID, title: 'ok', number: 0 })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        title: 'ok',
        targetDuration: 59,
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        title: 'ok',
        targetDuration: 300,
        contentStyle: 'dialogue-heavy',
      }).success,
    ).toBe(true);
  });

  it('refuses an unknown content style', () => {
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        title: 'ok',
        contentStyle: 'chatty',
      }).success,
    ).toBe(false);
  });
});

describe('update_episode rejects what the episode update schema rejects', () => {
  const schema = schemaOf(updateEpisodeTool.inputSchema);

  it('requires a positive version for optimistic locking', () => {
    expect(
      schema.safeParse({ episodeId: EPISODE_ID, version: 0, title: 'x' })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ episodeId: EPISODE_ID, title: 'x' }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ episodeId: EPISODE_ID, version: 3, title: 'x' })
        .success,
    ).toBe(true);
  });

  it('refuses a non-uuid episode id and an empty title', () => {
    expect(schema.safeParse({ episodeId: 'nope', version: 1 }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ episodeId: EPISODE_ID, version: 1, title: '' })
        .success,
    ).toBe(false);
  });
});

describe('upsert_asset rejects what the character and location editors reject', () => {
  const schema = schemaOf(upsertAssetTool.inputSchema);

  it('takes only characters and locations', () => {
    expect(
      schema.safeParse({ projectId: PROJECT_ID, type: 'prop', name: 'Box' })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ projectId: PROJECT_ID, type: 'voice', name: 'V' })
        .success,
    ).toBe(false);
  });

  it('refuses an empty name, as both editors do', () => {
    expect(
      schema.safeParse({ projectId: PROJECT_ID, type: 'character', name: '' })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ projectId: PROJECT_ID, type: 'location', name: '' })
        .success,
    ).toBe(false);
  });

  it('refuses character details the character editor refuses', () => {
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        type: 'character',
        name: 'Ada',
        character: { physicalAttributes: { age: 200 } },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        type: 'character',
        name: 'Ada',
        character: { physicalAttributes: { build: 'gigantic' } },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        type: 'character',
        name: 'Ada',
        character: {
          referenceImages: Array.from(
            { length: 11 },
            (_, i) => `https://x/${i}`,
          ),
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        type: 'character',
        name: 'Ada',
        character: {
          physicalAttributes: { age: 34, build: 'slim' },
          personality: 'Dry wit',
          backstory: 'Grew up by the sea.',
        },
      }).success,
    ).toBe(true);
  });

  it('refuses location details the location editor refuses', () => {
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        type: 'location',
        name: 'Pier',
        location: { referenceImages: 'not-a-list' },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        type: 'location',
        name: 'Pier',
        description: 'd'.repeat(1001),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        type: 'location',
        name: 'Pier',
        location: { setting: 'coastal', timeOfDay: 'dusk' },
      }).success,
    ).toBe(true);
  });
});
