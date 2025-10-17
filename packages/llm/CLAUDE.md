# LLM Abstraction Layer

This file contains guidance for working with the LLM abstraction layer supporting multiple AI providers (vendor-agnostic).

## Overview

`@kit/llm` provides a unified interface for Large Language Model providers, enabling zero-code provider switching via environment variables. All providers implement the same `LLMClient` interface with consistent behavior for chat completions, streaming, cost tracking, and error handling.

## Provider Comparison

**Supported providers** (switch via `LLM_PROVIDER` environment variable):

| Provider | Cost (1M tokens) | Best Models | Best For | API Key Required |
|----------|------------------|-------------|----------|------------------|
| **Local** ⭐ | $0 (free) | claude-sonnet-4-5, claude-opus-4 | Development, testing, offline | ❌ No |
| **OpenAI** | $0.15-$60 | gpt-4o, gpt-4o-mini | Production, function calling | ✅ Yes |
| **Anthropic** | $0.25-$75 | claude-3-5-sonnet, claude-3-opus | Long context, complex reasoning | ✅ Yes |
| **Gemini** | $0.0375-$5 | gemini-1.5-flash, gemini-1.5-pro | Cost-effective, multimodal | ✅ Yes |

**Pricing** (per 1M tokens - prompt/completion):
- **Local**: $0/$0 (free)
- **GPT-4o-mini**: $0.15/$0.60
- **GPT-4o**: $2.50/$10.00
- **Claude 3.5 Sonnet**: $3.00/$15.00
- **Claude 3 Haiku**: $0.25/$1.25
- **Gemini 1.5 Flash**: $0.075/$0.30
- **Gemini 1.5 Flash 8B**: $0.0375/$0.15

**Recommended**: **Local** for development → **GPT-4o-mini** or **Gemini Flash** for production (cost-effective) → **Claude 3.5 Sonnet** or **GPT-4o** for complex tasks.

## Configuration

### Local Provider (Recommended for Development)

```bash
# OpenAI-compatible local API (e.g., Claude Code API)
LLM_PROVIDER=local
LLM_MODEL=claude-sonnet-4-5              # optional, this is default
LOCAL_API_URL=http://127.0.0.1:8000/v1   # optional, this is default

# No API key required!
```

**Available Local Models:**
- `claude-sonnet-4-5` (default) - Latest Claude Sonnet 4.5
- `claude-sonnet-4` - Claude Sonnet 4
- `claude-opus-4` - Claude Opus 4 (most capable)
- `claude-haiku-4` - Claude Haiku 4 (fastest)

**Requirements:**
- Local API server running at configured URL
- Default: `http://127.0.0.1:8000/v1`
- Compatible with OpenAI API format

### OpenAI Provider

```bash
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini                    # or gpt-4o, gpt-4-turbo, gpt-3.5-turbo
OPENAI_API_KEY=sk-...                    # or LLM_API_KEY

# Optional parameters
LLM_TEMPERATURE=0.7                      # 0.0 to 2.0
LLM_MAX_TOKENS=1024
LLM_TOP_P=1.0
```

**Available Models:**
- `gpt-4o` - Latest flagship model
- `gpt-4o-mini` - Cost-effective (default)
- `gpt-4-turbo` - High performance
- `gpt-3.5-turbo` - Fast and cheap

### Anthropic Provider

```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-3-5-sonnet-20241022     # or claude-3-opus, claude-3-haiku
ANTHROPIC_API_KEY=sk-ant-...             # or LLM_API_KEY

# Optional parameters
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=1024
LLM_TOP_P=1.0
```

**Available Models:**
- `claude-3-5-sonnet-20241022` - Latest Sonnet (default)
- `claude-3-opus-20240229` - Most capable
- `claude-3-sonnet-20240229` - Balanced
- `claude-3-haiku-20240307` - Fastest

### Gemini Provider

```bash
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-flash               # or gemini-1.5-pro, gemini-1.5-flash-8b
GOOGLE_API_KEY=AI...                     # or LLM_API_KEY

# Optional parameters
LLM_TEMPERATURE=0.7
LLM_MAX_TOKENS=1024
LLM_TOP_P=1.0
```

