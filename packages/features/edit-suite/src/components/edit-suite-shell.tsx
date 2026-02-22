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

import { Toolbar } from './toolbar';
import { MediaBin } from './media-bin/media-bin';
import { PreviewPanel } from './preview/preview-panel';
import { InspectorPanel } from './inspector/inspector-panel';
import { Timeline } from './timeline/timeline';

export function EditSuiteShell() {
    return (
        <div className="edit-suite-shell">
            {/* Toolbar */}
            <header className="edit-suite-toolbar-area">
                <Toolbar />
            </header>

            {/* Three-panel workspace */}
            <div className="edit-suite-workspace">
                <aside className="edit-suite-media-bin">
                    <MediaBin />
                </aside>

                <main className="edit-suite-preview">
                    <PreviewPanel />
                </main>

                <aside className="edit-suite-inspector">
                    <InspectorPanel />
                </aside>
            </div>

            {/* Timeline */}
            <div className="edit-suite-timeline-area">
                <Timeline />
            </div>

            <style>{`
                .edit-suite-shell {
                    display: grid;
                    grid-template-rows: auto 1fr 280px;
                    height: 100vh;
                    width: 100%;
                    background: #0a0a0f;
                    color: #e4e4e7;
                    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
                    overflow: hidden;
                }

                .edit-suite-toolbar-area {
                    border-bottom: 1px solid #27272a;
                    z-index: 10;
                }

                .edit-suite-workspace {
                    display: grid;
                    grid-template-columns: 260px 1fr 280px;
                    min-height: 0;
                    overflow: hidden;
                }

                .edit-suite-media-bin {
                    border-right: 1px solid #27272a;
                    overflow-y: auto;
                }

                .edit-suite-preview {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 0;
                    background: #09090b;
                }

                .edit-suite-inspector {
                    border-left: 1px solid #27272a;
                    overflow-y: auto;
                }

                .edit-suite-timeline-area {
                    border-top: 1px solid #27272a;
                    overflow: hidden;
                }
            `}</style>
        </div>
    );
}
