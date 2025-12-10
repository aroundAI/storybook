# FILM-111: Project Templates

## Metadata
- **Phase:** 1 - Foundation
- **Priority:** P1 (Post-MVP Enhancement)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-110 (Project Extension), FILM-104 (Film Studio Package)
- **Blocks:** None
- **Status:** COMPLETED
- **PR:** #58

---

## Context

Project templates provide pre-configured starting points for different content types (drama series, comedy shorts, documentary, etc.). Templates include pre-defined settings, sample characters, locations, and story structures to help creators get started quickly and learn best practices.

---

## Specification

### Requirements

1. **Template Library**: Curated templates for different genres/formats
2. **Template Preview**: Preview template contents before using
3. **Template Application**: Create new project from template
4. **Custom Templates**: Save existing project as custom template
5. **Template Sharing**: Share templates within organization (team accounts)
6. **Template Categories**: Organize templates by genre, format, duration

### Database Schema

```sql
-- Project templates table
CREATE TABLE project_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID, -- NULL for system templates
  name VARCHAR(255) NOT NULL,
  description TEXT,
  thumbnail_url TEXT,
  category VARCHAR(50) NOT NULL, -- 'series', 'film', 'shorts', 'documentary', 'educational'
  genre VARCHAR(50), -- 'drama', 'comedy', 'action', 'horror', 'scifi', etc.
  target_duration_minutes INTEGER,
  is_system BOOLEAN DEFAULT FALSE, -- System-provided templates
  is_public BOOLEAN DEFAULT FALSE, -- Shared with organization
  template_data JSONB NOT NULL, -- Full project configuration
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_templates_account ON project_templates(account_id) WHERE account_id IS NOT NULL;
CREATE INDEX idx_templates_category ON project_templates(category, genre);
CREATE INDEX idx_templates_system ON project_templates(is_system) WHERE is_system = TRUE;

-- Template data structure:
-- {
--   "projectSettings": { ... },
--   "sampleCharacters": [ ... ],
--   "sampleLocations": [ ... ],
--   "storyStructure": { ... },
--   "styleGuide": { ... },
--   "sampleEpisodes": [ ... ]
-- }
```

### Template Data Schema

```typescript
// packages/features/film-studio/src/lib/template-types.ts

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  thumbnailUrl?: string;
  category: 'series' | 'film' | 'shorts' | 'documentary' | 'educational';
  genre?: string;
  targetDurationMinutes?: number;
  isSystem: boolean;
  isPublic: boolean;
  templateData: TemplateData;
  usageCount: number;
}

export interface TemplateData {
  projectSettings: {
    projectType: 'series' | 'film' | 'shorts';
    targetPlatforms: string[];
    videoStyle: {
      aspectRatio: '16:9' | '9:16' | '1:1';
      defaultDuration: number;
      quality: 'standard' | 'pro';
    };
    defaultVoiceProvider: string;
    defaultVideoProvider: string;
  };
  sampleCharacters?: Array<{
    name: string;
    description: string;
    physicalAttributes?: Record<string, string>;
    personality?: string;
    role: 'protagonist' | 'antagonist' | 'supporting' | 'minor';
  }>;
  sampleLocations?: Array<{
    name: string;
    description: string;
    visualStyle?: string;
  }>;
  storyStructure?: {
    acts: number;
    episodeCount?: number;
    episodeDuration?: number;
    plotPoints: Array<{
      name: string;
      description: string;
      position: number; // 0-100 percentage through story
    }>;
  };
  styleGuide?: {
    tone: string;
    colorPalette?: string[];
    visualReferences?: string[];
    audioStyle?: string;
  };
  sampleEpisodes?: Array<{
    title: string;
    description: string;
    premiseTemplate: string;
  }>;
}
```

### Template Library Component

