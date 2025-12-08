import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRovingTabIndex } from '../src/hooks/use-focus-trap';

// Note: useFocusTrap is tested indirectly through integration tests
// as it requires complex DOM interactions that are difficult to simulate
// in unit tests. The hook's core functionality (event handling, focus management)
// is verified through manual testing and E2E tests.

describe('useRovingTabIndex', () => {
  it('should initialize with correct index', () => {
    const { result } = renderHook(() => useRovingTabIndex(5));

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.getTabIndex(0)).toBe(0);
    expect(result.current.getTabIndex(1)).toBe(-1);
  });

  it('should initialize with custom initial index', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex(5, { initialIndex: 2 }),
    );

    expect(result.current.currentIndex).toBe(2);
    expect(result.current.getTabIndex(2)).toBe(0);
    expect(result.current.getTabIndex(0)).toBe(-1);
  });

  it('should handle ArrowRight navigation', () => {
    const { result } = renderHook(() => useRovingTabIndex(3));

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowRight',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(1);
  });

  it('should handle ArrowLeft navigation', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex(3, { initialIndex: 1 }),
    );

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowLeft',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(0);
  });

  it('should wrap around with arrow keys by default', () => {
    const { result } = renderHook(() => useRovingTabIndex(3));

    // At index 0, go left should wrap to index 2
    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowLeft',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(2);

    // At index 2, go right should wrap to index 0
    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowRight',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(0);
  });

  it('should not wrap when wrap option is false', () => {
    const { result } = renderHook(() => useRovingTabIndex(3, { wrap: false }));

    // At index 0, go left should stay at 0
    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowLeft',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(0);
  });

  it('should handle Home key', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex(5, { initialIndex: 3 }),
    );

    act(() => {
      result.current.handleKeyDown({
        key: 'Home',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(0);
  });

  it('should handle End key', () => {
    const { result } = renderHook(() => useRovingTabIndex(5));

    act(() => {
      result.current.handleKeyDown({
        key: 'End',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(4);
  });

  it('should handle vertical orientation', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex(3, { orientation: 'vertical' }),
    );

    // ArrowDown should work in vertical mode
    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(1);

    // ArrowRight should not work in vertical mode
    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowRight',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(1); // Unchanged
  });

  it('should handle both orientation', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex(3, { orientation: 'both' }),
    );

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowDown',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(1);

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowRight',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(2);
  });

  it('should allow manual index setting', () => {
    const { result } = renderHook(() => useRovingTabIndex(5));

    act(() => {
      result.current.setCurrentIndex(3);
    });

    expect(result.current.currentIndex).toBe(3);
    expect(result.current.getTabIndex(3)).toBe(0);
    expect(result.current.getTabIndex(0)).toBe(-1);
  });

  it('should not change index for unhandled keys', () => {
    const { result } = renderHook(() => useRovingTabIndex(3));

    act(() => {
      result.current.handleKeyDown({
        key: 'Enter',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(0); // Unchanged
  });

  it('should handle ArrowUp in vertical mode', () => {
    const { result } = renderHook(() =>
      useRovingTabIndex(3, { orientation: 'vertical', initialIndex: 1 }),
    );

    act(() => {
      result.current.handleKeyDown({
        key: 'ArrowUp',
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent);
    });

    expect(result.current.currentIndex).toBe(0);
  });
});
