import { Component, type ReactNode } from 'react';

import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Without this, a component that throws during render is swallowed by React
// 18+ (logged to console, tree unmounts) — every preview cell becomes a
// silent blank with no way to tell "genuinely empty" apart from "crashed".
// Turns every such case into a visible, diagnosable message instead.
class PreviewErrorBoundary extends Component<
  { children?: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="text-xs text-destructive">
          ⚠ {this.state.error.message}
        </div>
      );
    }
    return this.props.children;
  }
}

// Wraps every preview cell (cfg.provider) so it renders against the DS's
// real ambient page background — the cinema-dark theme is the DEFAULT
// (un-classed) :root, not an opt-in `.dark` mode, but the preview card
// template hardcodes a white page background for its own grid/gallery
// chrome. Without this, anything relying on inherited text color (Button's
// `ghost`/`link` variants, plain text) renders illegibly: light
// `text-foreground` on the template's white page. Components with their
// own opaque background (Card, etc.) are unaffected either way.
//
// Also wraps a QueryClientProvider: components that call useMutation/
// useQuery (e.g. MultiStepForm's useMutation) throw with no QueryClient in
// the tree — React 18+ swallows that render error (no error boundary here),
// so it surfaces as a silently blank cell, not a visible error message.
// One module-level singleton is fine: previews are static, non-interactive
// renders with no real network activity to cache or isolate between cells.
//
// This file is bundled into the MAIN _ds_bundle.js (cfg.extraEntries), the
// SAME bundle cfg.storyImports.shim now redirects every @kit/ui component
// import into (see config.json's "/packages/ui/src/" shim — it routes named
// imports through window.KitUi's whole namespace instead of bundling real
// source fresh per preview, which is what cut _preview/**'s total size from
// ~70MB to ~12MB). That makes THIS QueryClientProvider the one components
// actually see: a shimmed component's internal useContext() call resolves
// against the createContext() object instantiated HERE, in _ds_bundle.js's
// own module graph — the SAME bundle the shimmed component itself runs in.
// A QueryClientProvider/i18n-init/etc. written inside an individual
// preview's OWN separately-bundled .tsx file is invisible to it (a
// DIFFERENT createContext() call, even for the identical library) — that
// was the original failure mode (see NOTES.md's MultiStepForm entry, now
// superseded by this shim-aware framing).
const queryClient = new QueryClient();

// LanguageSelector's useTranslation() and BorderedNavigationMenuItem's
// internal <Trans i18nKey={label} defaults={label} /> (no children) both
// need a REAL, initialized i18next instance reachable via this bundle's
// react-i18next module state (getI18n()/setI18n()) — doing it here, once,
// covers every shimmed component that touches i18n, instead of repeating
// the init per preview (which, post-shim, wouldn't even reach the right
// module instance anyway).
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: ['en', 'es', 'fr', 'de'],
    initImmediate: false,
    resources: { en: {}, es: {}, fr: {}, de: {} },
    react: { useSuspense: false },
  });
}

// AppRouterContext (EnhancedDataTable's useRouter()) and PathnameContext
// (AppBreadcrumbs' usePathname()) need PER-STORY values (a "WithPagination"
// or "DeepPath" story wants different content than "Default") — cfg.provider
// wraps every cell identically with no per-story prop passthrough, so they
// can't be provided here directly the way the QueryClient/i18n setup above
// is. Exposed as window globals instead: an individual preview (its own,
// separately-bundled .tsx file) reads the SAME context OBJECT from here —
// window.__dsAppRouterContext.Provider / window.__dsPathnameContext.Provider
// — and wraps with whatever per-story value it needs. Since the object
// reference itself comes from THIS bundle, a shimmed component's
// useContext() call (reading the identical object, also from this bundle)
// sees it correctly — only the VALUE differs per story, not the identity.
declare global {
  interface Window {
    __dsAppRouterContext?: typeof AppRouterContext;
    __dsPathnameContext?: typeof PathnameContext;
  }
}
if (typeof window !== 'undefined') {
  window.__dsAppRouterContext = AppRouterContext;
  window.__dsPathnameContext = PathnameContext;
}

export function PreviewBackground({ children }: { children?: ReactNode }) {
  return (
    <PreviewErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <div className="min-h-[80px] rounded-md bg-background p-6 text-foreground">
          {children}
        </div>
      </QueryClientProvider>
    </PreviewErrorBoundary>
  );
}
