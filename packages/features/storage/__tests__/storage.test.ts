/**
 * Storage Adapter Tests
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(Buffer.from('test')),
  unlinkSync: vi.fn(),
}));

// Mock server-only
vi.mock('server-only', () => ({}));

describe('LocalStorageAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should exist as a module', async () => {
    // Basic test to ensure module loads
    const { LocalStorageAdapter } = await import('../src/adapters/local');
    expect(LocalStorageAdapter).toBeDefined();
  });

  it('should construct with default options', async () => {
    const { LocalStorageAdapter } = await import('../src/adapters/local');
    const adapter = new LocalStorageAdapter();
    expect(adapter).toBeInstanceOf(LocalStorageAdapter);
  });

  it('should construct with custom options', async () => {
    const { LocalStorageAdapter } = await import('../src/adapters/local');
    const adapter = new LocalStorageAdapter({
      basePath: '/custom/path',
      baseUrl: 'https://example.com',
    });
    expect(adapter).toBeInstanceOf(LocalStorageAdapter);
  });
});

describe('SupabaseStorageAdapter', () => {
  it('should exist as a module', async () => {
    const { SupabaseStorageAdapter } = await import('../src/adapters/supabase');
    expect(SupabaseStorageAdapter).toBeDefined();
  });
});

describe('getStorageAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module cache
    vi.resetModules();
  });

  it('should return R2StorageAdapter when STORAGE_PROVIDER=r2', async () => {
    process.env.STORAGE_PROVIDER = 'r2';
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    process.env.R2_BUCKET_NAME = 'test-bucket';
    const { getStorageAdapter, R2StorageAdapter } = await import('../src');
    const adapter = getStorageAdapter();
    expect(adapter).toBeInstanceOf(R2StorageAdapter);
  });

  it('should throw when STORAGE_PROVIDER=supabase without client', async () => {
    process.env.STORAGE_PROVIDER = 'supabase';
    vi.resetModules();
    const { getStorageAdapter } = await import('../src');
    expect(() => getStorageAdapter()).toThrow('Supabase client is required');
  });
});
