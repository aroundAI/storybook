'use client';

/**
 * Inspector Panel — right sidebar for clip properties.
 *
 * Stub implementation. Will contain:
 * - Clip properties editor
 * - Keyframe curve editor
 * - Transition picker
 */

import { useEditSuite } from '../edit-suite-provider';

export function InspectorPanel() {
    const { state } = useEditSuite();
    const selectedCount = state.selectedClipIds.size;

    return (
        <div className="flex h-full flex-col bg-zinc-900">
            <div className="border-b border-zinc-800 px-3 py-2.5">
                <h3 className="m-0 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Inspector
                </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
                {selectedCount === 0 && (
                    <div className="flex h-[200px] flex-col items-center justify-center gap-2">
                        <span className="text-2xl opacity-50">🎯</span>
                        <p className="m-0 text-center text-xs text-zinc-500">
                            Select a clip to view its properties
                        </p>
                    </div>
                )}

                {selectedCount === 1 && (
                    <div className="flex flex-col gap-1">
                        <InspectorSection title="Clip Properties" />
                        <InspectorSection title="Keyframes" />
                        <InspectorSection title="Transition" />
                    </div>
                )}

                {selectedCount > 1 && (
                    <div className="flex h-[200px] flex-col items-center justify-center gap-2">
                        <p className="m-0 text-center text-xs text-zinc-500">
                            {selectedCount} clips selected
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

function InspectorSection({ title }: { title: string }) {
    return (
        <div className="overflow-hidden rounded-md border border-zinc-800">
            <div className="flex cursor-pointer items-center bg-[#1f1f23] px-2.5 py-2">
                <span className="m-0 text-xs font-medium text-zinc-400">{title}</span>
            </div>
            <div className="p-2.5 text-xs text-zinc-600">
                Coming soon
            </div>
        </div>
    );
}
