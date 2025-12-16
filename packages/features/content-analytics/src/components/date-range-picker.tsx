'use client';

import { useCallback, useMemo } from 'react';

import { format, startOfMonth, startOfYear, subDays } from 'date-fns';
import { CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { Button } from '@kit/ui/button';
import { Calendar } from '@kit/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { cn } from '@kit/ui/utils';

export interface DateRangeValue {
  from: Date;
  to: Date;
}

interface DateRangePickerProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
}

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'This month', type: 'month' as const },
  { label: 'Year to date', type: 'ytd' as const },
];

export function DateRangePicker({
  value,
  onChange,
  className,
}: DateRangePickerProps) {
  const dateRange: DateRange = useMemo(
    () => ({
      from: value.from,
      to: value.to,
    }),
    [value],
  );

  const handleSelect = useCallback(
    (range: DateRange | undefined) => {
      if (range?.from && range?.to) {
        onChange({ from: range.from, to: range.to });
      } else if (range?.from) {
        onChange({ from: range.from, to: range.from });
      }
    },
    [onChange],
  );

  const handlePresetClick = useCallback(
    (preset: (typeof PRESETS)[number]) => {
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      let from: Date;
      const to = today;

      if ('days' in preset && preset.days !== undefined) {
        from = subDays(today, preset.days - 1);
      } else if ('type' in preset && preset.type === 'month') {
        from = startOfMonth(today);
      } else {
        from = startOfYear(today);
      }

      from.setHours(0, 0, 0, 0);
      onChange({ from, to });
    },
    [onChange],
  );

  const displayValue = useMemo(() => {
    if (value.from && value.to) {
      return `${format(value.from, 'LLL dd, y')} - ${format(value.to, 'LLL dd, y')}`;
    }
    return 'Pick a date range';
  }, [value]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-[280px] justify-start text-left font-normal',
            !value.from && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayValue}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex">
          <div className="border-r p-2">
            <div className="space-y-1">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handlePresetClick(preset)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
          <Calendar
            mode="range"
            defaultMonth={value.from}
            selected={dateRange}
            onSelect={handleSelect}
            numberOfMonths={2}
            disabled={{ after: new Date() }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