**Available Models:**
- `gemini-1.5-flash` - Fast and cost-effective (default)
- `gemini-1.5-flash-8b` - Ultra-efficient
- `gemini-1.5-pro` - Most capable
- `gemini-1.0-pro` - Legacy

**Zero code changes** to switch providers - handled by `@kit/llm` factory pattern.

## Basic Usage

### Simple Chat Completion

```typescript
import { createLLMClient } from '@kit/llm';

async function basicExample() {
  // Uses environment variables (LLM_PROVIDER, LLM_MODEL, etc.)
  const llm = createLLMClient();

  const response = await llm.createChatCompletion({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is TypeScript?' }
    ]
  });

  console.log('Response:', response.message.content);
  console.log('Provider:', response.provider);
  console.log('Model:', response.model);
  console.log('Tokens:', response.usage.totalTokens);
  console.log('Cost: $', response.cost?.total.toFixed(4));
}
```

### With Custom Parameters

```typescript
const response = await llm.createChatCompletion({
  messages: [
    { role: 'user', content: 'Explain React in one sentence.' }
  ],
  temperature: 0.2,      // Lower = more focused
  maxTokens: 100,        // Limit response length
  topP: 0.9             // Nucleus sampling
});
```

### Error Handling

```typescript
import { createLLMClient, LLMError } from '@kit/llm';

async function withErrorHandling() {
  try {
    const llm = createLLMClient();
    const response = await llm.createChatCompletion({
      messages: [{ role: 'user', content: 'Hello!' }]
    });
    return response.message.content;
  } catch (error) {
    if (error instanceof LLMError) {
      console.error(`${error.provider} error:`, error.message);
      console.error('Error code:', error.code);
      console.error('Status:', error.statusCode);
    } else {
      console.error('Unknown error:', error);
    }
    throw error;
  }
}
```

## API Request/Response Format Mapping

Understanding how the unified TypeScript interface maps to actual provider API requests.

### The Unified Interface

```typescript
// This is what you write (same for all providers)
const response = await llm.createChatCompletion({
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7,
  maxTokens: 100,
  topP: 0.9
});
```

### OpenAI Format

**Your TypeScript:**
```typescript
await llm.createChatCompletion({
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7,
  maxTokens: 100
});
```

**Maps to OpenAI API:**
```http
POST https://api.openai.com/v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-...

{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "system", "content": "You are helpful." },
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 100,
  "top_p": 0.9
}
```

**Response Format:**
```json
{
  "id": "chatcmpl-123",
  "object": "chat.completion",
  "created": 1677652288,
  "model": "gpt-4o-mini",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Hello! How can I help you today?"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 9,
    "total_tokens": 19
  }
}
```

### Anthropic Format

**Your TypeScript:**
```typescript
await llm.createChatCompletion({
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7,
  maxTokens: 100
});
```

**Maps to Anthropic API:**
```http
POST https://api.anthropic.com/v1/messages
Content-Type: application/json
x-api-key: sk-ant-...
anthropic-version: 2023-06-01

{
  "model": "claude-3-5-sonnet-20241022",
  "system": "You are helpful.",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "temperature": 0.7,
  "max_tokens": 100,
  "top_p": 0.9
}
```

**Note:** Anthropic handles system messages separately from conversation messages.

**Response Format:**
```json
{
  "id": "msg_123",
  "type": "message",
  "role": "assistant",
  "content": [{
    "type": "text",
    "text": "Hello! How can I assist you today?"
  }],
  "model": "claude-3-5-sonnet-20241022",
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 10,
    "output_tokens": 9
  }
}
```

### Gemini Format

**Your TypeScript:**
```typescript
await llm.createChatCompletion({
  messages: [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello!' }
  ],
  temperature: 0.7,
  maxTokens: 100
});
```

**Maps to Gemini API:**
```http
POST https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent
Content-Type: application/json

{
  "systemInstruction": {
    "parts": [{ "text": "You are helpful." }]
  },
  "contents": [{
    "role": "user",
    "parts": [{ "text": "Hello!" }]
  }],
  "generationConfig": {
    "temperature": 0.7,
    "maxOutputTokens": 100,
    "topP": 0.9
  }
}
```

**Note:** Gemini uses different structure for system instructions and chat history.

### Local Provider Format ⭐

