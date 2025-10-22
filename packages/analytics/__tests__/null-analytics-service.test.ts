import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NullAnalyticsService } from '../src/null-analytics-service';

describe('null-analytics-service', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleDebugSpy.mockRestore();
  });

  describe('NullAnalyticsService', () => {
    it('should be defined', () => {
      expect(NullAnalyticsService).toBeDefined();
    });

    it('should have all required methods', () => {
      expect(NullAnalyticsService.initialize).toBeInstanceOf(Function);
      expect(NullAnalyticsService.trackPageView).toBeInstanceOf(Function);
      expect(NullAnalyticsService.trackEvent).toBeInstanceOf(Function);
      expect(NullAnalyticsService.identify).toBeInstanceOf(Function);
    });

    describe('initialize', () => {
      it('should return a function', async () => {
        const result = await NullAnalyticsService.initialize();

        expect(result).toBeUndefined();
      });

      it('should log debug message when called', async () => {
        await NullAnalyticsService.initialize();

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: initialize',
        );
      });

      it('should handle arguments', async () => {
        await NullAnalyticsService.initialize('arg1', 'arg2');

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: initialize',
          'arg1',
          'arg2',
        );
      });

      it('should filter falsy arguments', async () => {
        await NullAnalyticsService.initialize('arg1', null, undefined, 'arg2');

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: initialize',
          'arg1',
          'arg2',
        );
      });
    });

    describe('trackPageView', () => {
      it('should log debug message with path', async () => {
        await NullAnalyticsService.trackPageView('/dashboard');

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackPageView',
          '/dashboard',
        );
      });

      it('should handle multiple arguments', async () => {
        await NullAnalyticsService.trackPageView('/dashboard', {
          referrer: 'google',
        });

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackPageView',
          '/dashboard',
          { referrer: 'google' },
        );
      });

      it('should return undefined', async () => {
        const result = await NullAnalyticsService.trackPageView('/home');

        expect(result).toBeUndefined();
      });
    });

    describe('trackEvent', () => {
      it('should log debug message with event name', async () => {
        await NullAnalyticsService.trackEvent('button_clicked');

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackEvent',
          'button_clicked',
        );
      });

      it('should handle event properties', async () => {
        const properties = { button_id: 'signup', page: 'homepage' };

        await NullAnalyticsService.trackEvent('button_clicked', properties);

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackEvent',
          'button_clicked',
          properties,
        );
      });

      it('should handle complex event properties', async () => {
        const properties = {
          user_id: '123',
          tags: ['premium', 'monthly'],
          value: '99.99',
        };

        await NullAnalyticsService.trackEvent('purchase', properties);

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackEvent',
          'purchase',
          properties,
        );
      });

      it('should return undefined', async () => {
        const result = await NullAnalyticsService.trackEvent('test_event');

        expect(result).toBeUndefined();
      });
    });

    describe('identify', () => {
      it('should log debug message with user ID', async () => {
        await NullAnalyticsService.identify('user123');

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: identify',
          'user123',
        );
      });

      it('should handle user traits', async () => {
        const traits = { email: 'user@example.com', plan: 'premium' };

        await NullAnalyticsService.identify('user123', traits);

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: identify',
          'user123',
          traits,
        );
      });

      it('should handle complex traits', async () => {
        const traits = {
          email: 'user@example.com',
          name: 'John Doe',
          created_at: '2024-01-01',
          plan: 'enterprise',
        };

        await NullAnalyticsService.identify('user456', traits);

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: identify',
          'user456',
          traits,
        );
      });

      it('should return undefined', async () => {
        const result = await NullAnalyticsService.identify('user123');

        expect(result).toBeUndefined();
      });
    });

    describe('edge cases', () => {
      it('should handle empty strings', async () => {
        await NullAnalyticsService.trackEvent('');

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackEvent',
        );
      });

      it('should handle special characters in event names', async () => {
        await NullAnalyticsService.trackEvent('event:name-with_special.chars');

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackEvent',
          'event:name-with_special.chars',
        );
      });

      it('should handle numeric user IDs', async () => {
        await NullAnalyticsService.identify(123 as any);

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: identify',
          123,
        );
      });

      it('should filter null and undefined from args', async () => {
        await NullAnalyticsService.trackEvent(
          'test',
          null as any,
          undefined,
          'extra',
        );

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackEvent',
          'test',
          'extra',
        );
      });

      it('should not filter falsy values like 0 or false', async () => {
        await NullAnalyticsService.trackEvent('test', 0 as any, false as any);

        expect(consoleDebugSpy).toHaveBeenCalledWith(
          'Noop analytics service called with event: trackEvent',
          'test',
        );
      });
    });

    describe('concurrent calls', () => {
      it('should handle concurrent method calls', async () => {
        await Promise.all([
          NullAnalyticsService.initialize(),
          NullAnalyticsService.trackEvent('event1'),
          NullAnalyticsService.trackPageView('/page1'),
          NullAnalyticsService.identify('user1'),
        ]);

        expect(consoleDebugSpy).toHaveBeenCalledTimes(4);
      });

      it('should handle sequential calls', async () => {
        await NullAnalyticsService.initialize();
        await NullAnalyticsService.trackPageView('/home');
        await NullAnalyticsService.trackEvent('page_loaded');
        await NullAnalyticsService.identify('user123');

        expect(consoleDebugSpy).toHaveBeenCalledTimes(4);
      });
    });
  });
});
