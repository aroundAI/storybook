---
id: FILM-1103
title: LLM-Based Canon Extraction
status: done
priority: critical
effort: M
dependencies: [FILM-1005, FILM-1101]
---

# FILM-1103: LLM-Based Canon Extraction

## Overview

Replace the current regex-based `extractCanonChangesAction` with an LLM-based extraction that can intelligently identify immutable events, character state changes, and narrative thread updates from generated story content.

## Problem Statement

Current `extractCanonChangesAction` (lines 885-962 in `canon-actions.ts`):
- Uses simple regex patterns like `/(\\w+) (?:died|was killed)/gi`
- Generates episode summary by taking first 50 words
- Sentiment scoring uses word counting
- Cannot detect nuanced character development or plot threads
- Results in low-quality canon extraction

## Solution

Create a new LLM prompt template `canon-extraction.json` and update the action to use `executeLLM` instead of regex patterns.

---

## Files to Create

| File | Purpose |
|------|---------|
| `packages/features/prompt-engine/src/prompts/canon-roles/canon-extraction.json` | LLM prompt for extracting canon from story text |

## Files to Modify

| File | Change |
|------|--------|
| `packages/features/episodes/src/server/canon-actions.ts` | Replace regex with LLM call |
| `apps/web/lambda/llm-worker/prompt-registry.ts` | Register canon-extraction prompt |

---

## Implementation

### Step 1: Create Canon Extraction Prompt

```json
{
  "slug": "canon-extraction",
  "name": "Canon Extraction from Story",
  "version": "1.0",
  "description": "Extracts immutable events, character state changes, and narrative thread updates from generated story content",
  
  "variables": {
    "story_content": {
      "type": "string",
      "required": true
    },
    "characters": {
      "type": "string",
      "required": false,
      "default": ""
    },
    "existing_threads": {
      "type": "string",
      "required": false,
      "default": ""
    },
    "episode_number": {
      "type": "number",
      "required": true
    },
    "season": {
      "type": "number",
      "required": true
    }
  },
  
  "llm": {
    "provider": "google",
    "model": "gemini-2.0-flash",
    "max_tokens": 2000,
    "temperature": 0.1,
    "response_format": "json_object"
  },
  
  "system_prompt": "You are a narrative analyst extracting canon facts from story content. Analyze the story carefully and identify:\n\n1. IMMUTABLE EVENTS - Permanent facts that cannot be undone:\n   - Character deaths\n   - World rules established\n   - Permanent relationship changes (marriage, blood relations)\n   - Location destructions\n   - Ability losses\n\n2. CHARACTER STATE CHANGES - How characters evolved:\n   - Emotional state shifts (with trigger, cost, constraints)\n   - Physical changes\n   - Knowledge gained\n   - Relationship status changes\n\n3. NARRATIVE THREAD UPDATES - Plot thread progress:\n   - New threads opened (promises made)\n   - Existing threads progressed\n   - Threads resolved (payoffs delivered)\n\n4. EPISODE SUMMARY - A 2-3 sentence summary focusing on:\n   - Key plot advancement\n   - Main character moments\n   - Cliffhangers or setups for next episode\n\nBe conservative with immutable events - only mark things as 'death' if explicitly stated. Use 'high' confidence only when the text is explicit.",
  
  "user_prompt": "Analyze this story content from Season {{season}}, Episode {{episode_number}}:\n\n---\n{{{story_content}}}\n---\n\n{{#if characters}}\nKnown characters: {{{characters}}}\n{{/if}}\n\n{{#if existing_threads}}\nExisting narrative threads: {{{existing_threads}}}\n{{/if}}\n\nExtract all canon changes. Return as JSON.",
  
  "output": {
    "type": "object",
    "wrapper_key": "extraction",
    "schema_for_llm": "{\n  \"immutableEvents\": [{\n    \"type\": \"death|world_fact|relationship|timeline|ability_loss|location_destruction\",\n    \"eventKey\": \"entity:id:state format\",\n    \"description\": \"human readable\",\n    \"confidence\": \"high|medium|low\"\n  }],\n  \"characterStateChanges\": [{\n    \"characterName\": \"string\",\n    \"stateType\": \"emotional|physical|relationship|knowledge|ability|location|goal\",\n    \"previousState\": \"string or null\",\n    \"newState\": \"string\",\n    \"trigger\": \"what caused this\",\n    \"cost\": \"what was sacrificed\",\n    \"constraints\": [\"what this prevents\"]\n  }],\n  \"threadUpdates\": [{\n    \"threadName\": \"string\",\n    \"action\": \"open|progress|resolve\",\n    \"description\": \"what happened\",\n    \"promises\": [\"for open threads\"],\n    \"payoffs\": [\"for resolved threads\"]\n  }],\n  \"episodeSummary\": \"2-3 sentence summary\",\n  \"sentimentScore\": 0.0-1.0,\n  \"keyEvents\": [\"list of major plot points\"]\n}"
  }
}
```

### Step 2: Update extractCanonChangesAction

