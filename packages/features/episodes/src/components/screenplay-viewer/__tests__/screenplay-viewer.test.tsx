/**
 * @vitest-environment happy-dom
 */
import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EpisodeWithShots } from '../../../lib/types';
import { ScreenplayViewer } from '../screenplay-viewer';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Film: () => <span data-testid="icon-film" />,
  Check: () => <span data-testid="icon-check" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
  Loader2: () => <span data-testid="icon-loader" />,
}));

// Mock the cn utility
vi.mock('@kit/ui/utils', () => ({
  cn: (...args: (string | boolean | undefined)[]) =>
    args.filter(Boolean).join(' '),
}));

// Mock UI components
vi.mock('@kit/ui/card', () => ({
  Card: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <h3 data-testid="card-title">{children}</h3>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="card-description">{children}</p>
  ),
}));

vi.mock('@kit/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
  }) => (
    <button
      data-testid="button"
      data-variant={variant}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  ),
}));

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

vi.mock('@kit/ui/sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock child components
vi.mock('../scene-navigation', () => ({
  SceneNavigation: ({
    scenes,
    activeSceneNumber,
    onSceneSelect,
  }: {
    scenes: { number: number }[];
    activeSceneNumber: number;
    onSceneSelect: (num: number) => void;
  }) => (
    <div data-testid="scene-navigation" data-active={activeSceneNumber}>
      {scenes.map((s) => (
        <button
          key={s.number}
          data-testid={`scene-nav-${s.number}`}
          onClick={() => onSceneSelect(s.number)}
        >
          Scene {s.number}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../scene-content', () => ({
  SceneContent: ({
    scene,
    isActive,
  }: {
    scene: { number: number; heading: string };
    isActive: boolean;
  }) => (
    <div
      data-testid={`scene-content-${scene.number}`}
      data-active={isActive}
      id={`scene-${scene.number}`}
    >
      {scene.heading}
    </div>
  ),
}));

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockUnobserve = vi.fn();
const mockDisconnect = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  // Setup IntersectionObserver mock
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: mockObserve,
    unobserve: mockUnobserve,
    disconnect: mockDisconnect,
  }));
});

