import type { ColumnDef } from '@tanstack/react-table';

import { Badge } from '@kit/ui/badge';
import { DataTable } from '@kit/ui/data-table';

interface EpisodeRow {
  title: string;
  status: 'Published' | 'Draft' | 'Rendering';
  duration: string;
}

const columns: ColumnDef<EpisodeRow>[] = [
  {
    accessorKey: 'title',
    header: 'Episode',
  },
  {
    accessorKey: 'duration',
    header: 'Duration',
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = row.original.status;
      return (
        <Badge variant={status === 'Published' ? 'default' : 'outline'}>
          {status}
        </Badge>
      );
    },
  },
];

const data: EpisodeRow[] = [
  { title: 'The Hollow Light', status: 'Published', duration: '8:42' },
  { title: 'Whispers in the Ledger', status: 'Rendering', duration: '7:15' },
  { title: 'The Last Confession', status: 'Draft', duration: '9:03' },
];

export function Default() {
  return <DataTable columns={columns} data={data} />;
}

export function Empty() {
  return <DataTable columns={columns} data={[]} />;
}
