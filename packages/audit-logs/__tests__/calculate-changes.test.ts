import { describe, expect, it } from 'vitest';

import {
  calculateChanges,
  formatChanges,
} from '../src/server/calculate-changes';

describe('calculateChanges', () => {
  describe('Basic change detection', () => {
    it('should detect simple string changes', () => {
      const before = { name: 'Old Name' };
      const after = { name: 'New Name' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        name: {
          before: 'Old Name',
          after: 'New Name',
        },
      });
    });

    it('should detect number changes', () => {
      const before = { count: 10 };
      const after = { count: 20 };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        count: {
          before: 10,
          after: 20,
        },
      });
    });

    it('should detect boolean changes', () => {
      const before = { active: true };
      const after = { active: false };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        active: {
          before: true,
          after: false,
        },
      });
    });

    it('should ignore unchanged fields', () => {
      const before = { name: 'Same', status: 'active' };
      const after = { name: 'Same', status: 'inactive' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        status: {
          before: 'active',
          after: 'inactive',
        },
      });

      expect(changes).not.toHaveProperty('name');
    });

    it('should return empty object when nothing changed', () => {
      const before = { name: 'Same', status: 'active' };
      const after = { name: 'Same', status: 'active' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({});
    });
  });

  describe('Multiple field changes', () => {
    it('should detect multiple changes at once', () => {
      const before = {
        name: 'Old',
        email: 'old@example.com',
        age: 30,
      };

      const after = {
        name: 'New',
        email: 'new@example.com',
        age: 31,
      };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        name: { before: 'Old', after: 'New' },
        email: { before: 'old@example.com', after: 'new@example.com' },
        age: { before: 30, after: 31 },
      });
    });

    it('should handle mixed changed and unchanged fields', () => {
      const before = {
        name: 'Same',
        email: 'old@example.com',
        phone: '123-456-7890',
        age: 30,
      };

      const after = {
        name: 'Same',
        email: 'new@example.com',
        phone: '123-456-7890',
        age: 31,
      };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        email: { before: 'old@example.com', after: 'new@example.com' },
        age: { before: 30, after: 31 },
      });

      expect(Object.keys(changes)).toHaveLength(2);
    });
  });

  describe('Added and removed fields', () => {
    it('should detect newly added fields', () => {
      const before = { name: 'Test' };
      const after = { name: 'Test', email: 'test@example.com' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        email: {
          before: undefined,
          after: 'test@example.com',
        },
      });
    });

    it('should detect removed fields', () => {
      const before = { name: 'Test', email: 'test@example.com' };
      const after = { name: 'Test' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        email: {
          before: 'test@example.com',
          after: undefined,
        },
      });
    });

    it('should handle both added and removed fields', () => {
      const before = { oldField: 'old', common: 'same' };
      const after = { newField: 'new', common: 'same' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        oldField: { before: 'old', after: undefined },
        newField: { before: undefined, after: 'new' },
      });
    });
  });

  describe('Null and undefined handling', () => {
    it('should detect changes from value to null', () => {
      const before = { name: 'Test' };
      const after = { name: null };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        name: {
          before: 'Test',
          after: null,
        },
      });
    });

    it('should detect changes from null to value', () => {
      const before = { name: null };
      const after = { name: 'Test' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        name: {
          before: null,
          after: 'Test',
        },
      });
    });

    it('should detect changes from undefined to value', () => {
      const before = { name: undefined };
      const after = { name: 'Test' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        name: {
          before: undefined,
          after: 'Test',
        },
      });
    });

    it('should detect changes from value to undefined', () => {
      const before = { name: 'Test' };
      const after = { name: undefined };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        name: {
          before: 'Test',
          after: undefined,
        },
      });
    });
  });

  describe('Date handling', () => {
    it('should detect date changes', () => {
      const before = { createdAt: new Date('2024-01-01') };
      const after = { createdAt: new Date('2024-01-02') };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        createdAt: {
          before: new Date('2024-01-01'),
          after: new Date('2024-01-02'),
        },
      });
    });

    it('should not detect identical dates as changes', () => {
      const date = new Date('2024-01-01');
      const before = { createdAt: date };
      const after = { createdAt: new Date('2024-01-01') };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({});
    });
  });

  describe('Array handling', () => {
    it('should detect array changes', () => {
      const before = { tags: ['a', 'b'] };
      const after = { tags: ['a', 'b', 'c'] };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        tags: {
          before: ['a', 'b'],
          after: ['a', 'b', 'c'],
        },
      });
    });

    it('should not detect identical arrays as changes', () => {
      const before = { tags: ['a', 'b', 'c'] };
      const after = { tags: ['a', 'b', 'c'] };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({});
    });

    it('should detect array order changes', () => {
      const before = { tags: ['a', 'b', 'c'] };
      const after = { tags: ['c', 'b', 'a'] };

      const changes = calculateChanges(before, after);

      expect(changes).toHaveProperty('tags');
    });

    it('should detect empty to filled array', () => {
      const before = { tags: [] };
      const after = { tags: ['a'] };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        tags: {
          before: [],
          after: ['a'],
        },
      });
    });
  });

  describe('Nested object handling', () => {
    it('should detect nested object changes', () => {
      const before = { user: { name: 'Old' } };
      const after = { user: { name: 'New' } };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        user: {
          before: { name: 'Old' },
          after: { name: 'New' },
        },
      });
    });

    it('should not detect identical nested objects as changes', () => {
      const before = { user: { name: 'Same', age: 30 } };
      const after = { user: { name: 'Same', age: 30 } };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({});
    });

    it('should detect partial nested object changes', () => {
      const before = { user: { name: 'Same', email: 'old@test.com' } };
      const after = { user: { name: 'Same', email: 'new@test.com' } };

      const changes = calculateChanges(before, after);

      expect(changes).toHaveProperty('user');
    });
  });

  describe('Edge cases', () => {
    it('should return empty object for non-object inputs', () => {
      expect(calculateChanges('string', 'string')).toEqual({});
      expect(calculateChanges(123, 456)).toEqual({});
      expect(calculateChanges(true, false)).toEqual({});
    });

    it('should return empty object for null inputs', () => {
      expect(calculateChanges(null, null)).toEqual({});
      expect(calculateChanges(null, { name: 'Test' })).toEqual({});
      expect(calculateChanges({ name: 'Test' }, null)).toEqual({});
    });

    it('should return empty object for undefined inputs', () => {
      expect(calculateChanges(undefined, undefined)).toEqual({});
      expect(calculateChanges(undefined, { name: 'Test' })).toEqual({});
      expect(calculateChanges({ name: 'Test' }, undefined)).toEqual({});
    });

    it('should handle empty objects', () => {
      const changes = calculateChanges({}, {});
      expect(changes).toEqual({});
    });

    it('should handle objects with many fields', () => {
      const before = { a: 1, b: 2, c: 3, d: 4, e: 5 };
      const after = { a: 1, b: 22, c: 3, d: 44, e: 5 };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        b: { before: 2, after: 22 },
        d: { before: 4, after: 44 },
      });
    });
  });

  describe('Type changes', () => {
    it('should detect type changes from string to number', () => {
      const before = { value: '10' };
      const after = { value: 10 };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        value: {
          before: '10',
          after: 10,
        },
      });
    });

    it('should detect type changes from boolean to string', () => {
      const before = { active: true };
      const after = { active: 'yes' };

      const changes = calculateChanges(before, after);

      expect(changes).toEqual({
        active: {
          before: true,
          after: 'yes',
        },
      });
    });
  });
});