describe('ScreenplayViewer', () => {
  const mockScreenplayData = {
    scenes: [
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
    ],
    metadata: {
      totalScenes: 2,
      estimatedDuration: 75,
      locations: ['Coffee Shop', 'Central Park'],
      characters: [],
    },
  };

  const mockEpisode: EpisodeWithShots = {
    id: 'episode-1',
    slug: 'episode-1-test-episode',
    projectId: 'project-1',
    seasonId: null,
    number: 1,
    title: 'Test Episode',
    description: null,
    status: 'storyboard',
    durationSeconds: null,
    thumbnailUrl: null,
    finalVideoUrl: null,
    storyData: null,
    screenplayData: mockScreenplayData,
    shotList: null,
    metadata: null,
    version: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
    shots: [],
    season: null,
  };

  const mockOnApprove = vi.fn();
  const mockOnRegenerate = vi.fn();

  describe('Empty State', () => {
    it('should render empty state when no screenplay data', () => {
      const episodeWithoutScreenplay = {
        ...mockEpisode,
        screenplayData: null,
      };

      render(
        <ScreenplayViewer
          episode={episodeWithoutScreenplay}
          onApprove={mockOnApprove}
        />,
      );

      expect(screen.getByText(/No screenplay generated yet/i)).toBeDefined();
    });

    it('should render empty state when screenplay has no scenes', () => {
      const episodeWithEmptyScreenplay = {
        ...mockEpisode,
        screenplayData: {
          ...mockScreenplayData,
          scenes: [],
        },
      };

      render(
        <ScreenplayViewer
          episode={episodeWithEmptyScreenplay}
          onApprove={mockOnApprove}
        />,
      );

      expect(screen.getByText(/No screenplay generated yet/i)).toBeDefined();
    });

    it('should not render scene navigation in empty state', () => {
      const episodeWithoutScreenplay = {
        ...mockEpisode,
        screenplayData: null,
      };

      render(
        <ScreenplayViewer
          episode={episodeWithoutScreenplay}
          onApprove={mockOnApprove}
        />,
      );

      expect(screen.queryByTestId('scene-navigation')).toBeNull();
    });
  });

  describe('Screenplay Rendering', () => {
    it('should render screenplay when data is available', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByTestId('scene-navigation')).toBeDefined();
      expect(screen.getByTestId('scene-content-1')).toBeDefined();
      expect(screen.getByTestId('scene-content-2')).toBeDefined();
    });

    it('should display scene count in header', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByText(/2 scenes/)).toBeDefined();
    });

    it('should display estimated duration in minutes', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      // 75 seconds = 1.25 minutes, rounded to ~1 min
      expect(screen.getByText(/~1 min/)).toBeDefined();
    });
  });

  describe('Approve Button', () => {
    it('should render approve button', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByText(/Approve & Continue/)).toBeDefined();
    });

    it('should call onApprove when approve button is clicked', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      const approveButton = screen
        .getByText(/Approve & Continue/)
        .closest('button');
      fireEvent.click(approveButton!);

      // Note: Due to useTransition, onApprove is called asynchronously
      // In the actual component, it happens inside startTransition
      expect(mockOnApprove).toHaveBeenCalled();
    });
  });

  describe('Regenerate Button', () => {
    it('should render regenerate button when onRegenerate is provided', () => {
      render(
        <ScreenplayViewer
          episode={mockEpisode}
          onApprove={mockOnApprove}
          onRegenerate={mockOnRegenerate}
        />,
      );

      expect(screen.getByText(/Regenerate/)).toBeDefined();
    });

    it('should not render regenerate button when onRegenerate is not provided', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.queryByText(/Regenerate/)).toBeNull();
    });

    it('should call onRegenerate when regenerate button is clicked', () => {
      render(
        <ScreenplayViewer
          episode={mockEpisode}
          onApprove={mockOnApprove}
          onRegenerate={mockOnRegenerate}
        />,
      );

      const regenerateButton = screen.getByText(/Regenerate/).closest('button');
      fireEvent.click(regenerateButton!);

      expect(mockOnRegenerate).toHaveBeenCalled();
    });
  });

  describe('Scene Navigation Integration', () => {
    it('should pass scenes to SceneNavigation', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByTestId('scene-nav-1')).toBeDefined();
      expect(screen.getByTestId('scene-nav-2')).toBeDefined();
    });

    it('should set first scene as active initially', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      const navigation = screen.getByTestId('scene-navigation');
      expect(navigation.getAttribute('data-active')).toBe('1');
    });

    it('should update active scene when scene nav is clicked', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      fireEvent.click(screen.getByTestId('scene-nav-2'));

      const navigation = screen.getByTestId('scene-navigation');
      expect(navigation.getAttribute('data-active')).toBe('2');
    });
  });

  describe('Scene Content Rendering', () => {
    it('should render SceneContent for each scene', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByTestId('scene-content-1')).toBeDefined();
      expect(screen.getByTestId('scene-content-2')).toBeDefined();
    });

    it('should mark first scene as active initially', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      const scene1 = screen.getByTestId('scene-content-1');
      const scene2 = screen.getByTestId('scene-content-2');

      expect(scene1.getAttribute('data-active')).toBe('true');
      expect(scene2.getAttribute('data-active')).toBe('false');
    });

    it('should update active scene content when navigation changes', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      fireEvent.click(screen.getByTestId('scene-nav-2'));

      const scene1 = screen.getByTestId('scene-content-1');
      const scene2 = screen.getByTestId('scene-content-2');

      expect(scene1.getAttribute('data-active')).toBe('false');
      expect(scene2.getAttribute('data-active')).toBe('true');
    });
  });

  describe('IntersectionObserver', () => {
    it('should create IntersectionObserver on mount', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(global.IntersectionObserver).toHaveBeenCalled();
    });

    it('should observe scene elements', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      // Should observe all scene elements
      expect(mockObserve).toHaveBeenCalled();
    });

    it('should disconnect observer on unmount', () => {
      const { unmount } = render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      unmount();

      expect(mockDisconnect).toHaveBeenCalled();
    });

    it('should not create observer when no screenplay', () => {
      const episodeWithoutScreenplay = {
        ...mockEpisode,
        screenplayData: null,
      };

      render(
        <ScreenplayViewer
          episode={episodeWithoutScreenplay}
          onApprove={mockOnApprove}
        />,
      );

      // Observer should not be created for empty screenplay
      expect(mockObserve).not.toHaveBeenCalled();
    });
  });

  describe('Card Structure', () => {
    it('should render within a Card component', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByTestId('card')).toBeDefined();
    });

    it('should have card header with title', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByTestId('card-header')).toBeDefined();
      expect(screen.getByText('Screenplay')).toBeDefined();
    });
  });

  describe('Icons', () => {
    it('should render Film icon in header', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByTestId('icon-film')).toBeDefined();
    });

    it('should render Check icon in approve button', () => {
      render(
        <ScreenplayViewer episode={mockEpisode} onApprove={mockOnApprove} />,
      );

      expect(screen.getByTestId('icon-check')).toBeDefined();
    });

    it('should render RefreshCw icon in regenerate button when present', () => {
      render(
        <ScreenplayViewer
          episode={mockEpisode}
          onApprove={mockOnApprove}
          onRegenerate={mockOnRegenerate}
        />,
      );

      expect(screen.getByTestId('icon-refresh')).toBeDefined();
    });
  });
});
