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

// Set Supabase environment variables for server actions
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = 'test-public-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// Set environment variables for email services
process.env.EMAIL_SENDER = 'noreply@test.com';
process.env.NEXT_PUBLIC_PRODUCT_NAME = 'Test Product';
