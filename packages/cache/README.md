# @kit/cache

A vendor-agnostic cache abstraction layer with support for multiple providers, enabling seamless switching between in-memory and Redis caching without code changes.

## Features

- ✅ **Vendor-agnostic** - Switch providers via environment variables
- ✅ **Zero lock-in** - Consistent API across all providers
- ✅ **Production-ready** - Comprehensive error handling and metrics
- ✅ **Type-safe** - Full TypeScript support
- ✅ **Well-tested** - 52 integration tests covering all scenarios

## Quick Start

### Installation

```bash
# Already included in the monorepo
pnpm add @kit/cache
```

### Basic Usage

```typescript
import { createCacheClient } from '@kit/cache';

// Create cache client (reads from environment variables)
const cache = createCacheClient();

// Set a value with TTL
await cache.set('user:123', { name: 'John Doe' }, 3600); // 1 hour

// Get a value
const user = await cache.get<{ name: string }>('user:123');

// Delete a key
await cache.del('user:123');

// Clear all cache
await cache.clear();
```

## Supported Providers

### Memory Cache (Default)

Perfect for development and serverless environments.

**Pros:**
- ✅ Zero configuration
- ✅ No external dependencies
- ✅ Fast (no network latency)
- ✅ LRU eviction prevents memory leaks

**Cons:**
- ❌ Not shared across instances
- ❌ Lost on restart
- ❌ Limited by available memory

**Configuration:**
```bash
CACHE_PROVIDER=memory
CACHE_MAX_SIZE=1000    # Max number of items (default: 1000)
CACHE_MAX_AGE=300      # Default TTL in seconds (default: 300)
```

### Redis Cache

Ideal for production with multiple instances.

**Pros:**
- ✅ Shared across all instances
- ✅ Persistent (survives restarts)
- ✅ Scalable
- ✅ Pattern-based deletion

**Cons:**
- ❌ Requires external service
- ❌ Network latency
- ❌ Additional cost

**Supported Redis Services:**
- AWS ElastiCache
- Upstash Redis
- Redis Cloud
- Self-hosted Redis

**Configuration:**
```bash
CACHE_PROVIDER=redis
REDIS_URL=redis://localhost:6379
# or
REDIS_URL=rediss://default:password@redis.upstash.io:6379  # TLS
```

## Provider Comparison

| Feature | Memory | Redis |
|---------|--------|-------|
| Setup Complexity | None | Medium |
| Performance | Fastest | Fast |
| Persistence | No | Yes |
| Shared State | No | Yes |
| Cost | Free | $ |
| Best For | Dev, Serverless | Production |

## API Reference

### Core Methods

#### `get<T>(key: string): Promise<T | null>`

Retrieve a value from cache.

```typescript
const user = await cache.get<User>('user:123');
if (user) {
  console.log(user.name);
}
```

#### `set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>`

Store a value in cache with optional TTL.

```typescript
// With default TTL (from config)
await cache.set('session:abc', sessionData);

// With custom TTL (30 minutes)
await cache.set('temp:token', token, 1800);
```

#### `del(key: string): Promise<void>`

Delete a single key or pattern.

```typescript
// Delete specific key
await cache.del('user:123');

// Delete pattern (Redis only)
await cache.del('user:*');
```

### Bulk Operations

#### `mget<T>(keys: string[]): Promise<(T | null)[]>`

Get multiple values at once.

```typescript
const [user1, user2, user3] = await cache.mget<User>([
  'user:1',
  'user:2',
  'user:3'
]);
```

#### `mset<T>(entries: [string, T][], ttlSeconds?: number): Promise<void>`

Set multiple values at once.

```typescript
await cache.mset([
  ['user:1', { name: 'Alice' }],
  ['user:2', { name: 'Bob' }],
], 3600);
```

#### `mdel(keys: string[]): Promise<void>`

Delete multiple keys at once.

