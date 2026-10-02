/**
 * Rows the memory context builder reads back (FILM-1004). The implementation
 * lives in `@kit/generation` (FILM-1901), where the story stage's commit
 * writes them; this module keeps the package's import path.
 */
export * from '@kit/generation/canon';
