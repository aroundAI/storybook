'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import type { McpConnectionSummary } from '@kit/studio-mcp';
import {
  STORYBOOKSTUDIO_CLIENT_ID,
  STORYBOOKSTUDIO_CLIENT_NAME,
} from '@kit/studio-mcp/desktop-client';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@kit/ui/alert-dialog';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import { revokeMcpConnectionAction } from '../_lib/server/actions';

const KIND_LABEL = {
  pat: 'Personal access token',
  oauth: 'OAuth app',
} as const;

/**
 * The signed-in user's connections on this team: personal access tokens
 * today, OAuth consents once FILM-1907 lands (they are the same rows).
 */
export function McpConnectionsList(props: {
  accountSlug: string;
  connections: McpConnectionSummary[];
}) {
  return (
    <Card data-test="mcp-connections-card">
      <CardHeader>
        <CardTitle>Your connections</CardTitle>
        <CardDescription>
          Each row is one app or token acting as you in this team. Revoking one
          refuses its next call.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {props.connections.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-test="mcp-connections-empty"
          >
            No connections yet.
          </p>
        ) : (
          <Table data-test="mcp-connections-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {props.connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  accountSlug={props.accountSlug}
                  connection={connection}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function ConnectionRow(props: {
  accountSlug: string;
  connection: McpConnectionSummary;
}) {
  const { connection } = props;
  const revoked = connection.revokedAt !== null;

  return (
    <TableRow data-test="mcp-connection-row" data-connection-id={connection.id}>
      <TableCell className="font-medium">
        <span className="block" data-test="mcp-connection-name">
          {connection.name}
        </span>
        {connection.clientId === STORYBOOKSTUDIO_CLIENT_ID ? (
          <span
            className="block text-xs font-normal text-muted-foreground"
            data-test="mcp-connection-desktop-app"
          >
            {STORYBOOKSTUDIO_CLIENT_NAME} desktop app
          </span>
        ) : null}
      </TableCell>
      <TableCell>{KIND_LABEL[connection.kind]}</TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1" data-test="mcp-connection-scopes">
          {connection.scopes.map((scope) => (
            <Badge key={scope} variant="outline">
              {scope}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {connection.lastUsedAt
          ? new Date(connection.lastUsedAt).toLocaleString()
          : 'Never'}
      </TableCell>
      <TableCell data-test="mcp-connection-status">
        {revoked ? (
          <Badge variant="secondary">Revoked</Badge>
        ) : (
          <Badge>Active</Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        {revoked ? null : (
          <RevokeButton
            accountSlug={props.accountSlug}
            connectionId={connection.id}
            name={connection.name}
          />
        )}
      </TableCell>
    </TableRow>
  );
}

function RevokeButton(props: {
  accountSlug: string;
  connectionId: string;
  name: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const revoke = () => {
    startTransition(async () => {
      try {
        await unwrap(
          revokeMcpConnectionAction({
            accountSlug: props.accountSlug,
            connectionId: props.connectionId,
          }),
        );
        toast.success(`Revoked “${props.name}”`);
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, 'Could not revoke the connection.'));
      }
    });
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          disabled={isPending}
          data-test="mcp-connection-revoke"
        >
          {isPending ? 'Revoking…' : 'Revoke'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke “{props.name}”?</AlertDialogTitle>
          <AlertDialogDescription>
            Any client holding this token is refused from its next call. This
            cannot be undone; create a new token instead.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-test="mcp-connection-revoke-cancel">
            Keep it
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={revoke}
            data-test="mcp-connection-revoke-confirm"
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
