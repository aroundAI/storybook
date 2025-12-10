'use client';

import { useEffect, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import type { SampleCharacter, SampleLocation } from '@kit/film-studio-schemas';
import type { ProjectTemplate } from '@kit/film-studio/lib';
import { createProjectFromTemplateAction } from '@kit/film-studio/server';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Separator } from '@kit/ui/separator';
import { toast } from '@kit/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { CreateFromTemplateSchema } from '../_lib/schemas/template.schema';

interface TemplatePreviewDialogProps {
  template: ProjectTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountSlug: string;
}

export function TemplatePreviewDialog({
  template,
  open,
  onOpenChange,
  accountSlug,
}: TemplatePreviewDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(CreateFromTemplateSchema),
    defaultValues: {
      projectName: '',
      projectDescription: '',
    },
  });

  // Reset form when template changes or dialog opens/closes
  useEffect(() => {
    if (open && template) {
      form.reset({
        projectName: '',
        projectDescription: '',
      });
    }
  }, [open, template?.id, form]);

  if (!template) return null;

  const projectSettings = template.templateData.projectSettings;
  const sampleCharacters = template.templateData.sampleCharacters ?? [];
  const sampleLocations = template.templateData.sampleLocations ?? [];
  const storyStructure = template.templateData.storyStructure;

  const handleCreate = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        const result = await createProjectFromTemplateAction({
          templateId: template.id,
          accountSlug,
          projectName: data.projectName,
          projectDescription: data.projectDescription,
        });

        toast.success('Project created successfully!', {
          description: `Created ${result.assetsCreated.characters} characters and ${result.assetsCreated.locations} locations.`,
        });

        onOpenChange(false);
        router.push(`/home/${accountSlug}/studio/${result.projectId}`);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to create project',
        );
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template.name}</DialogTitle>
          <DialogDescription>
            {template.description ?? 'No description available'}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="characters">
                Characters ({sampleCharacters.length})
              </TabsTrigger>
              <TabsTrigger value="locations">
                Locations ({sampleLocations.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4 py-4">
              <div className="flex flex-wrap gap-2">
                <Badge>{template.category}</Badge>
                {template.genre && (
                  <Badge variant="outline">{template.genre}</Badge>
                )}
                {template.targetDurationMinutes && (
                  <Badge variant="secondary">
                    ~{template.targetDurationMinutes} min
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Project Type:</span>
                  <span className="ml-2">{projectSettings?.projectType}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Video Style:</span>
                  <span className="ml-2">{projectSettings?.videoStyle}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Aspect Ratio:</span>
                  <span className="ml-2">
                    {projectSettings?.defaultAspectRatio}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Provider:</span>
                  <span className="ml-2">
                    {projectSettings?.defaultProvider}
                  </span>
                </div>
              </div>

              {storyStructure && (
                <div className="mt-4">
                  <h4 className="mb-2 font-medium">Story Structure</h4>
                  <div className="text-sm">
                    {storyStructure.acts && (
                      <span>
                        <span className="text-muted-foreground">Acts:</span>{' '}
                        {storyStructure.acts}
                      </span>
                    )}
                    {storyStructure.episodeCount && (
                      <>
                        <span className="mx-2">•</span>
                        <span>
                          <span className="text-muted-foreground">
                            Episodes:
                          </span>{' '}
                          {storyStructure.episodeCount}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="settings" className="py-4">
              <pre className="bg-muted overflow-auto rounded-lg p-4 text-sm">
                {JSON.stringify(projectSettings, null, 2)}
              </pre>
            </TabsContent>

            <TabsContent value="characters" className="space-y-4 py-4">
              {sampleCharacters.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No sample characters
                </p>
              ) : (
                sampleCharacters.map((char: SampleCharacter, idx: number) => (
                  <div key={idx} className="rounded-lg border p-4">
                    <h4 className="font-medium">{char.name}</h4>
                    {char.description && (
                      <p className="text-muted-foreground mt-1 text-sm">
                        {char.description}
                      </p>
                    )}
                    {char.role && (
                      <Badge variant="outline" className="mt-2">
                        {char.role}
                      </Badge>
                    )}
                  </div>
                ))
              )}
            </TabsContent>

            <TabsContent value="locations" className="space-y-4 py-4">
              {sampleLocations.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No sample locations
                </p>
              ) : (
                sampleLocations.map((loc: SampleLocation, idx: number) => (
                  <div key={idx} className="rounded-lg border p-4">
                    <h4 className="font-medium">{loc.name}</h4>
                    {loc.description && (
                      <p className="text-muted-foreground mt-1 text-sm">
                        {loc.description}
                      </p>
                    )}
                  </div>
                ))
              )}
            </TabsContent>
          </Tabs>

          <Separator className="my-4" />

          <Form {...form}>
            <form className="space-y-4">
              <FormField
                control={form.control}
                name="projectName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="My New Project"
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="projectDescription"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Brief description of your project"
                        disabled={isPending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isPending}>
            {isPending ? 'Creating...' : 'Create Project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
