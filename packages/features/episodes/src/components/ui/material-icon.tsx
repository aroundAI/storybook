import { cn } from '@kit/ui/utils';

export interface MaterialIconProps {
  name: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  filled?: boolean;
}

const sizeClasses = {
  sm: 'text-base',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-3xl',
};

/**
 * MaterialIcon - Renders a Material Symbols icon
 *
 * Uses the Material Symbols Outlined font family.
 * Icon names should be in snake_case (e.g., 'lightbulb', 'menu_book', 'movie_creation')
 *
 * @see https://fonts.google.com/icons for available icons
 */
export function MaterialIcon({
  name,
  className,
  size = 'md',
  filled = false,
}: MaterialIconProps) {
  return (
    <span
      className={cn(
        'material-symbols-outlined select-none leading-none',
        sizeClasses[size],
        filled && 'font-filled',
        className,
      )}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