```typescript
await cache.mdel(['user:1', 'user:2', 'user:3']);
```

### Utility Methods

#### `clear(): Promise<void>`

Clear all cached items.

```typescript
await cache.clear(); // Use with caution!
```

#### `isHealthy(): Promise<boolean>`

Check if cache is operational.

```typescript
const healthy = await cache.isHealthy();
if (!healthy) {
  console.warn('Cache unavailable, degraded mode');
}
```

#### `disconnect(): Promise<void>`

Close connections (for graceful shutdown).

```typescript
await cache.disconnect();
```

## Performance Metrics

### Tracking Cache Performance

```typescript
// Get current metrics
const metrics = cache.getMetrics();

console.log(`Hit Rate: ${metrics.hitRate.toFixed(2)}%`);
console.log(`Hits: ${metrics.hits}`);
console.log(`Misses: ${metrics.misses}`);
console.log(`Total Operations: ${metrics.operations}`);

// Reset metrics
cache.resetMetrics();
```

### Interpreting Metrics

**Hit Rate Guidelines:**
- **>80%**: Excellent - Cache is effective
- **60-80%**: Good - Consider tuning TTLs
- **40-60%**: Fair - Review caching strategy
- **<40%**: Poor - Cache may not be beneficial

**Optimization Tips:**
1. **Low hit rate?** Increase TTL or cache more data
2. **High memory usage?** Reduce max size or lower TTL
3. **Slow operations?** Check Redis latency or network

## Configuration Options

### Programmatic Configuration

```typescript
import { createCacheClient } from '@kit/cache';

// Memory cache with custom settings
const cache = createCacheClient({
  provider: 'memory',
  memory: {
    maxSize: 5000,        // Store up to 5000 items
    maxAge: 600,          // Default TTL: 10 minutes
  }
});

// Redis cache
const redisCache = createCacheClient({
  provider: 'redis',
  redis: {
    url: 'redis://localhost:6379'
  }
});
```

### Environment Variables

```bash
# Provider selection
CACHE_PROVIDER=memory|redis

# Memory cache settings
CACHE_MAX_SIZE=1000        # Maximum number of items
CACHE_MAX_AGE=300          # Default TTL in seconds

# Redis settings
REDIS_URL=redis://host:port
```

## Best Practices

### 1. Choose Appropriate TTLs

```typescript
// Frequently changing data - short TTL
await cache.set('stock:AAPL', price, 60);  // 1 minute

// Static data - long TTL
await cache.set('user:profile', profile, 3600);  // 1 hour

// Configuration data - very long TTL
await cache.set('config:app', config, 86400);  // 24 hours
```

### 2. Use Descriptive Keys

```typescript
// ✅ Good - hierarchical, descriptive
'user:123:profile'
'product:456:inventory'
'session:abc123:data'

// ❌ Bad - ambiguous
'u123'
'prod'
'data'
```

### 3. Handle Cache Failures Gracefully

```typescript
async function getUser(id: string): Promise<User> {
  try {
    // Try cache first
    const cached = await cache.get<User>(`user:${id}`);
    if (cached) return cached;
  } catch (error) {
    console.warn('Cache error, falling back to DB', error);
  }

  // Fallback to database
  const user = await db.users.findById(id);

  // Try to cache for next time
  try {
    await cache.set(`user:${id}`, user, 3600);
  } catch (error) {
    console.warn('Failed to cache user', error);
  }

  return user;
}
```

### 4. Implement Cache Warming

```typescript
// Warm cache on startup
async function warmCache() {
  const popularUsers = await db.users.findPopular();

  await cache.mset(
    popularUsers.map(u => [`user:${u.id}`, u]),
    3600
  );
}
```

### 5. Monitor Metrics

```typescript
// Log metrics periodically
setInterval(() => {
  const metrics = cache.getMetrics();

  logger.info({
    cacheHitRate: metrics.hitRate,
    cacheHits: metrics.hits,
    cacheMisses: metrics.misses,
  });

  // Alert on low hit rate
  if (metrics.hitRate < 60) {
    logger.warn('Cache hit rate below 60%');
  }
}, 60000); // Every minute
```

