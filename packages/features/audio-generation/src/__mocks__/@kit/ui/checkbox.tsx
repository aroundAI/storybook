import * as React from 'react';

interface CheckboxProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    'checked' | 'onChange'
  > {
  checked?: boolean | 'indeterminate';
  onCheckedChange?: (checked: boolean) => void;
  'data-test'?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  ...props
}: CheckboxProps) {
  return (
    <input
      type="checkbox"
      checked={checked === true}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      role="checkbox"
      {...props}
    />
  );
}
