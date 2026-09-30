'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  GitBranch,
  Loader2,
  Shield,
  Skull,
  User,
} from 'lucide-react';

import {
  buildMemoryContextAction,
  validateContentInlineAction,
} from '@kit/episodes/server';
import type { ScreenplayScene } from '@kit/episodes/types';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

import { buildContinuityView } from './continuity-view';

interface ContinuitySidebarProps {
  projectId: string;
  episodeId: string;
  episodeNumber: number;
  scene: ScreenplayScene;
}

const SEVERITY_STYLES = {
  error: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
  warning:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  info: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
} as const;

function sceneContent(scene: ScreenplayScene): string {
  return [
    scene.heading,
    scene.description,
    ...(scene.dialogue ?? []).map((line) => `${line.character}: ${line.text}`),
  ].join('\n');
}

/**
 * What the canon says about the scene being read: events it must not
 * contradict, open threads, the characters in it, and any violation found in
 * its text (FILM-1007). Hidden below the `lg` breakpoint, where the
 * screenplay needs the width.
 */
export function ContinuitySidebar({
  projectId,
  episodeId,
  episodeNumber,
  scene,
}: ContinuitySidebarProps) {
  const content = sceneContent(scene);

  const context = useQuery({
    queryKey: ['continuity-context', projectId, episodeNumber],
    queryFn: () => buildMemoryContextAction({ projectId, episodeNumber }),
    staleTime: 60_000,
  });

  const validation = useQuery({
    queryKey: ['continuity-validation', episodeId, scene.number, content],
    queryFn: () =>
      validateContentInlineAction({ projectId, episodeId, content }),
    staleTime: 60_000,
  });

  const view = context.data
    ? buildContinuityView(
        context.data,
        {
          heading: scene.heading,
          description: scene.description,
          dialogue: scene.dialogue ?? [],
        },
        validation.data?.violations,
      )
    : null;

  return (
    <aside
      className="hidden w-72 shrink-0 overflow-y-auto border-l border-white/5 bg-white/[0.02] p-4 lg:block"
      aria-label="Continuity"
      data-test="continuity-sidebar"
    >
      <div className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-violet-500" />
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          Continuity
        </h3>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          Scene {scene.number}
        </Badge>
      </div>

      {context.isPending ? (
        <div
          className="flex items-center gap-2 py-6 text-xs text-muted-foreground"
          data-test="continuity-loading"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading canon...
        </div>
      ) : context.isError || !view ? (
        <div className="space-y-2 py-4" data-test="continuity-error">
          <p className="text-xs text-muted-foreground">
            Canon could not be loaded. The screenplay is unaffected.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => context.refetch()}
            data-test="continuity-retry"
          >
            Try again
          </Button>
        </div>
      ) : view.isEmpty ? (
        <p
          className="py-4 text-xs text-muted-foreground"
          data-test="continuity-empty"
        >
          No canon applies yet. Events, threads and character changes from
          committed episodes appear here.
        </p>
      ) : (
        <div className="space-y-5">
          {validation.isError && (
            <p
              className="text-[11px] text-muted-foreground"
              data-test="continuity-check-error"
            >
              This scene could not be checked against canon.
            </p>
          )}

          {view.violations.length > 0 && (
            <Section
              icon={<AlertTriangle className="h-3 w-3" />}
              title="In this scene"
              testId="continuity-violations"
            >
              {view.violations.map((violation) => (
                <li
                  key={`${violation.code}-${violation.message}`}
                  className={cn(
                    'rounded-md border p-2 text-[11px] leading-snug',
                    SEVERITY_STYLES[violation.severity],
                  )}
                  data-test="continuity-violation"
                >
                  <span className="font-mono text-[10px]">
                    {violation.code}
                  </span>{' '}
                  {violation.message}
                </li>
              ))}
            </Section>
          )}

          {view.mustNotContradict.length > 0 && (
            <Section
              icon={<Skull className="h-3 w-3" />}
              title="Must not contradict"
              testId="continuity-events"
            >
              {view.mustNotContradict.map((event) => (
                <li
                  key={event.id}
                  className="text-[11px] leading-snug text-muted-foreground"
                  data-test="continuity-event"
                >
                  <span className="font-medium text-foreground">
                    {event.description}
                  </span>{' '}
                  <span className="text-[10px]">
                    ({event.label}, Ep.{event.episodeNumber})
                  </span>
                </li>
              ))}
            </Section>
          )}

          {view.openThreads.length > 0 && (
            <Section
              icon={<GitBranch className="h-3 w-3" />}
              title="Open threads"
              testId="continuity-threads"
            >
              {view.openThreads.map((thread) => (
                <li
                  key={thread.id}
                  className="flex items-center justify-between gap-2 text-[11px]"
                  data-test="continuity-thread"
                >
                  <span className="truncate">{thread.name}</span>
                  <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                    {thread.status}
                  </Badge>
                </li>
              ))}
            </Section>
          )}

          {view.characters.length > 0 && (
            <Section
              icon={<User className="h-3 w-3" />}
              title="Characters"
              testId="continuity-characters"
            >
              {view.characters.map((character) => (
                <li
                  key={character.id}
                  className="text-[11px] leading-snug"
                  data-test="continuity-character"
                >
                  <span className="font-medium">{character.name}</span>
                  {character.state && (
                    <span className="text-muted-foreground">
                      {' '}
                      - {character.state}
                    </span>
                  )}
                  {character.constraints.length > 0 && (
                    <span className="block text-[10px] text-muted-foreground">
                      {character.constraints.join('; ')}
                    </span>
                  )}
                </li>
              ))}
            </Section>
          )}
        </div>
      )}
    </aside>
  );
}

function Section({
  icon,
  title,
  testId,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section data-test={testId}>
      <h4 className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
      </h4>
      <ul className="space-y-1.5">{children}</ul>
    </section>
  );
}
