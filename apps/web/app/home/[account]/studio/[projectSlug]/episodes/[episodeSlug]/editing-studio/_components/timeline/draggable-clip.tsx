'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Scissors } from 'lucide-react';

import { cn } from '@kit/ui/utils';

export interface DraggableClipProps {
    /** Unique ID for the clip */
    id: string;
    /** Clip type for styling */
    type: 'video' | 'dialogue' | 'music' | 'sfx';
    /** Content to render inside the clip */
    children: ReactNode;
    /** Width in pixels */
    width: number;
    /** Height in pixels (optional, defaults by type) */
    height?: number;
    /** Left offset in pixels */
    left: number;
    /** Whether clip is selected */
    isSelected?: boolean;
    /** Whether clip is disabled/locked */
    disabled?: boolean;
    /** Callback when clip is clicked */
    onClick?: () => void;
    /** Callback when clip is resized from left edge */
    onResizeLeft?: (deltaPixels: number) => void;
    /** Callback when clip is resized from right edge */
    onResizeRight?: (deltaPixels: number) => void;
    /** Callback when clip is cut */
    onCut?: () => void;
    /** Callback when clip is deleted */
    onDelete?: () => void;
    /** Custom class name */
    className?: string;
}

const TYPE_STYLES = {
    video: {
        bg: 'bg-indigo-100 dark:bg-indigo-900/40',
        border: 'border-indigo-300 dark:border-indigo-700',
        handle: 'bg-indigo-200 dark:bg-indigo-800',
    },
    dialogue: {
        bg: 'bg-green-100 dark:bg-green-900/40',
        border: 'border-green-300 dark:border-green-700',
        handle: 'bg-green-200 dark:bg-green-800',
    },
    music: {
        bg: 'bg-purple-100 dark:bg-purple-900/40',
        border: 'border-purple-300 dark:border-purple-700',
        handle: 'bg-purple-200 dark:bg-purple-800',
    },
    sfx: {
        bg: 'bg-orange-100 dark:bg-orange-900/40',
        border: 'border-orange-300 dark:border-orange-700',
        handle: 'bg-orange-200 dark:bg-orange-800',
    },
};

/**
 * DraggableClip - Reusable draggable and resizable timeline clip
 * 
 * Features:
 * - Drag to reposition (via dnd-kit sortable)
 * - Resize handles on left/right edges
 * - Visual feedback during drag
 * - Type-based styling
 */
export function DraggableClip({
    id,
    type,
    children,
    width,
    height = 56,
    left,
    isSelected = false,
    disabled = false,
    onClick,
    onResizeLeft,
    onResizeRight,
    onCut,
    className,
}: DraggableClipProps) {
    const [isResizing, setIsResizing] = useState<'left' | 'right' | null>(null);
    const styles = TYPE_STYLES[type];

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({
        id,
        disabled,
    });

    const style: CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        position: 'absolute',
        left: `${left}px`,
        width: `${width}px`,
        height: `${height}px`,
        zIndex: isDragging ? 50 : isSelected ? 20 : 10,
    };

    // Handle resize drag
    const handleResizeStart = (edge: 'left' | 'right', e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        setIsResizing(edge);

        const startX = e.clientX;
        const onResizer = edge === 'left' ? onResizeLeft : onResizeRight;

        const handleMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            onResizer?.(delta);
        };

        const handleMouseUp = () => {
            setIsResizing(null);
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                'group flex cursor-pointer items-stretch overflow-hidden rounded-md border transition-all',
                styles.bg,
                styles.border,
                isDragging && 'opacity-50 shadow-lg ring-2 ring-blue-500',
                isSelected && 'ring-2 ring-blue-500',
                isResizing && 'cursor-ew-resize',
                className,
            )}
            onClick={onClick}
            {...attributes}
        >
            {/* Left resize handle */}
            {onResizeLeft && (
                <div
                    className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-transparent hover:bg-white/30 z-20"
                    onMouseDown={(e) => handleResizeStart('left', e)}
                />
            )}

            {/* Drag handle */}
            <div
                className={cn(
                    'flex w-5 shrink-0 cursor-grab items-center justify-center',
                    styles.handle,
                )}
                {...listeners}
            >
                <GripVertical className="h-3 w-3 text-gray-500" />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden px-1">
                {children}
            </div>

            {/* Cut button (on hover) */}
            {onCut && (
                <button
                    className="absolute top-1 right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded bg-white/80 text-gray-600 hover:bg-red-100 hover:text-red-600 z-20"
                    onClick={(e) => {
                        e.stopPropagation();
                        onCut();
                    }}
                >
                    <Scissors className="h-3 w-3" />
                </button>
            )}

            {/* Right resize handle */}
            {onResizeRight && (
                <div
                    className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-transparent hover:bg-white/30 z-20"
                    onMouseDown={(e) => handleResizeStart('right', e)}
                />
            )}
        </div>
    );
}
