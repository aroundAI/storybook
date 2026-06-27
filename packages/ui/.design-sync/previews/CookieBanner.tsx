import { CookieBanner } from '@kit/ui/cookie-banner';

// CookieBanner is a zero-prop component that reads consent state from
// localStorage and renders `null` once a decision is already stored, or
// outside the browser. In a fresh render (no consent key set yet) it
// should self-render its Radix dialog with the accept/reject banner.
export function Default() {
  return <CookieBanner />;
}
