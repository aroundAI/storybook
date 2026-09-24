import type { ComponentProps, ReactNode } from 'react';

import {
  act,
  configure,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioAsset } from '../audio-asset-card';
import { AudioLibraryClient } from '../audio-library-client';

/**
 * KB-79: the audio library took one upload. The Upload button was drawn only
 * in the empty state, and the list lived in `useState(initialAssets)`, which
 * ignored the new props `router.refresh()` brought, so a new asset showed
 * only after a full reload. The E2E drives both through the real dialog;
 * these pin the two causes.
 */

configure({ testIdAttribute: 'data-test' });

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const uploaded: AudioAsset = {
  id: 'new-1',
  name: 'Second track',
  audioType: 'music',
  prompt: 'Second track',
  fileUrl: 'https://storage.test/new.mp3',
  durationSeconds: null,
  status: 'completed',
  usageCount: 0,
  createdAt: '2026-09-24T00:00:01Z',
};

// The dialogs are driven by the E2E; here each is a button that reports a
// finished upload or generation, as the real ones do.
vi.mock('../upload-audio-dialog', () => ({
  UploadAudioDialog: (props: {
    open: boolean;
    onSuccess?: (asset: AudioAsset) => void;
  }) =>
    props.open ? (
      <button
        data-test="fake-upload-done"
        onClick={() => props.onSuccess?.(uploaded)}
      >
        done
      </button>
    ) : null,
}));

vi.mock('../generate-audio-dialog', () => ({
  GenerateAudioDialog: () => null,
}));

vi.mock('../batch-generate-dialog', () => ({
  BatchGenerateDialog: () => null,
}));

// Plain elements in place of the styled ones: the subject is which buttons
// and cards are drawn, not how.
vi.mock('@kit/ui/button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => (
    <button {...props} />
  ),
}));

vi.mock('@kit/ui/input', () => ({
  Input: (props: ComponentProps<'input'>) => <input {...props} />,
}));

vi.mock('@kit/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock('@kit/ui/card', () => ({
  Card: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@kit/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: () => null,
    DropdownMenuItem: Pass,
  };
});

vi.mock('@kit/ui/tabs', () => {
  const Pass = ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  );
  return { Tabs: Pass, TabsList: Pass, TabsTrigger: Pass };
});

const first: AudioAsset = {
  id: 'old-1',
  name: 'First track',
  audioType: 'music',
  prompt: 'First track',
  fileUrl: 'https://storage.test/old.mp3',
  durationSeconds: null,
  status: 'completed',
  usageCount: 0,
  createdAt: '2026-09-24T00:00:00Z',
};

beforeEach(() => {
  refresh.mockClear();
});

describe('AudioLibraryClient (KB-79)', () => {
  it('offers Upload when the library already holds an asset', () => {
    render(<AudioLibraryClient projectId="p" initialAssets={[first]} />);

    expect(screen.getByText('First track')).toBeTruthy();
    expect(screen.getByTestId('audio-library-upload')).toBeTruthy();
  });

  it('shows an upload as soon as the dialog reports it, then refreshes', async () => {
    render(<AudioLibraryClient projectId="p" initialAssets={[first]} />);

    fireEvent.click(screen.getByTestId('audio-library-upload'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('fake-upload-done'));
    });

    expect(screen.getByText('Second track')).toBeTruthy();
    expect(screen.getByText('First track')).toBeTruthy();
    expect(refresh).toHaveBeenCalled();
  });

  it('follows the server list when it changes, without duplicating an upload', async () => {
    const { rerender } = render(
      <AudioLibraryClient projectId="p" initialAssets={[first]} />,
    );

    fireEvent.click(screen.getByTestId('audio-library-upload'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('fake-upload-done'));
    });

    const generated: AudioAsset = {
      ...first,
      id: 'gen-1',
      name: 'Generated cue',
      prompt: 'Generated cue',
    };

    rerender(
      <AudioLibraryClient
        projectId="p"
        initialAssets={[generated, uploaded, first]}
      />,
    );

    expect(screen.getByText('Generated cue')).toBeTruthy();
    expect(screen.getAllByText('Second track')).toHaveLength(1);
  });
});
