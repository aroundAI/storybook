'use client';

/**
 * Dual Range Slider - Double-handle slider for trim range selection
 *
 * Uses standard Slider with dual values for selecting in/out points.
 */
import { Slider } from '@kit/ui/slider';
import { cn } from '@kit/ui/utils';

interface DualRangeSliderProps {
  /** Current [start, end] values */
  value: [number, number];
  /** Minimum value */
  min: number;
  /** Maximum value */
  max: number;
  /** Step increment */
  step?: number;
  /** Callback when values change */
  onValueChange: (value: [number, number]) => void;
  /** Additional CSS classes */
  className?: string;
  /** Whether the slider is disabled */
  disabled?: boolean;
}

export function DualRangeSlider({
  value,
  min,
  max,
  step = 1,
  onValueChange,
  className,
  disabled = false,
}: DualRangeSliderProps) {
  return (
    <Slider
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(values) => {
        if (values.length >= 2) {
          onValueChange([values[0] ?? min, values[1] ?? max]);
        }
      }}
      disabled={disabled}
      className={cn('w-full', className)}
    />
  );
}
