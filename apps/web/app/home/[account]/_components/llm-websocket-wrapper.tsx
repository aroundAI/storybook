'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { getSupabaseBrowserClient } from '@kit/supabase/browser-client';
import { LlmWebSocketProvider } from '@kit/ui/hooks';

interface LlmWebSocketWrapperProps {
    children: ReactNode;
}

/**
 * Client-side wrapper that provides the LlmWebSocketProvider with auth token.
 * 
 * Uses the Supabase browser client to get the session token.
 * Should be placed in an authenticated layout (e.g., [account]/layout.tsx).
 */
export function LlmWebSocketWrapper({ children }: LlmWebSocketWrapperProps) {
    const [authToken, setAuthToken] = useState<string>();
    const supabase = getSupabaseBrowserClient();

    useEffect(() => {
        // Get initial session
        void supabase.auth.getSession().then(({ data: sessionData }) => {
            setAuthToken(sessionData.session?.access_token);
        });

        // Subscribe to auth changes (refresh, logout, etc.)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                setAuthToken(session?.access_token);
            }
        );

        return () => {
            subscription.unsubscribe();
        };
    }, [supabase]);

    const wsUrl = process.env.NEXT_PUBLIC_WEBSOCKET_URL;

    return (
        <LlmWebSocketProvider wsUrl={wsUrl} token={authToken}>
            {children}
        </LlmWebSocketProvider>
    );
}
