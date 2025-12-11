/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StoryIdeation } from '../story-ideation';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ArrowRight: () => <span data-testid="icon-arrow-right" />,
  CheckCircle: () => <span data-testid="icon-check" />,
  Eye: () => <span data-testid="icon-eye" />,
  Lightbulb: () => <span data-testid="icon-lightbulb" />,
  Loader2: () => <span data-testid="icon-loader" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
  Sparkles: () => <span data-testid="icon-sparkles" />,
}));

// Mock the server action
vi.mock('../../../server/story-actions', () => ({
  generateStoryIdeasAction: vi.fn(),
}));

// Mock UI components
vi.mock('@kit/ui/button', () => ({
  Button: ({
    children,
    onClick,
    type,
    disabled,
    variant,
    className,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    type?: string;
    disabled?: boolean;
    variant?: string;
    className?: string;
  }) => (
    <button
      data-testid="button"
      data-type={type}
      data-variant={variant}
      className={className}
      disabled={disabled}
      onClick={onClick}
      type={type as 'submit' | 'button' | 'reset'}
    >
      {children}
    </button>
  ),
}));

vi.mock('@kit/ui/card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>
      {children}
    </div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-content">{children}</div>
  ),
  CardDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-description">{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-header">{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="card-title">{children}</div>
  ),
}));

vi.mock('@kit/ui/form', () => ({
  Form: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="form">{children}</div>
  ),
  FormControl: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="form-control">{children}</div>
  ),
  FormDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="form-description">{children}</div>
  ),
  FormField: ({
    render,
    name,
  }: {
    render: (props: { field: { value: string; onChange: () => void } }) => React.ReactNode;
    name: string;
  }) => (
    <div data-testid={`form-field-${name}`}>
      {render({ field: { value: '', onChange: vi.fn() } })}
    </div>
  ),
  FormItem: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="form-item">{children}</div>
  ),
  FormLabel: ({ children }: { children: React.ReactNode }) => (
    <label data-testid="form-label">{children}</label>
  ),
  FormMessage: () => <div data-testid="form-message" />,
}));

vi.mock('@kit/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select">{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-content">{children}</div>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-trigger">{children}</div>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span data-testid="select-value">{placeholder}</span>
  ),
}));

vi.mock('@kit/ui/slider', () => ({
  Slider: ({
    value,
    onValueChange,
    min,
    max,
  }: {
    value: number[];
    onValueChange: (value: number[]) => void;
    min: number;
    max: number;
  }) => (
    <input
      data-testid="slider"
      type="range"
      min={min}
      max={max}
      value={value[0]}
      onChange={(e) => onValueChange([parseInt(e.target.value)])}
    />
  ),
}));

vi.mock('@kit/ui/sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@kit/ui/textarea', () => ({
  Textarea: ({
    placeholder,
    className,
    ...props
  }: {
    placeholder?: string;
    className?: string;
  }) => (
    <textarea data-testid="textarea" placeholder={placeholder} className={className} {...props} />
  ),
}));

vi.mock('../idea-card', () => ({
  IdeaCard: ({
    idea,
    isSelected,
    onSelect,
  }: {
    idea: { title: string };
    isSelected: boolean;
    onSelect: () => void;
  }) => (
    <div data-testid="idea-card" data-selected={isSelected} onClick={onSelect}>
      {idea.title}
    </div>
  ),
}));

describe('StoryIdeation', () => {
  const defaultProps = {
    onComplete: vi.fn(),
    isGenerating: false,
  };

  it('should render the story ideation form', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(screen.getByTestId('form')).toBeDefined();
    expect(screen.getByText('Story Ideation')).toBeDefined();
  });

  it('should render premise textarea', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(screen.getByTestId('form-field-premise')).toBeDefined();
  });

  it('should render genre select field', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(screen.getByTestId('form-field-genre')).toBeDefined();
  });

  it('should render style select field', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(screen.getByTestId('form-field-style')).toBeDefined();
  });

  it('should render target audience select field', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(screen.getByTestId('form-field-targetAudience')).toBeDefined();
  });

  it('should render number of ideas slider', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(screen.getByTestId('form-field-numberOfIdeas')).toBeDefined();
  });

  it('should render generate ideas button', () => {
    render(<StoryIdeation {...defaultProps} />);

    const buttons = screen.getAllByTestId('button');
    const generateButton = buttons.find((btn) =>
      btn.textContent?.includes('Generate Ideas'),
    );
    expect(generateButton).toBeDefined();
  });

  it('should show description text', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(
      screen.getByText('Enter your story premise and configure generation settings'),
    ).toBeDefined();
  });

  it('should not show idea cards initially', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(screen.queryByTestId('idea-card')).toBeNull();
  });

  it('should not show continue button when no ideas generated', () => {
    render(<StoryIdeation {...defaultProps} />);

    expect(screen.queryByText('Continue with Selected')).toBeNull();
  });

  it('should accept isGenerating prop', () => {
    render(<StoryIdeation {...defaultProps} isGenerating={true} />);

    // Component should render without error
    expect(screen.getByTestId('form')).toBeDefined();
  });
});

describe('StoryIdeation Form Validation', () => {
  it('should have a submit button', () => {
    render(<StoryIdeation onComplete={vi.fn()} />);

    const buttons = screen.getAllByTestId('button');
    const submitButton = buttons.find((btn) => btn.getAttribute('type') === 'submit');
    expect(submitButton).toBeDefined();
  });
});
