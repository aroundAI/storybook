import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import * as devMocks from '../dev-mock-modules';

describe('dev-mock-modules', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
  });

  describe('Turnstile mocks', () => {
    it('should export Turnstile as undefined', () => {
      expect(devMocks.Turnstile).toBeUndefined();
    });

    it('should export TurnstileProps as empty object', () => {
      expect(devMocks.TurnstileProps).toEqual({});
    });
  });

  describe('Baselime mocks', () => {
    it('should export useBaselimeRum as function', () => {
      expect(typeof devMocks.useBaselimeRum).toBe('function');
    });

    it('should export BaselimeRum as undefined', () => {
      expect(devMocks.BaselimeRum).toBeUndefined();
    });

    it('should log debug message when useBaselimeRum is called', () => {
      devMocks.useBaselimeRum();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('useBaselimeRum'),
      );
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('mocked for development'),
      );
    });

    it('should not throw when useBaselimeRum is called', () => {
      expect(() => devMocks.useBaselimeRum()).not.toThrow();
    });
  });

  describe('Sentry mocks', () => {
    it('should export captureException as function', () => {
      expect(typeof devMocks.captureException).toBe('function');
    });

    it('should export captureEvent as function', () => {
      expect(typeof devMocks.captureEvent).toBe('function');
    });

    it('should export init as function', () => {
      expect(typeof devMocks.init).toBe('function');
    });

    it('should export setUser as function', () => {
      expect(typeof devMocks.setUser).toBe('function');
    });

    it('should log debug message when captureException is called', () => {
      devMocks.captureException();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sentry.captureException'),
      );
    });

    it('should log debug message when captureEvent is called', () => {
      devMocks.captureEvent();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sentry.captureEvent'),
      );
    });

    it('should log debug message when init is called', () => {
      devMocks.init();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sentry.init'),
      );
    });

    it('should log debug message when setUser is called', () => {
      devMocks.setUser();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sentry.setUser'),
      );
    });

    it('should not throw when Sentry functions are called', () => {
      expect(() => devMocks.captureException()).not.toThrow();
      expect(() => devMocks.captureEvent()).not.toThrow();
      expect(() => devMocks.init()).not.toThrow();
      expect(() => devMocks.setUser()).not.toThrow();
    });
  });

  describe('Stripe mocks', () => {
    it('should export loadStripe as function', () => {
      expect(typeof devMocks.loadStripe).toBe('function');
    });

    it('should log debug message when loadStripe is called', () => {
      devMocks.loadStripe();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Stripe.loadStripe'),
      );
    });

    it('should not throw when loadStripe is called', () => {
      expect(() => devMocks.loadStripe()).not.toThrow();
    });
  });

  describe('Nodemailer mocks', () => {
    it('should export createTransport as function', () => {
      expect(typeof devMocks.createTransport).toBe('function');
    });

    it('should log debug message when createTransport is called', () => {
      devMocks.createTransport();

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Nodemailer.createTransport'),
      );
    });

    it('should not throw when createTransport is called', () => {
      expect(() => devMocks.createTransport()).not.toThrow();
    });
  });

  describe('noop function behavior', () => {
    it('should include function name in debug message', () => {
      devMocks.useBaselimeRum();

      const debugMessage = consoleDebugSpy.mock.calls[0][0];
      expect(debugMessage).toContain('useBaselimeRum');
    });

    it('should include "mocked for development" in message', () => {
      devMocks.captureException();

      const debugMessage = consoleDebugSpy.mock.calls[0][0];
      expect(debugMessage).toContain('mocked for development');
    });

    it('should include environment variable hint in message', () => {
      devMocks.loadStripe();

      const debugMessage = consoleDebugSpy.mock.calls[0][0];
      expect(debugMessage).toContain('environment variables');
    });

    it('should include support ticket suggestion in message', () => {
      devMocks.init();

      const debugMessage = consoleDebugSpy.mock.calls[0][0];
      expect(debugMessage).toContain('support ticket');
    });
  });

  describe('multiple invocations', () => {
    it('should log on each invocation', () => {
      devMocks.captureException();
      devMocks.captureException();
      devMocks.captureException();

      expect(consoleDebugSpy).toHaveBeenCalledTimes(3);
    });

    it('should handle rapid successive calls', () => {
      for (let i = 0; i < 10; i++) {
        devMocks.useBaselimeRum();
      }

      expect(consoleDebugSpy).toHaveBeenCalledTimes(10);
    });
  });

  describe('function return values', () => {
    it('should return undefined for all noop functions', () => {
      expect(devMocks.useBaselimeRum()).toBeUndefined();
      expect(devMocks.captureException()).toBeUndefined();
      expect(devMocks.captureEvent()).toBeUndefined();
      expect(devMocks.init()).toBeUndefined();
      expect(devMocks.setUser()).toBeUndefined();
      expect(devMocks.loadStripe()).toBeUndefined();
      expect(devMocks.createTransport()).toBeUndefined();
    });
  });

  describe('with arguments', () => {
    it('should accept arguments without error', () => {
      expect(() => devMocks.captureException(new Error('test'))).not.toThrow();
      expect(() =>
        devMocks.setUser({ id: '123', email: 'test@example.com' }),
      ).not.toThrow();
      expect(() => devMocks.loadStripe('pk_test_123')).not.toThrow();
    });

    it('should log even when called with arguments', () => {
      devMocks.captureException(new Error('test error'));

      expect(consoleDebugSpy).toHaveBeenCalled();
    });
  });

  describe('exported constants', () => {
    it('should have all Turnstile exports', () => {
      expect(devMocks).toHaveProperty('Turnstile');
      expect(devMocks).toHaveProperty('TurnstileProps');
    });

    it('should have all Baselime exports', () => {
      expect(devMocks).toHaveProperty('useBaselimeRum');
      expect(devMocks).toHaveProperty('BaselimeRum');
    });

    it('should have all Sentry exports', () => {
      expect(devMocks).toHaveProperty('captureException');
      expect(devMocks).toHaveProperty('captureEvent');
      expect(devMocks).toHaveProperty('init');
      expect(devMocks).toHaveProperty('setUser');
    });

    it('should have all Stripe exports', () => {
      expect(devMocks).toHaveProperty('loadStripe');
    });

    it('should have all Nodemailer exports', () => {
      expect(devMocks).toHaveProperty('createTransport');
    });
  });

  describe('integration scenarios', () => {
    it('should allow calling multiple mock functions in sequence', () => {
      devMocks.init();
      devMocks.setUser();
      devMocks.captureException();

      expect(consoleDebugSpy).toHaveBeenCalledTimes(3);
    });

    it('should not interfere with each other', () => {
      const calls: string[] = [];

      consoleDebugSpy.mockImplementation((message: string) => {
        calls.push(message);
      });

      devMocks.useBaselimeRum();
      devMocks.loadStripe();
      devMocks.createTransport();

      expect(calls.length).toBe(3);
      expect(calls[0]).toContain('useBaselimeRum');
      expect(calls[1]).toContain('loadStripe');
      expect(calls[2]).toContain('createTransport');
    });
  });
});
