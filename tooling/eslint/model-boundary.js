/**
 * The model-import boundary (FILM-1902). A model is reached only through
 * `@kit/ai-gateway`, so every other package is refused an import of the
 * model client package or a model SDK at lint time; `base.js` and `apps.js`
 * both apply it (the latter overrides the rule for `app/**`). The two
 * packages that are the door, `packages/ai-gateway` and `packages/llm`, opt
 * out with `modelGatewayExemption` in their own eslint.config.mjs.
 */
const THROUGH_THE_GATEWAY =
  'A model is reached only through @kit/ai-gateway, from a generation run (FILM-1902). Open a run and call run.write(), or the gateway executors.';

export const TRANS_RESTRICTION = {
  name: 'react-i18next',
  importNames: ['Trans'],
  message: 'Please use `@kit/ui/trans` instead',
};

export const MODEL_IMPORT_RESTRICTIONS = [
  { name: '@kit/llm', message: THROUGH_THE_GATEWAY },
  { name: '@kit/llm/types', message: THROUGH_THE_GATEWAY },
  { name: '@kit/llm/factory', message: THROUGH_THE_GATEWAY },
  { name: '@google/genai', message: THROUGH_THE_GATEWAY },
  { name: 'openai', message: THROUGH_THE_GATEWAY },
  { name: '@anthropic-ai/sdk', message: THROUGH_THE_GATEWAY },
  { name: 'voyageai', message: THROUGH_THE_GATEWAY },
];

export const MODEL_IMPORT_PATTERNS = [
  {
    group: [
      '@kit/llm/*',
      '@google/genai/*',
      'openai/*',
      '@anthropic-ai/sdk/*',
      'voyageai/*',
    ],
    message: THROUGH_THE_GATEWAY,
  },
];

/** The rule as every package gets it. */
export const restrictedImports = (extraPaths = []) => [
  'error',
  {
    paths: [TRANS_RESTRICTION, ...extraPaths, ...MODEL_IMPORT_RESTRICTIONS],
    patterns: MODEL_IMPORT_PATTERNS,
  },
];

/** For packages/ai-gateway and packages/llm only: the door itself. */
export const modelGatewayExemption = {
  rules: {
    'no-restricted-imports': ['error', { paths: [TRANS_RESTRICTION] }],
  },
};