## Performance Tuning

### Memory Cache

**Tuning maxSize:**
```typescript
// Conservative (low memory)
maxSize: 500

// Balanced (moderate memory)
maxSize: 2000

// Aggressive (high memory)
maxSize: 10000
```

**Memory Usage Estimation:**
```
Average item size: 1KB
maxSize: 1000
Estimated memory: ~1MB

Average item size: 100KB
maxSize: 1000
Estimated memory: ~100MB
```

### Redis Cache

**Connection Pool Settings:**
```bash
# High throughput
REDIS_MAX_CONNECTIONS=50

# Low latency
REDIS_ENABLE_PIPELINING=true
```

**Pattern Deletion Optimization:**
- Small datasets (<1000 keys): Use patterns freely
- Large datasets (>1000 keys): Consider batch deletion
- Very large datasets (>10000 keys): Use background jobs

## Migration Guide

### From Direct Redis

```typescript
// Before (direct redis)
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);
await redis.set('key', JSON.stringify(value));
const data = JSON.parse(await redis.get('key'));

// After (@kit/cache)
import { createCacheClient } from '@kit/cache';
const cache = createCacheClient();
await cache.set('key', value);  // Auto-serialization
const data = await cache.get('key');  // Auto-deserialization
```

### From node-cache

```typescript
// Before (node-cache)
import NodeCache from 'node-cache';
const cache = new NodeCache({ stdTTL: 100 });
cache.set('key', value);
const data = cache.get('key');

// After (@kit/cache)
import { createCacheClient } from '@kit/cache';
const cache = createCacheClient({
  provider: 'memory',
  memory: { maxAge: 100 }
});
await cache.set('key', value);  // Now async
const data = await cache.get('key');
```

## Troubleshooting

### Cache Not Working

**Check health status:**
```typescript
const healthy = await cache.isHealthy();
console.log('Cache healthy:', healthy);
```

**Verify configuration:**
```typescript
console.log('CACHE_PROVIDER:', process.env.CACHE_PROVIDER);
console.log('REDIS_URL:', process.env.REDIS_URL);
```

### Low Hit Rate

1. **Check TTLs**: May be too short
2. **Review cache keys**: Ensure consistency
3. **Monitor access patterns**: Cache what's actually used
4. **Increase maxSize**: May be evicting too aggressively

### High Memory Usage (Memory Cache)

1. **Reduce maxSize**: Lower the item limit
2. **Decrease maxAge**: Shorter default TTL
3. **Clear unused data**: Call `clear()` periodically
4. **Switch to Redis**: For large datasets

### Redis Connection Errors

1. **Verify URL**: Check `REDIS_URL` format
2. **Check network**: Ensure Redis is accessible
3. **Review credentials**: Confirm username/password
4. **Check TLS**: Use `rediss://` for encrypted connections

## Testing

### Running Tests

```bash
# Run all cache tests
pnpm --filter @kit/cache test

# Watch mode
pnpm --filter @kit/cache test:watch

# Coverage
pnpm --filter @kit/cache test --coverage
```

### Example Test

```typescript
import { createCacheClient } from '@kit/cache';

describe('Cache Integration', () => {
  it('should cache user data', async () => {
    const cache = createCacheClient({ provider: 'memory' });

    await cache.set('user:1', { name: 'Alice' }, 60);
    const user = await cache.get<{ name: string }>('user:1');

    expect(user).toEqual({ name: 'Alice' });
  });
});
```

## Contributing

When adding new providers:

1. Implement the `CacheClient` interface
2. Add comprehensive tests
3. Update this README with provider details
4. Add configuration examples

## License

See the root LICENSE file.

## Support

For issues, questions, or contributions, please open an issue in the repository.
