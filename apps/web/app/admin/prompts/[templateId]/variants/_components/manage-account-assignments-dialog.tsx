'use client';

import { useState, useTransition } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@kit/ui/dialog';
import { Button } from '@kit/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import { Checkbox } from '@kit/ui/checkbox';
import { SettingsIcon, Loader2Icon } from 'lucide-react';
import { toast } from '@kit/ui/sonner';
import { useRouter } from 'next/navigation';
import {
  assignVariantToAccountAction,
  unassignVariantFromAccountAction,
} from '@kit/prompt-templates/mutations';

interface ManageAccountAssignmentsDialogProps {
  variantId: string;
  currentAssignments: Array<{
    id: string;
    account: {
      id: string;
      name: string;
      slug: string | null;
      picture_url: string | null;
    } | null;
  }>;
}

// This would normally come from a server action or API
// For now, we'll fetch it client-side using a hook
function useAccounts() {
  // TODO: Implement proper account fetching
  // This is a placeholder - in real implementation, fetch from server
  const [accounts] = useState<
    Array<{
      id: string;
      name: string;
      slug: string | null;
      picture_url: string | null;
    }>
  >([]);

  return { accounts, isLoading: false };
}

export function ManageAccountAssignmentsDialog({
  variantId,
  currentAssignments,
}: ManageAccountAssignmentsDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    new Set(
      currentAssignments
        .map((a) => a.account?.id)
        .filter((id): id is string => id !== null && id !== undefined),
    ),
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { accounts, isLoading } = useAccounts();

  const handleToggleAccount = (accountId: string) => {
    const newSelection = new Set(selectedAccountIds);
    if (newSelection.has(accountId)) {
      newSelection.delete(accountId);
    } else {
      newSelection.add(accountId);
    }
    setSelectedAccountIds(newSelection);
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        const currentIds = new Set(
          currentAssignments
            .map((a) => a.account?.id)
            .filter((id): id is string => id !== null && id !== undefined),
        );

        // Find accounts to assign (in selected but not in current)
        const toAssign = Array.from(selectedAccountIds).filter(
          (id) => !currentIds.has(id),
        );

        // Find accounts to unassign (in current but not in selected)
        const toUnassign = Array.from(currentIds).filter(
          (id) => !selectedAccountIds.has(id),
        );

        // Execute assignments
        for (const accountId of toAssign) {
          await assignVariantToAccountAction({
            variant_id: variantId,
            account_id: accountId,
          });
        }

        // Execute unassignments
        for (const accountId of toUnassign) {
          await unassignVariantFromAccountAction({
            variant_id: variantId,
            account_id: accountId,
          });
        }

        toast.success('Account assignments updated');
        router.refresh();
        setOpen(false);
      } catch (error) {
        toast.error('Failed to update assignments');
        console.error(error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <SettingsIcon className="mr-2 h-4 w-4" />
          Manage
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Manage Account Assignments</DialogTitle>
          <DialogDescription>
            Select which accounts should use this variant. Assigned accounts
            will always receive this variant (no traffic randomization).
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2Icon className="h-6 w-6 animate-spin" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
              No accounts available
            </div>
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted"
                >
                  <Checkbox
                    id={`account-${account.id}`}
                    checked={selectedAccountIds.has(account.id)}
                    onCheckedChange={() => handleToggleAccount(account.id)}
                  />
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={account.picture_url || ''} />
                    <AvatarFallback>
                      {account.name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{account.name}</p>
                    {account.slug && (
                      <p className="text-muted-foreground text-xs">
                        {account.slug}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
