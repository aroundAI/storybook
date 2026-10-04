'use client';

import type { ReactNode } from 'react';

import { useFormContext } from 'react-hook-form';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Switch } from '@kit/ui/switch';

/**
 * The field shapes the FILM-2004 Brand and Edit policy forms repeat. Each
 * reads the form from context and is controlled: a Radix Select left
 * uncontrolled keeps its label across reset() (CLAUDE.md, FILM-1609).
 */

interface FieldProps {
  name: string;
  label: ReactNode;
  description?: ReactNode;
  dataTest: string;
}

export function NumberField({
  name,
  label,
  description,
  dataTest,
  step = 1,
  nullable = false,
  placeholder,
}: FieldProps & { step?: number; nullable?: boolean; placeholder?: string }) {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              step={step}
              inputMode="decimal"
              data-test={dataTest}
              placeholder={placeholder}
              name={field.name}
              ref={field.ref}
              onBlur={field.onBlur}
              value={
                typeof field.value === 'number' && !Number.isNaN(field.value)
                  ? field.value
                  : ''
              }
              onChange={(event) =>
                field.onChange(
                  event.target.value === '' && nullable
                    ? null
                    : event.target.valueAsNumber,
                )
              }
            />
          </FormControl>
          {description ? (
            <FormDescription>{description}</FormDescription>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function TextField({ name, label, description, dataTest }: FieldProps) {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input data-test={dataTest} {...field} value={field.value ?? ''} />
          </FormControl>
          {description ? (
            <FormDescription>{description}</FormDescription>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SelectField({
  name,
  label,
  description,
  dataTest,
  options,
}: FieldProps & { options: ReadonlyArray<{ value: string; label: string }> }) {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <Select value={field.value ?? ''} onValueChange={field.onChange}>
            <FormControl>
              <SelectTrigger data-test={dataTest}>
                <SelectValue />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {options.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  data-test={`${dataTest}-${option.value}`}
                >
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {description ? (
            <FormDescription>{description}</FormDescription>
          ) : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SwitchField({
  name,
  label,
  description,
  dataTest,
}: FieldProps) {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <FormLabel>{label}</FormLabel>
            {description ? (
              <FormDescription>{description}</FormDescription>
            ) : null}
          </div>
          <FormControl>
            <Switch
              data-test={dataTest}
              checked={field.value === true}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </FormItem>
      )}
    />
  );
}

/** A hex colour: a swatch picker and the text it writes, one value. */
export function ColorField({ name, label, description, dataTest }: FieldProps) {
  const { control } = useFormContext();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = typeof field.value === 'string' ? field.value : '';
        const swatch = /^#[0-9a-fA-F]{6}/.test(value)
          ? value.slice(0, 7)
          : '#000000';

        return (
          <FormItem>
            <FormLabel>{label}</FormLabel>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`${typeof label === 'string' ? label : name} swatch`}
                data-test={`${dataTest}-swatch`}
                className="h-9 w-10 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
                value={swatch}
                onChange={(event) =>
                  field.onChange(
                    event.target.value.toUpperCase() + value.slice(7),
                  )
                }
              />
              <FormControl>
                <Input
                  data-test={dataTest}
                  className="font-mono"
                  {...field}
                  value={value}
                />
              </FormControl>
            </div>
            {description ? (
              <FormDescription>{description}</FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
