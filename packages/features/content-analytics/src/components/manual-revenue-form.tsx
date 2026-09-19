'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { CalendarIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@kit/ui/button';
import { Calendar } from '@kit/ui/calendar';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import {
  formatLocalDate,
  manualRevenueDefaults,
  parseAmountToCents,
  parseLocalDate,
} from '../lib/manual-revenue';
import { MANUAL_ENTRY_CATEGORIES } from '../lib/revenue-mix';
import { AddManualRevenueSchema } from '../lib/schemas/revenue.schema';
import { addManualRevenueAction } from '../server/revenue-actions';
// Type-only, so nothing server-side is pulled into the client bundle. The
// point of naming it is exhaustiveness: a new refusal reason fails to compile
// until it has a sentence.
import type { AddManualRevenueResult } from '../server/revenue-actions';

interface Publish {
  id: string;
  title: string;
  platform: string;
}

interface ManualRevenueFormProps {
  accountId: string;
  publishes?: Publish[];
  onSuccess?: () => void;
}

/** Sentinel for "no video": Radix Select cannot hold an empty value. */
const CHANNEL_LEVEL = '__channel__';

/**
 * One sentence per refusal, because who can unblock the caller differs and
 * telling a project member to find an account owner sends them to the wrong
 * person. Written here rather than thrown from the action: Next masks Server
 * Action error messages in a production build.
 */
const REFUSAL_MESSAGE: Record<
  Exclude<AddManualRevenueResult, { ok: true }>['reason'],
  string
> = {
  not_yours:
    'An entry already exists for this date and category, and only the person who added it, or an account owner, can change it. Ask one of them, or use a different category.',
  project_role:
    'An entry already exists for this date and category, and only someone with access to this video’s project can change it.',
  no_access:
    'You do not have access to record revenue here. Ask an account owner, or someone on this video’s project.',
  conflict:
    'Someone just saved an entry for this date and category. Your figure was not recorded — check with them before entering it again.',
};

