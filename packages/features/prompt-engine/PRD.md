# Product Requirements Document: JSON File-Based Prompt Engine

## Document Information

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Status** | Implemented |
| **Package** | `@kit/prompt-engine` |
| **Location** | `packages/features/prompt-engine/` |
| **Created** | 2025-12-04 |

---

## 1. Executive Summary

### 1.1 Overview

The **Prompt Engine** is a JSON file-based system for managing LLM (Large Language Model) prompt templates. It replaces the previous database-driven prompt management system with a simpler, version-controlled approach where all prompt configurations are stored as JSON files in the codebase.

### 1.2 Problem Statement

The previous system (`@kit/prompt-templates`) used a complex 9-table database schema with:
- A/B testing variants
- Account-specific variant assignments
- System prompt composition layers
- Execution logging with attribution scoring
- Admin UI for management

**Issues with the previous approach:**
1. **Over-engineered**: Most applications don't need A/B testing for prompts
2. **Complex migrations**: Database schema changes required careful migration planning
3. **Deployment friction**: Prompt changes required database updates, not just code deploys
4. **Version control gaps**: Prompt history lived in the database, not in git
5. **Testing difficulty**: Required database setup for integration tests

### 1.3 Solution

A file-based prompt system where:
- **Prompts are JSON files** stored in `packages/features/*/src/prompts/`
- **Version controlled** through git with full history
- **Self-contained** - each JSON file includes LLM config, system prompts, variables, and output schema
- **Type-safe** with Zod validation for both prompt structure and LLM responses
- **Analytics-enabled** via automatic usage logging to `llm_usage_analytics` table

---

## 2. Goals and Non-Goals

### 2.1 Goals

| Goal | Description |
|------|-------------|
| **G1: Simplicity** | Single JSON file contains all prompt configuration |
| **G2: Version Control** | All prompts tracked in git with full history |
| **G3: Type Safety** | Zod schemas validate prompt files and LLM responses |
| **G4: Developer Experience** | Easy to create, test, and deploy prompt changes |
| **G5: Analytics** | Track usage, costs, and performance per template |
| **G6: Provider Agnostic** | Support multiple LLM providers (OpenAI, Anthropic, Gemini, Local) |

### 2.2 Non-Goals

| Non-Goal | Rationale |
|----------|-----------|
| **A/B Testing** | Adds complexity; can be added later if needed |
| **Admin UI** | Developers edit JSON files directly |
| **Per-Account Variants** | All users get the same prompt version |
| **Real-time Editing** | Changes require deployment |
| **Prompt Marketplace** | Out of scope for base SaaS kit |

---

## 3. System Architecture

### 3.1 Package Structure

```
packages/features/prompt-engine/
├── package.json              # Package configuration
├── tsconfig.json             # TypeScript configuration
├── vitest.config.ts          # Test configuration
├── CLAUDE.md                 # AI assistant documentation
├── PRD.md                    # This document
├── __tests__/
│   └── validation.test.ts    # Validation tests
└── src/
    └── lib/
        ├── types.ts          # Core type definitions
        ├── server/
        │   ├── index.ts      # Server exports
        │   ├── prompt-loader.ts   # File discovery & loading
        │   └── llm-executor.ts    # LLM execution with retry
        └── validation/
            ├── index.ts      # Validation exports
            └── prompt-template.schema.ts  # Zod schemas
```

### 3.2 Prompt File Location

Prompts are discovered from:
1. **Feature packages**: `packages/features/*/src/prompts/**/*.json`
2. **Custom directory**: `$PROMPTS_DIR` environment variable (optional)

Example locations:
```
packages/features/content/src/prompts/
├── summarization/
│   ├── summarize-article.json
│   └── extract-keywords.json
├── generation/
│   ├── write-blog-post.json
│   └── generate-title.json
└── analysis/
    └── sentiment-analysis.json
```

### 3.3 Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Application Code                             │
│                                                                      │
│   const result = await executeLLM<OutputType>({                     │
│     templateSlug: 'summarize-article',                              │
│     variables: { content: '...', max_length: 100 },                 │
│     context: { name: 'summarize', accountId, userId }               │
│   });                                                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Prompt Loader                                 │
│                                                                      │
│   1. Discover JSON file by slug                                     │
│   2. Parse and validate with Zod schema                             │
│   3. Interpolate variables: {{content}} → actual content            │
│   4. Compose system prompts in order                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        LLM Executor                                  │
│                                                                      │
│   1. Create LLM client (OpenAI/Anthropic/Gemini/Local)             │
│   2. Execute with retry logic (exponential backoff)                 │
│   3. Parse JSON from response                                       │
│   4. Validate output against Zod schema                             │
│   5. Log analytics to database                                      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Analytics Storage                             │
│                                                                      │
│   llm_usage_analytics table:                                        │
│   - account_id, user_id, template_slug                              │
│   - provider, model, tokens, cost                                   │
│   - latency_ms, status, error details                               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. JSON Prompt File Schema

