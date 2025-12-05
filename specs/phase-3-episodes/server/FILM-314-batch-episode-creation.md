# FILM-314: Batch Episode Creation

## Metadata
- **Phase:** 3 - Episodes
- **Priority:** P1 (Post-MVP Enhancement)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-301 (Episode CRUD), FILM-305 (Story Generation)
- **Blocks:** None

---

## Context

Series projects often require creating multiple episodes at once. Batch episode creation allows creators to plan an entire season by generating multiple episode outlines simultaneously, ensuring narrative consistency and proper story arc development across the series.

---

## Specification

### Requirements

1. **Batch Creation**: Create multiple episode entries at once
2. **Season Planning**: Define overall season arc that influences individual episodes
3. **Episode Outlines**: Auto-generate premise/outline for each episode
4. **Arc Distribution**: Distribute character arcs across episodes
5. **Consistency Check**: Ensure episode connections and continuity
6. **Bulk Edit**: Edit multiple episode details in a grid view

### Batch Episode Creator Component

```typescript
// packages/features/episodes/src/components/batch-episode-creator.tsx

'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { Slider } from '@kit/ui/slider';
import { Badge } from '@kit/ui/badge';
import { Alert, AlertDescription } from '@kit/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@kit/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@kit/ui/table';
import { Plus, Wand2, Edit2, Trash2, ArrowUp, ArrowDown, Sparkles } from 'lucide-react';
import { batchCreateEpisodesAction, generateSeasonOutlineAction } from '../server/batch-episode-actions';

interface BatchEpisodeCreatorProps {
  projectId: string;
  seasonId: string;
  existingEpisodeCount: number;
}

interface EpisodeOutline {
  number: number;
  title: string;
  premise: string;
  mainPlot: string;
  characterFocus?: string[];
  arcPosition?: string; // 'setup', 'rising', 'midpoint', 'climax', 'resolution'
}

export function BatchEpisodeCreator({
  projectId,
  seasonId,
  existingEpisodeCount,
}: BatchEpisodeCreatorProps) {
  const [episodeCount, setEpisodeCount] = useState(10);
  const [seasonPremise, setSeasonPremise] = useState('');
  const [generatedOutlines, setGeneratedOutlines] = useState<EpisodeOutline[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const queryClient = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: generateSeasonOutlineAction,
    onSuccess: (data) => {
      setGeneratedOutlines(data.episodes);
      setShowEditor(true);
    },
  });

  const createMutation = useMutation({
    mutationFn: batchCreateEpisodesAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['episodes', seasonId] });
      setShowEditor(false);
      setGeneratedOutlines([]);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Multiple Episodes</CardTitle>
        <CardDescription>
          Plan your entire season with AI-generated episode outlines
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Episode Count */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Number of Episodes</label>
            <Badge variant="outline">{episodeCount} episodes</Badge>
          </div>
          <Slider
            value={[episodeCount]}
            onValueChange={([value]) => setEpisodeCount(value)}
            min={2}
            max={24}
            step={1}
          />
          <p className="text-xs text-muted-foreground">
            Starting from Episode {existingEpisodeCount + 1}
          </p>
        </div>

        {/* Season Premise */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Season Premise / Arc</label>
          <Textarea
            placeholder="Describe the overall story arc for this season. What's the main conflict? How should it develop across episodes?"
            value={seasonPremise}
            onChange={(e) => setSeasonPremise(e.target.value)}
            rows={4}
          />
        </div>

        {/* Story Structure Info */}
        <Alert>
          <Sparkles className="h-4 w-4" />
          <AlertDescription>
            Episodes will follow a classic story structure:
            <ul className="list-disc list-inside mt-2 text-xs">
              <li><strong>Setup (1-2)</strong>: Introduce world, characters, conflict</li>
              <li><strong>Rising Action (3-5)</strong>: Escalate stakes and complications</li>
              <li><strong>Midpoint (6)</strong>: Major revelation or turning point</li>
              <li><strong>Climax Build (7-9)</strong>: Push toward confrontation</li>
              <li><strong>Resolution (10)</strong>: Climax and aftermath</li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Generate Button */}
        <Button
          className="w-full"
          onClick={() =>
            generateMutation.mutate({
              projectId,
              seasonId,
              episodeCount,
              seasonPremise,
              startingNumber: existingEpisodeCount + 1,
            })
          }
          disabled={!seasonPremise || generateMutation.isPending}
        >
          <Wand2 className="h-4 w-4 mr-2" />
          {generateMutation.isPending ? 'Generating Outlines...' : 'Generate Episode Outlines'}
        </Button>

        {/* Episode Editor Dialog */}
        <Dialog open={showEditor} onOpenChange={setShowEditor}>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Review Episode Outlines</DialogTitle>
            </DialogHeader>

            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead className="w-48">Title</TableHead>
                    <TableHead>Premise</TableHead>
                    <TableHead className="w-24">Arc</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {generatedOutlines.map((episode, index) => (
                    <EpisodeOutlineRow
                      key={index}
                      episode={episode}
                      onUpdate={(updated) => {
                        const newOutlines = [...generatedOutlines];
                        newOutlines[index] = updated;
                        setGeneratedOutlines(newOutlines);
                      }}
                      onMoveUp={() => {
                        if (index > 0) {
                          const newOutlines = [...generatedOutlines];
                          [newOutlines[index - 1], newOutlines[index]] = [newOutlines[index], newOutlines[index - 1]];
                          setGeneratedOutlines(newOutlines);
                        }
                      }}
                      onMoveDown={() => {
                        if (index < generatedOutlines.length - 1) {
                          const newOutlines = [...generatedOutlines];
                          [newOutlines[index], newOutlines[index + 1]] = [newOutlines[index + 1], newOutlines[index]];
                          setGeneratedOutlines(newOutlines);
                        }
                      }}
                      onDelete={() => {
                        setGeneratedOutlines(generatedOutlines.filter((_, i) => i !== index));
                      }}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>

            <DialogFooter className="border-t pt-4">
              <Button variant="outline" onClick={() => setShowEditor(false)}>
                Cancel
              </Button>
              <Button
                onClick={() =>
                  createMutation.mutate({
                    seasonId,
                    episodes: generatedOutlines,
                  })
                }
                disabled={createMutation.isPending || generatedOutlines.length === 0}
              >
                {createMutation.isPending
                  ? 'Creating Episodes...'
                  : `Create ${generatedOutlines.length} Episodes`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function EpisodeOutlineRow({ episode, onUpdate, onMoveUp, onMoveDown, onDelete }) {
  const [editing, setEditing] = useState(false);

  const arcColors = {
    setup: 'bg-blue-100 text-blue-700',
    rising: 'bg-amber-100 text-amber-700',
    midpoint: 'bg-purple-100 text-purple-700',
    climax: 'bg-red-100 text-red-700',
    resolution: 'bg-green-100 text-green-700',
  };

  return (
    <TableRow>
      <TableCell className="font-medium">{episode.number}</TableCell>
      <TableCell>
        {editing ? (
          <Input
            value={episode.title}
            onChange={(e) => onUpdate({ ...episode, title: e.target.value })}
            onBlur={() => setEditing(false)}
            autoFocus
          />
        ) : (
          <span className="cursor-pointer hover:underline" onClick={() => setEditing(true)}>
            {episode.title}
          </span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {episode.premise}
      </TableCell>
      <TableCell>
        <Badge className={arcColors[episode.arcPosition] || 'bg-gray-100'}>
          {episode.arcPosition}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onMoveUp}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onMoveDown}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
```

