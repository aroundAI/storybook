'use client';

import { useState } from 'react';

import { Check, Copy } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';

/**
 * The one time a token is visible. Dismissing it is the user's confirmation
 * that they copied it; nothing can show it again, because only its hash is
 * stored.
 */
export function NewTokenReveal(props: {
  token: string;
  name: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Alert data-test="pat-reveal">
      <AlertTitle>Copy your token for “{props.name}” now</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          This is the only time it is shown. Send it as{' '}
          <code>Authorization: Bearer …</code> to <code>/api/mcp</code>.
        </p>

        <code
          className="block rounded bg-muted px-3 py-2 font-mono text-sm break-all"
          data-test="pat-reveal-token"
        >
          {props.token}
        </code>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={copy}
            data-test="pat-reveal-copy"
          >
            {copied ? (
              <Check className="mr-2 h-4 w-4" />
            ) : (
              <Copy className="mr-2 h-4 w-4" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={props.onDismiss}
            data-test="pat-reveal-dismiss"
          >
            I have saved it
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