### 4.1 Complete Schema

```json
{
  "slug": "summarize-article",
  "name": "Article Summarizer",
  "version": 1,
  "category": "summarization",
  "description": "Summarizes long articles into concise summaries",
  "exported_at": "2025-01-01T00:00:00.000Z",

  "llm": {
    "provider": "gemini",
    "model": "gemini-2.0-flash-exp",
    "max_tokens": 500,
    "temperature": 0.3,
    "response_format": {
      "type": "json_object"
    }
  },

  "system_prompts": [
    {
      "slug": "role",
      "name": "Summarizer Role",
      "content": "You are an expert content summarizer...",
      "layer_type": "role",
      "scope": "template",
      "order": 1
    },
    {
      "slug": "format",
      "name": "Output Format",
      "content": "Always respond in valid JSON format.",
      "layer_type": "format",
      "scope": "template",
      "order": 2
    }
  ],

  "user_prompt": "Summarize the following content in {{max_length}} words or less:\n\n{{content}}",

  "variables": {
    "content": {
      "type": "text",
      "required": true,
      "description": "The content to summarize"
    },
    "max_length": {
      "type": "number",
      "required": true,
      "description": "Maximum word count"
    }
  },

  "output": {
    "type": "object",
    "wrapper_key": null,
    "schema": {
      "type": "zod",
      "definition": "z.object({ summary: z.string(), keywords: z.array(z.string()) })"
    },
    "schema_for_llm": "Return JSON: { \"summary\": \"...\", \"keywords\": [\"...\"] }",
    "example_output": {
      "summary": "This article discusses...",
      "keywords": ["technology", "innovation"]
    }
  }
}
```

### 4.2 Field Reference

#### Root Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | Yes | Unique identifier (filename without .json) |
| `name` | string | Yes | Human-readable name |
| `version` | number | Yes | Version number for tracking changes |
| `category` | string | Yes | Grouping category |
| `description` | string | Yes | What this prompt does |
| `exported_at` | string | Yes | ISO timestamp of last export |

#### LLM Configuration (`llm`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `provider` | enum | Yes | `openai`, `anthropic`, `gemini`, `local`, `deepseek` |
| `model` | string | Yes | Model identifier (e.g., `gpt-4o-mini`) |
| `max_tokens` | number | Yes | Maximum response tokens |
| `temperature` | number | Yes | Randomness (0.0 - 2.0) |
| `response_format` | object | No | OpenAI JSON mode config |

#### System Prompts (`system_prompts[]`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | Yes | Unique identifier |
| `name` | string | Yes | Human-readable name |
| `content` | string | Yes | The system prompt text |
| `layer_type` | enum | Yes | `role`, `format`, `context`, `constraints` |
| `scope` | enum | Yes | `global`, `category`, `template` |
| `order` | number | Yes | Composition order (lower = first) |

#### Variables (`variables`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | Yes | `text`, `number`, `boolean`, `array`, `object` |
| `required` | boolean | Yes | Whether variable must be provided |
| `description` | string | Yes | What this variable is for |
| `default` | any | No | Default value if not provided |

#### Output (`output`)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | Yes | `object` or `array` |
| `wrapper_key` | string | No | If set, extracts this key from response |
| `schema.type` | enum | Yes | `zod` |
| `schema.definition` | string | Yes | Zod schema as string |
| `schema_for_llm` | string | No | Human-readable schema for LLM |
| `example_output` | any | No | Example valid output |

---

## 5. API Reference

### 5.1 Main Execution Function

```typescript
import { executeLLM } from '@kit/prompt-engine/server';

interface LLMExecutionConfig {
  templateSlug: string;                    // JSON file name (without .json)
  variables: Record<string, unknown>;      // Template variables
  context: {
    name: string;                          // Operation name for analytics
    accountId: string;                     // Account for cost tracking
    userId?: string;                       // Optional user ID
  };
  temperature?: number;                    // Override file's temperature
  maxTokens?: number;                      // Override file's max_tokens
  validateSchema?: boolean;                // Enable/disable validation (default: true)
}

interface LLMExecutionResult<T> {
  data: T;                                 // Validated response data
  metadata: {
    latency: number;                       // Execution time in ms
    tokens: number;                        // Total tokens used
    cost: number | undefined;              // Cost in USD
    provider: string;                      // LLM provider used
    model: string;                         // Model name
  };
}

// Usage
const result = await executeLLM<{ summary: string }>({
  templateSlug: 'summarize-article',
  variables: { content: articleText, max_length: 100 },
  context: { name: 'summarize', accountId: 'acc_123', userId: 'user_456' }
});

console.log(result.data.summary);       // The summary
console.log(result.metadata.tokens);    // Token usage
console.log(result.metadata.cost);      // Cost in USD
```

