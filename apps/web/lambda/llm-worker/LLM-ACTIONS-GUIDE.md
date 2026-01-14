# Adding New LLM Actions

This guide explains how to add new long-running LLM operations that bypass CloudFront's 30-second timeout using SQS background processing.

## Architecture Overview

```
┌────────────┐    ┌─────────┐    ┌──────────────┐    ┌───────────┐
│ Server     │───▶│  SQS    │───▶│ Lambda       │───▶│ WebSocket │
│ Action     │    │  Queue  │    │ Worker       │    │ to User   │
└────────────┘    └─────────┘    └──────────────┘    └───────────┘
     │                                  │
     │ Production: Queue job            │ Fetch data, run LLM, update DB
     │ Local dev: Run synchronously     │
```

## Step-by-Step: Adding a New LLM Action

### Step 1: Define the Job Type

Add your job type to the Lambda worker's switch statement:

```typescript
// apps/web/lambda/llm-worker/index.ts
switch (job.jobType) {
  // ... existing cases
  case 'my-new-action': {
    const { processMyNewAction } = await import('./handlers/my-new-action');
    return processMyNewAction(job.payload, supabase);
  }
}
```

### Step 2: Create the Handler

Create `apps/web/lambda/llm-worker/handlers/my-new-action.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

interface MyNewActionPayload {
  episodeId: string;
  accountId: string;
  userId: string;
  // ... other fields
}

interface MyNewActionResult {
  success: boolean;
  data: {
    // ... your result fields
  };
}

export async function processMyNewAction(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<MyNewActionResult> {
  const data = payload as MyNewActionPayload;

  console.log(`[My New Action] Processing for ${data.episodeId}`);

  // 1. FETCH DATA from database
  const { data: episode, error } = await supabase
    .from('episodes')
    .select('id, title, story_data')
    .eq('id', data.episodeId)
    .single();

  if (error) throw new Error(`Failed to fetch: ${error.message}`);

  // 2. BUILD CONTEXT for the LLM
  const variables = {
    title: episode.title,
    content: episode.story_data,
  };

  // 3. EXECUTE LLM
  const { executeLLM } = await import('@kit/prompt-engine/server');

  const result = await executeLLM<{ output: string }>({
    templateSlug: 'my-template',
    variables,
    context: {
      name: 'my-new-action',
      accountId: data.accountId,
      userId: data.userId,
    },
  });

  // 4. UPDATE DATABASE (if needed)
  await supabase
    .from('episodes')
    .update({ my_field: result.data.output })
    .eq('id', data.episodeId);

  // 5. RETURN RESULT (sent via WebSocket)
  return {
    success: true,
    data: { output: result.data.output },
  };
}
```

### Step 3: Modify the Server Action

Update your server action to queue in production:

```typescript
// packages/features/my-feature/src/server/my-actions.ts
export const myNewAction = enhanceAction(
  async (data): Promise<MyResult | { success: true; queued: true }> => {
    const client = getSupabaseServerClient();
    const { data: user } = await requireUser(client);
    
    // Validation and pre-processing here...
    
    // Check environment
    const { isLambdaEnvironment, queueLlmJob } = await import(
      '@kit/prompt-engine/server'
    );

    if (isLambdaEnvironment()) {
      // PRODUCTION: Queue for background processing
      await queueLlmJob({
        jobType: 'my-new-action',  // Must match switch case
        userId: user.id,
        payload: {
          episodeId: data.episodeId,
          accountId,
          userId: user.id,
          // Include ALL data handler needs
        },
      });

      return { success: true, queued: true };
    }

    // LOCAL DEV: Run synchronously (full logic here)
    // ... your existing sync implementation
  },
  { schema: MyNewActionSchema }
);
```

### Step 4: Update Frontend

Handle the async response in your UI:

```tsx
const handleAction = async () => {
  const result = await myNewAction({ episodeId });
  
  if ('queued' in result && result.queued) {
    toast.info('Processing in background...');
    // WebSocket will deliver result via useLlmJob hook
  } else {
    // Synchronous result (local dev)
    toast.success('Done!');
    setData(result.data);
  }
};
```

## Handler Patterns by Complexity

### Pattern A: Read-Only (No DB Writes)
Examples: `analytics-insights`, `language-insights`, `story-ideation`

```typescript
// Just fetch → LLM → return
const data = await supabase.from('...').select();
const result = await executeLLM(...);
return { success: true, data: result.data };
```

### Pattern B: Single Update
Examples: `story-generation`, `screenplay-conversion`

```typescript
// Fetch → LLM → Update single table → return
const episode = await supabase.from('episodes').select().single();
const result = await executeLLM(...);
await supabase.from('episodes').update({ ... });
return { success: true, data: ... };
```

### Pattern C: Multiple Operations
Examples: `shot-generation`, `translate-dialogue`

```typescript
// Fetch → LLM → Insert new rows → Update parent → return
const episodes = await supabase.from('episodes').select();
const result = await executeLLM(...);
await supabase.from('shots').insert([...]); // Insert many
await supabase.from('episodes').update({ ... }); // Update parent
return { success: true, data: ... };
```

## Important Notes

1. **Payload Size**: Keep queue payloads minimal. Pass IDs, not full objects.

2. **Error Handling**: Errors in handlers are caught by the main Lambda and:
   - Sent to user via WebSocket as `llm-error`
   - Added to DLQ after 3 failures

3. **Timeouts**: Lambda has 15-minute timeout. For longer operations, consider chunking.

4. **Local Development**: Server actions run synchronously when `AWS_LAMBDA_FUNCTION_NAME` is not set.

5. **Audit Logs**: Currently handlers don't create audit logs (would need user session context).

## File Locations

| Type | Location |
|------|----------|
| Lambda Worker | `apps/web/lambda/llm-worker/index.ts` |
| Handlers | `apps/web/lambda/llm-worker/handlers/` |
| SQS Helper | `packages/features/prompt-engine/src/lib/server/sqs-helper.ts` |
| WebSocket Hook | `packages/ui/src/hooks/use-llm-job.ts` |
| SST Config | `sst.config.ts` (LlmJobsQueue, llmWorker) |
