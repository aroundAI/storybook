import pino from 'pino';

/**
 * @name Logger
 * @description A logger implementation using Pino
 * 
 * Uses synchronous logging in development to avoid worker exit errors.
 * In production, uses async transport for better performance.
 */
const isBrowser = typeof window !== 'undefined';
const isDevelopment = process.env.NODE_ENV === 'development';

// In development, avoid async transports to prevent "worker has exited" errors
// In production with file logging, use async transport for performance
const getDestination = () => {
  // Browser has no destination
  if (isBrowser) return undefined;

  // In development, use sync destination to stdout
  if (isDevelopment) {
    return pino.destination({ sync: true });
  }

  // In production with file logging, use async transport
  if (process.env.ENABLE_FILE_LOGGING === 'true') {
    return pino.transport({
      targets: [
        {
          target: 'pino/file',
          options: { destination: 1 }, // 1 = stdout
        },
        {
          target: 'pino/file',
          options: {
            destination: process.env.STORAGE_LOCAL_PATH
              ? `${process.env.STORAGE_LOCAL_PATH}/logs/app.log`
              : (process.env.LOG_FILE_PATH || './logs/app.log'),
            mkdir: true,
          },
        },
      ],
    });
  }

  return undefined;
};

const Logger = pino({
  browser: {
    asObject: true,
  },
  level: process.env.LOG_LEVEL || 'debug',
  base: {
    env: process.env.NODE_ENV,
  },
  errorKey: 'error',
}, getDestination());

export { Logger };
