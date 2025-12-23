import pino from 'pino';

/**
 * @name Logger
 * @description A logger implementation using Pino
 */
const isBrowser = typeof window !== 'undefined';

const transport =
  !isBrowser && process.env.ENABLE_FILE_LOGGING === 'true'
    ? pino.transport({
      targets: [
        // Write to stdout (but we rely on nextjs piping usually, so this might duplicate)
        // Actually, standard pino writes to stdout by default.
        // If we provide a transport, it TAKES OVER.
        // So we need to ensure we still write to stdout if we want to see it there.
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
    })
    : undefined;

const Logger = pino({
  browser: {
    asObject: true,
  },
  level: process.env.LOG_LEVEL || 'debug',
  base: {
    env: process.env.NODE_ENV,
  },
  errorKey: 'error',
}, transport);

export { Logger };
