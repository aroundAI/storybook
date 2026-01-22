import pino from 'pino';

/**
 * @name Logger
 * @description A logger implementation using Pino
 *
 * For AWS Lambda: Uses synchronous stdout for CloudWatch capture
 * For Development: Uses synchronous stdout to avoid worker exit errors
 * For Production with file logging: Uses async transport for performance
 */
const isBrowser = typeof window !== 'undefined';
const isDevelopment = process.env.NODE_ENV === 'development';
const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// In Lambda or development, use sync destination to stdout for guaranteed logging
// In production with file logging, use async transport for performance
const getDestination = () => {
  // Browser has no destination
  if (isBrowser) return undefined;

  // In Lambda, always use sync stdout for CloudWatch
  if (isLambda) {
    return pino.destination({ sync: true, dest: 1 }); // 1 = stdout
  }

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
              : process.env.LOG_FILE_PATH || './logs/app.log',
            mkdir: true,
          },
        },
      ],
    });
  }

  // Default: sync stdout for serverless/Lambda environments
  return pino.destination({ sync: true, dest: 1 });
};

const Logger = pino(
  {
    browser: {
      asObject: true,
    },
    level: process.env.LOG_LEVEL || 'debug',
    base: {
      env: process.env.NODE_ENV,
      ...(isLambda ? { lambda: process.env.AWS_LAMBDA_FUNCTION_NAME } : {}),
    },
    errorKey: 'error',
    // For Lambda, use a format CloudWatch can parse
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  getDestination(),
);

export { Logger };
