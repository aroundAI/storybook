import { vi } from 'vitest';

// Mock Next.js headers
vi.mock('next/headers', () => ({
  headers: () => new Headers(),
  cookies: () => ({
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    getAll: vi.fn(() => []),
    has: vi.fn(() => false),
  }),
}));

// Set environment variables for webhook services that validate at module load
process.env.NEXT_PUBLIC_SITE_URL = 'https://test.com';
process.env.NEXT_PUBLIC_PRODUCT_NAME = 'Test Product';
process.env.EMAIL_SENDER = 'noreply@test.com';

// Set Supabase environment variables for server actions
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'test-public-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