export function ManualRevenueForm({
  accountId,
  publishes = [],
  onSuccess,
}: ManualRevenueFormProps) {
  /**
   * The amount as typed. Kept beside form state rather than derived from
   * it: deriving `250.50` back out of 25050 cents drops the trailing zero
   * mid-keystroke. Cleared where reset happens, so the two cannot drift.
   */
  const [amountText, setAmountText] = useState('');

  const form = useForm({
    resolver: zodResolver(AddManualRevenueSchema),
    defaultValues: manualRevenueDefaults(accountId),
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(data: z.infer<typeof AddManualRevenueSchema>) {
    try {
      // One scope, and the action enforces it too — this is a server
      // action, so the form is not its only possible caller.
      const result = await addManualRevenueAction({
        ...data,
        publishId: data.publishId || undefined,
        accountId: data.publishId ? undefined : accountId,
        currency: data.currency || 'USD',
      });

      // The reason comes back as a value and the sentence is written here,
      // because Next masks Server Action error messages in a production
      // build — a thrown explanation reaches the user as a digest.
      //
      // One sentence per branch: who can unblock the caller differs, and
      // telling a project member to find an account owner sends them to the
      // wrong person.
      if (!result.ok) {
        toast.error(REFUSAL_MESSAGE[result.reason]);

        return;
      }

      toast.success('Revenue entry added successfully');
      form.reset(manualRevenueDefaults(accountId));
      setAmountText('');
      onSuccess?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add revenue entry',
      );
    }
  }

  // Convert dollar input to cents
  const handleAmountChange = (value: string) => {
    setAmountText(value);

    const cents = parseAmountToCents(value);

    // Anything that is not a whole-string amount is *no amount*, never a
    // parsed prefix: `1,250.00` must not become $1.00. It lands as 0, which
    // the schema rejects with a message covering both an empty field and a
    // malformed one — a setError here would be replaced by the resolver the
    // moment submit re-validates.
    form.setValue('revenueCents', cents ?? 0, { shouldValidate: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Manual Revenue</CardTitle>
        <CardDescription>
          Enter revenue data for platforms without automatic API integration
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-6"
            data-test="manual-revenue-form"
          >
            <FormField
              control={form.control}
              name="publishId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Published Content</FormLabel>
                  {/*
                    Controlled, like the category Select below. With
                    `defaultValue` Radix owns the displayed value, so after
                    form.reset() the trigger kept showing the last video
                    while form state said undefined — the next entry would
                    be written as channel-level revenue under a label
                    naming a video.
                  */}
                  <Select
                    onValueChange={(value) =>
                      field.onChange(
                        value === CHANNEL_LEVEL ? undefined : value,
                      )
                    }
                    value={field.value ?? CHANNEL_LEVEL}
                  >
                    <FormControl>
                      <SelectTrigger data-test="revenue-publish-trigger">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {/*
                        Always offered, and the default. Sponsorship,
                        product and licensing income often belongs to the
                        channel rather than to one video — the schema has
                        always allowed it, but with no option here the path
                        was unreachable from the UI.
                      */}
                      <SelectItem value={CHANNEL_LEVEL}>
                        Whole channel (not one video)
                      </SelectItem>

                      {publishes.length === 0 ? (
                        <SelectItem value="none" disabled>
                          No published content available
                        </SelectItem>
                      ) : (
                        publishes.map((publish) => (
                          <SelectItem key={publish.id} value={publish.id}>
                            <span className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground capitalize">
                                [{publish.platform}]
                              </span>
                              {publish.title}
                            </span>
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {publishes.length === 0
                      ? 'Recorded against the whole channel. Per-video entry arrives with the publish list (FILM-1611).'
                      : 'Select the content this revenue is associated with'}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Date</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          data-test="revenue-date-trigger"
                          className={cn(
                            'w-[240px] pl-3 text-left font-normal',
                            !field.value && 'text-muted-foreground',
                          )}
                        >
                          {parseLocalDate(field.value) ? (
                            format(parseLocalDate(field.value)!, 'PPP')
                          ) : (
                            <span>Pick a date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      {/*
                        The form field is the single source of truth. A
                        mirrored `selectedDate` plus a one-way useEffect
                        drifted: react-day-picker toggles, so clicking the
                        selected day again calls onSelect(undefined), which
                        the effect ignored — the calendar showed nothing
                        selected while the entry still submitted under the
                        old date.
                      */}
                      <Calendar
                        mode="single"
                        selected={parseLocalDate(field.value) ?? undefined}
                        onSelect={(date) =>
                          field.onChange(date ? formatLocalDate(date) : '')
                        }
                        disabled={(date) =>
                          date > new Date() || date < new Date('2020-01-01')
                        }
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormDescription>
                    The date this revenue was earned
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              {/*
                Registered through FormField, and the text is controlled.
                Previously this was a bare FormItem writing to form state
                only via setValue, so form.reset() zeroed revenueCents
                while the input kept showing the typed amount — the next
                submit wrote a 0 row, which the schema accepts. It also had
                no FormMessage, so any error on this field was invisible.
              */}
              <FormField
                control={form.control}
                name="revenueCents"
                render={() => (
                  <FormItem>
                    <FormLabel>Amount (USD)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">
                          $
                        </span>
                        {/*
                          text + inputMode, not type="number": a number
                          input returns '' for a mid-edit value like '12.',
                          so amountText became '' and revenueCents became 0
                          while the field still displayed 12. — React
                          rewrites nothing, both sides being ''. Parsing the
                          raw string ourselves keeps the two in step.
                        */}
                        <Input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="pl-7"
                          data-test="revenue-amount-input"
                          value={amountText}
                          onChange={(e) => handleAmountChange(e.target.value)}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>Revenue amount in dollars</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-test="revenue-currency-trigger">
                          <SelectValue placeholder="Select currency" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="USD">USD - US Dollar</SelectItem>
                        <SelectItem value="EUR">EUR - Euro</SelectItem>
                        <SelectItem value="GBP">GBP - British Pound</SelectItem>
                        <SelectItem value="CAD">
                          CAD - Canadian Dollar
                        </SelectItem>
                        <SelectItem value="AUD">
                          AUD - Australian Dollar
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-test="revenue-category-trigger">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {MANUAL_ENTRY_CATEGORIES.map(({ value, label }) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Tracked so the revenue mix — ads falling as a share of the
                    total — stays measurable. One entry per date and category:
                    saving again for the same pair <strong>replaces</strong> the
                    earlier amount rather than adding to it.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Add any notes about this revenue entry..."
                      className="resize-none"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={isSubmitting}
              data-test="revenue-submit"
            >
              {isSubmitting && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Add Revenue Entry
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
