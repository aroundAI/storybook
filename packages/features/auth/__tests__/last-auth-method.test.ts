import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type LastAuthMethod,
  clearLastAuthMethod,
  getLastAuthMethod,
  saveLastAuthMethod,
} from '../src/utils/last-auth-method';

// Mock isBrowser from @kit/shared/utils
vi.mock('@kit/shared/utils', () => ({
  isBrowser: vi.fn(() => true),
}));

describe('LastAuthMethod Utils', () => {
  // Mock localStorage
  let localStorageMock: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Create localStorage mock
    localStorageMock = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    // Replace global localStorage
    Object.defineProperty(global, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Spy on console.warn to suppress warnings in tests
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('saveLastAuthMethod', () => {
    it('should save password auth method to localStorage', () => {
      const authMethod: LastAuthMethod = {
        method: 'password',
        email: 'user@example.com',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(authMethod);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'auth_last_method',
        JSON.stringify(authMethod),
      );
    });

    it('should save OTP auth method to localStorage', () => {
      const authMethod: LastAuthMethod = {
        method: 'otp',
        email: 'user@example.com',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(authMethod);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'auth_last_method',
        JSON.stringify(authMethod),
      );
    });

    it('should save magic link auth method to localStorage', () => {
      const authMethod: LastAuthMethod = {
        method: 'magic_link',
        email: 'user@example.com',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(authMethod);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'auth_last_method',
        JSON.stringify(authMethod),
      );
    });

    it('should save OAuth auth method with provider', () => {
      const authMethod: LastAuthMethod = {
        method: 'oauth',
        provider: 'google',
        email: 'user@example.com',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(authMethod);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'auth_last_method',
        JSON.stringify(authMethod),
      );
    });

    it('should save OAuth method with different providers', () => {
      const providers = ['google', 'github', 'facebook', 'twitter'];

      providers.forEach((provider) => {
        const authMethod: LastAuthMethod = {
          method: 'oauth',
          provider,
          timestamp: Date.now(),
        };

        saveLastAuthMethod(authMethod);

        expect(localStorageMock.setItem).toHaveBeenCalledWith(
          'auth_last_method',
          JSON.stringify(authMethod),
        );
      });
    });

    it('should save auth method without email', () => {
      const authMethod: LastAuthMethod = {
        method: 'oauth',
        provider: 'google',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(authMethod);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'auth_last_method',
        JSON.stringify(authMethod),
      );
    });

    it('should handle localStorage errors gracefully', () => {
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const authMethod: LastAuthMethod = {
        method: 'password',
        timestamp: Date.now(),
      };

      // Should not throw
      expect(() => saveLastAuthMethod(authMethod)).not.toThrow();

      expect(console.warn).toHaveBeenCalledWith(
        'Failed to save last auth method:',
        expect.any(Error),
      );
    });
  });

  describe('getLastAuthMethod', () => {
    it('should return null when not in browser', async () => {
      const { isBrowser } = await import('@kit/shared/utils');
      vi.mocked(isBrowser).mockReturnValue(false);

      const result = getLastAuthMethod();

      expect(result).toBeNull();
      expect(localStorageMock.getItem).not.toHaveBeenCalled();
    });

    it('should return null when no data stored', () => {
      localStorageMock.getItem.mockReturnValue(null);

      const result = getLastAuthMethod();

      expect(result).toBeNull();
      expect(localStorageMock.getItem).toHaveBeenCalledWith('auth_last_method');
    });

    it('should return stored auth method if recent', () => {
      const authMethod: LastAuthMethod = {
        method: 'password',
        email: 'user@example.com',
        timestamp: Date.now(),
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(authMethod));

      const result = getLastAuthMethod();

      expect(result).toEqual(authMethod);
    });

    it('should return null and remove if older than 30 days', () => {
      const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000;
      const authMethod: LastAuthMethod = {
        method: 'password',
        email: 'user@example.com',
        timestamp: thirtyOneDaysAgo,
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(authMethod));

      const result = getLastAuthMethod();

      expect(result).toBeNull();
      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        'auth_last_method',
      );
    });

    it('should return auth method if exactly 29 days old', () => {
      const twentyNineDaysAgo = Date.now() - 29 * 24 * 60 * 60 * 1000;
      const authMethod: LastAuthMethod = {
        method: 'oauth',
        provider: 'google',
        timestamp: twentyNineDaysAgo,
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(authMethod));

      const result = getLastAuthMethod();

      expect(result).toEqual(authMethod);
      expect(localStorageMock.removeItem).not.toHaveBeenCalled();
    });

    it('should handle invalid JSON gracefully', () => {
      localStorageMock.getItem.mockReturnValue('invalid json {');

      const result = getLastAuthMethod();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        'Failed to get last auth method:',
        expect.any(Error),
      );
    });

    it('should handle localStorage errors gracefully', () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error('SecurityError');
      });

      const result = getLastAuthMethod();

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(
        'Failed to get last auth method:',
        expect.any(Error),
      );
    });

    it('should return OAuth method with provider', () => {
      const authMethod: LastAuthMethod = {
        method: 'oauth',
        provider: 'github',
        email: 'dev@example.com',
        timestamp: Date.now(),
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(authMethod));

      const result = getLastAuthMethod();

      expect(result).toEqual(authMethod);
      expect(result?.provider).toBe('github');
    });

    it('should return method without email field', () => {
      const authMethod: LastAuthMethod = {
        method: 'magic_link',
        timestamp: Date.now(),
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(authMethod));

      const result = getLastAuthMethod();

      expect(result).toEqual(authMethod);
      expect(result?.email).toBeUndefined();
    });
  });

  describe('clearLastAuthMethod', () => {
    it('should remove auth method from localStorage', () => {
      clearLastAuthMethod();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        'auth_last_method',
      );
    });

    it('should handle localStorage errors gracefully', () => {
      localStorageMock.removeItem.mockImplementation(() => {
        throw new Error('SecurityError');
      });

      // Should not throw
      expect(() => clearLastAuthMethod()).not.toThrow();

      expect(console.warn).toHaveBeenCalledWith(
        'Failed to clear last auth method:',
        expect.any(Error),
      );
    });

    it('should be callable multiple times', () => {
      clearLastAuthMethod();
      clearLastAuthMethod();
      clearLastAuthMethod();

      expect(localStorageMock.removeItem).toHaveBeenCalledTimes(3);
    });
  });

  describe('integration scenarios', () => {
    it('should save and retrieve password method', () => {
      const authMethod: LastAuthMethod = {
        method: 'password',
        email: 'test@example.com',
        timestamp: Date.now(),
      };

      // Save
      saveLastAuthMethod(authMethod);

      // Mock getItem to return what setItem saved
      const savedData = localStorageMock.setItem.mock.calls[0][1];
      localStorageMock.getItem.mockReturnValue(savedData);

      // Retrieve
      const retrieved = getLastAuthMethod();

      expect(retrieved).toEqual(authMethod);
    });

    it('should save and clear method', () => {
      const authMethod: LastAuthMethod = {
        method: 'otp',
        email: 'user@example.com',
        timestamp: Date.now(),
      };

      // Save
      saveLastAuthMethod(authMethod);

      // Clear
      clearLastAuthMethod();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith(
        'auth_last_method',
      );
    });

    it('should overwrite previous auth method', () => {
      const firstMethod: LastAuthMethod = {
        method: 'password',
        timestamp: Date.now(),
      };

      const secondMethod: LastAuthMethod = {
        method: 'oauth',
        provider: 'google',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(firstMethod);
      saveLastAuthMethod(secondMethod);

      expect(localStorageMock.setItem).toHaveBeenCalledTimes(2);
      expect(localStorageMock.setItem).toHaveBeenLastCalledWith(
        'auth_last_method',
        JSON.stringify(secondMethod),
      );
    });
  });

  describe('edge cases', () => {
    it('should handle method with very long email', () => {
      const authMethod: LastAuthMethod = {
        method: 'password',
        email: 'a'.repeat(1000) + '@example.com',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(authMethod);

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'auth_last_method',
        JSON.stringify(authMethod),
      );
    });

    it('should handle timestamp at exact 30-day boundary', () => {
      // Use a fixed timestamp to avoid race condition between test setup and function call
      const fixedNow = 1700000000000; // Fixed point in time
      vi.setSystemTime(fixedNow);

      const exactlyThirtyDaysAgo = fixedNow - 30 * 24 * 60 * 60 * 1000;
      const authMethod: LastAuthMethod = {
        method: 'password',
        timestamp: exactlyThirtyDaysAgo,
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(authMethod));

      const result = getLastAuthMethod();

      // Should NOT be removed (uses < not <=, so exactly 30 days is still valid)
      expect(result).toEqual(authMethod);
      expect(localStorageMock.removeItem).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should handle future timestamp', () => {
      const futureTimestamp = Date.now() + 24 * 60 * 60 * 1000;
      const authMethod: LastAuthMethod = {
        method: 'oauth',
        provider: 'google',
        timestamp: futureTimestamp,
      };

      localStorageMock.getItem.mockReturnValue(JSON.stringify(authMethod));

      const result = getLastAuthMethod();

      expect(result).toEqual(authMethod);
    });

    it('should handle special characters in email', () => {
      const authMethod: LastAuthMethod = {
        method: 'password',
        email: 'user+test@example.com\'"<>',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(authMethod);

      const savedData = localStorageMock.setItem.mock.calls[0][1];
      expect(JSON.parse(savedData)).toEqual(authMethod);
    });

    it('should handle Unicode characters in email', () => {
      const authMethod: LastAuthMethod = {
        method: 'password',
        email: '用户@example.com',
        timestamp: Date.now(),
      };

      saveLastAuthMethod(authMethod);

      const savedData = localStorageMock.setItem.mock.calls[0][1];
      expect(JSON.parse(savedData)).toEqual(authMethod);
    });
  });
});
