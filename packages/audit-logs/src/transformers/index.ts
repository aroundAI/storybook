export { ConfigBasedTransformer } from './config-based-transformer';
export { userTransformer } from './user-transformer';
export { projectTransformer } from './project-transformer';
export { settingsTransformer } from './settings-transformer';

// Helper to initialize default transformers
import { registerTransformer } from '../config/audit-registry';
import { userTransformer } from './user-transformer';
import { projectTransformer } from './project-transformer';
import { settingsTransformer } from './settings-transformer';

/**
 * Initialize default transformers
 * Call this once during application startup
 */
export function initializeAuditTransformers(): void {
  registerTransformer('user', userTransformer);
  registerTransformer('project', projectTransformer);
  registerTransformer('account_settings', settingsTransformer);
  registerTransformer('settings', settingsTransformer); // Alias
}
