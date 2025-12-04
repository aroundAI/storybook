# Prompt Engine

JSON file-based prompt engine for LLM template management. All prompt configuration is stored in version-controlled JSON files.

## Overview

This package provides a simple, file-based approach to managing LLM prompts:
- **No database required** - Prompts are JSON files in `packages/features/*/src/prompts/`
- **Self-contained** - Each JSON file contains LLM config, system prompts, user prompt, variables, and output schema
- **Type-safe** - Zod schema validation for both prompt files and LLM responses
- **Analytics** - Automatic usage tracking via `@kit/llm` analytics

## Quick Start

```typescript
import { executeLLM } from '@kit/prompt-engine/server';

// Execute a prompt template
const result = await executeLLM<{ summary: string }>({
  templateSlug: 'summarize-content',
  variables: {
    content: 'Long article text here...',
    max_length: 100,
  },
  context: {
    name: 'summarize-article',
    accountId: 'account-uuid',
    userId: 'user-uuid', // optional
  },
});

console.log(result.data.summary);
console.log(`Tokens used: ${result.metadata.tokens}`);
console.log(`Cost: $${result.metadata.cost}`);
```

## JSON Prompt File Structure

Place prompt files in: `packages/features/<your-package>/src/prompts/<category>/<slug>.json`

```json
{
  "slug": "summarize-content",
  "name": "Content Summarizer",
  "version": 1,
  "category": "summarization",
  "description": "Summarizes long content into a concise summary",
  "exported_at": "2025-01-01T00:00:00.000Z",

  "llm": {
    "provider": "openai",
    "model": "gpt-4o-mini",
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
      "content": "You are an expert content summarizer. Create concise, accurate summaries.",
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
      "description": "Maximum word count for summary"
    }
  },

  "output": {
    "type": "object",
    "schema": {
      "type": "zod",
      "definition": "z.object({ summary: z.string() })"
    },
    "schema_for_llm": "Return JSON: { \"summary\": \"your summary here\" }",
    "example_output": {
      "summary": "This is an example summary..."
    }
  }
}
```

## File Location Discovery

The engine automatically discovers prompts in:
1. `packages/features/*/src/prompts/` - Recursively searches all feature packages
2. `$PROMPTS_DIR` environment variable - Custom directory (highest priority)

```typescript
// These all find the same file:
executeLLM({ templateSlug: 'summarize-content', ... });
// Searches: packages/features/*/src/prompts/**/summarize-content.json

executeLLM({ templateSlug: 'summarization/summarize-content', ... });
// Searches: packages/features/*/src/prompts/summarization/summarize-content.json
```

## API Reference

### `executeLLM<T>(config)`

Main execution function. All configuration comes from the prompt JSON file.

```typescript
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
  validateSchema?: boolean;                // Enable/disable Zod validation (default: true)
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
```

### `loadAndRenderPrompt(slug, variables)`

Load and render a template without executing LLM call. Useful for debugging.

```typescript
import { loadAndRenderPrompt } from '@kit/prompt-engine/server';

const rendered = await loadAndRenderPrompt('summarize-content', {
  content: 'Article text...',
  max_length: 100,
});

console.log(rendered.systemPrompt);  // Composed system prompts
console.log(rendered.userPrompt);    // Variables interpolated
console.log(rendered.llmConfig);     // Provider, model, etc.
```

### Validation Functions

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

## Output Configuration

### Simple Object Response

```json
{
  "output": {
    "type": "object",
    "schema": {
      "type": "zod",
      "definition": "z.object({ summary: z.string(), keywords: z.array(z.string()) })"
    }
  }
}
```

### Array Response

```json
{
  "output": {
    "type": "array",
    "schema": {
      "type": "zod",
      "definition": "z.array(z.object({ id: z.string(), name: z.string() }))"
    }
  }
}
```

### Wrapped Array (Array in Object)

```json
{
  "output": {
    "type": "object",
    "wrapper_key": "items",
    "schema": {
      "type": "zod",
      "definition": "z.object({ items: z.array(z.object({ id: z.string() })) })"
    }
  }
}
```

When `wrapper_key` is set, `executeLLM` returns the array directly:

```typescript
const result = await executeLLM<Item[]>({
  templateSlug: 'list-items',
  ...
});
// result.data is Item[], not { items: Item[] }
```

## LLM Provider Configuration

Set environment variables based on your `llm.provider` in the JSON:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Gemini
GOOGLE_API_KEY=AI...
# or
GEMINI_API_KEY=AI...

# DeepSeek
DEEPSEEK_API_KEY=sk-...

# Local (no key needed)
LOCAL_API_URL=http://127.0.0.1:8000/v1
```

## Analytics

All executions are automatically logged to `llm_usage_analytics` table:
- Account and user attribution
- Token usage and cost tracking
- Latency metrics
- Success/failure status
- Request/response metadata

Query analytics:

```sql
SELECT
  template_slug,
  COUNT(*) as executions,
  SUM(total_cost) as total_cost,
  AVG(latency_ms) as avg_latency
FROM llm_usage_analytics
WHERE account_id = 'your-account-id'
GROUP BY template_slug;
```

## Best Practices

1. **Use descriptive slugs**: `analyze-customer-feedback` not `prompt-1`
2. **Version prompts**: Increment `version` when making changes
3. **Add schema_for_llm**: Helps LLM understand expected output format
4. **Include example_output**: Documents expected response and validates schema
5. **Set appropriate max_tokens**: Prevents runaway costs
6. **Use low temperature** (0.1-0.3): For consistent JSON output
