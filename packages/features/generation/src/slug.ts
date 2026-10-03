/**
 * Utility functions for generating URL-friendly slugs
 */

/**
 * Generate a slug from episode number and title
 * Format: episode-{number}-{title-slug}
 *
 * @example
 * generateEpisodeSlug(1, 'The Pilot Episode') => 'episode-1-the-pilot-episode'
 * generateEpisodeSlug(10, "A Hero's Journey!") => 'episode-10-a-heros-journey'
 */
export function generateEpisodeSlug(number: number, title: string): string {
  const titleSlug = slugify(title);
  return `episode-${number}-${titleSlug}`;
}

/**
 * Generate a slug from project name
 *
 * @example
 * generateProjectSlug('My Awesome Show') => 'my-awesome-show'
 */
export function generateProjectSlug(name: string): string {
  return slugify(name);
}

/**
 * Convert a string to a URL-friendly slug
 * - Converts to lowercase
 * - Replaces spaces and special chars with hyphens
 * - Removes consecutive hyphens
 * - Trims hyphens from start/end
 *
 * @example
 * slugify('Hello World!') => 'hello-world'
 * slugify("A Hero's Journey") => 'a-heros-journey'
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
    .replace(/[\s_]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/-+/g, '-') // Replace consecutive hyphens with single hyphen
    .replace(/^-+|-+$/g, ''); // Trim hyphens from start and end
}
