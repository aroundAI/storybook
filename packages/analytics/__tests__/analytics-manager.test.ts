import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createAnalyticsManager } from '../src/analytics-manager';
import { NullAnalyticsService } from '../src/null-analytics-service';
import type {
  AnalyticsService,
  CreateAnalyticsManagerOptions,
} from '../src/types';

describe('analytics-manager', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('createAnalyticsManager', () => {
    it('should create an analytics manager', () => {
      const manager = createAnalyticsManager({
        providers: {
          null: () => NullAnalyticsService,
        },
      });

      expect(manager).toBeDefined();
      expect(manager.addProvider).toBeInstanceOf(Function);
      expect(manager.removeProvider).toBeInstanceOf(Function);
      expect(manager.identify).toBeInstanceOf(Function);
      expect(manager.trackPageView).toBeInstanceOf(Function);
      expect(manager.trackEvent).toBeInstanceOf(Function);
    });

    it('should initialize providers on creation', () => {
      const mockInitialize = vi.fn(() => Promise.resolve());
      const mockService: AnalyticsService = {
        initialize: mockInitialize,
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      expect(mockInitialize).toHaveBeenCalledOnce();
    });

    it('should handle empty providers', async () => {
      const manager = createAnalyticsManager({
        providers: {},
      });

      await manager.trackEvent('test');

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'No active analytics services. Using NullAnalyticsService.',
      );
    });

    it('should warn when provider factory is missing', () => {
      const options: CreateAnalyticsManagerOptions<'test', object> = {
        providers: {
          test: undefined as any,
        },
      };

      createAnalyticsManager(options);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Analytics provider 'test' not registered. Skipping initialization.",
      );
    });
  });

  describe('addProvider', () => {
    it('should add a provider dynamically', async () => {
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      const newMockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      await manager.addProvider('test2' as any, {});

      // Since test2 factory doesn't exist, it should warn
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Analytics provider 'test2' not registered. Skipping initialization.",
      );
    });

    it('should initialize newly added provider', async () => {
      const mockInitialize = vi.fn(() => Promise.resolve());
      const mockService: AnalyticsService = {
        initialize: mockInitialize,
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: (config?: object) => mockService,
        },
      });

      // Clear the initialization call from creation
      mockInitialize.mockClear();

      await manager.addProvider('test', { apiKey: 'test-key' });

      expect(mockInitialize).toHaveBeenCalledOnce();
    });

    it('should return promise from initialize', async () => {
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve('initialized')),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      const result = await manager.addProvider('test', {});

      expect(result).toBe('initialized');
    });

    it('should warn when adding unknown provider', async () => {
      const manager = createAnalyticsManager({
        providers: {
          test: () => NullAnalyticsService,
        },
      });

      await manager.addProvider('unknown' as any, {});

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "Analytics provider 'unknown' not registered. Skipping initialization.",
      );
    });

    it('should pass config to provider factory', async () => {
      const mockFactory = vi.fn(() => ({
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      }));

      const manager = createAnalyticsManager({
        providers: {
          test: mockFactory,
        },
      });

      // Clear the initial factory call
      mockFactory.mockClear();

      const config = { apiKey: 'test-key', endpoint: 'https://api.example.com' };
      await manager.addProvider('test', config);

      expect(mockFactory).toHaveBeenCalledWith(config);
    });
  });

  describe('removeProvider', () => {
    it('should remove a provider', async () => {
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      manager.removeProvider('test');

      await manager.trackEvent('test_event');

      // Should use NullAnalyticsService after removal
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'No active analytics services. Using NullAnalyticsService.',
      );
    });

    it('should handle removing non-existent provider', () => {
      const manager = createAnalyticsManager({
        providers: {
          test: () => NullAnalyticsService,
        },
      });

      expect(() => manager.removeProvider('unknown' as any)).not.toThrow();
    });
  });

  describe('identify', () => {
    it('should call identify on all active services', async () => {
      const mockIdentify1 = vi.fn(() => Promise.resolve());
      const mockIdentify2 = vi.fn(() => Promise.resolve());

      const mockService1: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: mockIdentify1,
      };

      const mockService2: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: mockIdentify2,
      };

      const manager = createAnalyticsManager({
        providers: {
          test1: () => mockService1,
          test2: () => mockService2,
        },
      });

      await manager.identify('user123', { email: 'user@example.com' });

      expect(mockIdentify1).toHaveBeenCalledWith('user123', {
        email: 'user@example.com',
      });
      expect(mockIdentify2).toHaveBeenCalledWith('user123', {
        email: 'user@example.com',
      });
    });

    it('should work without traits', async () => {
      const mockIdentify = vi.fn(() => Promise.resolve());
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: mockIdentify,
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      await manager.identify('user123');

      expect(mockIdentify).toHaveBeenCalledWith('user123', undefined);
    });

    it('should use NullAnalyticsService when no providers', async () => {
      const manager = createAnalyticsManager({
        providers: {},
      });

      await manager.identify('user123');

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'No active analytics services. Using NullAnalyticsService.',
      );
    });

    it('should return Promise.all results', async () => {
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve('identified')),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      const result = await manager.identify('user123');

      expect(result).toEqual(['identified']);
    });
  });

  describe('trackPageView', () => {
    it('should call trackPageView on all active services', async () => {
      const mockTrackPageView1 = vi.fn(() => Promise.resolve());
      const mockTrackPageView2 = vi.fn(() => Promise.resolve());

      const mockService1: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: mockTrackPageView1,
        identify: vi.fn(() => Promise.resolve()),
      };

      const mockService2: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: mockTrackPageView2,
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test1: () => mockService1,
          test2: () => mockService2,
        },
      });

      await manager.trackPageView('/dashboard');

      expect(mockTrackPageView1).toHaveBeenCalledWith('/dashboard');
      expect(mockTrackPageView2).toHaveBeenCalledWith('/dashboard');
    });

    it('should use NullAnalyticsService when no providers', async () => {
      const manager = createAnalyticsManager({
        providers: {},
      });

      await manager.trackPageView('/home');

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'No active analytics services. Using NullAnalyticsService.',
      );
    });

    it('should return Promise.all results', async () => {
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve()),
        trackPageView: vi.fn(() => Promise.resolve('tracked')),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      const result = await manager.trackPageView('/about');

      expect(result).toEqual(['tracked']);
    });
  });

  describe('trackEvent', () => {
    it('should call trackEvent on all active services', async () => {
      const mockTrackEvent1 = vi.fn(() => Promise.resolve());
      const mockTrackEvent2 = vi.fn(() => Promise.resolve());

      const mockService1: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: mockTrackEvent1,
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const mockService2: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: mockTrackEvent2,
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test1: () => mockService1,
          test2: () => mockService2,
        },
      });

      const properties = { button_id: 'signup', page: 'homepage' };
      await manager.trackEvent('button_clicked', properties);

      expect(mockTrackEvent1).toHaveBeenCalledWith('button_clicked', properties);
      expect(mockTrackEvent2).toHaveBeenCalledWith('button_clicked', properties);
    });

    it('should work without event properties', async () => {
      const mockTrackEvent = vi.fn(() => Promise.resolve());
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: mockTrackEvent,
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      await manager.trackEvent('page_loaded');

      expect(mockTrackEvent).toHaveBeenCalledWith('page_loaded', undefined);
    });

    it('should handle array values in properties', async () => {
      const mockTrackEvent = vi.fn(() => Promise.resolve());
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: mockTrackEvent,
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      const properties = { tags: ['premium', 'monthly'], value: '99.99' };
      await manager.trackEvent('purchase', properties);

      expect(mockTrackEvent).toHaveBeenCalledWith('purchase', properties);
    });

    it('should use NullAnalyticsService when no providers', async () => {
      const manager = createAnalyticsManager({
        providers: {},
      });

      await manager.trackEvent('test_event');

      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'No active analytics services. Using NullAnalyticsService.',
      );
    });

    it('should return Promise.all results', async () => {
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve('event_tracked')),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      const result = await manager.trackEvent('click');

      expect(result).toEqual(['event_tracked']);
    });
  });

  describe('multiple providers', () => {
    it('should manage multiple providers simultaneously', async () => {
      const mockService1: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve('provider1')),
        trackPageView: vi.fn(() => Promise.resolve('provider1')),
        identify: vi.fn(() => Promise.resolve('provider1')),
      };

      const mockService2: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve('provider2')),
        trackPageView: vi.fn(() => Promise.resolve('provider2')),
        identify: vi.fn(() => Promise.resolve('provider2')),
      };

      const mockService3: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve('provider3')),
        trackPageView: vi.fn(() => Promise.resolve('provider3')),
        identify: vi.fn(() => Promise.resolve('provider3')),
      };

      const manager = createAnalyticsManager({
        providers: {
          provider1: () => mockService1,
          provider2: () => mockService2,
          provider3: () => mockService3,
        },
      });

      const eventResult = await manager.trackEvent('test');
      const pageResult = await manager.trackPageView('/test');
      const identifyResult = await manager.identify('user123');

      expect(eventResult).toEqual(['provider1', 'provider2', 'provider3']);
      expect(pageResult).toEqual(['provider1', 'provider2', 'provider3']);
      expect(identifyResult).toEqual(['provider1', 'provider2', 'provider3']);
    });

    it('should handle provider add/remove correctly', async () => {
      const mockService1: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve('service1')),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const mockService2: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve('service2')),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test1: () => mockService1,
          test2: () => mockService2,
        },
      });

      // Should have both providers
      let result = await manager.trackEvent('event1');
      expect(result).toEqual(['service1', 'service2']);

      // Remove one provider
      manager.removeProvider('test1');

      // Should only have test2
      result = await manager.trackEvent('event2');
      expect(result).toEqual(['service2']);

      // Remove last provider
      manager.removeProvider('test2');

      // Should use NullAnalyticsService
      await manager.trackEvent('event3');
      expect(consoleDebugSpy).toHaveBeenCalledWith(
        'No active analytics services. Using NullAnalyticsService.',
      );
    });
  });

  describe('error handling', () => {
    it('should propagate errors from services', async () => {
      const mockService: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.reject(new Error('Tracking failed'))),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test: () => mockService,
        },
      });

      await expect(manager.trackEvent('test')).rejects.toThrow('Tracking failed');
    });

    it('should handle partial failures with multiple providers', async () => {
      const mockService1: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.resolve('success')),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const mockService2: AnalyticsService = {
        initialize: vi.fn(() => Promise.resolve()),
        trackEvent: vi.fn(() => Promise.reject(new Error('Service 2 failed'))),
        trackPageView: vi.fn(() => Promise.resolve()),
        identify: vi.fn(() => Promise.resolve()),
      };

      const manager = createAnalyticsManager({
        providers: {
          test1: () => mockService1,
          test2: () => mockService2,
        },
      });

      await expect(manager.trackEvent('test')).rejects.toThrow('Service 2 failed');
    });
  });
});
