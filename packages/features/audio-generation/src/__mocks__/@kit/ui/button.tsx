import * as React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  'data-test'?: string;
  variant?: string;
  size?: string;
}

export function Button({
  children,
  disabled,
  onClick,
  variant: _variant,
  size: _size,
  ...props
}: ButtonProps) {
  return (
    <button disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  );
}
