'use client';

import { useState } from 'react';

import type { Control, FieldPath, FieldValues } from 'react-hook-form';

import { parseOptionalInteger } from '@kit/content-analytics/lib/ypp-targets';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';

/**
 * A whole-number setting that may be left blank to inherit.
 *
 * One component rather than the same handful of lines at each of the five
 * places a target is edited — the empty-means-null rule is the thing most
 * likely to be got subtly wrong, so it exists once.
 *
 * `type="text"` with `inputMode="numeric"`, not `type="number"`. The number
 * widget reports an empty string for any invalid intermediate state, so a
 * partially typed or pasted value is indistinguishable from a cleared field
 * — and "cleared" is a meaningful, persisted instruction here.
 */
export function OverrideNumberField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder,
  dataTest,
  disabled,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label: string;
  description: string;
  placeholder: string;
  dataTest: string;
  disabled?: boolean;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <NumericInput
              initial={field.value as number | null}
              onParsed={field.onChange}
              placeholder={placeholder}
              dataTest={dataTest}
              disabled={disabled}
            />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function NumericInput({
  initial,
  onParsed,
  placeholder,
  dataTest,
  disabled,
}: {
  initial: number | null;
  onParsed: (value: number | null) => void;
  placeholder: string;
  dataTest: string;
  disabled?: boolean;
}) {
  // The text the user sees is held here rather than derived from form state,
  // so a value the schema rejects still renders as typed. Deriving it would
  // reproduce the FILM-1609 defect in reverse: paste `1,250`, watch the box
  // snap to `0`, and lose what you typed.
  const [text, setText] = useState(initial === null ? '' : String(initial));

  return (
    <Input
      type={'text'}
      inputMode={'numeric'}
      autoComplete={'off'}
      value={text}
      placeholder={placeholder}
      disabled={disabled}
      data-test={dataTest}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);

        const parsed = parseOptionalInteger(raw);

        // `undefined` means the text is not a usable number. Writing 0 hands
        // the schema a value its `.positive()` rejects, so the user gets the
        // field's own message instead of a silent no-op — the same trick
        // `parseAmountToCents` plays with `min(1)`.
        onParsed(parsed === undefined ? 0 : parsed);
      }}
    />
  );
}
