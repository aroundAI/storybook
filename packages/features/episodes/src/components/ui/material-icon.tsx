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
 * MaterialIcon - Renders a Material Design icon
 *
 * Uses the Material Icons Outlined font family from @material-design-icons/font.
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
        'material-icons-outlined select-none leading-none',
        sizeClasses[size],
        filled && 'material-icons',
        className,
      )}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}