**Your TypeScript:**
```typescript
import { createLLMClient } from '@kit/llm';

// Using environment variables (LLM_PROVIDER=local)
const llm = createLLMClient();

const response = await llm.createChatCompletion({
  messages: [
    {
      role: 'system',
      name: 'format-guard',
      content: 'Return ONLY a JSON array with exactly 5 objects. No prose. No markdown. No code fences. No leading or trailing characters. Start with \'[\' and end with \']\'. Each object MUST have exactly these string fields: "frontend", "backend", "frontend_benefits", "backend_benefits".'
    },
    {
      role: 'user',
      content: 'Produce 5 examples of Python+React FE/BE stacks as a JSON array of objects with keys: frontend, backend, frontend_benefits, backend_benefits. Do not include markdown or backticks. Output only the JSON array.'
    }
  ],
  temperature: 0.2,
  maxTokens: 600,
  topP: 1
});
```

**Maps to Local API Request:**
```http
POST http://127.0.0.1:8000/v1/chat/completions
Content-Type: application/json

{
  "model": "claude-sonnet-4-5",
  "messages": [
    {
      "role": "system",
      "name": "format-guard",
      "content": "Return ONLY a JSON array with exactly 5 objects. No prose. No markdown. No code fences. No leading or trailing characters. Start with '[' and end with ']'. Each object MUST have exactly these string fields: \"frontend\", \"backend\", \"frontend_benefits\", \"backend_benefits\"."
    },
    {
      "role": "user",
      "content": "Produce 5 examples of Python+React FE/BE stacks as a JSON array of objects with keys: frontend, backend, frontend_benefits, backend_benefits. Do not include markdown or backticks. Output only the JSON array."
    }
  ],
  "temperature": 0.2,
  "top_p": 1,
  "n": 1,
  "stream": false,
  "max_tokens": 600
}
```

**Note:** Local provider uses OpenAI-compatible format. The `name` field in messages is preserved for custom message identification (like `format-guard` in the example).

**Response Format (OpenAI-compatible):**
```json
{
  "id": "chatcmpl-a57c54994bba44aa9e391aeb",
  "object": "chat.completion",
  "created": 1760698365,
  "model": "claude-sonnet-4-5",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "[{\"frontend\":\"React 18\",\"backend\":\"FastAPI\",\"frontend_benefits\":\"Modern hooks, concurrent features\",\"backend_benefits\":\"High performance, automatic docs\"}...]"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 120,
    "completion_tokens": 450,
    "total_tokens": 570
  }
}
```

**Unified Response (What you get back):**
```typescript
{
  id: 'chatcmpl-a57c54994bba44aa9e391aeb',
  provider: 'local',
  model: 'claude-sonnet-4-5',
  message: {
    role: 'assistant',
    content: '[{"frontend":"React 18","backend":"FastAPI",...}]'
  },
  usage: {
    promptTokens: 120,
    completionTokens: 450,
    totalTokens: 570
  },
  cost: {
    prompt: 0,
    completion: 0,
    total: 0
  },
  finishReason: 'stop'
}
```

## Advanced Usage

### Streaming Responses

```typescript
async function streamingExample() {
  const llm = createLLMClient();

  console.log('Streaming response:');

  for await (const chunk of llm.createStreamingChatCompletion({
    messages: [
      { role: 'user', content: 'Count from 1 to 5' }
    ]
  })) {
    if (!chunk.done) {
      process.stdout.write(chunk.delta);
    } else {
      console.log('\n\nStream complete!');
    }
  }
}
```

### Manual Provider Configuration

```typescript
import { createLLMClient } from '@kit/llm';

// Override environment variables
const llm = createLLMClient({
  provider: 'local',
  model: 'claude-opus-4',
  apiKey: '', // not needed for local
  baseUrl: 'http://192.168.1.100:8000/v1', // custom URL
  temperature: 0.5,
  maxTokens: 2000
});
```

### Multiple Providers in Same App

```typescript
// Use different providers for different tasks
const fastLLM = createLLMClient({
  provider: 'gemini',
  model: 'gemini-1.5-flash-8b',
  apiKey: process.env.GOOGLE_API_KEY!
});

const smartLLM = createLLMClient({
  provider: 'anthropic',
  model: 'claude-3-opus-20240229',
  apiKey: process.env.ANTHROPIC_API_KEY!
});

// Fast responses for simple queries
const quickResponse = await fastLLM.createChatCompletion({...});

// Smart responses for complex tasks
const detailedResponse = await smartLLM.createChatCompletion({...});
```

