'use client';

import { useEffect } from 'react';

/**
 * Sets up studio mode styling to prevent scroll issues.
 * - Sets data-studio-mode="true" on html to remove min-h-screen via CSS
 * - Sets overflow: hidden on body to prevent body scrolling
 */
export function StudioModeProvider({ children }: { children: React.ReactNode }) {
    useEffect(() => {
        document.documentElement.setAttribute('data-studio-mode', 'true');

        // Store original body overflow and set to hidden
        const originalOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        return () => {
            document.documentElement.removeAttribute('data-studio-mode');
            document.body.style.overflow = originalOverflow;
        };
    }, []);

    return <>{children}</>;
}