### 5.2 Template Loading (for debugging)

```typescript
import { loadAndRenderPrompt } from '@kit/prompt-engine/server';

const rendered = await loadAndRenderPrompt('summarize-article', {
  content: 'Article text...',
  max_length: 100,
});

console.log(rendered.systemPrompt);  // Composed system prompts
console.log(rendered.userPrompt);    // Variables interpolated
console.log(rendered.llmConfig);     // Provider, model, etc.
console.log(rendered.output);        // Output schema config
```

### 5.3 Validation Functions

```typescript
import {
  validatePromptTemplate,
  validateVariablePlaceholders,
  validateZodSchemaCompilation,
  validateExampleOutput,
} from '@kit/prompt-engine/validation';

// Validate JSON structure
const template = validatePromptTemplate(jsonData);

// Check all {{variables}} are defined
const errors = validateVariablePlaceholders(template);

// Verify Zod schema compiles
const result = validateZodSchemaCompilation(template.output.schema.definition);

// Validate example matches schema
const exampleResult = validateExampleOutput(template);
```

---

## 6. Analytics System

### 6.1 Database Schema

```sql
CREATE TABLE public.llm_usage_analytics (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  -- Template identification
  template_slug text NOT NULL,
  operation_name text NOT NULL,

  -- LLM details
  llm_provider text NOT NULL,
  llm_model text NOT NULL,

  -- Token usage
  prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  total_tokens integer NOT NULL,

  -- Cost tracking (USD)
  prompt_cost numeric(10, 6),
  completion_cost numeric(10, 6),
  total_cost numeric(10, 6),

  -- Performance
  latency_ms integer NOT NULL,

  -- Status
  status text NOT NULL CHECK (status IN ('success', 'failure')),
  error_code text,
  error_message text,

  -- Additional context
  request_config jsonb,
  response_metadata jsonb,

  executed_at timestamp with time zone DEFAULT now() NOT NULL
);
```

### 6.2 Analytics Queries

```sql
-- Cost per template (last 30 days)
SELECT
  template_slug,
  COUNT(*) as executions,
  SUM(total_tokens) as total_tokens,
  SUM(total_cost) as total_cost,
  AVG(latency_ms) as avg_latency_ms,
  COUNT(*) FILTER (WHERE status = 'failure') as failures
FROM llm_usage_analytics
WHERE executed_at > NOW() - INTERVAL '30 days'
GROUP BY template_slug
ORDER BY total_cost DESC;

-- Cost per account
SELECT
  a.name as account_name,
  COUNT(*) as executions,
  SUM(total_cost) as total_cost
FROM llm_usage_analytics lua
JOIN accounts a ON lua.account_id = a.id
WHERE executed_at > NOW() - INTERVAL '30 days'
GROUP BY a.id, a.name
ORDER BY total_cost DESC;

-- Provider comparison
SELECT
  llm_provider,
  llm_model,
  COUNT(*) as executions,
  AVG(latency_ms) as avg_latency,
  AVG(total_cost / NULLIF(total_tokens, 0) * 1000000) as cost_per_million_tokens
FROM llm_usage_analytics
WHERE executed_at > NOW() - INTERVAL '7 days'
GROUP BY llm_provider, llm_model
ORDER BY executions DESC;
```

---

## 7. Error Handling

### 7.1 Retry Logic

The executor implements exponential backoff for transient network errors:

| Attempt | Delay | Cumulative |
|---------|-------|------------|
| 1 | 2s | 2s |
| 2 | 4s | 6s |
| 3 | 8s | 14s |
| 4 | 16s | 30s |
| 5 | 32s | 62s |

**Retryable errors:**
- `ERR_STREAM_PREMATURE_CLOSE`
- `ERR_SOCKET_TIMEOUT`
- `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`
- `socket hang up`, `fetch failed`

### 7.2 JSON Extraction

The executor handles common LLM response issues:
- Markdown code fences (```json ... ```)
- DeepSeek `<think>` reasoning blocks
- Trailing garbage after valid JSON
- Balanced brace counting for nested objects

### 7.3 Error Logging

All errors are logged with full context:
```typescript
{
  templateSlug: 'summarize-article',
  provider: 'openai',
  model: 'gpt-4o-mini',
  latency: 1234,
  error: 'Invalid JSON in response',
  rawResponse: '...'
}
```

---

## 8. Provider Configuration

