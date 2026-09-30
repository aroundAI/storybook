export type DialogueShortcut =
  | 'next'
  | 'previous'
  | 'first'
  | 'last'
  | 'toggle-play'
  | 'open-menu'
  | 'edit'
  | 'close';

export const DIALOGUE_SHORTCUTS: readonly {
  keys: string;
  description: string;
}[] = [
  { keys: 'Arrow Up / Down', description: 'Move to the previous or next line' },
  { keys: 'Home / End', description: 'Jump to the first or last line' },
  { keys: 'Space', description: 'Play or pause the focused line' },
  { keys: 'Enter', description: 'Open the line actions menu' },
  { keys: 'E', description: 'Edit the focused line' },
  { keys: 'Escape', description: 'Close the menu' },
];

const KEY_TO_SHORTCUT: Record<string, DialogueShortcut> = {
  ArrowDown: 'next',
  ArrowUp: 'previous',
  Home: 'first',
  End: 'last',
  ' ': 'toggle-play',
  Enter: 'open-menu',
  e: 'edit',
  E: 'edit',
  Escape: 'close',
};

interface ShortcutKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function resolveDialogueShortcut(
  event: ShortcutKeyEvent,
): DialogueShortcut | null {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return null;
  }

  return KEY_TO_SHORTCUT[event.key] ?? null;
}

export function isKeyboardIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return (
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
    ) !== null
  );
}

export function moveDialogueIndex(
  current: number,
  shortcut: DialogueShortcut,
  length: number,
): number {
  if (length === 0) {
    return -1;
  }

  switch (shortcut) {
    case 'next':
      return Math.min(current + 1, length - 1);
    case 'previous':
      return Math.max(current - 1, 0);
    case 'first':
      return 0;
    case 'last':
      return length - 1;
    default:
      return current;
  }
}