describe('formatChanges', () => {
  it('should format single change', () => {
    const changes = {
      name: { before: 'Old', after: 'New' },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toBe("Changed name from 'Old' to 'New'");
  });

  it('should format multiple changes', () => {
    const changes = {
      name: { before: 'Old', after: 'New' },
      status: { before: 'active', after: 'archived' },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toBe(
      "Changed name from 'Old' to 'New', status from 'active' to 'archived'",
    );
  });

  it('should format number changes', () => {
    const changes = {
      count: { before: 10, after: 20 },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toBe('Changed count from 10 to 20');
  });

  it('should format boolean changes', () => {
    const changes = {
      active: { before: true, after: false },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toBe('Changed active from true to false');
  });

  it('should format null values', () => {
    const changes = {
      value: { before: null, after: 'something' },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toBe("Changed value from null to 'something'");
  });

  it('should format undefined values', () => {
    const changes = {
      value: { before: undefined, after: 'something' },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toBe("Changed value from undefined to 'something'");
  });

  it('should format date values', () => {
    const changes = {
      createdAt: {
        before: new Date('2024-01-01T00:00:00.000Z'),
        after: new Date('2024-01-02T00:00:00.000Z'),
      },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toContain('2024-01-01T00:00:00.000Z');
    expect(formatted).toContain('2024-01-02T00:00:00.000Z');
  });

  it('should format array values', () => {
    const changes = {
      tags: { before: ['a', 'b'], after: ['a', 'b', 'c'] },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toBe('Changed tags from [2 items] to [3 items]');
  });

  it('should format object values', () => {
    const changes = {
      user: { before: { name: 'Old' }, after: { name: 'New' } },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toBe('Changed user from [object] to [object]');
  });

  it('should return "No changes" for empty changes', () => {
    const formatted = formatChanges({});

    expect(formatted).toBe('No changes');
  });

  it('should handle three or more changes', () => {
    const changes = {
      name: { before: 'A', after: 'B' },
      email: { before: 'a@test.com', after: 'b@test.com' },
      age: { before: 25, after: 26 },
    };

    const formatted = formatChanges(changes);

    expect(formatted).toContain('name');
    expect(formatted).toContain('email');
    expect(formatted).toContain('age');
    expect(formatted.split(',').length).toBe(3); // Three items split by commas
  });
});