### 8.1 Environment Variables

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Google Gemini
GOOGLE_API_KEY=AI...
# or
GEMINI_API_KEY=AI...

# DeepSeek
DEEPSEEK_API_KEY=sk-...

# Local (OpenAI-compatible)
LOCAL_API_URL=http://127.0.0.1:8000/v1
# No API key required
```

### 8.2 Provider Comparison

| Provider | Cost (1M tokens) | Best Models | Latency |
|----------|------------------|-------------|---------|
| **Local** | $0 (free) | claude-sonnet-4-5 | ~50ms |
| **OpenAI** | $0.15-$60 | gpt-4o-mini, gpt-4o | ~500ms |
| **Anthropic** | $0.25-$75 | claude-3-5-sonnet | ~800ms |
| **Gemini** | $0.04-$5 | gemini-1.5-flash | ~400ms |
| **DeepSeek** | $0.14-$2.19 | deepseek-chat | ~600ms |

---

## 9. Migration Guide

### 9.1 From @kit/prompt-templates

**Before (Database):**
```typescript
import { getPromptTemplate, executePrompt } from '@kit/prompt-templates/server';

const template = await getPromptTemplate(client, 'summarize-article');
const result = await executePrompt(client, template, variables);
```

**After (File-based):**
```typescript
import { executeLLM } from '@kit/prompt-engine/server';

const result = await executeLLM<OutputType>({
  templateSlug: 'summarize-article',
  variables,
  context: { name: 'summarize', accountId }
});
```

### 9.2 Converting Database Prompts to JSON

1. Export prompt from database
2. Create JSON file in appropriate location
3. Map fields:
   - `prompt_templates.slug` → `slug`
   - `prompt_templates.name` → `name`
   - `prompt_system_prompts` → `system_prompts[]`
   - `template_variables` → `variables`

---

## 10. Best Practices

### 10.1 Prompt Design

1. **Use descriptive slugs**: `analyze-customer-feedback` not `prompt-1`
2. **Increment version**: When making breaking changes
3. **Add schema_for_llm**: Helps LLM understand expected format
4. **Include example_output**: Documents and validates schema
5. **Set appropriate max_tokens**: Prevents runaway costs

### 10.2 Temperature Guidelines

| Use Case | Temperature | Rationale |
|----------|-------------|-----------|
| JSON extraction | 0.1-0.3 | Consistent, predictable output |
| Summarization | 0.3-0.5 | Balanced accuracy and flow |
| Creative writing | 0.7-1.0 | More varied, creative output |
| Brainstorming | 1.0-1.5 | Maximum creativity |

### 10.3 Cost Optimization

1. **Use local provider for development**: $0 cost
2. **Choose model based on task complexity**:
   - Simple: `gpt-4o-mini`, `gemini-1.5-flash`
   - Complex: `gpt-4o`, `claude-3-5-sonnet`
3. **Set reasonable max_tokens limits**
4. **Monitor analytics for cost anomalies**

---

## 11. Testing

### 11.1 Unit Tests

```bash
pnpm --filter @kit/prompt-engine test
```

### 11.2 Test Coverage

| Component | Tests | Coverage |
|-----------|-------|----------|
| Validation schemas | 9 | 100% |
| Variable validation | 2 | 100% |
| Zod compilation | 2 | 100% |
| Example validation | 3 | 100% |

### 11.3 Integration Testing

```typescript
// Mock the LLM client for integration tests
vi.mock('@kit/llm', () => ({
  createLLMClient: () => ({
    createChatCompletion: vi.fn().mockResolvedValue({
      message: { content: '{"summary": "Test summary"}' },
      usage: { totalTokens: 100 },
      cost: { total: 0.001 }
    })
  })
}));
```

---

## 12. Future Considerations

### 12.1 Potential Enhancements

| Feature | Priority | Complexity |
|---------|----------|------------|
| Prompt versioning UI | Low | Medium |
| A/B testing support | Low | High |
| Prompt caching | Medium | Low |
| Streaming support | Medium | Medium |
| Multi-turn conversations | Low | High |

### 12.2 Not Planned

- Admin UI for prompt editing
- Per-account prompt customization
- Real-time prompt hot-reloading
- Prompt marketplace

---

## 13. Appendix

### 13.1 Related Documents

- `packages/features/prompt-engine/CLAUDE.md` - AI assistant documentation
- `packages/llm/CLAUDE.md` - LLM package documentation
- `DEPLOYMENT.md` - Deployment configuration

### 13.2 Dependencies

```json
{
  "@kit/llm": "workspace:*",
  "@kit/shared": "workspace:*",
  "@kit/supabase": "workspace:*",
  "zod": "^3.25.74"
}
```

### 13.3 Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2025-12-04 | Initial implementation replacing @kit/prompt-templates |
