import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createLLMClient,
  loadConfigFromEnv,
  resetLLMClient,
} from '../src/factory';
import { LLMError } from '../src/types';

describe('LLM Factory', () => {
  // Store original env vars
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset singleton before each test
    resetLLMClient();
    // Clear all env vars
    delete process.env.LLM_PROVIDER;
    delete process.env.LLM_MODEL;
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.LOCAL_API_URL;
    delete process.env.LLM_TEMPERATURE;
    delete process.env.LLM_MAX_TOKENS;
    delete process.env.LLM_TOP_P;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
    resetLLMClient();
  });

  describe('loadConfigFromEnv', () => {
    describe('Provider Selection', () => {
      it('should default to openai when LLM_PROVIDER not set', () => {
        process.env.OPENAI_API_KEY = 'sk-test-key';
        const config = loadConfigFromEnv();
        expect(config.provider).toBe('openai');
      });

      it('should use LLM_PROVIDER when set', () => {
        process.env.LLM_PROVIDER = 'anthropic';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        const config = loadConfigFromEnv();
        expect(config.provider).toBe('anthropic');
      });

      it('should support all providers', () => {
        const providers = [
          { name: 'openai', key: 'sk-test' },
          { name: 'anthropic', key: 'sk-ant-test' },
          { name: 'gemini', key: 'AIza-test' },
          { name: 'local', key: 'not-needed' },
        ] as const;

        providers.forEach(({ name, key }) => {
          resetLLMClient();
          process.env.LLM_PROVIDER = name;
          process.env.LLM_API_KEY = key;
          const config = loadConfigFromEnv();
          expect(config.provider).toBe(name);
        });
      });
    });

    describe('API Key Handling', () => {
      it('should use LLM_API_KEY when set', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.LLM_API_KEY = 'sk-primary-key';
        process.env.OPENAI_API_KEY = 'sk-fallback-key';
        const config = loadConfigFromEnv();
        expect(config.apiKey).toBe('sk-primary-key');
      });

      it('should fallback to OPENAI_API_KEY for openai provider', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-openai-key';
        const config = loadConfigFromEnv();
        expect(config.apiKey).toBe('sk-openai-key');
      });

      it('should fallback to ANTHROPIC_API_KEY for anthropic provider', () => {
        process.env.LLM_PROVIDER = 'anthropic';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-key';
        const config = loadConfigFromEnv();
        expect(config.apiKey).toBe('sk-ant-key');
      });

      it('should fallback to GOOGLE_API_KEY for gemini provider', () => {
        process.env.LLM_PROVIDER = 'gemini';
        process.env.GOOGLE_API_KEY = 'AIza-key';
        const config = loadConfigFromEnv();
        expect(config.apiKey).toBe('AIza-key');
      });

      it('should set "not-needed" for local provider', () => {
        process.env.LLM_PROVIDER = 'local';
        const config = loadConfigFromEnv();
        expect(config.apiKey).toBe('not-needed');
      });

      it('should throw error when no API key found', () => {
        process.env.LLM_PROVIDER = 'openai';
        expect(() => loadConfigFromEnv()).toThrow(LLMError);
        expect(() => loadConfigFromEnv()).toThrow(/No API key found/);
      });

      it('should throw LLMError with correct properties', () => {
        process.env.LLM_PROVIDER = 'openai';
        try {
          loadConfigFromEnv();
          expect.fail('Should have thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(LLMError);
          expect((error as LLMError).provider).toBe('openai');
          expect((error as LLMError).code).toBe('MISSING_API_KEY');
        }
      });
    });

    describe('Model Selection', () => {
      it('should use LLM_MODEL when set', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.LLM_API_KEY = 'sk-test';
        process.env.LLM_MODEL = 'gpt-4o';
        const config = loadConfigFromEnv();
        expect(config.model).toBe('gpt-4o');
      });

      it('should default to gpt-4o-mini for openai', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
        const config = loadConfigFromEnv();
        expect(config.model).toBe('gpt-4o-mini');
      });

      it('should default to claude-3-5-sonnet-20241022 for anthropic', () => {
        process.env.LLM_PROVIDER = 'anthropic';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        const config = loadConfigFromEnv();
        expect(config.model).toBe('claude-3-5-sonnet-20241022');
      });

      it('should default to gemini-1.5-flash for gemini', () => {
        process.env.LLM_PROVIDER = 'gemini';
        process.env.GOOGLE_API_KEY = 'AIza-test';
        const config = loadConfigFromEnv();
        expect(config.model).toBe('gemini-1.5-flash');
      });

      it('should default to claude-sonnet-4-5 for local', () => {
        process.env.LLM_PROVIDER = 'local';
        const config = loadConfigFromEnv();
        expect(config.model).toBe('claude-sonnet-4-5');
      });
    });

    describe('Optional Parameters', () => {
      beforeEach(() => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
      });

      it('should parse temperature when set', () => {
        process.env.LLM_TEMPERATURE = '0.7';
        const config = loadConfigFromEnv();
        expect(config.temperature).toBe(0.7);
      });

      it('should parse maxTokens when set', () => {
        process.env.LLM_MAX_TOKENS = '2000';
        const config = loadConfigFromEnv();
        expect(config.maxTokens).toBe(2000);
      });

      it('should parse topP when set', () => {
        process.env.LLM_TOP_P = '0.9';
        const config = loadConfigFromEnv();
        expect(config.topP).toBe(0.9);
      });

      it('should set baseUrl for local provider', () => {
        process.env.LLM_PROVIDER = 'local';
        process.env.LOCAL_API_URL = 'http://localhost:8080/v1';
        const config = loadConfigFromEnv();
        expect(config.baseUrl).toBe('http://localhost:8080/v1');
      });

      it('should not set baseUrl for non-local providers', () => {
        const config = loadConfigFromEnv();
        expect(config.baseUrl).toBeUndefined();
      });

      it('should handle all optional parameters together', () => {
        process.env.LLM_TEMPERATURE = '0.8';
        process.env.LLM_MAX_TOKENS = '1500';
        process.env.LLM_TOP_P = '0.95';
        const config = loadConfigFromEnv();
        expect(config.temperature).toBe(0.8);
        expect(config.maxTokens).toBe(1500);
        expect(config.topP).toBe(0.95);
      });
    });
  });

  describe('createLLMClient', () => {
    describe('Singleton Pattern', () => {
      it('should return singleton instance when called without config', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
        const client1 = createLLMClient();
        const client2 = createLLMClient();
        expect(client1).toBe(client2);
      });

      it('should not cache when config is provided', () => {
        const config1 = {
          provider: 'openai' as const,
          model: 'gpt-4o',
          apiKey: 'sk-test-1',
        };
        const config2 = {
          provider: 'openai' as const,
          model: 'gpt-4o-mini',
          apiKey: 'sk-test-2',
        };
        const client1 = createLLMClient(config1);
        const client2 = createLLMClient(config2);
        expect(client1).not.toBe(client2);
      });

      it('should reset singleton with resetLLMClient', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
        const client1 = createLLMClient();
        resetLLMClient();
        const client2 = createLLMClient();
        expect(client1).not.toBe(client2);
      });
    });

    describe('Configuration Loading', () => {
      it('should load config from environment when not provided', () => {
        process.env.LLM_PROVIDER = 'anthropic';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        const client = createLLMClient();
        expect(client.getProvider()).toBe('anthropic');
      });

      it('should use provided config over environment', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-env-key';
        const client = createLLMClient({
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          apiKey: 'sk-override-key',
        });
        expect(client.getProvider()).toBe('anthropic');
      });
    });

    describe('Validation', () => {
      it('should throw error when apiKey is missing', () => {
        expect(() =>
          createLLMClient({
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: '',
          }),
        ).toThrow(LLMError);
        expect(() =>
          createLLMClient({
            provider: 'openai',
            model: 'gpt-4o',
            apiKey: '',
          }),
        ).toThrow(/API key is required/);
      });

      it('should throw error when model is missing', () => {
        expect(() =>
          createLLMClient({
            provider: 'openai',
            model: '',
            apiKey: 'sk-test',
          }),
        ).toThrow(LLMError);
        expect(() =>
          createLLMClient({
            provider: 'openai',
            model: '',
            apiKey: 'sk-test',
          }),
        ).toThrow(/Model is required/);
      });
    });

    describe('Provider Instantiation', () => {
      it('should create OpenAI client', () => {
        const client = createLLMClient({
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-test',
        });
        expect(client.getProvider()).toBe('openai');
        expect(client.getModel()).toBe('gpt-4o');
      });

      it('should create Anthropic client', () => {
        const client = createLLMClient({
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          apiKey: 'sk-ant-test',
        });
        expect(client.getProvider()).toBe('anthropic');
        expect(client.getModel()).toBe('claude-3-5-sonnet-20241022');
      });

      it('should create Gemini client', () => {
        const client = createLLMClient({
          provider: 'gemini',
          model: 'gemini-1.5-pro',
          apiKey: 'AIza-test',
        });
        expect(client.getProvider()).toBe('gemini');
        expect(client.getModel()).toBe('gemini-1.5-pro');
      });

      it('should create Local client', () => {
        const client = createLLMClient({
          provider: 'local',
          model: 'claude-sonnet-4-5',
          apiKey: 'not-needed',
          baseUrl: 'http://localhost:8000/v1',
        });
        expect(client.getProvider()).toBe('local');
        expect(client.getModel()).toBe('claude-sonnet-4-5');
      });

      it('should throw error for unsupported provider', () => {
        expect(() =>
          createLLMClient({
            provider: 'invalid' as any,
            model: 'test-model',
            apiKey: 'test-key',
          }),
        ).toThrow(LLMError);
        expect(() =>
          createLLMClient({
            provider: 'invalid' as any,
            model: 'test-model',
            apiKey: 'test-key',
          }),
        ).toThrow(/Unsupported provider/);
      });
    });

    describe('Provider Switching', () => {
      it('should allow switching providers with config', () => {
        const openaiClient = createLLMClient({
          provider: 'openai',
          model: 'gpt-4o',
          apiKey: 'sk-test',
        });
        expect(openaiClient.getProvider()).toBe('openai');

        const anthropicClient = createLLMClient({
          provider: 'anthropic',
          model: 'claude-3-5-sonnet-20241022',
          apiKey: 'sk-ant-test',
        });
        expect(anthropicClient.getProvider()).toBe('anthropic');
      });

      it('should allow switching via environment + reset', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
        const client1 = createLLMClient();
        expect(client1.getProvider()).toBe('openai');

        resetLLMClient();
        process.env.LLM_PROVIDER = 'anthropic';
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        const client2 = createLLMClient();
        expect(client2.getProvider()).toBe('anthropic');
      });
    });

    describe('Configuration Propagation', () => {
      it('should pass temperature to client', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
        process.env.LLM_TEMPERATURE = '0.7';
        const client = createLLMClient();
        expect(client).toBeDefined();
      });

      it('should pass maxTokens to client', () => {
        process.env.LLM_PROVIDER = 'openai';
        process.env.OPENAI_API_KEY = 'sk-test';
        process.env.LLM_MAX_TOKENS = '2000';
        const client = createLLMClient();
        expect(client).toBeDefined();
      });

      it('should pass baseUrl to local client', () => {
        const client = createLLMClient({
          provider: 'local',
          model: 'claude-sonnet-4-5',
          apiKey: 'not-needed',
          baseUrl: 'http://custom-url:8080/v1',
        });
        expect(client).toBeDefined();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty string for optional params', () => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.LLM_TEMPERATURE = '';
      process.env.LLM_MAX_TOKENS = '';
      process.env.LLM_TOP_P = '';
      const config = loadConfigFromEnv();
      expect(config.temperature).toBeUndefined();
      expect(config.maxTokens).toBeUndefined();
      expect(config.topP).toBeUndefined();
    });

    it('should handle invalid number strings for optional params', () => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.LLM_TEMPERATURE = 'invalid';
      process.env.LLM_MAX_TOKENS = 'not-a-number';
      const config = loadConfigFromEnv();
      expect(config.temperature).toBeNaN();
      expect(config.maxTokens).toBeNaN();
    });

    it('should handle zero values for optional params', () => {
      process.env.LLM_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.LLM_TEMPERATURE = '0';
      process.env.LLM_MAX_TOKENS = '0';
      process.env.LLM_TOP_P = '0';
      const config = loadConfigFromEnv();
      expect(config.temperature).toBe(0);
      expect(config.maxTokens).toBe(0);
      expect(config.topP).toBe(0);
    });
  });
});
