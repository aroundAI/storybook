export const MAIN_CONTENT_ID = 'main-content';

/**
 * First focusable element of a page: hidden until focused, then jumps past
 * the navigation to the `<main>` carrying `id={MAIN_CONTENT_ID}`.
 */
export function SkipToContent() {
  return (
    <nav aria-label="Skip links">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        data-test="skip-to-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
      >
        Skip to main content
      </a>
    </nav>
  );
}
