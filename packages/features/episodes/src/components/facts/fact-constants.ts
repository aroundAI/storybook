/**
 * Shared constants for the Fact Management UI.
 * Single source of truth for status styles, labels, and categories.
 */

export const STATUS_STYLES: Record<string, string> = {
  unverified:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  verified:
    'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  disputed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  pending_review:
    'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  retracted: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

export const STATUS_LABELS: Record<string, string> = {
  unverified: 'Unverified',
  verified: 'Verified',
  disputed: 'Disputed',
  pending_review: 'Pending Review',
  retracted: 'Retracted',
};

export const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(
  ([value, label]) => ({
    value,
    label,
  }),
);

export const FACT_CATEGORIES = [
  'physics',
  'biology',
  'history',
  'geography',
  'chemistry',
  'technology',
  'politics',
  'economics',
  'culture',
  'science',
  'medicine',
  'law',
] as const;

export const CATEGORY_OPTIONS = FACT_CATEGORIES.map((cat) => ({
  value: cat,
  label: cat.charAt(0).toUpperCase() + cat.slice(1),
}));

export const SOURCE_TYPES = [
  { value: 'research_paper', label: 'Research Paper' },
  { value: 'book', label: 'Book' },
  { value: 'news_article', label: 'News Article' },
  { value: 'official_document', label: 'Official Document' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'expert_interview', label: 'Expert Interview' },
  { value: 'dataset', label: 'Dataset' },
  { value: 'website', label: 'Website' },
  { value: 'encyclopedia', label: 'Encyclopedia' },
  { value: 'court_document', label: 'Court Document' },
  { value: 'historical_record', label: 'Historical Record' },
  { value: 'textbook', label: 'Textbook' },
  { value: 'other', label: 'Other' },
] as const;
