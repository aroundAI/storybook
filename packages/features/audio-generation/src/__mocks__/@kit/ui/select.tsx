import * as React from 'react';

interface SelectProps {
  children: React.ReactNode;
  value?: string;
  onValueChange?: (value: string) => void;
}

interface SelectTriggerProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  'data-test'?: string;
}

export function Select({ children, value }: SelectProps) {
  return <div data-value={value}>{children}</div>;
}

export function SelectTrigger({ children, ...props }: SelectTriggerProps) {
  return (
    <button type="button" {...props}>
      {children}
    </button>
  );
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  return <div role="listbox">{children}</div>;
}

export function SelectItem({
  children,
  value,
}: {
  children: React.ReactNode;
  value: string;
}) {
  return (
    <div role="option" aria-selected={false} data-value={value}>
      {children}
    </div>
  );
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span>{placeholder}</span>;
}
