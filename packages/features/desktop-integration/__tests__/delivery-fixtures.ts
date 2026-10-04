/** The PRD's explain-why report example, shared by the delivery tests (FILM-2003). */
export const REPORT = {
  versions: [
    {
      id: 'v1',
      label: 'Rough cut',
      parentId: null,
      createdAt: '2026-10-04T10:00:00.000Z',
      origin: 'rough_cut',
    },
    {
      id: 'v2',
      label: 'AI cut v2',
      parentId: 'v1',
      createdAt: '2026-10-04T10:05:00.000Z',
      origin: 'ai',
    },
  ],
  finalDuration: 91.2,
  aiOps: 34,
  userOps: 3,
  explain: {
    plan: 'Make it 90 seconds',
    targetDuration: 90,
    durationBefore: 128.4,
    scenes: [
      {
        scene: 1,
        durationBefore: 24.1,
        durationAfter: 18,
        changes: [
          {
            action: 'trimmed',
            target: 'Shot 1.2',
            reason: 'Information already given by dialogue',
            before: 4.8,
            after: 3.2,
            by: 'ai',
          },
          {
            action: 'removed',
            target: 'Shot 1.4',
            reason: 'Duplicate establishing shot',
            before: 2.1,
            by: 'ai',
          },
        ],
      },
    ],
    audio: [
      {
        target: 'Music',
        change: '-8 dB under dialogue',
        reason: 'Dialogue was masked at 0:42-0:47',
      },
    ],
  },
};
