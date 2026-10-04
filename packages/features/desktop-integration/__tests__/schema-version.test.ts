import { describe, expect, it } from 'vitest';

import { DESKTOP_INTEGRATION_SCHEMA_VERSION } from '../src';

describe('DESKTOP_INTEGRATION_SCHEMA_VERSION', () => {
  it('names the edit package contract version', () => {
    expect(DESKTOP_INTEGRATION_SCHEMA_VERSION).toBe('storybook-edit-package/1');
  });
});
