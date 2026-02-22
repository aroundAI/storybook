'use client';

/**
 * Media Bin — left sidebar for browsing episode assets.
 *
 * Stub implementation. Will be populated with:
 * - Shots, Dialogue, Dubbed, Music, SFX, Uploads sections
 * - Drag-to-timeline support
 * - Upload handler
 * - Search/filter
 */

export function MediaBin() {
    return (
        <div className="media-bin">
            <div className="media-bin-header">
                <h3 className="media-bin-title">Media Bin</h3>
            </div>

            <div className="media-bin-sections">
                <MediaSection icon="🎬" label="Shots" count={0} />
                <MediaSection icon="🗣" label="Dialogue" count={0} />
                <MediaSection icon="🌐" label="Dubbed" count={0} />
                <MediaSection icon="🎵" label="Music" count={0} />
                <MediaSection icon="🔊" label="SFX" count={0} />
                <MediaSection icon="📁" label="Uploads" count={0} />
            </div>

            <style>{`
                .media-bin {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: #18181b;
                }

                .media-bin-header {
                    padding: 10px 12px;
                    border-bottom: 1px solid #27272a;
                }

                .media-bin-title {
                    font-size: 12px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    color: #a1a1aa;
                    margin: 0;
                }

                .media-bin-sections {
                    flex: 1;
                    overflow-y: auto;
                    padding: 4px 0;
                }

                .media-section {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    cursor: pointer;
                    transition: background 0.15s;
                }

                .media-section:hover {
                    background: #27272a;
                }

                .media-section-icon {
                    font-size: 16px;
                }

                .media-section-label {
                    flex: 1;
                    font-size: 13px;
                    color: #d4d4d8;
                }

                .media-section-count {
                    font-size: 11px;
                    color: #71717a;
                    background: #27272a;
                    padding: 1px 6px;
                    border-radius: 8px;
                }
            `}</style>
        </div>
    );
}

function MediaSection({ icon, label, count }: { icon: string; label: string; count: number }) {
    return (
        <div className="media-section">
            <span className="media-section-icon">{icon}</span>
            <span className="media-section-label">{label}</span>
            <span className="media-section-count">{count}</span>
        </div>
    );
}
