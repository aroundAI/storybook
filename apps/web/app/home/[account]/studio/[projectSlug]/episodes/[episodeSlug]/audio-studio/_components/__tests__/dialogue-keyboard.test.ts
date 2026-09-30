import { describe, expect, it } from 'vitest';

import {
  isKeyboardIgnoredTarget,
  moveDialogueIndex,
  resolveDialogueShortcut,
} from '../dialogue-keyboard';

const key = (k: string, mods: Partial<Record<string, boolean>> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

describe('resolveDialogueShortcut', () => {
  it('maps the documented keys', () => {
    expect(resolveDialogueShortcut(key('ArrowDown'))).toBe('next');
    expect(resolveDialogueShortcut(key('ArrowUp'))).toBe('previous');
    expect(resolveDialogueShortcut(key('Home'))).toBe('first');
    expect(resolveDialogueShortcut(key('End'))).toBe('last');
    expect(resolveDialogueShortcut(key(' '))).toBe('toggle-play');
    expect(resolveDialogueShortcut(key('Enter'))).toBe('open-menu');
    expect(resolveDialogueShortcut(key('e'))).toBe('edit');
    expect(resolveDialogueShortcut(key('Escape'))).toBe('close');
  });

  it('ignores unmapped keys and modified keys', () => {
    expect(resolveDialogueShortcut(key('x'))).toBeNull();
    expect(resolveDialogueShortcut(key('e', { metaKey: true }))).toBeNull();
    expect(
      resolveDialogueShortcut(key('ArrowDown', { ctrlKey: true })),
    ).toBeNull();
  });
});

describe('isKeyboardIgnoredTarget', () => {
  it('ignores form fields, dialogs and menus but not dialogue blocks', () => {
    const textarea = document.createElement('textarea');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inner = document.createElement('button');
    dialog.appendChild(inner);
    const block = document.createElement('div');
    block.setAttribute('role', 'button');

    expect(isKeyboardIgnoredTarget(textarea)).toBe(true);
    expect(isKeyboardIgnoredTarget(inner)).toBe(true);
    expect(isKeyboardIgnoredTarget(block)).toBe(false);
    expect(isKeyboardIgnoredTarget(null)).toBe(false);
  });
});

describe('moveDialogueIndex', () => {
  it('clamps at both ends', () => {
    expect(moveDialogueIndex(0, 'previous', 3)).toBe(0);
    expect(moveDialogueIndex(2, 'next', 3)).toBe(2);
    expect(moveDialogueIndex(1, 'next', 3)).toBe(2);
    expect(moveDialogueIndex(1, 'first', 3)).toBe(0);
    expect(moveDialogueIndex(1, 'last', 3)).toBe(2);
    expect(moveDialogueIndex(0, 'next', 0)).toBe(-1);
  });
});
