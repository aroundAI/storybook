/**
 * Remotion Configuration
 */

import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);

// For Lambda rendering
// Config.setChunkSize(120);
// Config.setConcurrency(8);
