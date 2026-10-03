/**
 * The worker's names for what now lives in `@kit/ai-gateway` (FILM-1902
 * part B). `executeLLMForLambda` moved behind the gateway with the embedded
 * registry it reads: it needs the run in scope (`withRun`, set by the job
 * boundary) and refuses before any model call unless that run is an open
 * server run. The handlers and tests that import these names from here keep
 * working; nothing in this file reaches a model itself.
 */
export {
  executeLLMForLambda,
  extractJSON,
  getApiKeyForProvider,
} from '@kit/ai-gateway';
export {
  type LambdaPromptTemplate as PromptTemplate,
  getPromptTemplate as loadPromptTemplate,
  loadAndRenderPromptForLambda,
  renderPrompt,
} from '@kit/ai-gateway/lambda-prompts';
