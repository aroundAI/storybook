'use server';

/**
 * @deprecated This file is maintained for backward compatibility only.
 * Use the individual action files instead:
 * - poll-status-action.ts for pollVideoStatusAction
 * - cancel-action.ts for cancelVideoJobAction
 */
import 'server-only';

export { pollVideoStatusAction } from './poll-status-action';
export { cancelVideoJobAction } from './cancel-action';
