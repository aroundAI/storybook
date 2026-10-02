import { describe, expect, it } from 'vitest';

import type { PlatformUploadStatus } from '../publish-types';
import {
  type PublishOutcome,
  publishedUploadStatus,
} from '../published-upload-status';

/**
 * KB-160: the publish dialog read `url` off the action's result, which
 * returns `platformUrl`, so the link to the published post never showed.
 */
const uploading: PlatformUploadStatus = {
  platform: 'youtube',
  connectionName: 'Sandbox Channel',
  language: 'en',
  contentType: 'full',
  status: 'uploading',
};

const published: PublishOutcome = {
  platform: 'youtube',
  status: 'completed',
  platformContentId: 'vid-123',
  platformUrl: 'https://www.youtube.com/watch?v=vid-123',
  publishId: 'publish-1',
};

describe('publishedUploadStatus (KB-160)', () => {
  it('links the row to the URL the platform gave the post', () => {
    expect(publishedUploadStatus(uploading, published)).toEqual({
      ...uploading,
      status: 'success',
      url: 'https://www.youtube.com/watch?v=vid-123',
    });
  });
});
