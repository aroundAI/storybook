import { describe, expect, it } from 'vitest';

import { toolResultContent } from '../src/registry';

const PROJECT_ID = '5f0c8a52-2a7e-4f43-9a55-6c0b1b6e0e11';

describe('the content a tool result sends', () => {
  it('carries the structured data after a summary, so a client reading only text gets the ids', () => {
    const content = toolResultContent({
      text: '1 project in storybook: "Cassy Advance".',
      structuredContent: {
        projects: [{ id: PROJECT_ID, name: 'Cassy Advance' }],
      },
    });

    expect(content[0]).toEqual({
      type: 'text',
      text: '1 project in storybook: "Cassy Advance".',
    });
    expect(content.map((block) => block.text).join('\n')).toContain(PROJECT_ID);
  });

  it('is the JSON alone when a tool gives no summary', () => {
    const content = toolResultContent({ structuredContent: { ok: true } });

    expect(content).toEqual([
      { type: 'text', text: JSON.stringify({ ok: true }, null, 2) },
    ]);
  });
});
