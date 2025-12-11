/**
 * DialogueList component tests (FILM-506)
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CharacterAsset,
  DialogueLine,
} from '../src/lib/types/dialogue.types';
import { DialogueList } from '../src/components/DialogueList';

// Mock server actions
vi.mock('../src/server/voice-actions', () => ({
  generateDialogueVoiceAction: vi.fn().mockResolvedValue({
    dialogueLineId: 'line-1',
    audioUrl: 'https://example.com/audio.mp3',
    duration: 5.2,
    cost: 10,
    status: 'completed',
  }),
}));

vi.mock('../src/server/batch-actions', () => ({
  batchGenerateDialogueAction: vi.fn().mockResolvedValue({
    batchJobId: 'batch-1',
    episodeId: 'episode-1',
    totalLines: 5,
    estimatedCost: 100,
    estimatedDuration: 30,
    status: 'queued',
  }),
}));

// Mock toast
vi.mock('@kit/ui/sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

// Test data
const mockCharacters: CharacterAsset[] = [
  { id: 'char-1', name: 'Alice', type: 'character' },
  { id: 'char-2', name: 'Bob', type: 'character' },
];

const mockDialogueLines: DialogueLine[] = [
  {
    id: 'line-1',
    episodeId: 'episode-1',
    characterAssetId: 'char-1',
    text: 'Hello, how are you?',
    sequenceNumber: 1,
    status: 'completed',
    audioUrl: 'https://example.com/audio1.mp3',
    generationMetadata: { durationSeconds: 2.5 },
  },
  {
    id: 'line-2',
    episodeId: 'episode-1',
    characterAssetId: 'char-2',
    text: 'I am doing well, thanks!',
    sequenceNumber: 2,
    status: 'pending',
    audioUrl: null,
    generationMetadata: null,
  },
  {
    id: 'line-3',
    episodeId: 'episode-1',
    characterAssetId: 'char-1',
    text: 'Great to hear.',
    sequenceNumber: 3,
    status: 'failed',
    audioUrl: null,
    generationMetadata: { error: 'API rate limit exceeded' },
  },
  {
    id: 'line-4',
    episodeId: 'episode-1',
    characterAssetId: null,
    text: 'The narrator speaks.',
    sequenceNumber: 4,
    status: 'generating',
    audioUrl: null,
    generationMetadata: null,
  },
];

// Create a wrapper with QueryClientProvider
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe('DialogueList', () => {
  const mockOnPlay = vi.fn();
  const mockOnPause = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders all dialogue lines', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Check that all lines are rendered
      expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
      expect(screen.getByText('I am doing well, thanks!')).toBeInTheDocument();
      expect(screen.getByText('Great to hear.')).toBeInTheDocument();
      expect(screen.getByText('The narrator speaks.')).toBeInTheDocument();
    });

    it('displays correct summary counts', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('4 lines:')).toBeInTheDocument();
      expect(screen.getByText('1 completed')).toBeInTheDocument();
      expect(screen.getByText('1 pending')).toBeInTheDocument();
      expect(screen.getByText('1 generating')).toBeInTheDocument();
      expect(screen.getByText('1 failed')).toBeInTheDocument();
    });

    it('displays character names correctly', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Check character names appear
      const aliceElements = screen.getAllByText('Alice');
      expect(aliceElements.length).toBeGreaterThan(0);
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Narrator')).toBeInTheDocument();
    });

    it('displays status badges correctly', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('Completed')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
      expect(screen.getByText('Failed')).toBeInTheDocument();
      expect(screen.getByText('Generating')).toBeInTheDocument();
    });

    it('shows error message for failed lines', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('API rate limit exceeded')).toBeInTheDocument();
    });

    it('renders empty state when no lines', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={[]}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      expect(screen.getByText('No dialogue lines found')).toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('filters by search text', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      const searchInput = screen.getByPlaceholderText('Search dialogue...');
      fireEvent.change(searchInput, { target: { value: 'Hello' } });

      expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
      expect(screen.queryByText('I am doing well, thanks!')).not.toBeInTheDocument();
    });

    it('filters by character', async () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Open character filter dropdown
      const characterFilter = screen.getByTestId('character-filter');
      fireEvent.click(characterFilter);

      // Wait for dropdown and select Alice
      const aliceOption = await screen.findByRole('option', { name: 'Alice' });
      fireEvent.click(aliceOption);

      // Only Alice's lines should be visible
      expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
      expect(screen.getByText('Great to hear.')).toBeInTheDocument();
      expect(screen.queryByText('I am doing well, thanks!')).not.toBeInTheDocument();
    });

    it('filters by status', async () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Open status filter dropdown
      const statusFilter = screen.getByTestId('status-filter');
      fireEvent.click(statusFilter);

      // Select "completed" status
      const completedOption = await screen.findByRole('option', { name: 'Completed' });
      fireEvent.click(completedOption);

      // Only completed lines should be visible
      expect(screen.getByText('Hello, how are you?')).toBeInTheDocument();
      expect(screen.queryByText('I am doing well, thanks!')).not.toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('sorts by sequence number by default', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      const lines = screen.getAllByText(/\d/, { selector: '.tabular-nums' });
      // Check sequence numbers are in order
      expect(lines[0]?.textContent).toBe('1');
      expect(lines[1]?.textContent).toBe('2');
    });
  });

  describe('audio controls', () => {
    it('calls onPlay when play button is clicked', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Find the play button for the first line (which has audio)
      const playButton = screen.getByTestId('play-button-line-1');
      fireEvent.click(playButton);

      expect(mockOnPlay).toHaveBeenCalledWith(
        'https://example.com/audio1.mp3',
        'line-1',
      );
    });

    it('calls onPause when pause button is clicked', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
          playingLineId="line-1"
        />,
        { wrapper: createWrapper() },
      );

      // When playingLineId matches, clicking should pause
      const playButton = screen.getByTestId('play-button-line-1');
      fireEvent.click(playButton);

      expect(mockOnPause).toHaveBeenCalled();
    });

    it('disables play button when no audio URL', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Line 2 has no audio URL
      const playButton = screen.getByTestId('play-button-line-2');
      expect(playButton).toBeDisabled();
    });

    it('disables download button when no audio URL', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Line 2 has no audio URL
      const downloadButton = screen.getByTestId('download-button-line-2');
      expect(downloadButton).toBeDisabled();
    });
  });

  describe('selection', () => {
    it('selects individual lines', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Find the row for line-1 and get its checkbox
      const row = screen.getByTestId('dialogue-line-line-1');
      const checkbox = within(row).getByRole('checkbox');
      fireEvent.click(checkbox);

      // Check selection indicator appears
      expect(screen.getByText('1 line selected')).toBeInTheDocument();
    });

    it('selects all lines with select all checkbox', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      const selectAllCheckbox = screen.getByTestId('select-all-checkbox');
      fireEvent.click(selectAllCheckbox);

      expect(screen.getByText('4 lines selected')).toBeInTheDocument();
    });

    it('clears selection when clear button is clicked', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      // Select a line
      const row = screen.getByTestId('dialogue-line-line-1');
      const checkbox = within(row).getByRole('checkbox');
      fireEvent.click(checkbox);

      // Clear selection
      const clearButton = screen.getByText('Clear Selection');
      fireEvent.click(clearButton);

      expect(screen.queryByText(/line.*selected/)).not.toBeInTheDocument();
    });
  });

  describe('batch operations', () => {
    it('disables batch generate when no pending or failed lines', () => {
      const completedLines: DialogueLine[] = [
        {
          id: 'line-1',
          episodeId: 'episode-1',
          characterAssetId: 'char-1',
          text: 'Completed line',
          sequenceNumber: 1,
          status: 'completed',
          audioUrl: 'https://example.com/audio.mp3',
          generationMetadata: null,
        },
      ];

      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={completedLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      const batchButton = screen.getByTestId('batch-generate-button');
      expect(batchButton).toBeDisabled();
    });

    it('enables batch generate when there are pending lines', () => {
      render(
        <DialogueList
          episodeId="episode-1"
          dialogueLines={mockDialogueLines}
          characters={mockCharacters}
          onPlay={mockOnPlay}
          onPause={mockOnPause}
        />,
        { wrapper: createWrapper() },
      );

      const batchButton = screen.getByTestId('batch-generate-button');
      expect(batchButton).not.toBeDisabled();
    });
  });
});
