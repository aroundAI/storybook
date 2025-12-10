'use client';

import { useEffect, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { FileText, Film, GraduationCap, Search, Tv, Video } from 'lucide-react';

import type { TemplateCategory } from '@kit/film-studio-schemas';
import type { ProjectTemplate } from '@kit/film-studio/lib';
import {
  createProjectFromTemplateAction,
  getTemplatesAction,
} from '@kit/film-studio/server';
import { Card, CardContent } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { TemplateCard } from './template-card';
import { TemplatePreviewDialog } from './template-preview-dialog';

const CATEGORY_CONFIG = {
  all: { label: 'All', icon: FileText },
  series: { label: 'Series', icon: Tv },
  film: { label: 'Film', icon: Film },
  shorts: { label: 'Shorts', icon: Video },
  documentary: { label: 'Documentary', icon: FileText },
  educational: { label: 'Educational', icon: GraduationCap },
} as const;

interface TemplateLibraryProps {
  accountSlug: string;
  initialCategory?: TemplateCategory;
}

export function TemplateLibrary({
  accountSlug,
  initialCategory,
}: TemplateLibraryProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isCreating, setIsCreating] = useState(false);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(
    initialCategory ?? 'all',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] =
    useState<ProjectTemplate | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // Fetch templates on mount and category change
  useEffect(() => {
    fetchTemplates(selectedCategory);
  }, [selectedCategory]);

  const fetchTemplates = (category: string) => {
    startTransition(async () => {
      try {
        const result = await getTemplatesAction({
          category:
            category === 'all' ? undefined : (category as TemplateCategory),
          includeSystem: true,
          includeCustom: true,
        });
        setTemplates(result.templates);
      } catch {
        toast.error('Failed to load templates');
      }
    });
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    router.push(
      `/home/${accountSlug}/studio/templates${category !== 'all' ? `?category=${category}` : ''}`,
    );
  };

  const handlePreview = (template: ProjectTemplate) => {
    setSelectedTemplate(template);
    setIsPreviewOpen(true);
  };

  const handleUseTemplate = async (template: ProjectTemplate) => {
    setIsCreating(true);
    try {
      const result = await createProjectFromTemplateAction({
        templateId: template.id,
        accountSlug,
        projectName: `${template.name} Project`,
      });

      toast.success('Project created successfully!', {
        description: `Created ${result.assetsCreated.characters} characters and ${result.assetsCreated.locations} locations.`,
      });

      router.push(`/home/${accountSlug}/studio/${result.projectId}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create project',
      );
    } finally {
      setIsCreating(false);
    }
  };

  // Filter templates by search query
  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const systemTemplates = filteredTemplates.filter((t) => t.isSystem);
  const customTemplates = filteredTemplates.filter((t) => !t.isSystem);

  return (
    <div className="space-y-8">
      {/* Search */}
      <div className="relative max-w-md">
        <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          placeholder="Search templates..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Category Tabs */}
      <Tabs value={selectedCategory} onValueChange={handleCategoryChange}>
        <TabsList className="grid w-full grid-cols-6">
          {Object.entries(CATEGORY_CONFIG).map(([key, config]) => {
            const Icon = config.icon;
            return (
              <TabsTrigger key={key} value={key} disabled={isPending}>
                <Icon className="mr-2 h-4 w-4" />
                {config.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={selectedCategory} className="mt-8">
          {/* System Templates */}
          {systemTemplates.length > 0 && (
            <div className="mb-8">
              <h3 className="mb-4 text-lg font-semibold">System Templates</h3>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {systemTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onPreview={() => handlePreview(template)}
                    onUse={() => handleUseTemplate(template)}
                    isCreating={isCreating}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Custom Templates */}
          {customTemplates.length > 0 && (
            <div>
              <h3 className="mb-4 text-lg font-semibold">Custom Templates</h3>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {customTemplates.map((template) => (
                  <TemplateCard
                    key={template.id}
                    template={template}
                    onPreview={() => handlePreview(template)}
                    onUse={() => handleUseTemplate(template)}
                    isCreating={isCreating}
                    showEditActions
                  />
                ))}
              </div>
            </div>
          )}

          {filteredTemplates.length === 0 && !isPending && (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {searchQuery
                    ? 'No templates found matching your search.'
                    : 'No templates found in this category.'}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Preview Dialog */}
      <TemplatePreviewDialog
        template={selectedTemplate}
        open={isPreviewOpen}
        onOpenChange={setIsPreviewOpen}
        accountSlug={accountSlug}
      />
    </div>
  );
}
