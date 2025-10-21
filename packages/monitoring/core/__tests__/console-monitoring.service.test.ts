import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConsoleMonitoringService } from '../src/console-monitoring.service';

describe('ConsoleMonitoringService', () => {
  let service: ConsoleMonitoringService;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    service = new ConsoleMonitoringService();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('identifyUser', () => {
    it('should log user identification with user ID', () => {
      const userId = { id: 'user-123' };

      service.identifyUser(userId);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Console Monitoring] Identified user',
        userId,
      );
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it('should log user identification with extended user info', () => {
      const userInfo = {
        id: 'user-456',
        email: 'user@example.com',
        name: 'John Doe',
      };

      service.identifyUser(userInfo);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Console Monitoring] Identified user',
        userInfo,
      );
    });

    it('should handle user identification with minimal info', () => {
      const minimalUser = { id: '' };

      service.identifyUser(minimalUser);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Console Monitoring] Identified user',
        minimalUser,
      );
    });

    it('should log multiple user identifications independently', () => {
      service.identifyUser({ id: 'user-1' });
      service.identifyUser({ id: 'user-2' });
      service.identifyUser({ id: 'user-3' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        1,
        '[Console Monitoring] Identified user',
        { id: 'user-1' },
      );
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        2,
        '[Console Monitoring] Identified user',
        { id: 'user-2' },
      );
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        3,
        '[Console Monitoring] Identified user',
        { id: 'user-3' },
      );
    });
  });

  describe('captureException', () => {
    it('should log basic error', () => {
      const error = new Error('Test error');

      service.captureException(error);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const call = consoleErrorSpy.mock.calls[0]?.[0];
      expect(call).toContain('[Console Monitoring] Caught exception:');
      // JSON.stringify(error) returns {} for standard Error objects
      expect(call).toContain('{}');
    });

    it('should log error with stack trace', () => {
      const error = new Error('Error with stack');
      error.stack = 'Error: Error with stack\n    at test.ts:10:5';

      service.captureException(error);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const call = consoleErrorSpy.mock.calls[0]?.[0];
      expect(call).toContain('[Console Monitoring] Caught exception:');
      // Stack is not included in JSON.stringify output
      expect(call).toContain('{}');
    });

    it('should log error with digest property', () => {
      const error = new Error('Digest error') as Error & { digest?: string };
      error.digest = 'error-digest-123';

      service.captureException(error);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const call = consoleErrorSpy.mock.calls[0]?.[0];
      expect(call).toContain('[Console Monitoring] Caught exception:');
      expect(call).toContain('error-digest-123');
    });

    it('should log error with extra data', () => {
      const error = new Error('Error with extra');
      const extra = { userId: 'user-123', action: 'submit-form' };

      service.captureException(error, extra);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const call = consoleErrorSpy.mock.calls[0]?.[0];
      expect(call).toContain('[Console Monitoring] Caught exception:');
    });

    it('should log error with config options', () => {
      const error = new Error('Error with config');
      const extra = { context: 'payment' };
      const config = { level: 'fatal', tags: ['billing'] };

      service.captureException(error, extra, config);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple exceptions', () => {
      service.captureException(new Error('Error 1'));
      service.captureException(new Error('Error 2'));
      service.captureException(new Error('Error 3'));

      expect(consoleErrorSpy).toHaveBeenCalledTimes(3);
    });

    it('should handle custom error types', () => {
      class CustomError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.code = code;
        }
      }

      const error = new CustomError('Custom error message', 'ERR_CUSTOM');

      service.captureException(error);

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const call = consoleErrorSpy.mock.calls[0]?.[0];
      // Custom properties like 'code' are included in JSON.stringify
      expect(call).toContain('ERR_CUSTOM');
      expect(call).toContain('"code"');
    });
  });

  describe('captureEvent', () => {
    it('should log basic event', () => {
      const event = 'user_login';

      service.captureEvent(event);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Console Monitoring] Captured event: user_login',
      );
      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });

    it('should log event with extra data', () => {
      const event = 'purchase_completed';
      const extra = { amount: 99.99, currency: 'USD' };

      service.captureEvent(event, extra);

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Console Monitoring] Captured event: purchase_completed',
      );
    });

    it('should log multiple events', () => {
      service.captureEvent('event_1');
      service.captureEvent('event_2');
      service.captureEvent('event_3');

      expect(consoleLogSpy).toHaveBeenCalledTimes(3);
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        1,
        '[Console Monitoring] Captured event: event_1',
      );
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        2,
        '[Console Monitoring] Captured event: event_2',
      );
      expect(consoleLogSpy).toHaveBeenNthCalledWith(
        3,
        '[Console Monitoring] Captured event: event_3',
      );
    });

    it('should log event with empty string name', () => {
      service.captureEvent('');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Console Monitoring] Captured event: ',
      );
    });

    it('should log event with special characters', () => {
      service.captureEvent('user:login:success');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Console Monitoring] Captured event: user:login:success',
      );
    });

    it('should log event with complex extra data', () => {
      const event = 'complex_event';
      const extra = {
        user: { id: 'user-123', role: 'admin' },
        metadata: { timestamp: Date.now(), version: '1.0.0' },
        tags: ['important', 'verified'],
      };

      service.captureEvent(event, extra);

      expect(consoleLogSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('ready', () => {
    it('should return resolved promise', async () => {
      const result = await service.ready();

      expect(result).toBeUndefined();
    });

    it('should resolve immediately', async () => {
      const startTime = Date.now();
      await service.ready();
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(10); // Should be nearly instant
    });

    it('should allow multiple ready calls', async () => {
      await service.ready();
      await service.ready();
      await service.ready();

      // Should not throw or cause issues
    });

    it('should be awaitable', async () => {
      const promise = service.ready();

      expect(promise).toBeInstanceOf(Promise);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('implementation conformance', () => {
    it('should implement MonitoringService interface', () => {
      expect(service).toHaveProperty('identifyUser');
      expect(service).toHaveProperty('captureException');
      expect(service).toHaveProperty('captureEvent');
      expect(service).toHaveProperty('ready');
    });

    it('should have all methods callable', () => {
      expect(typeof service.identifyUser).toBe('function');
      expect(typeof service.captureException).toBe('function');
      expect(typeof service.captureEvent).toBe('function');
      expect(typeof service.ready).toBe('function');
    });

    it('should not throw when methods are called', () => {
      expect(() => service.identifyUser({ id: 'test' })).not.toThrow();
      expect(() => service.captureException(new Error('test'))).not.toThrow();
      expect(() => service.captureEvent('test')).not.toThrow();
      expect(() => service.ready()).not.toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle complete user session tracking', () => {
      // User identifies
      service.identifyUser({ id: 'user-789', email: 'test@example.com' });

      // User performs actions
      service.captureEvent('page_view', { path: '/dashboard' });
      service.captureEvent('button_click', { button: 'submit' });

      // Error occurs
      service.captureException(new Error('Validation failed'), {
        field: 'email',
      });

      // Another event
      service.captureEvent('error_recovered');

      expect(consoleLogSpy).toHaveBeenCalledTimes(4); // 1 identify + 3 events
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1); // 1 exception
    });

    it('should handle rapid succession of events', () => {
      for (let i = 0; i < 100; i++) {
        service.captureEvent(`event_${i}`);
      }

      expect(consoleLogSpy).toHaveBeenCalledTimes(100);
    });

    it('should handle mixed operations', () => {
      service.identifyUser({ id: 'user-1' });
      service.captureEvent('login');
      service.captureException(new Error('Test'));
      service.captureEvent('logout');
      service.identifyUser({ id: 'user-2' });

      expect(consoleLogSpy).toHaveBeenCalledTimes(4); // 2 identify + 2 events
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1); // 1 exception
    });
  });
});
