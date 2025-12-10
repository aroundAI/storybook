/**
 * Creatomate exports for @kit/video-rendering
 */

// Client/Provider
export { CreatomateRenderProvider } from './client';

// Timeline converter
export {
  convertTimelineToCreatomate,
  validateTimelineForCreatomate,
  estimateCreatomateCost,
  getCreatomateApiUrl,
} from './timeline-converter';

// Types
export type {
  CreatomateSource,
  CreatomateElement,
  CreatomateBaseElement,
  CreatomateVideoElement,
  CreatomateImageElement,
  CreatomateAudioElement,
  CreatomateTextElement,
  CreatomateCompositionElement,
  CreatomateAnimation,
  CreatomateRenderRequest,
  CreatomateRenderResponse,
  CreatomateTemplateResponse,
  CreatomateErrorResponse,
} from './types';