```typescript
export const extractCanonChangesAction = enhanceAction(
    async (data: {
        projectId: string;
        episodeId: string;
        storyContent: string;
        season?: number;
        episodeNumber?: number;
    }): Promise<CanonExtractionResult> => {
        const client = getSupabaseServerClient();
        
        // Fetch episode info if not provided
        let season = data.season;
        let episodeNumber = data.episodeNumber;
        
        if (!season || !episodeNumber) {
            const { data: episode } = await client
                .from('episodes')
                .select('number, seasons(number)')
                .eq('id', data.episodeId)
                .single();
            
            season = episode?.seasons?.number ?? 1;
            episodeNumber = episode?.number ?? 1;
        }
        
        // Fetch characters for context
        const { data: characters } = await client
            .from('assets')
            .select('id, name')
            .eq('project_id', data.projectId)
            .eq('type', 'character');
        
        const characterList = characters?.map(c => c.name).join(', ') ?? '';
        
        // Fetch existing threads
        const { data: threads } = await client
            .from('narrative_threads')
            .select('thread_name, status')
            .eq('project_id', data.projectId)
            .in('status', ['open', 'progressed']);
        
        const threadList = threads?.map(t => `${t.thread_name} (${t.status})`).join(', ') ?? '';
        
        // Use LLM for intelligent extraction
        const { executeLLM } = await import('@kit/prompt-engine/server');
        
        const result = await executeLLM<{
            extraction: {
                immutableEvents: ExtractedCanonChange[];
                characterStateChanges: Array<{
                    characterName: string;
                    stateType: string;
                    previousState: string | null;
                    newState: string;
                    trigger: string;
                    cost: string;
                    constraints: string[];
                }>;
                threadUpdates: ExtractedThreadUpdate[];
                episodeSummary: string;
                sentimentScore: number;
                keyEvents: string[];
            };
        }>({
            templateSlug: 'canon-extraction',
            variables: {
                story_content: data.storyContent,
                characters: characterList,
                existing_threads: threadList,
                episode_number: episodeNumber,
                season: season,
            },
            context: {
                name: 'canon-extraction',
                projectId: data.projectId,
            },
            supabaseClient: client,
        });
        
        const extraction = result.data.extraction;
        
        return {
            immutableEvents: extraction.immutableEvents,
            threadUpdates: extraction.threadUpdates,
            stateChanges: extraction.characterStateChanges.map(change => ({
                characterName: change.characterName,
                stateType: change.stateType as StateType,
                newState: change.newState,
                trigger: change.trigger,
                cost: change.cost,
                constraints: change.constraints,
            })),
            episodeSummary: extraction.episodeSummary,
            sentimentScore: extraction.sentimentScore,
            keyEvents: extraction.keyEvents,
        };
    },
    {
        schema: z.object({
            projectId: z.string().uuid(),
            episodeId: z.string().uuid(),
            storyContent: z.string(),
            season: z.number().optional(),
            episodeNumber: z.number().optional(),
        }),
    }
);
```

### Step 3: Register Prompt in Lambda

```typescript
// In prompt-registry.ts
import canonExtraction from '../../../../packages/features/prompt-engine/src/prompts/canon-roles/canon-extraction.json';

// In PROMPT_REGISTRY
'canon-extraction': canonExtraction as PromptTemplate,
'canon-roles/canon-extraction': canonExtraction as PromptTemplate,
```

---

## Acceptance Criteria

- [x] `canon-extraction.json` prompt template created and valid
- [x] Prompt registered in Lambda worker
- [x] `extractCanonChangesAction` uses LLM instead of regex
- [x] Extraction correctly identifies character deaths
- [x] Extraction correctly identifies character emotional changes
- [x] Extraction correctly identifies plot thread openings/resolutions
- [x] Episode summary is coherent 2-3 sentences
- [x] Sentiment score is reasonable (0.0-1.0)
- [x] Cost per extraction is logged

---

## Testing

### Unit Test

```typescript
describe('LLM Canon Extraction', () => {
  const storyWithDeath = `
    The battle raged until dawn. John, surrounded by enemies, 
    fought bravely but fell to a fatal blow. Sarah watched in horror 
    as her brother died in her arms. "I'll avenge you," she whispered.
  `;
  
  it('should detect character death', async () => {
    const result = await extractCanonChangesAction({
      projectId: 'test-project',
      episodeId: 'test-episode',
      storyContent: storyWithDeath,
      season: 1,
      episodeNumber: 5,
    });
    
    const deathEvent = result.immutableEvents.find(
      e => e.type === 'death' && e.description.includes('John')
    );
    expect(deathEvent).toBeDefined();
    expect(deathEvent?.confidence).toBe('high');
  });
  
  it('should detect emotional state change', async () => {
    const result = await extractCanonChangesAction({
      projectId: 'test-project',
      episodeId: 'test-episode',
      storyContent: storyWithDeath,
      season: 1,
      episodeNumber: 5,
    });
    
    const stateChange = result.stateChanges.find(
      s => s.characterName === 'Sarah' && s.stateType === 'emotional'
    );
    expect(stateChange).toBeDefined();
    expect(stateChange?.newState).toContain('grief');
  });
});
```

### Manual Test

1. Generate story with clear character death
2. Click "Reanalyze" on Publish page
3. Verify extraction shows death as immutable event
4. Verify summary is coherent, not first 50 words

---

## Estimated Effort

| Task | Time |
|------|------|
| Create prompt template | 45 min |
| Update extractCanonChangesAction | 1 hour |
| Register in Lambda | 15 min |
| Testing | 1.5 hours |
| **Total** | **~3.5 hours** |

---

## Dependencies

- **FILM-1005**: Canon actions exist (✅ Complete)
- **FILM-1101**: Prompt registration working

## Blocks

- None (independent extraction improvement)

---

## Implementation Status

**Implemented** in PR #175 — merged 2026-02-09
