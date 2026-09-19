'use client';

import * as React from 'react';
import { useCallback } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
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
import { RadioGroup, RadioGroupItem } from '@kit/ui/radio-group';
import { Textarea } from '@kit/ui/textarea';

import {
  VoiceCloneConsentSchema,
  type VoiceCloneConsentSchemaType,
} from '../lib/schemas';

const DEFAULT_CONSENT_TEXT = `I hereby confirm that:

1. I am the owner of the voice used in the audio samples, OR I have explicit written permission from the voice owner to create an AI voice clone.

2. I understand that this voice clone will be used for generating synthetic speech.

3. I agree to use the cloned voice responsibly and in accordance with applicable laws and regulations.

4. I will not use this voice clone for any fraudulent, deceptive, or harmful purposes.

5. I understand that I can request deletion of this voice clone at any time.`;

export interface ConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConsent: (consent: VoiceCloneConsentSchemaType) => void;
  isLoading?: boolean;
}

export function ConsentDialog({
  open,
  onOpenChange,
  onConsent,
  isLoading = false,
}: ConsentDialogProps) {
  const form = useForm({
    resolver: zodResolver(VoiceCloneConsentSchema),
    defaultValues: {
      consenterName: '',
      consenterEmail: '',
      consentType: 'self' as const,
      consentText: DEFAULT_CONSENT_TEXT,
      consentSignature: '',
    },
  });

  const handleSubmit = useCallback(
    (data: VoiceCloneConsentSchemaType) => {
      onConsent(data);
    },
    [onConsent],
  );

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!isLoading) {
        onOpenChange(newOpen);
        if (!newOpen) {
          form.reset();
        }
      }
    },
    [isLoading, onOpenChange, form],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>Voice Cloning Consent</DialogTitle>
          <DialogDescription>
            Please review and acknowledge the consent requirements before
            proceeding with voice cloning.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-6"
          >
            <FormField
              control={form.control}
              name="consentType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Voice Ownership</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex flex-col space-y-2"
                    >
                      <FormItem className="flex items-center space-y-0 space-x-3">
                        <FormControl>
                          <RadioGroupItem value="self" />
                        </FormControl>
                        <FormLabel className="font-normal">
                          This is my own voice
                        </FormLabel>
                      </FormItem>
                      <FormItem className="flex items-center space-y-0 space-x-3">
                        <FormControl>
                          <RadioGroupItem value="other_authorized" />
                        </FormControl>
                        <FormLabel className="font-normal">
                          I have authorization from the voice owner
                        </FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consenterName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your full name" {...field} />
                  </FormControl>
                  <FormDescription>
                    The name of the person providing consent
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consenterEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="your@email.com"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    For consent confirmation and future communications
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consentText"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Consent Agreement</FormLabel>
                  <FormControl>
                    <Textarea
                      className="min-h-[180px] font-mono text-sm"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Please read and acknowledge the terms above
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consentSignature"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Digital Signature (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Type your name to sign"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormDescription>
                    By typing your name, you confirm you have read and agree to
                    the terms
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? 'Processing...' : 'I Agree & Continue'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

ConsentDialog.displayName = 'ConsentDialog';
