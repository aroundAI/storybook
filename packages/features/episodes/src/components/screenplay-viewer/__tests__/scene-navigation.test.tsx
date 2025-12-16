/**
 * @vitest-environment happy-dom
 */
import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SceneNavigation } from '../scene-navigation';

// Mock the cn utility
vi.mock('@kit/ui/utils', () => ({
  cn: (...args: (string | boolean | undefined)[]) =>
    args.filter(Boolean).join(' '),
}));

// Mock UI components
vi.mock('@kit/ui/scroll-area', () => ({
  ScrollArea: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="scroll-area" className={className}>
      {children}
    </div>
  ),
}));

vi.mock('@kit/ui/badge', () => ({
  Badge: ({
    children,
    variant,
    className,
  }: {
    children: React.ReactNode;
    variant?: string;
    className?: string;
  }) => (
    <span data-testid="badge" data-variant={variant} className={className}>
      {children}
    </span>
  ),
}));

vi.mock('@kit/ui/button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    className?: string;
  }) => (
    <button
      data-testid="nav-button"
      data-variant={variant}
      className={className}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

describe('SceneNavigation', () => {
  const mockScenes = [
    {
      number: 1,
      heading: 'INT. COFFEE SHOP - MORNING',
      location: 'Coffee Shop',
      timeOfDay: 'day' as const,
      description: 'A cozy coffee shop.',
      dialogue: [],
      estimatedDuration: 30,
    },
    {
      number: 2,
      heading: 'EXT. PARK - AFTERNOON',
      location: 'Central Park',
      timeOfDay: 'day' as const,
      description: 'A sunny park.',
      dialogue: [],
      estimatedDuration: 45,
    },
    {
      number: 3,
      heading: 'INT. OFFICE - NIGHT',
      location: 'Office Building',
      timeOfDay: 'night' as const,
      description: 'A dark office.',
      dialogue: [],
      estimatedDuration: 60,
    },
  ];

  const mockOnSceneSelect = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render scroll area container', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      expect(screen.getByTestId('scroll-area')).toBeDefined();
    });

    it('should render a button for each scene', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      const buttons = screen.getAllByTestId('nav-button');
      expect(buttons).toHaveLength(3);
    });

    it('should render scene number badges', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      const badges = screen.getAllByTestId('badge');
      expect(badges).toHaveLength(3);
      expect(badges[0]?.textContent).toBe('1');
      expect(badges[1]?.textContent).toBe('2');
      expect(badges[2]?.textContent).toBe('3');
    });

    it('should render scene locations', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      expect(screen.getByText('Coffee Shop')).toBeDefined();
      expect(screen.getByText('Central Park')).toBeDefined();
      expect(screen.getByText('Office Building')).toBeDefined();
    });

    it('should render time of day and duration', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      expect(screen.getByText('day - 30s')).toBeDefined();
      expect(screen.getByText('day - 45s')).toBeDefined();
      expect(screen.getByText('night - 60s')).toBeDefined();
    });
  });

  describe('Active Scene Highlighting', () => {
    it('should apply bg-accent class to active scene button', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={2}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      const buttons = screen.getAllByTestId('nav-button');
      expect(buttons[0]?.className).not.toContain('bg-accent');
      expect(buttons[1]?.className).toContain('bg-accent');
      expect(buttons[2]?.className).not.toContain('bg-accent');
    });

    it('should update highlight when activeSceneNumber changes', () => {
      const { rerender } = render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      let buttons = screen.getAllByTestId('nav-button');
      expect(buttons[0]?.className).toContain('bg-accent');

      rerender(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={3}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      buttons = screen.getAllByTestId('nav-button');
      expect(buttons[0]?.className).not.toContain('bg-accent');
      expect(buttons[2]?.className).toContain('bg-accent');
    });
  });

  describe('Click Interactions', () => {
    it('should call onSceneSelect with correct scene number when clicked', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      const buttons = screen.getAllByTestId('nav-button');
      const secondButton = buttons[1];
      expect(secondButton).toBeDefined();
      fireEvent.click(secondButton!);

      expect(mockOnSceneSelect).toHaveBeenCalledTimes(1);
      expect(mockOnSceneSelect).toHaveBeenCalledWith(2);
    });

    it('should call onSceneSelect for each scene button clicked', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      const buttons = screen.getAllByTestId('nav-button');
      const firstButton = buttons[0];
      const thirdButton = buttons[2];
      expect(firstButton).toBeDefined();
      expect(thirdButton).toBeDefined();

      fireEvent.click(firstButton!);
      expect(mockOnSceneSelect).toHaveBeenLastCalledWith(1);

      fireEvent.click(thirdButton!);
      expect(mockOnSceneSelect).toHaveBeenLastCalledWith(3);

      expect(mockOnSceneSelect).toHaveBeenCalledTimes(2);
    });
  });

  describe('Empty Scenes', () => {
    it('should render nothing when scenes array is empty', () => {
      render(
        <SceneNavigation
          scenes={[]}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      expect(screen.queryAllByTestId('nav-button')).toHaveLength(0);
    });
  });

  describe('Single Scene', () => {
    it('should render single scene correctly', () => {
      const firstScene = mockScenes[0];
      expect(firstScene).toBeDefined();

      render(
        <SceneNavigation
          scenes={[firstScene!]}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      expect(screen.getAllByTestId('nav-button')).toHaveLength(1);
      expect(screen.getByText('Coffee Shop')).toBeDefined();
    });
  });

  describe('Button Variant', () => {
    it('should use ghost variant for buttons', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      const buttons = screen.getAllByTestId('nav-button');
      buttons.forEach((button) => {
        expect(button.getAttribute('data-variant')).toBe('ghost');
      });
    });
  });

  describe('Badge Variant', () => {
    it('should use outline variant for badges', () => {
      render(
        <SceneNavigation
          scenes={mockScenes}
          activeSceneNumber={1}
          onSceneSelect={mockOnSceneSelect}
        />,
      );

      const badges = screen.getAllByTestId('badge');
      badges.forEach((badge) => {
        expect(badge.getAttribute('data-variant')).toBe('outline');
      });
    });
  });
});
