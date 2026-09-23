/**
 * Publishing server actions. Client components import this barrel, so it
 * holds actions only: a `server-only` library re-exported here would be
 * bundled for the browser. Reads for server components are in
 * `@kit/publishing/server/queries` (KB-58).
 */

export { getConnectedPlatformsAction } from './connection-actions';

export {
  publishToAllAction,
  getPublishStatusAction,
  retryPublishAction,
  getEpisodePublishesAction,
  deleteEpisodePublishesAction,
  unpublishAction,
} from './publish-actions';

export {
  updateEpisodePublishingConfigsAction,
  togglePublishingConfigAction,
  type EpisodePublishingConfig,
  type PlatformConnection,
} from './episode-publishing-actions';

export {
  updateProjectPublishingConfigsAction,
  type ProjectPublishingConfig,
} from './project-publishing-actions';

export {
  saveAccountOAuthAppAction,
  deleteAccountOAuthAppAction,
  type AccountOAuthApp,
} from './account-oauth-actions';

export {
  saveGlobalOAuthAppAction,
  deleteGlobalOAuthAppAction,
  type GlobalOAuthApp,
} from './global-oauth-actions';

export {
  createSocialPostAction,
  getSocialPostsAction,
  getSocialPostAction,
  updateSocialPostAction,
  deleteSocialPostAction,
  approveSocialPostAction,
  publishSocialPostAction,
  regenerateVariantsAction,
} from './social-post-actions';
