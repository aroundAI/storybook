'use client';

/**
 * QuickActions Component
 *
 * Consolidated action bar with primary "New Episode" button
 * and secondary actions in a clean row.
 */

import Link from 'next/link';

import { ChevronDown, MapPin, Plus, Sparkles, Users } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

interface QuickActionsProps {
    baseUrl: string;
}

export function QuickActions({ baseUrl }: QuickActionsProps) {
    return (
        <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
                {/* Primary Action: New Episode */}
                <Button asChild variant="generate">
                    <Link href={`${baseUrl}/episodes`}>
                        <Sparkles className="mr-2 h-4 w-4" />
                        New Episode
                    </Link>
                </Button>

                {/* Secondary Actions: Consolidated Dropdown */}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="default">
                            <Plus className="mr-2 h-4 w-4" />
                            Add Asset
                            <ChevronDown className="ml-2 h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem asChild>
                            <Link href={`${baseUrl}/characters`} className="flex items-center gap-2">
                                <Users className="h-4 w-4" />
                                Add Character
                            </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                            <Link href={`${baseUrl}/locations`} className="flex items-center gap-2">
                                <MapPin className="h-4 w-4" />
                                Add Location
                            </Link>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </div>
        </div>
    );
}
