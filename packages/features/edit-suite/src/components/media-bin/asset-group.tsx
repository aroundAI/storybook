'use client';

/**
 * AssetGroup — collapsible section in the Media Bin.
 *
 * Shows an icon, label, count badge, and expands/collapses its children.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';

interface AssetGroupProps {
    icon: string;
    label: string;
    count: number;
    defaultOpen?: boolean;
    children: ReactNode;
}

export function AssetGroup({ icon, label, count, defaultOpen = true, children }: AssetGroupProps) {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-zinc-800 last:border-b-0">
            <button
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-300 transition-colors hover:bg-zinc-800/50"
                onClick={() => setIsOpen(!isOpen)}
            >
                <span
                    className="text-[10px] text-zinc-500 transition-transform duration-150"
                    style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >
                    ▶
                </span>
                <span>{icon}</span>
                <span className="flex-1 font-medium">{label}</span>
                <span className="rounded-full bg-zinc-700/50 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {count}
                </span>
            </button>

            {isOpen && (
                <div className="pb-1">
                    {children}
                </div>
            )}
        </div>
    );
}
