// Interaction patterns hooks (FILM-DS-03)
export * from './use-keyboard-navigation';
export * from './use-drag-drop';

// Accessibility hooks (FILM-DS-04)
export { useFocusTrap, useRovingTabIndex } from './use-focus-trap';
export type {
  UseFocusTrapOptions,
  UseRovingTabIndexReturn,
} from './use-focus-trap';

// Responsive hooks (FILM-DS-05)
export * from './use-media-query';
export * from './use-touch-gestures';