### Direct Provider Instantiation

```typescript
import { OpenAIClient, AnthropicClient, LocalClient } from '@kit/llm';

// Direct instantiation (bypasses factory singleton)
const openai = new OpenAIClient({
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!
});

const local = new LocalClient({
  provider: 'local',
  model: 'claude-sonnet-4-5',
  apiKey: 'not-needed',
  baseUrl: 'http://127.0.0.1:8000/v1'
});
```

## Cost Tracking

### Accessing Cost Information

```typescript
const response = await llm.createChatCompletion({
  messages: [{ role: 'user', content: 'Hello!' }]
});

// Cost breakdown (in USD)
console.log('Prompt cost:', response.cost?.prompt);
console.log('Completion cost:', response.cost?.completion);
console.log('Total cost:', response.cost?.total);

// Token usage
console.log('Prompt tokens:', response.usage.promptTokens);
console.log('Completion tokens:', response.usage.completionTokens);
console.log('Total tokens:', response.usage.totalTokens);
```

### Manual Cost Calculation

```typescript
import { getModelPricing, calculateTokenCost } from '@kit/llm';

// Get pricing for a specific model
const pricing = getModelPricing('openai', 'gpt-4o');
console.log('Pricing:', pricing); // { prompt: 2.5, completion: 10 }

// Calculate cost manually
const cost = calculateTokenCost(1000, 500, pricing);
console.log('Cost for 1000 prompt + 500 completion tokens:', cost);
// { prompt: 0.0025, completion: 0.005, total: 0.0075 }
```

### Cost Optimization Tips

1. **Use cheaper models for simple tasks:**
   ```typescript
   // Simple: Use Gemini Flash ($0.0375/$0.15 per 1M tokens)
   // Complex: Use Claude 3.5 Sonnet ($3/$15 per 1M tokens)
   ```

2. **Limit max tokens:**
   ```typescript
   const response = await llm.createChatCompletion({
     messages: [...],
     maxTokens: 100  // Prevent excessive completion costs
   });
   ```

3. **Use local provider for development:**
   ```typescript
   // $0 cost for unlimited testing
   const llm = createLLMClient({ provider: 'local', ... });
   ```

## Provider-Specific Notes

### OpenAI

**Strengths:**
- Excellent function calling support
- Fast response times
- Wide model selection

**Function Calling Example:**
```typescript
const response = await llm.createChatCompletion({
  messages: [{ role: 'user', content: 'What\'s the weather in NYC?' }],
  functions: [{
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string' }
      }
    }
  }]
});
```

### Anthropic

**Strengths:**
- Excellent for long context (200K tokens)
- Strong reasoning capabilities
- Very safe and aligned

**System Message Handling:**
- System messages are extracted and sent separately
- Conversation only includes user/assistant messages

### Gemini

**Strengths:**
- Most cost-effective
- Fast response times
- Multimodal support (images, audio)

**Chat History Format:**
- Last message is sent separately
- Previous messages form history
- System instructions are separate

### Local Provider ⭐

**Strengths:**
- Zero cost ($0 for all operations)
- Zero latency (local server)
- Works offline
- Perfect for development and testing

**Requirements:**
- Local API server must be running
- Default URL: `http://127.0.0.1:8000/v1`
- OpenAI-compatible API format

**Connection Errors:**
```typescript
try {
  const response = await llm.createChatCompletion({...});
} catch (error) {
  if (error instanceof LLMError && error.code === 'CONNECTION_REFUSED') {
    console.error('Local API not running at', process.env.LOCAL_API_URL);
    console.error('Start the local API server and try again');
  }
}
```

**Custom Base URL:**
```bash
# Use different local server
LOCAL_API_URL=http://192.168.1.100:8000/v1
```

## Error Handling

### LLMError Class

```typescript
import { LLMError } from '@kit/llm';

try {
  const response = await llm.createChatCompletion({...});
} catch (error) {
  if (error instanceof LLMError) {
    console.error('Provider:', error.provider);     // 'openai', 'anthropic', etc.
    console.error('Error code:', error.code);       // 'INVALID_API_KEY', etc.
    console.error('Status code:', error.statusCode); // 401, 429, etc.
    console.error('Message:', error.message);
  }
}
```

