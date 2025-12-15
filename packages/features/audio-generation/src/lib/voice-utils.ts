import { ELEVENLABS } from './constants';

/**
 * Estimate voice generation cost in cents
 * Based on ElevenLabs pricing: $0.30 per 1000 characters
 */
export function estimateVoiceCost(textLength: number): number {
    return Math.ceil((textLength / 1000) * ELEVENLABS.COST_PER_1000_CHARS);
}
