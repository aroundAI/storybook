/**
 * Core Audio Generation Exports
 *
 * These exports are for use by the LLM Worker Lambda to process
 * audio generation jobs without the server action wrapper.
 */

export {
    generateMusicElevenLabsCore,
    type GenerateMusicCoreInput,
    type GenerateMusicCoreResult,
} from './elevenlabs-music-core';

export {
    generateSfxCore,
    type GenerateSfxCoreInput,
    type GenerateSfxCoreResult,
} from './sfx-core';

export {
    findOrCreateAudioAssetCore,
    updateAudioAssetCore,
    type AudioAsset,
} from './audio-asset-core';