### Common Error Codes

**All Providers:**
- `MISSING_API_KEY` - API key not configured
- `INVALID_API_KEY` - Invalid API key
- `UNKNOWN_ERROR` - Unexpected error

**OpenAI:**
- `NO_CHOICES` - No completion returned
- `NO_USAGE` - No usage information

**Anthropic:**
- `NO_CONTENT` - No text content in response
- `API_ERROR` - Anthropic API error

**Gemini:**
- `NO_MESSAGES` - No messages to send
- `QUOTA_EXCEEDED` - API quota exceeded

**Local:**
- `CONNECTION_REFUSED` - Cannot connect to local server
- `INVALID_PROVIDER` - Wrong provider configuration

### Rate Limiting

```typescript
async function withRetry() {
  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await llm.createChatCompletion({...});
    } catch (error) {
      if (error instanceof LLMError && error.statusCode === 429) {
        console.log(`Rate limited, retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        lastError = error;
      } else {
        throw error;
      }
    }
  }
  throw lastError;
}
```

## Best Practices

### 1. Use Environment Variables for Configuration

```typescript
// ✅ Good - Easy to switch providers
const llm = createLLMClient(); // Uses env vars

// ❌ Avoid - Hard-coded configuration
const llm = createLLMClient({
  provider: 'openai',
  apiKey: 'sk-hardcoded-key'
});
```

### 2. Handle Errors Gracefully

```typescript
// ✅ Good - Proper error handling
try {
  const response = await llm.createChatCompletion({...});
  return response.message.content;
} catch (error) {
  logger.error('LLM error:', error);
  return 'Sorry, I encountered an error.';
}
```

### 3. Use Local Provider for Development

```bash
# .env.development
LLM_PROVIDER=local

# .env.production
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

### 4. Limit Token Usage

```typescript
// ✅ Good - Set reasonable limits
const response = await llm.createChatCompletion({
  messages: [...],
  maxTokens: 500  // Prevent runaway costs
});
```

### 5. Monitor Costs

```typescript
// Track costs for monitoring
const response = await llm.createChatCompletion({...});

await analytics.track('llm_request', {
  provider: response.provider,
  model: response.model,
  tokens: response.usage.totalTokens,
  cost: response.cost?.total
});
```

### 6. Use Appropriate Models

```typescript
// Simple classification → Use cheap model
const fastLLM = createLLMClient({
  provider: 'gemini',
  model: 'gemini-1.5-flash-8b'
});

// Complex reasoning → Use smart model
const smartLLM = createLLMClient({
  provider: 'anthropic',
  model: 'claude-3-opus-20240229'
});
```

### 7. Streaming for Long Responses

```typescript
// ✅ Good - Stream for better UX
for await (const chunk of llm.createStreamingChatCompletion({...})) {
  if (!chunk.done) {
    sendToClient(chunk.delta);
  }
}

// ❌ Avoid - Waiting for complete response
const response = await llm.createChatCompletion({...});
sendToClient(response.message.content); // Long wait time
```

## Troubleshooting

### Local Provider Connection Issues

**Problem:** `CONNECTION_REFUSED` error

**Solution:**
1. Check if local API is running: `curl http://127.0.0.1:8000/health`
2. Verify the URL: `echo $LOCAL_API_URL`
3. Check firewall settings
4. Try explicit base URL in code

### API Key Issues

**Problem:** `INVALID_API_KEY` or `MISSING_API_KEY`

**Solution:**
1. Check environment variables: `echo $OPENAI_API_KEY`
2. Verify API key is valid (check provider dashboard)
3. Ensure correct provider-specific env var name

### High Costs

**Problem:** Unexpectedly high API costs

**Solution:**
1. Use `maxTokens` to limit response length
2. Switch to cheaper models for simple tasks
3. Use local provider for development/testing
4. Monitor costs: `console.log(response.cost?.total)`

### Rate Limiting

**Problem:** 429 errors (too many requests)

**Solution:**
1. Implement exponential backoff
2. Use request queuing
3. Upgrade API tier
4. Switch to local provider for development
