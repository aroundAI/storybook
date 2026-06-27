import { Badge } from '@kit/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

const customers = [
  { name: 'Acme Studios', plan: 'Pro', mrr: '$129', logins: 42, active: true },
  { name: 'Lumen Pictures', plan: 'Team', mrr: '$349', logins: 18, active: true },
  { name: 'Nightowl Media', plan: 'Free', mrr: '$0', logins: 3, active: false },
];

export function Default() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>MRR</TableHead>
          <TableHead>Logins</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.name}>
            <TableCell className="font-medium">{customer.name}</TableCell>
            <TableCell>{customer.plan}</TableCell>
            <TableCell>{customer.mrr}</TableCell>
            <TableCell>{customer.logins}</TableCell>
            <TableCell>
              <Badge variant={customer.active ? 'default' : 'secondary'}>
                {customer.active ? 'Active' : 'Inactive'}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
