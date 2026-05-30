/**
 * Barrel exports for @kit/edit-suite components.
 */

// Provider & Shell
export {
  EditSuiteProvider,
  usePlayback,
  useEditData,
  useEditCommands,
  useEditSuite,
} from './edit-suite-provider';
export type {
  PlaybackContextValue,
  DataContextValue,
  CommandContextValue,
  AssemblyStatus,
} from './edit-suite-provider';
export { EditSuiteShell } from './edit-suite-shell';

// State
export { editReducer } from '../state/edit-reducer';
export { UndoManager } from '../state/edit-commands';
export type { EditCommand } from '../state/edit-commands';
export type { EditSuiteState, EditAction, SaveStatus } from '../state/types';
export { createInitialState } from '../state/types';
