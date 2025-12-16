'use client';

import { useEffect, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { CalendarIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';

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

export function ManualRevenueForm({
  publishes = [],
  onSuccess,
}: ManualRevenueFormProps) {
  const [selectedDate, setSelectedDate] = useState<Date>();

  const form = useForm({
    resolver: zodResolver(AddManualRevenueSchema),
    defaultValues: {
      publishId: '',
      date: '',
      revenueCents: 0,
      currency: 'USD',
      notes: '',
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  // Update date field when calendar selection changes
  useEffect(() => {
    if (selectedDate) {
      form.setValue('date', format(selectedDate, 'yyyy-MM-dd'));
    }
  }, [selectedDate, form]);

  async function onSubmit(data: {
    publishId: string;
    date: string;
    revenueCents: number;
    currency: string;
    notes?: string;
  }) {
    try {
      await addManualRevenueAction({
        ...data,
        currency: data.currency || 'USD',
      });
      toast.success('Revenue entry added successfully');
      form.reset();
      setSelectedDate(undefined);
      onSuccess?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to add revenue entry',
      );
    }
  }

  // Convert dollar input to cents
  const handleAmountChange = (value: string) => {
    const dollars = parseFloat(value) || 0;
    form.setValue('revenueCents', Math.round(dollars * 100));
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="publishId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Published Content</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select published content" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
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
              <FormItem>
                <FormLabel>Amount (USD)</FormLabel>
                <FormControl>
                  <div className="relative">
                    <span className="text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2">
                      $
                    </span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      className="pl-7"
                      onChange={(e) => handleAmountChange(e.target.value)}
                    />
                  </div>
                </FormControl>
                <FormDescription>Revenue amount in dollars</FormDescription>
              </FormItem>

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
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

            <Button type="submit" disabled={isSubmitting}>
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
