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
        <div className="inspector-panel">
            <div className="inspector-header">
                <h3 className="inspector-title">Inspector</h3>
            </div>

            <div className="inspector-body">
                {selectedCount === 0 && (
                    <div className="inspector-empty">
                        <span className="inspector-empty-icon">🎯</span>
                        <p className="inspector-empty-text">
                            Select a clip to view its properties
                        </p>
                    </div>
                )}

                {selectedCount === 1 && (
                    <div className="inspector-sections">
                        <InspectorSection title="Clip Properties" />
                        <InspectorSection title="Keyframes" />
                        <InspectorSection title="Transition" />
                    </div>
                )}

                {selectedCount > 1 && (
                    <div className="inspector-empty">
                        <p className="inspector-empty-text">
                            {selectedCount} clips selected
                        </p>
                    </div>
                )}
            </div>

            <style>{`
                .inspector-panel {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: #18181b;
                }

                .inspector-header {
                    padding: 10px 12px;
                    border-bottom: 1px solid #27272a;
                }

                .inspector-title {
                    font-size: 12px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #a1a1aa;
                    margin: 0;
                }

                .inspector-body {
                    flex: 1;
                    padding: 8px;
                    overflow-y: auto;
                }

                .inspector-empty {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 200px;
                    gap: 8px;
                }

                .inspector-empty-icon {
                    font-size: 24px;
                    opacity: 0.5;
                }

                .inspector-empty-text {
                    font-size: 12px;
                    color: #71717a;
                    text-align: center;
                    margin: 0;
                }

                .inspector-sections {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                }

                .inspector-section {
                    border: 1px solid #27272a;
                    border-radius: 6px;
                    overflow: hidden;
                }

                .inspector-section-header {
                    display: flex;
                    align-items: center;
                    padding: 8px 10px;
                    background: #1f1f23;
                    cursor: pointer;
                }

                .inspector-section-title {
                    font-size: 12px;
                    font-weight: 500;
                    color: #a1a1aa;
                    margin: 0;
                }

                .inspector-section-body {
                    padding: 10px;
                    font-size: 12px;
                    color: #52525b;
                }
            `}</style>
        </div>
    );
}

function InspectorSection({ title }: { title: string }) {
    return (
        <div className="inspector-section">
            <div className="inspector-section-header">
                <span className="inspector-section-title">{title}</span>
            </div>
            <div className="inspector-section-body">
                Coming soon
            </div>
        </div>
    );
}
