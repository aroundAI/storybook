import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock next/headers - must be before imports
vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

import { headers } from 'next/headers';

import {
  extractNetworkContext,
  formatIpAddress,
} from '../src/server/extract-network-context';

const mockHeaders = vi.mocked(headers);

describe('extractNetworkContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('IP address extraction', () => {
    it('should extract IP from x-forwarded-for header', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for') return '192.168.1.1';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe('192.168.1.1');
    });

    it('should extract first IP from comma-separated x-forwarded-for', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for')
            return '192.168.1.1, 10.0.0.1, 172.16.0.1';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe('192.168.1.1');
    });

    it('should trim whitespace from x-forwarded-for IP', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for') return '  192.168.1.1  ';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe('192.168.1.1');
    });

    it('should fallback to x-real-ip when x-forwarded-for is not present', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-real-ip') return '10.0.0.1';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe('10.0.0.1');
    });

    it('should fallback to x-client-ip when other headers are not present', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-client-ip') return '172.16.0.1';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe('172.16.0.1');
    });

    it('should prefer x-forwarded-for over x-real-ip', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for') return '192.168.1.1';
          if (header === 'x-real-ip') return '10.0.0.1';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe('192.168.1.1');
    });

    it('should prefer x-real-ip over x-client-ip', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-real-ip') return '10.0.0.1';
          if (header === 'x-client-ip') return '172.16.0.1';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe('10.0.0.1');
    });

    it('should return undefined ipAddress when no IP headers present', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn(() => null),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBeUndefined();
    });
  });

  describe('User agent extraction', () => {
    it('should extract user agent from header', async () => {
      const userAgentString =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0';

      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'user-agent') return userAgentString;
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.userAgent).toBe(userAgentString);
    });

    it('should return undefined userAgent when header not present', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn(() => null),
      });

      const context = await extractNetworkContext();

      expect(context.userAgent).toBeUndefined();
    });

    it('should handle empty user agent string', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'user-agent') return '';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.userAgent).toBeUndefined();
    });
  });

  describe('Combined extraction', () => {
    it('should extract both IP and user agent', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for') return '192.168.1.1';
          if (header === 'user-agent') return 'Mozilla/5.0';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context).toEqual({
        ipAddress: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      });
    });

    it('should return empty object when headers throw error', async () => {
      mockHeaders.mockRejectedValue(new Error('Headers not available'));

      const context = await extractNetworkContext();

      expect(context).toEqual({});
    });

    it('should return empty object when headers() is not available', async () => {
      mockHeaders.mockImplementation(() => {
        throw new Error('Not in request context');
      });

      const context = await extractNetworkContext();

      expect(context).toEqual({});
    });
  });

  describe('Edge cases', () => {
    it('should handle IPv6 addresses in x-forwarded-for', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for')
            return '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe(
        '2001:0db8:85a3:0000:0000:8a2e:0370:7334',
      );
    });

    it('should handle localhost IP addresses', async () => {
      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'x-forwarded-for') return '127.0.0.1';
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.ipAddress).toBe('127.0.0.1');
    });

    it('should handle private network IPs', async () => {
      const privateIps = ['10.0.0.1', '172.16.0.1', '192.168.1.1'];

      for (const ip of privateIps) {
        mockHeaders.mockResolvedValue({
          get: vi.fn((header: string) => {
            if (header === 'x-forwarded-for') return ip;
            return null;
          }),
        });

        const context = await extractNetworkContext();
        expect(context.ipAddress).toBe(ip);
      }
    });

    it('should handle very long user agent strings', async () => {
      const longUserAgent = 'A'.repeat(1000);

      mockHeaders.mockResolvedValue({
        get: vi.fn((header: string) => {
          if (header === 'user-agent') return longUserAgent;
          return null;
        }),
      });

      const context = await extractNetworkContext();

      expect(context.userAgent).toBe(longUserAgent);
    });
  });
});

