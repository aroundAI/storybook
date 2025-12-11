import * as React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  'data-test'?: string;
}

export function Input(props: InputProps) {
  return <input {...props} />;
}
