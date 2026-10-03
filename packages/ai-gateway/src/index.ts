/**
 * @kit/ai-gateway: the one door to every AI model (FILM-1902).
 *
 * Nothing here takes a prompt and returns text on its own: every executor,
 * writer and embedder needs a generation run (FILM-1903), checks that it is
 * an open server run before the model call, and writes llm_usage_analytics
 * with its id. The only other workspace package that may import `@kit/llm`
 * or a model SDK is none; lint and a source scan enforce it.
 *
 * Lambda-safe: no `server-only`, no Next imports. The LLM worker bundles it.
 */
export { GatewayError, isGatewayError, type GatewayErrorCode } from './errors';
export { currentRun, requireRun, withRun } from './run-context';
export { assertServerRunOpen } from './guard';
export { gatewayBackend, openRun, withGateway } from './backend';
export { isLambdaEnvironment, type RunMessage } from './dispatch';
export {
  createServerWriter,
  type ServerWriter,
  type ServerWriterDeps,
} from './writers/server-writer';
export {
  createExternalWriter,
  type ExternalWriter,
} from './writers/external-writer';
export { resolveWriter } from './writers/resolve-writer';
export {
  executeLLM,
  type GatewayExecutorConfig,
} from './executors/execute-llm';
export {
  executeLLMForLambda,
  type LambdaExecutorConfig,
  type LambdaExecutorResult,
} from './executors/execute-llm-lambda';
export { extractJSON } from './executors/extract-json';
export { getApiKeyForProvider } from './executors/model-client';
export {
  embedForServerRun,
  serverEmbedder,
  type EmbedOptions,
} from './embedding/embed-for-server-run';
export {
  VOYAGE_EMBEDDING_DIMENSIONS,
  VOYAGE_EMBEDDING_MODEL,
  VoyageEmbeddingError,
  type Embedder,
} from './embedding/voyage-embedder';
export { agentStepWriter, agentStepWriterForCurrentRun } from './agent-writer';
export {
  STAGE_OF_JOB,
  jobRunTarget,
  openRunForJob,
  runRefusalMessage,
  SERVER_GENERATION_OFF_REFUSAL,
  STAGE_IN_PROGRESS_REFUSAL,
  type JobRunParams,
} from './jobs';
