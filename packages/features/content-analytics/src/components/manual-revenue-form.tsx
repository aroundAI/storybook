'use client';

import { useEffect, useState } from 'react';

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

import { manualRevenueDefaults } from '../lib/manual-revenue';
import { REVENUE_CATEGORY_LABELS } from '../lib/revenue-mix';
import { AddManualRevenueSchema } from '../lib/schemas/revenue.schema';
import { addManualRevenueAction } from '../server/revenue-actions';

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

export function ManualRevenueForm({
  accountId,
  publishes = [],
  onSuccess,
}: ManualRevenueFormProps) {
  const [selectedDate, setSelectedDate] = useState<Date>();
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

  // Update date field when calendar selection changes
  useEffect(() => {
    if (selectedDate) {
      form.setValue('date', format(selectedDate, 'yyyy-MM-dd'));
    }
  }, [selectedDate, form]);

  async function onSubmit(data: z.infer<typeof AddManualRevenueSchema>) {
    try {
      // Exactly one scope reaches the action. revenue_records' unique
      // index is on coalesce(publish_id, account_id), so sending both
      // would attach the row to a video *and* to the channel.
      await addManualRevenueAction({
        ...data,
        publishId: data.publishId || undefined,
        accountId: data.publishId ? undefined : accountId,
        currency: data.currency || 'USD',
      });
      toast.success('Revenue entry added successfully');
      form.reset(manualRevenueDefaults(accountId));
      setSelectedDate(undefined);
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

    // Non-numeric is *no amount*, which the schema rejects — not zero,
    // which it would once have accepted and written over a real figure.
    const dollars = Number.parseFloat(value);
    const cents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;

    form.setValue('revenueCents', cents, { shouldValidate: true });
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
                              <span className="text-muted-foreground text-xs capitalize">
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
                    Select the content this revenue is associated with
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
                          {field.value ? (
                            format(new Date(field.value), 'PPP')
                          ) : (
                            <span>Pick a date</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={setSelectedDate}
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
                        <span className="text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2">
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
                      {REVENUE_CATEGORY_LABELS.map(({ value, label }) => (
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
