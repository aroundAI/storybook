import { X_ENABLED } from '../../../../packages/features/publishing/src/lib/x-switch';

export { X_ENABLED };

/**
 * X is retired for now by the owner, 2026-10-02, and hidden behind
 * `X_ENABLED`, its code kept. A spec that drives X skips with this reason
 * while the switch is off, and runs again when it is switched on.
 */
export const X_HIDDEN =
  'X is hidden while X_ENABLED is off (owner, 2026-10-02); switch it on to run this';