### Server Actions

```typescript
// packages/features/episodes/src/server/batch-episode-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';
import { createLLMClient } from '@kit/llm';

export const generateSeasonOutlineAction = enhanceAction(
  async ({ projectId, seasonId, episodeCount, seasonPremise, startingNumber }, user) => {
    const client = getSupabaseServerClient();

    // Get project context (characters, locations)
    const { data: project } = await client
      .from('projects')
      .select('*, assets(*)')
      .eq('id', projectId)
      .single();

    const characters = project.assets.filter((a) => a.type === 'character');
    const locations = project.assets.filter((a) => a.type === 'location');

    // Use LLM to generate episode outlines
    const llmClient = createLLMClient();
    const response = await llmClient.chat.completions.create({
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'system',
          content: `You are a TV series showrunner. Create ${episodeCount} episode outlines that form a cohesive season arc.

            Follow this structure:
            - Episodes 1-2: Setup (introduce characters, world, initial conflict)
            - Episodes 3-5: Rising action (escalate stakes, introduce complications)
            - Episode 6 (or middle): Midpoint (major revelation or turning point)
            - Episodes 7-${episodeCount - 1}: Build to climax (everything comes together)
            - Episode ${episodeCount}: Resolution (climax and aftermath)

            Return a JSON array with this structure:
            [{
              "number": 1,
              "title": "Episode Title",
              "premise": "One-line premise",
              "mainPlot": "2-3 sentence plot summary",
              "characterFocus": ["character names featured"],
              "arcPosition": "setup|rising|midpoint|climax|resolution"
            }]`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            seasonPremise,
            episodeCount,
            startingNumber,
            characters: characters.map((c) => ({ name: c.name, description: c.description })),
            locations: locations.map((l) => ({ name: l.name, description: l.description })),
          }),
        },
      ],
    });

    const episodes = JSON.parse(response.choices[0].message.content);
    return { episodes };
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      seasonId: z.string().uuid(),
      episodeCount: z.number().min(2).max(24),
      seasonPremise: z.string().min(10),
      startingNumber: z.number().min(1),
    }),
    auth: true,
  }
);

export const batchCreateEpisodesAction = enhanceAction(
  async ({ seasonId, episodes }, user) => {
    const client = getSupabaseServerClient();

    // Get season to find project
    const { data: season } = await client
      .from('seasons')
      .select('project_id')
      .eq('id', seasonId)
      .single();

    // Create all episodes
    const episodesToInsert = episodes.map((ep, index) => ({
      project_id: season.project_id,
      season_id: seasonId,
      number: ep.number,
      title: ep.title,
      description: ep.premise,
      status: 'draft',
      story_data: {
        premise: ep.premise,
        mainPlot: ep.mainPlot,
        characterFocus: ep.characterFocus,
        arcPosition: ep.arcPosition,
        generatedFromBatch: true,
      },
    }));

    const { data: createdEpisodes } = await client
      .from('episodes')
      .insert(episodesToInsert)
      .select();

    return { episodes: createdEpisodes, count: createdEpisodes.length };
  },
  {
    schema: z.object({
      seasonId: z.string().uuid(),
      episodes: z.array(
        z.object({
          number: z.number(),
          title: z.string(),
          premise: z.string(),
          mainPlot: z.string().optional(),
          characterFocus: z.array(z.string()).optional(),
          arcPosition: z.string().optional(),
        })
      ),
    }),
    auth: true,
  }
);

export const regenerateEpisodeOutlineAction = enhanceAction(
  async ({ episodeId, context }, user) => {
    const client = getSupabaseServerClient();

    // Get episode with season context
    const { data: episode } = await client
      .from('episodes')
      .select(`
        *,
        seasons (
          *,
          episodes (*)
        ),
        projects (assets (*))
      `)
      .eq('id', episodeId)
      .single();

    // Use LLM to regenerate with context
    const llmClient = createLLMClient();
    const response = await llmClient.chat.completions.create({
      model: 'claude-3-5-sonnet-20241022',
      messages: [
        {
          role: 'system',
          content: `Regenerate this episode outline considering the surrounding episodes and overall season arc.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            currentEpisode: episode,
            seasonEpisodes: episode.seasons.episodes,
            additionalContext: context,
          }),
        },
      ],
    });

    const newOutline = JSON.parse(response.choices[0].message.content);

    // Update episode
    await client
      .from('episodes')
      .update({
        title: newOutline.title,
        description: newOutline.premise,
        story_data: {
          ...episode.story_data,
          ...newOutline,
          regeneratedAt: new Date().toISOString(),
        },
      })
      .eq('id', episodeId);

    return { episode: newOutline };
  },
  {
    schema: z.object({
      episodeId: z.string().uuid(),
      context: z.string().optional(),
    }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/episodes/src/components/batch-episode-creator.tsx` |
| CREATE | `packages/features/episodes/src/server/batch-episode-actions.ts` |
| MODIFY | `packages/features/episodes/src/components/episode-list.tsx` |

---

## Acceptance Criteria

- [ ] Create 2-24 episodes in one batch
- [ ] Season premise guides episode generation
- [ ] Episodes follow classic story structure (setup → rising → climax → resolution)
- [ ] Character focus distributed across episodes
- [ ] Preview/edit outlines before creating
- [ ] Reorder episodes in preview
- [ ] Delete unwanted outlines before creation
- [ ] Regenerate individual episode outline with context

---

## Test Plan

### Unit Tests
- [ ] Test episode count validation (2-24)
- [ ] Test arc position assignment logic
- [ ] Test episode numbering sequence

### Integration Tests
- [ ] Test full batch creation workflow
- [ ] Test regenerate with season context
- [ ] Test episode ordering persistence

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| LLM generation failed | Show error, allow retry |
| Invalid episode count | Clamp to valid range |
| Duplicate episode numbers | Auto-adjust numbering |
