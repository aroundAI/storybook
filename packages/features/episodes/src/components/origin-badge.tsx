'use client';

import { Bot, PencilLine, Sparkles } from 'lucide-react';

import { cn } from '@kit/ui/utils';

import {
  type DisplayOrigin,
  originLabel,
  parseGenerationOrigin,
} from '../lib/generation-origin';

const KIND_STYLES: Record<DisplayOrigin['kind'], string> = {
  server: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  external:
    'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  human: 'border-gray-400/40 bg-gray-500/10 text-gray-700 dark:text-gray-300',
};

const KIND_ICONS = {
  server: Sparkles,
  external: Bot,
  human: PencilLine,
} as const;

/**
 * Who wrote a piece of content: "Gemini", "Claude via MCP" (with the
 * model the client reported) or "Edited", from its `generation_origin`
 * (FILM-1910). Renders nothing for content with no origin, which is
 * everything written before FILM-1903.
 */
export function OriginBadge({
  origin,
  className,
}: {
  /** A raw `generation_origin` value, or an already parsed one */
  origin: unknown;
  className?: string;
}) {
  const parsed = parseGenerationOrigin(origin);

  if (!parsed) return null;

  const { label, detail } = originLabel(parsed);
  const Icon = KIND_ICONS[parsed.kind];

  return (
    <span
      data-test="origin-badge"
      data-origin-kind={parsed.kind}
      title={detail ? `${label} (${detail})` : label}
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap',
        KIND_STYLES[parsed.kind],
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span>{label}</span>
      {detail && (
        <span
          data-test="origin-badge-detail"
          className="truncate font-normal opacity-75"
        >
          · {detail}
        </span>
      )}
    </span>
  );
}
