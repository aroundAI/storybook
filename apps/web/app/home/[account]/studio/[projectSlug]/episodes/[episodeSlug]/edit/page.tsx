import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { withI18n } from '~/lib/i18n/with-i18n';

import { EditRecordView } from './_components/edit-record-view';
import { loadEditRecord } from './_lib/server/edit-record.loader';

interface EditRecordPageProps {
  params: Promise<{
    account: string;
    projectSlug: string;
    episodeSlug: string;
  }>;
}

export async function generateMetadata({
  params,
}: EditRecordPageProps): Promise<Metadata> {
  const record = await loadEditRecord(await params);

  return record
    ? {
        title: `${record.episode.title} - Edit record`,
        description:
          'How this episode was edited in StorybookStudio: versions, changes, renders.',
      }
    : { title: 'Episode Not Found' };
}

/**
 * The Edit record page (FILM-2006): the episode's StorybookStudio edit,
 * read on the server as the signed-in user.
 */
async function EditRecordPage({ params }: EditRecordPageProps) {
  const { account, projectSlug, episodeSlug } = await params;
  const record = await loadEditRecord({ projectSlug, episodeSlug });

  if (!record) notFound();

  return (
    <EditRecordView
      record={record}
      path={`/home/${account}/studio/${projectSlug}/episodes/${episodeSlug}/edit`}
    />
  );
}

export default withI18n(EditRecordPage);
