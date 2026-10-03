/**
 * The embedded prompt registry moved into `@kit/ai-gateway` with the
 * executor that reads it (FILM-1902 part B); this keeps the worker's import
 * path. Add a prompt in `packages/ai-gateway/src/prompts/lambda-registry.ts`.
 */
export {
  PROMPT_REGISTRY,
  type PromptTemplate,
  getPromptTemplate,
} from '@kit/ai-gateway/lambda-prompts';
