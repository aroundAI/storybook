import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('Logger Factory', () => {
  // Store original env
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules and environment before each test
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;
  });

  describe('getLogger', () => {
    describe('console logger', () => {
      it('should return console logger when LOGGER=console', async () => {
        process.env.LOGGER = 'console';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.fatal).toBe('function');
      });

      it('should log info messages', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        logger.info('Test info message');

        expect(consoleInfoSpy).toHaveBeenCalledWith('Test info message');
        consoleInfoSpy.mockRestore();
      });

      it('should log error messages', async () => {
        process.env.LOGGER = 'console';
        const consoleErrorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        logger.error('Test error message');

        expect(consoleErrorSpy).toHaveBeenCalledWith('Test error message');
        consoleErrorSpy.mockRestore();
      });

      it('should log warning messages', async () => {
        process.env.LOGGER = 'console';
        const consoleWarnSpy = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        logger.warn('Test warning');

        expect(consoleWarnSpy).toHaveBeenCalledWith('Test warning');
        consoleWarnSpy.mockRestore();
      });

      it('should log debug messages', async () => {
        process.env.LOGGER = 'console';
        const consoleDebugSpy = vi
          .spyOn(console, 'debug')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        logger.debug('Test debug');

        expect(consoleDebugSpy).toHaveBeenCalledWith('Test debug');
        consoleDebugSpy.mockRestore();
      });

      it('should log fatal messages using console.error', async () => {
        process.env.LOGGER = 'console';
        const consoleErrorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        logger.fatal('Test fatal');

        expect(consoleErrorSpy).toHaveBeenCalledWith('Test fatal');
        consoleErrorSpy.mockRestore();
      });

      it('should handle object logging', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        const obj = { foo: 'bar', num: 123 };
        logger.info(obj, 'Object message');

        expect(consoleInfoSpy).toHaveBeenCalledWith(obj, 'Object message');
        consoleInfoSpy.mockRestore();
      });

      it('should handle multiple arguments', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        logger.info('Message with', 'multiple', 'args');

        expect(consoleInfoSpy).toHaveBeenCalledWith(
          'Message with',
          'multiple',
          'args',
        );
        consoleInfoSpy.mockRestore();
      });
    });

    describe('pino logger', () => {
      it('should return pino logger when LOGGER=pino', async () => {
        process.env.LOGGER = 'pino';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        expect(logger).toBeDefined();
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.fatal).toBe('function');
      });

      it('should use pino as default when LOGGER not set', async () => {
        delete process.env.LOGGER;

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        expect(logger).toBeDefined();
        // Pino logger has additional properties
        expect(logger).toHaveProperty('info');
        expect(logger).toHaveProperty('error');
        expect(logger).toHaveProperty('warn');
        expect(logger).toHaveProperty('debug');
        expect(logger).toHaveProperty('fatal');
      });

      it('should have pino-specific properties', async () => {
        process.env.LOGGER = 'pino';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        // Pino loggers have child() method
        expect(typeof (logger as any).child).toBe('function');
        // Pino loggers have level property
        expect((logger as any).level).toBeDefined();
      });

      it('should handle string messages', async () => {
        process.env.LOGGER = 'pino';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        // Should not throw
        expect(() => logger.info('Test message')).not.toThrow();
        expect(() => logger.error('Error message')).not.toThrow();
        expect(() => logger.warn('Warning message')).not.toThrow();
        expect(() => logger.debug('Debug message')).not.toThrow();
        expect(() => logger.fatal('Fatal message')).not.toThrow();
      });

      it('should handle object messages', async () => {
        process.env.LOGGER = 'pino';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        const obj = { key: 'value', number: 42 };

        // Should not throw
        expect(() => logger.info(obj, 'With object')).not.toThrow();
      });

      it('should have configured level as debug', async () => {
        process.env.LOGGER = 'pino';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        expect((logger as any).level).toBe('debug');
      });
    });

    describe('provider switching', () => {
      it('should switch from console to pino', async () => {
        // First use console
        process.env.LOGGER = 'console';

        const { getLogger: getLogger1 } = await import('../src/logger/index');
        const logger1 = await getLogger1();

        // Verify it's console logger (doesn't have child method)
        expect((logger1 as any).child).toBeUndefined();

        // Reset and switch to pino
        vi.resetModules();
        process.env.LOGGER = 'pino';

        const { getLogger: getLogger2 } = await import('../src/logger/index');
        const logger2 = await getLogger2();

        // Verify it's pino logger (has child method)
        expect(typeof (logger2 as any).child).toBe('function');
      });

      it('should switch from pino to console', async () => {
        // First use pino
        process.env.LOGGER = 'pino';

        const { getLogger: getLogger1 } = await import('../src/logger/index');
        const logger1 = await getLogger1();

        expect(typeof (logger1 as any).child).toBe('function');

        // Reset and switch to console
        vi.resetModules();
        process.env.LOGGER = 'console';

        const { getLogger: getLogger2 } = await import('../src/logger/index');
        const logger2 = await getLogger2();

        // Console logger doesn't have child method
        expect((logger2 as any).child).toBeUndefined();
      });
    });

    describe('error handling', () => {
      it('should handle invalid LOGGER value', async () => {
        process.env.LOGGER = 'invalid' as any;

        const { getLogger } = await import('../src/logger/index');

        // Should throw when trying to get invalid logger
        await expect(getLogger()).rejects.toThrow();
      });

      it('should throw error for empty LOGGER value', async () => {
        process.env.LOGGER = '';

        const { getLogger } = await import('../src/logger/index');

        // Empty string is not a valid logger provider
        await expect(getLogger()).rejects.toThrow();
      });
    });

    describe('concurrent access', () => {
      it('should handle multiple getLogger calls for console', async () => {
        process.env.LOGGER = 'console';

        const { getLogger } = await import('../src/logger/index');

        const [logger1, logger2, logger3] = await Promise.all([
          getLogger(),
          getLogger(),
          getLogger(),
        ]);

        expect(logger1).toBeDefined();
        expect(logger2).toBeDefined();
        expect(logger3).toBeDefined();
      });

      it('should handle multiple getLogger calls for pino', async () => {
        process.env.LOGGER = 'pino';

        const { getLogger } = await import('../src/logger/index');

        const [logger1, logger2, logger3] = await Promise.all([
          getLogger(),
          getLogger(),
          getLogger(),
        ]);

        expect(logger1).toBeDefined();
        expect(logger2).toBeDefined();
        expect(logger3).toBeDefined();
      });
    });

    describe('integration scenarios', () => {
      it('should support rapid sequential logging', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        // Log 10 messages rapidly
        for (let i = 0; i < 10; i++) {
          logger.info(`Message ${i}`);
        }

        expect(consoleInfoSpy).toHaveBeenCalledTimes(10);
        consoleInfoSpy.mockRestore();
      });

      it('should handle mixed log levels', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});
        const consoleErrorSpy = vi
          .spyOn(console, 'error')
          .mockImplementation(() => {});
        const consoleWarnSpy = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        logger.info('Info');
        logger.error('Error');
        logger.warn('Warning');
        logger.info('Info 2');

        expect(consoleInfoSpy).toHaveBeenCalledTimes(2);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleWarnSpy).toHaveBeenCalledTimes(1);

        consoleInfoSpy.mockRestore();
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
      });

      it('should handle complex objects', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        const complexObj = {
          user: { id: '123', name: 'John' },
          meta: { timestamp: Date.now(), nested: { deep: true } },
          array: [1, 2, 3],
        };

        logger.info(complexObj, 'Complex object');

        expect(consoleInfoSpy).toHaveBeenCalledWith(complexObj, 'Complex object');
        consoleInfoSpy.mockRestore();
      });

      it('should work in serverless environment', async () => {
        process.env.LOGGER = 'pino';
        process.env.AWS_LAMBDA_FUNCTION_NAME = 'test-function';
        process.env.AWS_EXECUTION_ENV = 'AWS_Lambda_nodejs20.x';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        // Should not throw
        expect(() => logger.info('Lambda log')).not.toThrow();

        delete process.env.AWS_LAMBDA_FUNCTION_NAME;
        delete process.env.AWS_EXECUTION_ENV;
      });
    });

    describe('logger interface conformance', () => {
      it('should implement all required methods for console', async () => {
        process.env.LOGGER = 'console';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        const requiredMethods = ['info', 'error', 'warn', 'debug', 'fatal'];

        for (const method of requiredMethods) {
          expect(typeof (logger as any)[method]).toBe('function');
        }
      });

      it('should implement all required methods for pino', async () => {
        process.env.LOGGER = 'pino';

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        const requiredMethods = ['info', 'error', 'warn', 'debug', 'fatal'];

        for (const method of requiredMethods) {
          expect(typeof (logger as any)[method]).toBe('function');
        }
      });
    });

    describe('edge cases', () => {
      it('should handle null messages', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        // Should not throw
        expect(() => logger.info(null as any)).not.toThrow();
        consoleInfoSpy.mockRestore();
      });

      it('should handle undefined messages', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        // Should not throw
        expect(() => logger.info(undefined as any)).not.toThrow();
        consoleInfoSpy.mockRestore();
      });

      it('should handle empty string messages', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        logger.info('');

        expect(consoleInfoSpy).toHaveBeenCalledWith('');
        consoleInfoSpy.mockRestore();
      });

      it('should handle very long messages', async () => {
        process.env.LOGGER = 'console';
        const consoleInfoSpy = vi
          .spyOn(console, 'info')
          .mockImplementation(() => {});

        const { getLogger } = await import('../src/logger/index');
        const logger = await getLogger();

        const longMessage = 'A'.repeat(10000);
        logger.info(longMessage);

        expect(consoleInfoSpy).toHaveBeenCalledWith(longMessage);
        consoleInfoSpy.mockRestore();
      });
    });
  });
});
