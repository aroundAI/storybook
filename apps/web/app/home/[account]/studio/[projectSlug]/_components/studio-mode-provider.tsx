'use client';

import { useEffect } from 'react';

/**
 * Sets data-studio-mode="true" on the html element when mounted.
 * This allows CSS to remove min-h-screen for studio pages to prevent scroll issues.
 */
export function StudioModeProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        document.documentElement.setAttribute('data-studio-mode', 'true');

        return () => {
            document.documentElement.removeAttribute('data-studio-mode');
        };
    }, []);

    return <>{children}</>;
}
