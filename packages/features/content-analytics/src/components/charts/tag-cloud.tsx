'use client';

interface TagCloudProps {
  /** Array of tags to display */
  tags: string[];
  /** Color scheme - predefined color classes for variety */
  colorScheme?: 'default' | 'monochrome';
  /** Optional className */
  className?: string;
}

// Predefined color schemes for tags
const TAG_COLORS = [
  'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300',
  'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
  'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
  'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
  'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
];

const MONOCHROME_COLOR =
  'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300';

/**
 * Tag cloud with colored pills - used for audience interests
 */
export function TagCloud({
  tags,
  colorScheme = 'default',
  className = '',
}: TagCloudProps) {
  if (!tags || tags.length === 0) {
    return null;
  }

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {tags.map((tag, index) => {
        const colorClass =
          colorScheme === 'monochrome'
            ? MONOCHROME_COLOR
            : TAG_COLORS[index % TAG_COLORS.length];

        return (
          <span
            key={index}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${colorClass}`}
          >
            {tag}
          </span>
        );
      })}
    </div>
  );
}

interface InterestTag {
  name: string;
  color?: string;
}

interface TagCloudWithAffinityProps {
  /** Tags to display */
  tags: InterestTag[] | string[];
  /** Content affinity data */
  affinity?: {
    label: string;
    description: string;
    thumbnailUrl?: string;
  };
  /** Optional className */
  className?: string;
}

/**
 * Tag cloud with content affinity section - matches Audience prototype
 */
export function TagCloudWithAffinity({
  tags,
  affinity,
  className = '',
}: TagCloudWithAffinityProps) {
  const normalizedTags = tags.map((t) => (typeof t === 'string' ? t : t.name));

  return (
    <div className={className}>
      <TagCloud tags={normalizedTags} />
      {affinity && (
        <div className="mt-6">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Content Affinity
          </h4>
          <div className="flex items-center gap-3">
            {affinity.thumbnailUrl ? (
              <img
                src={affinity.thumbnailUrl}
                alt={affinity.label}
                className="h-12 w-12 rounded object-cover"
              />
            ) : (
              <div className="h-12 w-12 rounded bg-gray-200 dark:bg-gray-700" />
            )}
            <div>
              <p className="font-medium text-gray-900 dark:text-white">
                {affinity.label}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {affinity.description}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
