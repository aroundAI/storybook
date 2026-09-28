import { describe, expect, it } from 'vitest';

import {
  awsClientOptions,
  ignoredVendorOverrides,
  localServiceUrl,
  queueUrlFromEnv,
} from '../src/vendors';

/**
 * FILM-1806: the local SQS, DynamoDB and API Gateway emulators are reachable
 * only in the sandbox. Outside it the variables are never read - a value
 * that would throw if read proves it - and the AWS clients are built exactly
 * as before.
 */

const DEV = { NODE_ENV: 'development', VENDOR_SANDBOX: '1' };
const PRODUCTION = { NODE_ENV: 'production', VENDOR_SANDBOX: '1' };
const LAMBDA = { ...DEV, AWS_LAMBDA_FUNCTION_NAME: 'storybook-llm-worker' };

describe('localServiceUrl', () => {
  it('names the emulator in the sandbox', () => {
    expect(
      localServiceUrl('sqs', {
        ...DEV,
        VENDOR_URL_SQS: 'http://127.0.0.1:4120',
      }),
    ).toBe('http://127.0.0.1:4120');
    expect(
      localServiceUrl('dynamodb', {
        ...DEV,
        VENDOR_URL_DYNAMODB: 'http://127.0.0.1:4122',
      }),
    ).toBe('http://127.0.0.1:4122');
  });

  it.each([
    ['production', PRODUCTION],
    ['a Lambda', LAMBDA],
    ['development without VENDOR_SANDBOX', { NODE_ENV: 'development' }],
  ])('never reads the variable in %s', (_label, env) => {
    // Malformed on purpose: reading it would throw.
    const set = {
      VENDOR_URL_SQS: 'not a url',
      VENDOR_URL_DYNAMODB: 'not a url',
      VENDOR_URL_APIGATEWAY: 'not a url',
      VENDOR_URL_R2: 'not a url',
    };
    expect(localServiceUrl('sqs', { ...env, ...set })).toBeUndefined();
    expect(localServiceUrl('dynamodb', { ...env, ...set })).toBeUndefined();
    expect(localServiceUrl('r2', { ...env, ...set })).toBeUndefined();
    expect(awsClientOptions('dynamodb', { ...env, ...set })).toEqual({});
    expect(awsClientOptions('apigateway', { ...env, ...set })).toEqual({});
  });

  it('refuses a public address in the sandbox rather than use it', () => {
    expect(() =>
      localServiceUrl('dynamodb', {
        ...DEV,
        VENDOR_URL_DYNAMODB: 'https://dynamodb.example.com',
      }),
    ).toThrow(/VENDOR_URL_DYNAMODB must be/);
  });
});

describe('awsClientOptions', () => {
  it('gives the emulator endpoint and placeholder credentials in the sandbox', () => {
    expect(
      awsClientOptions('sqs', {
        ...DEV,
        VENDOR_URL_SQS: 'http://127.0.0.1:4120',
      }),
    ).toEqual({
      endpoint: 'http://127.0.0.1:4120',
      region: 'us-east-1',
      credentials: { accessKeyId: 'sandbox', secretAccessKey: 'sandbox' },
    });
  });

  it('adds nothing when the sandbox has no override for the service', () => {
    expect(awsClientOptions('sqs', DEV)).toEqual({});
  });
});

describe('queueUrlFromEnv', () => {
  const LOCAL = 'http://127.0.0.1:4120/000000000000/StorybookLlmJobsQueue';
  const AWS =
    'https://sqs.eu-west-1.amazonaws.com/123456789012/StorybookLlmJobsQueue';

  it('keeps a local queue URL in the sandbox', () => {
    expect(queueUrlFromEnv(LOCAL, DEV)).toBe(LOCAL);
  });

  it.each([
    ['production', PRODUCTION],
    ['a Lambda', LAMBDA],
  ])('drops a local queue URL in %s', (_label, env) => {
    expect(queueUrlFromEnv(LOCAL, env)).toBeUndefined();
  });

  it('keeps a real queue URL everywhere', () => {
    expect(queueUrlFromEnv(AWS, PRODUCTION)).toBe(AWS);
    expect(queueUrlFromEnv(AWS, DEV)).toBe(AWS);
  });

  it('treats an absent or malformed value as unset', () => {
    expect(queueUrlFromEnv(undefined, DEV)).toBeUndefined();
    expect(queueUrlFromEnv('not a url', DEV)).toBeUndefined();
  });
});

describe('ignoredVendorOverrides', () => {
  it('reports the local-service variables in production and accepts them in the sandbox', () => {
    const set = {
      VENDOR_URL_SQS: 'http://127.0.0.1:4120',
      VENDOR_URL_DYNAMODB: 'http://127.0.0.1:4122',
    };
    expect(ignoredVendorOverrides({ ...PRODUCTION, ...set })).toEqual([
      'VENDOR_URL_DYNAMODB',
      'VENDOR_URL_SQS',
    ]);
    expect(ignoredVendorOverrides({ ...DEV, ...set })).toEqual([]);
  });
});
