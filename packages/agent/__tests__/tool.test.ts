import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AgentParseError } from '../src/runner';
import { createTool, toolError, toolSuccess } from '../src/tool';

// We test parseAgentResponse by importing it — but it's not exported.
// Instead we test it indirectly through the public API.
// For direct unit testing, we replicate the parsing logic here.

// Direct import for testing internal functions
// Note: We test via the public runAgent API with mocked LLM in runner.test.ts
// This file tests the tool helper utilities.

describe('Tool Helper', () => {
  describe('createTool', () => {
    it('should create a tool with the given definition', () => {
      const tool = createTool({
        name: 'greet',
        description: 'Greets a person',
        parameters: z.object({ name: z.string() }),
        execute: async ({ name }) => toolSuccess(`Hello, ${name}!`),
      });

      expect(tool.name).toBe('greet');
      expect(tool.description).toBe('Greets a person');
    });

    it('should execute the tool function', async () => {
      const tool = createTool({
        name: 'add',
        description: 'Adds two numbers',
        parameters: z.object({ a: z.number(), b: z.number() }),
        execute: async ({ a, b }) => toolSuccess(a + b),
      });

      const result = await tool.execute({ a: 3, b: 4 });
      expect(result.success).toBe(true);
      expect(result.data).toBe(7);
    });

    it('should validate parameters with zod schema', () => {
      const tool = createTool({
        name: 'typed',
        description: 'A typed tool',
        parameters: z.object({
          required: z.string(),
          optional: z.number().optional(),
        }),
        execute: async (params) => toolSuccess(params),
      });

      // Zod schema validation
      const parseResult = tool.parameters.safeParse({
        required: 'hello',
      });
      expect(parseResult.success).toBe(true);

      const invalidResult = tool.parameters.safeParse({});
      expect(invalidResult.success).toBe(false);
    });
  });

  describe('toolSuccess', () => {
    it('should create a successful result', () => {
      const result = toolSuccess({ key: 'value' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ key: 'value' });
      expect(result.error).toBeUndefined();
    });

    it('should handle primitive data', () => {
      expect(toolSuccess(42).data).toBe(42);
      expect(toolSuccess('hello').data).toBe('hello');
      expect(toolSuccess(true).data).toBe(true);
    });

    it('should handle null and undefined', () => {
      expect(toolSuccess(null).data).toBeNull();
      expect(toolSuccess(undefined).data).toBeUndefined();
    });
  });

  describe('toolError', () => {
    it('should create a failed result', () => {
      const result = toolError('Something went wrong');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
      expect(result.data).toBeUndefined();
    });
  });
});

describe('AgentParseError', () => {
  it('should have the correct name', () => {
    const error = new AgentParseError('test');
    expect(error.name).toBe('AgentParseError');
  });

  it('should include the message', () => {
    const error = new AgentParseError('Missing JSON');
    expect(error.message).toBe('Missing JSON');
  });

  it('should be an instance of Error', () => {
    const error = new AgentParseError('test');
    expect(error).toBeInstanceOf(Error);
  });
});