```typescript
// packages/features/film-studio/src/components/template-library.tsx

'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Input } from '@kit/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@kit/ui/dialog';
import {
  Film,
  Tv,
  Video,
  FileText,
  GraduationCap,
  Search,
  Plus,
  Eye,
  Users,
  MapPin,
} from 'lucide-react';
import { getTemplatesAction, createProjectFromTemplateAction } from '../server/template-actions';
import { ProjectTemplate } from '../lib/template-types';

const CATEGORY_ICONS = {
  series: Tv,
  film: Film,
  shorts: Video,
  documentary: FileText,
  educational: GraduationCap,
};

interface TemplateLibraryProps {
  accountSlug: string;
  onCreateProject: (projectId: string) => void;
}

export function TemplateLibrary({ accountSlug, onCreateProject }: TemplateLibraryProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [previewTemplate, setPreviewTemplate] = useState<ProjectTemplate | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['project-templates', selectedCategory],
    queryFn: () => getTemplatesAction({ category: selectedCategory === 'all' ? undefined : selectedCategory }),
  });

  const createMutation = useMutation({
    mutationFn: createProjectFromTemplateAction,
    onSuccess: (data) => {
      onCreateProject(data.projectId);
    },
  });

  const filteredTemplates = templates?.filter((t) =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Project Templates</h2>
          <p className="text-muted-foreground">
            Start with a template or create from scratch
          </p>
        </div>
        <Button variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Blank Project
        </Button>
      </div>

      {/* Search and Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs value={selectedCategory} onValueChange={setSelectedCategory}>
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="series">Series</TabsTrigger>
            <TabsTrigger value="shorts">Shorts</TabsTrigger>
            <TabsTrigger value="film">Film</TabsTrigger>
            <TabsTrigger value="documentary">Documentary</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates?.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            onPreview={() => setPreviewTemplate(template)}
            onUse={() =>
              createMutation.mutate({
                templateId: template.id,
                accountSlug,
              })
            }
            isCreating={createMutation.isPending}
          />
        ))}
      </div>

      {/* Preview Dialog */}
      <TemplatePreviewDialog
        template={previewTemplate}
        open={!!previewTemplate}
        onOpenChange={(open) => !open && setPreviewTemplate(null)}
        onUse={() =>
          previewTemplate &&
          createMutation.mutate({
            templateId: previewTemplate.id,
            accountSlug,
          })
        }
        isCreating={createMutation.isPending}
      />
    </div>
  );
}

function TemplateCard({ template, onPreview, onUse, isCreating }) {
  const CategoryIcon = CATEGORY_ICONS[template.category] || Film;

  return (
    <Card className="overflow-hidden hover:border-primary/50 transition-colors">
      {template.thumbnailUrl ? (
        <img
          src={template.thumbnailUrl}
          alt={template.name}
          className="w-full h-40 object-cover"
        />
      ) : (
        <div className="w-full h-40 bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
          <CategoryIcon className="h-12 w-12 text-primary/50" />
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-lg">{template.name}</CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className="text-xs">
                {template.category}
              </Badge>
              {template.genre && (
                <Badge variant="secondary" className="text-xs">
                  {template.genre}
                </Badge>
              )}
            </div>
          </div>
          {template.isSystem && (
            <Badge className="bg-primary/10 text-primary">Official</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground line-clamp-2">
          {template.description}
        </p>

        {/* Template Contents Preview */}
        <div className="flex gap-4 text-xs text-muted-foreground">
          {template.templateData.sampleCharacters && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {template.templateData.sampleCharacters.length} characters
            </span>
          )}
          {template.templateData.sampleLocations && (
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {template.templateData.sampleLocations.length} locations
            </span>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onPreview}>
            <Eye className="h-4 w-4 mr-1" />
            Preview
          </Button>
          <Button size="sm" onClick={onUse} disabled={isCreating}>
            Use Template
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TemplatePreviewDialog({ template, open, onOpenChange, onUse, isCreating }) {
  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Settings Preview */}
          <div>
            <h4 className="font-medium mb-2">Project Settings</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Type:</span>{' '}
                {template.templateData.projectSettings.projectType}
              </div>
              <div>
                <span className="text-muted-foreground">Aspect Ratio:</span>{' '}
                {template.templateData.projectSettings.videoStyle.aspectRatio}
              </div>
              <div>
                <span className="text-muted-foreground">Platforms:</span>{' '}
                {template.templateData.projectSettings.targetPlatforms.join(', ')}
              </div>
              <div>
                <span className="text-muted-foreground">Quality:</span>{' '}
                {template.templateData.projectSettings.videoStyle.quality}
              </div>
            </div>
          </div>

          {/* Characters Preview */}
          {template.templateData.sampleCharacters && (
            <div>
              <h4 className="font-medium mb-2">Sample Characters</h4>
              <div className="space-y-2">
                {template.templateData.sampleCharacters.slice(0, 3).map((char, i) => (
                  <div key={i} className="p-2 rounded bg-muted/50">
                    <div className="font-medium text-sm">{char.name}</div>
                    <div className="text-xs text-muted-foreground">{char.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Story Structure Preview */}
          {template.templateData.storyStructure && (
            <div>
              <h4 className="font-medium mb-2">Story Structure</h4>
              <div className="text-sm">
                <span className="text-muted-foreground">Acts:</span>{' '}
                {template.templateData.storyStructure.acts}
                {template.templateData.storyStructure.episodeCount && (
                  <>
                    <span className="mx-2">•</span>
                    <span className="text-muted-foreground">Episodes:</span>{' '}
                    {template.templateData.storyStructure.episodeCount}
                  </>
                )}
              </div>
            </div>
          )}

          <Button className="w-full" onClick={onUse} disabled={isCreating}>
            {isCreating ? 'Creating Project...' : 'Use This Template'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Server Actions

```typescript
// packages/features/film-studio/src/server/template-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

