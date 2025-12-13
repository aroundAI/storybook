'use client';

/**
 * QuickActions Component
 *
 * Toolbar with quick create buttons and analytics link.
 */

import Link from 'next/link';

import { BarChart3, Clapperboard, MapPin, Users } from 'lucide-react';

import { Button } from '@kit/ui/button';

interface QuickActionsProps {
    baseUrl: string;
}

export function QuickActions({ baseUrl }: QuickActionsProps) {
    const actions = [
        {
            label: 'New Episode',
            href: `${baseUrl}/episodes?create=true`,
            icon: Clapperboard,
            variant: 'default' as const,
        },
        {
            label: 'Add Character',
            href: `${baseUrl}/assets?create=character`,
            icon: Users,
            variant: 'secondary' as const,
        },
        {
            label: 'Add Location',
            href: `${baseUrl}/assets?create=location`,
            icon: MapPin,
            variant: 'secondary' as const,
        },
    ];

    return (
        <div className="flex items-center gap-3">
            {actions.map((action) => {
                const Icon = action.icon;
                return (
                    <Button
                        key={action.label}
                        variant={action.variant}
                        size="sm"
                        asChild
                    >
                        <Link href={action.href}>
                            <Icon className="mr-1 h-3.5 w-3.5" />
                            {action.label}
                        </Link>
                    </Button>
                );
            })}

            {/* Analytics Link */}
            <div className="ml-auto">
                <Button variant="ghost" size="sm" asChild>
                    <Link href={`${baseUrl}/analytics`}>
                        <BarChart3 className="mr-1.5 h-4 w-4" />
                        Analytics
                    </Link>
                </Button>
            </div>
        </div>
    );
}
