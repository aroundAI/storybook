export { ConfigBasedTransformer } from './config-based-transformer';
export { defaultTransformer } from './default-transformer';
export { userTransformer } from './user-transformer';
export { projectTransformer } from './project-transformer';
export { settingsTransformer } from './settings-transformer';
export { accountTransformer } from './account-transformer';
export { teamMemberTransformer } from './team-member-transformer';

// Helper to initialize default transformers
import { registerTransformer } from '../config/audit-registry';
import { userTransformer } from './user-transformer';
import { projectTransformer } from './project-transformer';
import { settingsTransformer } from './settings-transformer';
import { accountTransformer } from './account-transformer';
import { teamMemberTransformer } from './team-member-transformer';

/**
 * Initialize default transformers
 * Call this once during application startup
 *
 * This registers transformers for common object types to ensure
 * sensitive data is always properly handled.
 */
export function initializeAuditTransformers(): void {
  // User transformers
  registerTransformer('user', userTransformer);

  // Account transformers
  registerTransformer('account', accountTransformer);

  // Project transformers
  registerTransformer('project', projectTransformer);

  // Team member transformers (works for both project and account members)
  registerTransformer('team_member', teamMemberTransformer);

  // Settings transformers
  registerTransformer('account_settings', settingsTransformer);
  registerTransformer('settings', settingsTransformer); // Alias
}