export const getTemplatesAction = enhanceAction(
  async ({ category, includeCustom = true }, user) => {
    const client = getSupabaseServerClient();

    let query = client
      .from('project_templates')
      .select('*')
      .order('usage_count', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    // Include system templates + user's custom templates
    query = query.or(`is_system.eq.true,account_id.eq.${user?.accountId || 'null'}`);

    const { data, error } = await query;
    if (error) throw error;
    return data;
  },
  {
    schema: z.object({
      category: z.string().optional(),
      includeCustom: z.boolean().optional(),
    }),
    auth: false, // Allow browsing without auth
  }
);

export const createProjectFromTemplateAction = enhanceAction(
  async ({ templateId, accountSlug, customName }, user) => {
    const client = getSupabaseServerClient();

    // Get template
    const { data: template } = await client
      .from('project_templates')
      .select('*')
      .eq('id', templateId)
      .single();

    if (!template) {
      throw new Error('Template not found');
    }

    // Get account ID from slug
    const { data: account } = await client
      .from('accounts')
      .select('id')
      .eq('slug', accountSlug)
      .single();

    // Create project with template settings
    const { data: project } = await client
      .from('projects')
      .insert({
        account_id: account.id,
        name: customName || `${template.name} Project`,
        settings: template.template_data.projectSettings,
      })
      .select()
      .single();

    // Create sample characters
    if (template.template_data.sampleCharacters) {
      for (const char of template.template_data.sampleCharacters) {
        const { data: asset } = await client
          .from('assets')
          .insert({
            project_id: project.id,
            type: 'character',
            name: char.name,
            description: char.description,
          })
          .select()
          .single();

        await client.from('character_details').insert({
          asset_id: asset.id,
          physical_attributes: char.physicalAttributes,
          personality: char.personality,
        });
      }
    }

    // Create sample locations
    if (template.template_data.sampleLocations) {
      for (const loc of template.template_data.sampleLocations) {
        await client.from('assets').insert({
          project_id: project.id,
          type: 'location',
          name: loc.name,
          description: loc.description,
        });
      }
    }

    // Increment usage count
    await client
      .from('project_templates')
      .update({ usage_count: template.usage_count + 1 })
      .eq('id', templateId);

    return { projectId: project.id };
  },
  {
    schema: z.object({
      templateId: z.string().uuid(),
      accountSlug: z.string(),
      customName: z.string().optional(),
    }),
    auth: true,
  }
);

export const saveAsTemplateAction = enhanceAction(
  async ({ projectId, name, description, isPublic }, user) => {
    const client = getSupabaseServerClient();

    // Get project with all assets
    const { data: project } = await client
      .from('projects')
      .select(`
        *,
        assets (*),
        character_details (*)
      `)
      .eq('id', projectId)
      .single();

    // Build template data
    const templateData = {
      projectSettings: project.settings,
      sampleCharacters: project.assets
        .filter((a) => a.type === 'character')
        .map((a) => ({
          name: a.name,
          description: a.description,
          physicalAttributes: a.character_details?.physical_attributes,
          personality: a.character_details?.personality,
        })),
      sampleLocations: project.assets
        .filter((a) => a.type === 'location')
        .map((a) => ({
          name: a.name,
          description: a.description,
        })),
    };

    // Create template
    const { data: template } = await client
      .from('project_templates')
      .insert({
        account_id: user.accountId,
        name,
        description,
        category: project.settings?.projectType || 'series',
        is_public: isPublic,
        template_data: templateData,
      })
      .select()
      .single();

    return { templateId: template.id };
  },
  {
    schema: z.object({
      projectId: z.string().uuid(),
      name: z.string().min(1).max(255),
      description: z.string().optional(),
      isPublic: z.boolean().optional(),
    }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/src/lib/template-types.ts` |
| CREATE | `packages/features/film-studio/src/components/template-library.tsx` |
| CREATE | `packages/features/film-studio/src/server/template-actions.ts` |
| MODIFY | `apps/web/supabase/schemas/30-film-studio.sql` |
| CREATE | `apps/web/app/home/[account]/studio/templates/page.tsx` |

---

## Acceptance Criteria

- [x] Template library displays system and custom templates
- [x] Templates filterable by category (series, film, shorts, etc.)
- [x] Template preview shows settings, characters, locations
- [x] Creating project from template copies all configuration
- [x] Sample characters and locations created from template
- [x] Save existing project as custom template
- [x] Share templates within organization (is_public flag)
- [x] Usage count tracked per template

---

## Test Plan

### Unit Tests
- [ ] Test template data structure validation
- [ ] Test category filtering logic
- [ ] Test template data extraction from project

### Integration Tests
- [ ] Test project creation from template
- [ ] Test custom template saving
- [ ] Test usage count increment

---

## Seed Data

System templates created:

1. **YouTube Series Starter** - 16:9 format, optimized for YouTube with hook-first structure
2. **Cinematic Short Film** - 21:9 cinematic format with 3-act structure
3. **TikTok Viral Shorts** - 9:16 vertical format, fast-paced hook structure
4. **Documentary Project** - Interview setup with B-roll organization
5. **Educational Course** - Structured for learning objectives and knowledge retention

---

## Implementation Notes

### Files Created

| File | Description |
|------|-------------|
| `apps/web/supabase/schemas/31-project-templates.sql` | Database schema with RLS policies |
| `apps/web/supabase/migrations/20251209144544_add-project-templates.sql` | Migration with seed data |
| `packages/features/film-studio-schemas/src/template.ts` | Zod schemas for template validation |
| `packages/features/film-studio/src/lib/types/template.types.ts` | TypeScript types and mapper |
| `packages/features/film-studio/src/server/template-actions.ts` | Server actions for template operations |
| `apps/web/app/home/[account]/studio/templates/page.tsx` | Templates page route |
| `apps/web/app/home/[account]/studio/templates/_components/template-library.tsx` | Main library component |
| `apps/web/app/home/[account]/studio/templates/_components/template-card.tsx` | Template card component |
| `apps/web/app/home/[account]/studio/templates/_components/template-preview-dialog.tsx` | Preview dialog |
| `apps/web/app/home/[account]/studio/templates/_components/template-library-skeleton.tsx` | Loading skeleton |

### Key Implementation Details

- Database table `project_templates` with soft delete support via `deleted_at`
- System templates have `is_system=true` and `account_id=NULL`
- Custom templates belong to accounts and can be shared via `is_public` flag
- RLS policies restrict access: system templates readable by all, custom templates by account members
- Template data stored as JSONB including project settings, sample characters, locations, story structure
- Server actions use type assertions for `project_templates` table (not in generated types until migration runs)
- Usage count incremented atomically when creating project from template
