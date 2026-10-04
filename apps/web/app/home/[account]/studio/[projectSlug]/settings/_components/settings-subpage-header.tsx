import type { ReactNode } from 'react';

import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import { Alert, AlertDescription } from '@kit/ui/alert';

/** The header of a project settings sub-page (FILM-2004 Brand, Edit policy). */
export function SettingsSubpageHeader({
  account,
  projectSlug,
  projectName,
  title,
  description,
  icon,
  canManage,
}: {
  account: string;
  projectSlug: string;
  projectName: string;
  title: string;
  description: ReactNode;
  icon: ReactNode;
  canManage: boolean;
}) {
  return (
    <header className="space-y-3 border-b border-border bg-card px-6 py-4">
      <Link
        href={`/home/${account}/studio/${projectSlug}/settings`}
        className="inline-flex items-center text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {projectName} settings
      </Link>
      <div className="flex items-center gap-3">
        {icon}
        <h1 className="text-xl font-bold text-foreground">{title}</h1>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      {canManage ? null : (
        <Alert data-test="settings-read-only">
          <AlertDescription>
            You can view these settings. Changing them needs a project owner or
            admin role and the team&apos;s settings permission.
          </AlertDescription>
        </Alert>
      )}
    </header>
  );
}
