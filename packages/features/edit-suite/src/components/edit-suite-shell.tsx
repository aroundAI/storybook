'use client';

/**
 * Edit Suite Shell — main layout component.
 *
 * CSS Grid layout with 4 zones:
 * - Top: Toolbar
 * - Left: Media Bin
 * - Center: Preview Canvas
 * - Right: Inspector
 * - Bottom: Timeline
 */
import { InspectorPanel } from './inspector/inspector-panel';
import { MediaBin } from './media-bin/media-bin';
import { PreviewPanel } from './preview/preview-panel';
import { Timeline } from './timeline/timeline';
import { Toolbar } from './toolbar';

export function EditSuiteShell() {
  return (
    <div className="grid h-screen w-full grid-rows-[auto_1fr_280px] overflow-hidden bg-[#0a0a0f] font-sans text-zinc-200">
      {/* Toolbar */}
      <header className="z-10 border-b border-zinc-800">
        <Toolbar />
      </header>

      {/* Three-panel workspace */}
      <div className="grid min-h-0 grid-cols-[260px_1fr_280px] overflow-hidden">
        <aside className="overflow-y-auto border-r border-zinc-800">
          <MediaBin />
        </aside>

        <main className="flex min-w-0 items-center justify-center bg-[#09090b]">
          <PreviewPanel />
        </main>

        <aside className="overflow-y-auto border-l border-zinc-800">
          <InspectorPanel />
        </aside>
      </div>

      {/* Timeline */}
      <div className="overflow-hidden border-t border-zinc-800">
        <Timeline />
      </div>
    </div>
  );
}
