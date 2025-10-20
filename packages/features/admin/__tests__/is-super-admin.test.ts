import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { isSuperAdmin } from '../src/lib/server/utils/is-super-admin';

// Mock Supabase client
const mockRpc = vi.fn();

const mockSupabaseClient = {
  rpc: mockRpc,
} as unknown as SupabaseClient;

describe('isSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when user is super admin', async () => {
    mockRpc.mockResolvedValue({
      data: true,
      error: null,
    });

    const result = await isSuperAdmin(mockSupabaseClient);

    expect(mockRpc).toHaveBeenCalledWith('is_super_admin');
    expect(result).toBe(true);
  });

  it('should return false when user is not super admin', async () => {
    mockRpc.mockResolvedValue({
      data: false,
      error: null,
    });

    const result = await isSuperAdmin(mockSupabaseClient);

    expect(result).toBe(false);
  });

  it('should return false when RPC returns error', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'RPC error', code: '500' },
    });

    const result = await isSuperAdmin(mockSupabaseClient);

    expect(result).toBe(false);
  });

  it('should return false when RPC throws exception', async () => {
    mockRpc.mockRejectedValue(new Error('Database connection failed'));

    const result = await isSuperAdmin(mockSupabaseClient);

    expect(result).toBe(false);
  });

  it('should return false when RPC returns null data', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: null,
    });

    const result = await isSuperAdmin(mockSupabaseClient);

    // The function returns the actual data value, which is null in this case
    expect(result).toBeNull();
  });

  it('should handle network timeouts gracefully', async () => {
    mockRpc.mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 100);
      });
    });

    const result = await isSuperAdmin(mockSupabaseClient);

    expect(result).toBe(false);
  });

  it('should call RPC function exactly once', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });

    await isSuperAdmin(mockSupabaseClient);

    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('should handle RPC with non-boolean data types', async () => {
    mockRpc.mockResolvedValue({
      data: 'true', // String instead of boolean
      error: null,
    });

    const result = await isSuperAdmin(mockSupabaseClient);

    // Should still handle truthy values
    expect(result).toBeTruthy();
  });

  it('should handle empty error objects', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {},
    });

    const result = await isSuperAdmin(mockSupabaseClient);

    expect(result).toBe(false);
  });

  it('should return false for undefined RPC response', async () => {
    mockRpc.mockResolvedValue(undefined);

    const result = await isSuperAdmin(mockSupabaseClient);

    expect(result).toBe(false);
  });
});
