'use client';

import { useCallback, useState, useTransition } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Plus, Search } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

import { refusalMessage, unwrap } from '@kit/next/action-result';

import {
  deleteFactAction,
  disputeFactAction,
  verifyFactAction,
} from '../../server/fact-actions';
import type { MappedFact } from '../../server/fact-row-mapper';
import { FactCard } from './fact-card';
import {
  CATEGORY_OPTIONS,
  STATUS_OPTIONS,
  isReviewable,
} from './fact-constants';
import { FactVerificationDialog } from './fact-verification-dialog';

interface FactLibraryProps {
  facts: MappedFact[];
  total: number;
  basePath: string;
  projectId: string;
  /**
   * Whether the viewer is an owner or admin of the project, who alone may
   * verify, dispute or delete a fact. Only hides the controls; the database
   * refuses everyone else regardless.
   */
  canReview: boolean;
}

export function FactLibrary({
  facts,
  total,
  basePath,
  projectId,
  canReview,
}: FactLibraryProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');

  // Verification dialog state
  const [verifyingFact, setVerifyingFact] = useState<MappedFact | null>(null);

  // Delete confirmation dialog state
  const [deletingFactId, setDeletingFactId] = useState<string | null>(null);

  const handleSearch = useCallback(
    (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const params = new URLSearchParams();

      if (searchQuery) params.set('q', searchQuery);
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (selectedStatus !== 'all') params.set('status', selectedStatus);

      const qs = params.toString();
      router.push(`${basePath}${qs ? `?${qs}` : ''}`);
    },
    [searchQuery, selectedCategory, selectedStatus, basePath, router],
  );

  // These reject on a refusal, so the dialog can stay open with the notes
  // the user typed and show why (KB-18).
  const handleVerify = useCallback(
    async (factId: string, notes: string) => {
      await unwrap(
        verifyFactAction({
          factId,
          projectId,
          basePath,
          verificationNotes: notes,
        }),
      );
      toast.success('Fact verified');
      router.refresh();
    },
    [projectId, basePath, router],
  );

  const handleDispute = useCallback(
    async (factId: string, reason: string) => {
      await unwrap(
        disputeFactAction({
          factId,
          projectId,
          basePath,
          disputeReason: reason,
        }),
      );
      toast.success('Fact marked as disputed');
      router.refresh();
    },
    [projectId, basePath, router],
  );

  const confirmDelete = useCallback(
    async (factId: string) => {
      startTransition(async () => {
        try {
          await unwrap(deleteFactAction({ factId, projectId, basePath }));
          toast.success('Fact deleted');
          router.refresh();
        } catch (error) {
          toast.error(
            refusalMessage(error, 'Could not delete the fact. Try again.'),
          );
        } finally {
          setDeletingFactId(null);
        }
      });
    },
    [projectId, basePath, router],
  );

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <form onSubmit={handleSearch} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search facts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedStatus} onValueChange={setSelectedStatus}>
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex gap-2">
          <Button type="submit" variant="secondary" disabled={isPending}>
            Search
          </Button>
          <Button asChild>
            <Link href={`${basePath}/add`}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Fact
            </Link>
          </Button>
        </div>
      </form>

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {total} fact{total !== 1 ? 's' : ''} found
      </p>

      {/* Fact List */}
      {facts.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          <p className="mb-2 text-lg">No facts yet</p>
          <p className="text-sm">
            Add verified facts to build your documentary&apos;s knowledge base.
          </p>
          <Button asChild className="mt-4">
            <Link href={`${basePath}/add`}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Your First Fact
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {facts.map((fact) => (
            <FactCard
              key={fact.id}
              fact={fact}
              basePath={basePath}
              onVerify={
                canReview && isReviewable(fact.verificationStatus)
                  ? () => setVerifyingFact(fact)
                  : undefined
              }
              onDelete={
                canReview ? () => setDeletingFactId(fact.id) : undefined
              }
            />
          ))}
        </div>
      )}

      {/* Verification Dialog */}
      {verifyingFact && (
        <FactVerificationDialog
          key={verifyingFact.id}
          fact={verifyingFact}
          open={!!verifyingFact}
          onOpenChange={(open) => {
            if (!open) setVerifyingFact(null);
          }}
          onVerify={handleVerify}
          onDispute={handleDispute}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!deletingFactId}
        onOpenChange={(open) => {
          if (!open) setDeletingFactId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Fact</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this fact? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deletingFactId) {
                  confirmDelete(deletingFactId);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
