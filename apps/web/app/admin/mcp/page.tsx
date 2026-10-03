import { AdminGuard } from '@kit/admin/components/admin-guard';
import { Badge } from '@kit/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { PageBody, PageHeader } from '@kit/ui/page';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';
import { cn } from '@kit/ui/utils';

import {
  MONITORING_WINDOWS,
  type Panel,
  loadMcpMonitoring,
  parseMonitoringWindow,
} from './_lib/server/mcp-monitoring.loader';

export const metadata = {
  title: 'MCP Connector | Super Admin',
};

interface McpMonitoringPageProps {
  searchParams: Promise<{ days?: string }>;
}

const percent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 1,
});

async function McpMonitoringPage({ searchParams }: McpMonitoringPageProps) {
  const days = parseMonitoringWindow((await searchParams).days);
  const data = await loadMcpMonitoring(days);

  return (
    <>
      <PageHeader
        title="MCP Connector"
        description="Tool calls from connected apps and generation runs in both modes, across every team."
      />

      <PageBody>
        <div className="flex flex-col gap-4" data-test="mcp-monitoring">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Window</span>

            {/* Plain anchors: a client navigation that only changes the
                query stalls on this page every time (KB-117) */}
            {MONITORING_WINDOWS.map((window) => (
              <a
                key={window}
                href={`/admin/mcp?days=${window}`}
                data-test={`mcp-window-${window}`}
                aria-current={window === days ? 'page' : undefined}
                className={cn(
                  'rounded-md border px-2 py-1',
                  window === days && 'bg-muted font-medium',
                )}
              >
                {window === 1 ? '24 hours' : `${window} days`}
              </a>
            ))}
          </div>

          <GuardCard guard={data.guard} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <PanelCard
              test="mcp-panel-tools"
              title="Calls per tool"
              description="Every call in the window, its errors, and the 95th percentile duration."
              panel={data.tools}
              empty="No tool calls in this window."
              columns={['Tool', 'Calls', 'Errors', 'p95']}
              row={(row) => [
                row.tool,
                row.calls,
                row.errors,
                `${Math.round(row.p95_ms)} ms`,
              ]}
            />

            <PanelCard
              test="mcp-panel-error-codes"
              title="Error rate by code"
              description="Calls that ended with each error code, as a share of every call in the window."
              panel={data.errorCodes}
              empty="No failed tool calls in this window."
              columns={['Code', 'Calls', 'Rate']}
              row={(row) => [
                row.error_code,
                row.calls,
                percent.format(row.rate),
              ]}
            />

            <PanelCard
              test="mcp-panel-runs"
              title="Runs by mode and status"
              description="Generation runs opened in the window: server mode is Gemini in the worker, external mode is an MCP client."
              panel={data.runs}
              empty="No generation runs opened in this window."
              columns={['Mode', 'Status', 'Runs']}
              row={(row) => [row.mode, row.status, row.runs]}
            />

            <PanelCard
              test="mcp-panel-expired-leases"
              title="Expired leases per day"
              description="Runs marked expired because their lease ran out, by UTC day."
              panel={data.expiredLeases}
              empty="No days in this window."
              columns={['Day', 'Expired']}
              row={(row) => [row.day, row.expired]}
            />
          </div>
        </div>
      </PageBody>
    </>
  );
}

export default AdminGuard(McpMonitoringPage);

function GuardCard({
  guard,
}: {
  guard: { violations: number } | { error: string };
}) {
  const failed = 'error' in guard || guard.violations > 0;

  return (
    <Card data-test="mcp-guard">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Model calls on external runs
          <Badge
            variant={failed ? 'destructive' : 'success'}
            data-test="mcp-guard-status"
          >
            {'error' in guard
              ? 'Unknown'
              : guard.violations > 0
                ? 'Guard failed'
                : 'None'}
          </Badge>
        </CardTitle>

        <CardDescription>
          A model-usage row on an external run means Gemini ran for work an MCP
          client owns. The database refuses it; an hourly check alerts if one
          ever exists.
        </CardDescription>
      </CardHeader>

      <CardContent data-test="mcp-guard-detail" className="text-sm">
        {'error' in guard
          ? `The check could not run: ${guard.error}`
          : `${guard.violations} usage rows on external runs, all time.`}
      </CardContent>
    </Card>
  );
}

function PanelCard<Row>({
  test,
  title,
  description,
  panel,
  empty,
  columns,
  row,
}: {
  test: string;
  title: string;
  description: string;
  panel: Panel<Row>;
  empty: string;
  columns: string[];
  row: (row: Row) => Array<string | number>;
}) {
  return (
    <Card data-test={test}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>

      <CardContent>
        {'error' in panel ? (
          <p className="text-sm text-destructive" data-test={`${test}-error`}>
            This panel could not load: {panel.error}
          </p>
        ) : panel.rows.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-test={`${test}-empty`}
          >
            {empty}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {panel.rows.map((item, index) => (
                <TableRow key={index} data-test={`${test}-row`}>
                  {row(item).map((cell, cellIndex) => (
                    <TableCell key={cellIndex}>{cell}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
