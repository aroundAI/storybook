import { describe, expect, it } from 'vitest';

import {
  type EditableExperiment,
  toFormValues,
  toUpdatePayload,
} from '../src/lib/experiment-edit';

/** A stored change as getExperimentAction returns it. */
function stored(overrides: Partial<EditableExperiment> = {}): EditableExperiment {
  return {
    id: 'e1',
    account_id: 'a1',
    project_id: null,
    title: 'Faces on thumbnails',
    hypothesis: 'A face gets more clicks',
    change_description: 'New thumbnails on five videos',
    expected_outcome: null,
    category: 'packaging',
    metric_watched: 'ctr',
    review_window_days: 30,
    notes: null,
    connection_id: 'c1',
    status: 'planned',
    publishes: [
      { publish_id: 'p1', publishes: { title: 'One', platform: 'youtube', published_at: null } },
      { publish_id: 'p2', publishes: { title: 'Two', platform: 'youtube', published_at: null } },
    ],
    tags: [{ tag_id: 't1', content_tags: { dimension: 'topic', slug: 'x', label: 'X' } }],
    ...overrides,
  };
}

describe('toFormValues', () => {
  it('fills the form from the stored change, with no value shown as empty', () => {
    expect(toFormValues(stored())).toEqual({
      accountId: 'a1',
      projectId: undefined,
      title: 'Faces on thumbnails',
      hypothesis: 'A face gets more clicks',
      changeDescription: 'New thumbnails on five videos',
      expectedOutcome: '',
      category: 'packaging',
      metricWatched: 'ctr',
      reviewWindowDays: 30,
      notes: '',
      connectionId: 'c1',
      publishIds: ['p1', 'p2'],
      tagIds: ['t1'],
    });
  });

  it('shows a stored value the form no longer offers as none, so it cannot block a save', () => {
    const values = toFormValues(
      stored({ category: 'retired-category', metric_watched: 'retired_metric' }),
    );

    expect(values.category).toBeUndefined();
    expect(values.metricWatched).toBeUndefined();
  });
});

describe('toUpdatePayload', () => {
  it('sends only what changed', () => {
    const initial = toFormValues(stored());

    expect(
      toUpdatePayload('e1', 'planned', initial, { ...initial, title: 'Faces, round two' }),
    ).toEqual({ experimentId: 'e1', title: 'Faces, round two' });
  });

  it('sends nothing but the id when nothing changed', () => {
    const initial = toFormValues(stored());

    expect(toUpdatePayload('e1', 'planned', initial, { ...initial })).toEqual({
      experimentId: 'e1',
    });
  });

  it('clears a select to null, which the action reads as "clear", not "leave alone"', () => {
    const initial = toFormValues(stored());

    expect(
      toUpdatePayload('e1', 'planned', initial, {
        ...initial,
        category: undefined,
        metricWatched: undefined,
        connectionId: undefined,
      }),
    ).toEqual({
      experimentId: 'e1',
      category: null,
      metricWatched: null,
      connectionId: null,
    });
  });

  it('clears the notes to null', () => {
    const initial = toFormValues(stored({ notes: 'Old note' }));

    expect(
      toUpdatePayload('e1', 'planned', initial, { ...initial, notes: '  ' }),
    ).toEqual({ experimentId: 'e1', notes: null });
  });

  it('compares linked videos and tags as sets, not by order', () => {
    const initial = toFormValues(stored());

    expect(
      toUpdatePayload('e1', 'planned', initial, {
        ...initial,
        publishIds: ['p2', 'p1'],
        tagIds: ['t1'],
      }),
    ).toEqual({ experimentId: 'e1' });

    expect(
      toUpdatePayload('e1', 'planned', initial, {
        ...initial,
        publishIds: ['p1'],
        tagIds: ['t1', 't2'],
      }),
    ).toEqual({ experimentId: 'e1', publishIds: ['p1'], tagIds: ['t1', 't2'] });
  });

  it('leaves out a frozen field once started, even if the form holds a new value', () => {
    // The action refuses any frozen field it is sent, changed or not; the
    // form disables them, and this keeps a stray value from blocking a save
    // of the wording.
    const initial = toFormValues(stored({ status: 'running' }));

    expect(
      toUpdatePayload('e1', 'running', initial, {
        ...initial,
        title: 'Renamed',
        metricWatched: 'search_share',
        reviewWindowDays: 90,
        publishIds: ['p1'],
        hypothesis: 'Hindsight',
        expectedOutcome: 'Hindsight',
        tagIds: ['t2'],
      }),
    ).toEqual({ experimentId: 'e1', title: 'Renamed', tagIds: ['t2'] });
  });
});
