/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StoryIdea } from '@kit/prompt-engine/schemas';

import { IdeaCard } from '../idea-card';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  CheckCircle: () => <span data-testid="icon-check" />,
  Eye: () => <span data-testid="icon-eye" />,
  Sparkles: () => <span data-testid="icon-sparkles" />,
}));

// Mock UI components
vi.mock('@kit/ui/badge', () => ({
  Badge: ({
    children,
    variant,
  }: {
    children: React.ReactNode;
    variant?: string;
  }) => (
    <span data-testid="badge" data-variant={variant}>
      {children}
    </span>
  ),
}));

vi.mock('@kit/ui/button', () => ({
  Button: ({
    children,
    onClick,
    variant,
    size,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    size?: string;
  }) => (
    <button
      data-testid="button"
      data-variant={variant}
      data-size={size}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

vi.mock('@kit/ui/card', () => ({
  Card: ({
    children,
    className,
    onClick,
  }: {
    children: React.ReactNode;
    className?: string;
    onClick?: () => void;
  }) => (
    <div data-testid="card" className={className} onClick={onClick}>
      {children}
    </div>
  ),
  CardContent: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="card-content" className={className}>
      {children}
    </div>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-description">{children}</div>
  ),
  CardHeader: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="card-header" className={className}>
      {children}
    </div>
  ),
  CardTitle: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <div data-testid="card-title" className={className}>
      {children}
    </div>
  ),
}));

vi.mock('@kit/ui/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('IdeaCard', () => {
  const mockIdea: StoryIdea = {
    title: 'The Last Frontier',
    logline: 'A lone astronaut discovers alien life on Mars',
    themes: ['exploration', 'discovery', 'isolation', 'humanity'],
    hook: 'What if we are not alone in the universe?',
    visualPotential: 'High - stunning Mars landscapes and alien encounters',
  };

  const defaultProps = {
    idea: mockIdea,
    isSelected: false,
    onSelect: vi.fn(),
  };

  it('should render the idea title', () => {
    render(<IdeaCard {...defaultProps} />);

    expect(screen.getByText('The Last Frontier')).toBeDefined();
  });

  it('should render the logline', () => {
    render(<IdeaCard {...defaultProps} />);

    expect(
      screen.getByText('A lone astronaut discovers alien life on Mars'),
    ).toBeDefined();
  });

  it('should render themes as badges (max 3)', () => {
    render(<IdeaCard {...defaultProps} />);

    const badges = screen.getAllByTestId('badge');
    // Should show 3 themes + 1 overflow badge
    expect(badges.length).toBe(4);
    expect(screen.getByText('exploration')).toBeDefined();
    expect(screen.getByText('discovery')).toBeDefined();
    expect(screen.getByText('isolation')).toBeDefined();
    expect(screen.getByText('+1')).toBeDefined();
  });

  it('should render the hook', () => {
    render(<IdeaCard {...defaultProps} />);

    expect(
      screen.getByText('What if we are not alone in the universe?'),
    ).toBeDefined();
  });

  it('should render visual potential', () => {
    render(<IdeaCard {...defaultProps} />);

    expect(
      screen.getByText(
        'Visual Potential: High - stunning Mars landscapes and alien encounters',
      ),
    ).toBeDefined();
  });

  it('should call onSelect when card is clicked', () => {
    const onSelect = vi.fn();
    render(<IdeaCard {...defaultProps} onSelect={onSelect} />);

    const card = screen.getByTestId('card');
    fireEvent.click(card);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('should call onSelect when select button is clicked', () => {
    const onSelect = vi.fn();
    render(<IdeaCard {...defaultProps} onSelect={onSelect} />);

    const button = screen.getByTestId('button');
    fireEvent.click(button);

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('should show "Selected" text when isSelected is true', () => {
    render(<IdeaCard {...defaultProps} isSelected={true} />);

    expect(screen.getByText('Selected')).toBeDefined();
  });

  it('should show "Select" text when isSelected is false', () => {
    render(<IdeaCard {...defaultProps} isSelected={false} />);

    expect(screen.getByText('Select')).toBeDefined();
  });

  it('should show check icon when selected', () => {
    render(<IdeaCard {...defaultProps} isSelected={true} />);

    expect(screen.getByTestId('icon-check')).toBeDefined();
  });

  it('should apply ring styling when selected', () => {
    render(<IdeaCard {...defaultProps} isSelected={true} />);

    const card = screen.getByTestId('card');
    expect(card.className).toContain('ring-primary');
    expect(card.className).toContain('ring-2');
  });

  it('should handle ideas with fewer than 3 themes', () => {
    const ideaWithFewThemes: StoryIdea = {
      ...mockIdea,
      themes: ['adventure'],
    };

    render(<IdeaCard {...defaultProps} idea={ideaWithFewThemes} />);

    const badges = screen.getAllByTestId('badge');
    expect(badges.length).toBe(1);
    expect(screen.getByText('adventure')).toBeDefined();
  });

  it('should handle ideas with exactly 3 themes (no overflow badge)', () => {
    const ideaWithThreeThemes: StoryIdea = {
      ...mockIdea,
      themes: ['adventure', 'drama', 'mystery'],
    };

    render(<IdeaCard {...defaultProps} idea={ideaWithThreeThemes} />);

    const badges = screen.getAllByTestId('badge');
    expect(badges.length).toBe(3);
    expect(screen.queryByText('+')).toBeNull();
  });
});