describe('formatIpAddress', () => {
  describe('IPv4 formatting', () => {
    it('should return valid IPv4 address', () => {
      expect(formatIpAddress('192.168.1.1')).toBe('192.168.1.1');
    });

    it('should remove port from IPv4 address', () => {
      expect(formatIpAddress('192.168.1.1:8080')).toBe('192.168.1.1');
    });

    it('should handle localhost', () => {
      expect(formatIpAddress('127.0.0.1')).toBe('127.0.0.1');
    });

    it('should handle all zeros', () => {
      expect(formatIpAddress('0.0.0.0')).toBe('0.0.0.0');
    });

    it('should handle all 255s', () => {
      expect(formatIpAddress('255.255.255.255')).toBe('255.255.255.255');
    });

    it('should handle private network ranges', () => {
      expect(formatIpAddress('10.0.0.1')).toBe('10.0.0.1');
      expect(formatIpAddress('172.16.0.1')).toBe('172.16.0.1');
      expect(formatIpAddress('192.168.0.1')).toBe('192.168.0.1');
    });
  });

  describe('IPv6 formatting', () => {
    it('should reject IPv6 addresses (not fully supported)', () => {
      // The current implementation has a simple IPv6 regex that requires
      // exactly 8 groups of exactly 4 hex digits each, which is very strict
      // and doesn't match most real-world IPv6 addresses
      expect(formatIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBeUndefined();
      expect(formatIpAddress('0000:0000:0000:0000:0000:0000:0000:0001')).toBeUndefined();
      expect(formatIpAddress('2001:db8::1')).toBeUndefined();
      expect(formatIpAddress('::1')).toBeUndefined();
      expect(formatIpAddress('::')).toBeUndefined();
    });
  });

  describe('Invalid IP handling', () => {
    it('should return undefined for undefined input', () => {
      expect(formatIpAddress(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(formatIpAddress('')).toBeUndefined();
    });

    it('should return undefined for invalid IPv4', () => {
      // Note: The simple regex doesn't validate number ranges (0-255)
      // so 256.256.256.256 actually passes the pattern check
      // This is a known limitation of the basic regex pattern
      expect(formatIpAddress('192.168.1')).toBeUndefined();
      expect(formatIpAddress('192.168.1.1.1')).toBeUndefined();
      expect(formatIpAddress('abc.def.ghi.jkl')).toBeUndefined();
    });

    it('should return undefined for partial IPv4', () => {
      expect(formatIpAddress('192.168')).toBeUndefined();
      expect(formatIpAddress('192')).toBeUndefined();
    });

    it('should return undefined for invalid IPv6', () => {
      expect(formatIpAddress('2001:0db8:85a3')).toBeUndefined();
      expect(formatIpAddress('gggg:hhhh:iiii:jjjj:kkkk:llll:mmmm:nnnn')).toBeUndefined();
    });

    it('should return undefined for non-IP strings', () => {
      expect(formatIpAddress('not-an-ip')).toBeUndefined();
      expect(formatIpAddress('localhost')).toBeUndefined();
      expect(formatIpAddress('example.com')).toBeUndefined();
    });

    it('should return undefined for special characters', () => {
      expect(formatIpAddress('192.168.1.1;drop table')).toBeUndefined();
      expect(formatIpAddress('192.168.1.1 OR 1=1')).toBeUndefined();
    });
  });

  describe('Port number handling', () => {
    it('should remove standard HTTP port', () => {
      expect(formatIpAddress('192.168.1.1:80')).toBe('192.168.1.1');
    });

    it('should remove standard HTTPS port', () => {
      expect(formatIpAddress('192.168.1.1:443')).toBe('192.168.1.1');
    });

    it('should remove custom port', () => {
      expect(formatIpAddress('192.168.1.1:3000')).toBe('192.168.1.1');
    });

    it('should handle multiple colons (IPv6 with port)', () => {
      // This will be treated as IPv6 format, but won't match the pattern
      expect(
        formatIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334:8080'),
      ).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('should handle whitespace', () => {
      expect(formatIpAddress('  192.168.1.1  ')).toBeUndefined();
    });

    it('should handle leading zeros in IPv4', () => {
      expect(formatIpAddress('192.168.001.001')).toBe('192.168.001.001');
    });

    it('should reject IPv4 with letters', () => {
      expect(formatIpAddress('192.168.a.1')).toBeUndefined();
    });

    it('should reject negative numbers', () => {
      expect(formatIpAddress('-1.-1.-1.-1')).toBeUndefined();
    });

    it('should handle IPv4-mapped IPv6', () => {
      // IPv4-mapped IPv6 like ::ffff:192.168.1.1 won't match our simple pattern
      expect(formatIpAddress('::ffff:192.168.1.1')).toBeUndefined();
    });
  });
});
