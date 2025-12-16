/**
 * @vitest-environment happy-dom
 */
import React from 'react';

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SceneContent } from '../scene-content';

// Mock the cn utility
vi.mock('@kit/ui/utils', () => ({
  cn: (...args: (string | boolean | undefined)[]) =>
    args.filter(Boolean).join(' '),
}));

describe('SceneContent', () => {
  const mockScene = {
    number: 1,
    heading: 'INT. COFFEE SHOP - MORNING',
    location: 'Coffee Shop',
    timeOfDay: 'day' as const,
    description: 'A cozy coffee shop with warm lighting.',
    dialogue: [
      {
        character: 'JOHN',
        parenthetical: 'nervously',
        text: 'Do you come here often?',
      },
      {
        character: 'SARAH',
        text: 'Sometimes.',
      },
    ],
    estimatedDuration: 30,
  };

  describe('Rendering', () => {
    it('should render scene heading', () => {
      render(<SceneContent scene={mockScene} />);

      expect(screen.getByText('INT. COFFEE SHOP - MORNING')).toBeDefined();
    });

    it('should render scene location', () => {
      render(<SceneContent scene={mockScene} />);

      expect(screen.getByText(/Location: Coffee Shop/)).toBeDefined();
    });

    it('should render time of day', () => {
      render(<SceneContent scene={mockScene} />);

      expect(screen.getByText(/Time: day/)).toBeDefined();
    });

    it('should render estimated duration', () => {
      render(<SceneContent scene={mockScene} />);

      expect(screen.getByText(/Duration: ~30s/)).toBeDefined();
    });

    it('should render scene description', () => {
      render(<SceneContent scene={mockScene} />);

      expect(
        screen.getByText('A cozy coffee shop with warm lighting.'),
      ).toBeDefined();
    });

    it('should set correct id attribute for scroll targeting', () => {
      const { container } = render(<SceneContent scene={mockScene} />);

      const sceneElement = container.querySelector('#scene-1');
      expect(sceneElement).not.toBeNull();
    });
  });

  describe('Dialogue Rendering', () => {
    it('should render character names in uppercase', () => {
      render(<SceneContent scene={mockScene} />);

      expect(screen.getByText('JOHN')).toBeDefined();
      expect(screen.getByText('SARAH')).toBeDefined();
    });

    it('should render dialogue text', () => {
      render(<SceneContent scene={mockScene} />);

      expect(screen.getByText('Do you come here often?')).toBeDefined();
      expect(screen.getByText('Sometimes.')).toBeDefined();
    });

    it('should render parentheticals when present', () => {
      render(<SceneContent scene={mockScene} />);

      expect(screen.getByText('(nervously)')).toBeDefined();
    });

    it('should not render parentheticals when not present', () => {
      render(<SceneContent scene={mockScene} />);

      // Sarah has no parenthetical, so there should only be one
      const parentheticals = screen.getAllByText(/^\(/);
      expect(parentheticals).toHaveLength(1);
    });
  });

  describe('Empty Dialogue', () => {
    it('should not render dialogue section when dialogue array is empty', () => {
      const sceneWithNoDialogue = {
        ...mockScene,
        dialogue: [],
      };

      render(<SceneContent scene={sceneWithNoDialogue} />);

      expect(screen.queryByText('JOHN')).toBeNull();
      expect(screen.queryByText('SARAH')).toBeNull();
    });
  });

  describe('Active State', () => {
    it('should apply active styling when isActive is true', () => {
      const { container } = render(
        <SceneContent scene={mockScene} isActive={true} />,
      );

      const sceneElement = container.querySelector('#scene-1');
      expect(sceneElement?.className).toContain('bg-accent/20');
      expect(sceneElement?.className).toContain('rounded-lg');
      expect(sceneElement?.className).toContain('p-4');
    });

    it('should not apply active styling when isActive is false', () => {
      const { container } = render(
        <SceneContent scene={mockScene} isActive={false} />,
      );

      const sceneElement = container.querySelector('#scene-1');
      expect(sceneElement?.className).not.toContain('bg-accent/20');
    });

    it('should default to inactive when isActive is not provided', () => {
      const { container } = render(<SceneContent scene={mockScene} />);

      const sceneElement = container.querySelector('#scene-1');
      expect(sceneElement?.className).not.toContain('bg-accent/20');
    });
  });

  describe('Multiple Scenes', () => {
    it('should render different scene numbers correctly', () => {
      const scene2 = { ...mockScene, number: 2 };
      const { container } = render(<SceneContent scene={scene2} />);

      const sceneElement = container.querySelector('#scene-2');
      expect(sceneElement).not.toBeNull();
    });
  });
});
