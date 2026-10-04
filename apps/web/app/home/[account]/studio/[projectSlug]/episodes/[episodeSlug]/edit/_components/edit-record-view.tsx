import { format } from 'date-fns';
import { Download, MonitorPlay } from 'lucide-react';

import { formatClock } from '@kit/content-analytics/lib/format';
import type { ExplainWhyReport, RenderPreset } from '@kit/desktop-integration';
import { Badge } from '@kit/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import type {
  EditRecord,
  EditRecordRender,
} from '../_lib/server/edit-record.loader';
import { ForceCloseButton } from './force-close-button';

const PRESET_LABEL: Record<RenderPreset, string> = {
  youtube_16x9: 'YouTube 16:9',
  shorts_9x16: 'YouTube Shorts 9:16',
  tiktok_9x16: 'TikTok 9:16',
  reels_9x16: 'Reels 9:16',
  square_1x1: 'Square 1:1',
  master: 'Master',
};

const ORIGIN_LABEL = { rough_cut: 'Rough cut', ai: 'AI', user: 'By hand' };

const when = (iso: string) => format(new Date(iso), 'MMM d, yyyy h:mm a');

/**
 * The Edit record (FILM-2006, PRD R-70): how the episode was edited in
 * StorybookStudio, from the latest delivered session's report. Read-only:
 * the edit itself happens in the Studio. Re-opening it is the episode
 * header's "Open in Studio" (FILM-2005), which this page shares with every
 * episode page rather than drawing a second one.
 */
export function EditRecordView(props: { record: EditRecord; path: string }) {
  const { record } = props;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Edit record</h1>
        <p className="text-sm text-muted-foreground">
          How this episode was cut in StorybookStudio. Open in Studio, above,
          re-opens it there.
        </p>
      </header>

      {record.open ? (
        <OpenSession
          open={record.open}
          canForceClose={record.canForceClose}
          path={props.path}
        />
      ) : null}

      {record.delivered ? (
        <Delivered delivered={record.delivered} />
      ) : (
        <Card data-test="edit-record-empty">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            This episode has not been delivered from StorybookStudio yet. Its
            versions, report and renders appear here after the first delivery.
          </CardContent>
        </Card>
      )}

      <Renders renders={record.renders} />
    </div>
  );
}

function OpenSession(props: {
  open: NonNullable<EditRecord['open']>;
  canForceClose: boolean;
  path: string;
}) {
  const { open } = props;

  return (
    <Card data-test="open-edit-session">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="flex items-start gap-3">
          <MonitorPlay className="mt-0.5 h-5 w-5 text-amber-600" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">Open in StorybookStudio</p>
            <p className="text-muted-foreground">
              <span data-test="open-session-editor">
                {open.editorName ?? 'A teammate'}
              </span>{' '}
              on{' '}
              <span data-test="open-session-device">
                {open.device ?? 'an unnamed device'}
              </span>
              , since{' '}
              <time
                dateTime={open.startedAt}
                data-test="open-session-since"
                suppressHydrationWarning
              >
                {when(open.startedAt)}
              </time>
            </p>
          </div>
        </div>
        {props.canForceClose ? (
          <ForceCloseButton
            sessionId={open.sessionId}
            editorName={open.editorName}
            path={props.path}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Delivered(props: {
  delivered: NonNullable<EditRecord['delivered']>;
}) {
  const { report, style, deliveredAt } = props.delivered;

  if (!report) {
    return (
      <Card data-test="edit-record-unreadable">
        <CardContent className="py-6 text-sm text-muted-foreground">
          Delivered from StorybookStudio on {when(deliveredAt)}, but the
          stored edit report could not be read.
        </CardContent>
      </Card>
    );
  }

  const target = style?.targetDuration ?? null;
  const difference = target === null ? null : report.finalDuration - target;

  return (
    <>
      <section
        className="grid grid-cols-2 gap-3 md:grid-cols-4"
        data-test="edit-record-summary"
      >
        <Figure
          label="Final duration"
          test="edit-record-duration"
          value={formatClock(report.finalDuration)}
          detail={
            target === null || difference === null
              ? 'No target recorded'
              : `Target ${formatClock(target)} · ${difference === 0 ? 'on target' : `${difference > 0 ? '+' : '−'}${formatClock(Math.abs(difference))}`}`
          }
        />
        <Figure
          label="Versions"
          test="edit-record-versions-count"
          value={String(report.versions.length)}
        />
        <Figure
          label="AI changes"
          test="edit-record-ai-ops"
          value={String(report.aiOps)}
        />
        <Figure
          label="Hand changes"
          test="edit-record-user-ops"
          value={String(report.userOps)}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Versions</CardTitle>
          <CardDescription>
            Delivered {when(deliveredAt)}
            {report.explain.plan ? ` · “${report.explain.plan}”` : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-col gap-2" data-test="edit-record-versions">
            {report.versions.map((version, index) => (
              <li
                key={version.id}
                className="flex items-center gap-3 text-sm"
                data-test="edit-record-version"
              >
                <span className="w-6 text-right tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="font-medium">{version.label}</span>
                <Badge variant="outline">{ORIGIN_LABEL[version.origin]}</Badge>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={version.createdAt}
                  suppressHydrationWarning
                >
                  {when(version.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <SceneChanges report={report} />
    </>
  );
}

function SceneChanges({ report }: { report: ExplainWhyReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What changed, and why</CardTitle>
        <CardDescription>
          Per scene, each change the edit made and the reason it gave.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {report.explain.scenes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The report lists no scene changes.
          </p>
        ) : (
          report.explain.scenes.map((scene) => (
            <div
              key={scene.scene}
              className="flex flex-col gap-2"
              data-test="edit-record-scene"
            >
              <h4 className="text-sm font-medium">
                Scene {scene.scene}{' '}
                <span className="font-normal text-muted-foreground">
                  {formatClock(scene.durationBefore)} →{' '}
                  {formatClock(scene.durationAfter)}
                </span>
              </h4>
              <ul className="flex flex-col gap-1.5">
                {scene.changes.map((change, index) => (
                  <li
                    key={`${change.target}-${index}`}
                    className="flex flex-wrap items-baseline gap-2 text-sm"
                    data-test="edit-record-change"
                  >
                    <Badge variant="secondary" className="capitalize">
                      {change.action}
                    </Badge>
                    <span className="font-medium">{change.target}</span>
                    <span className="text-muted-foreground">
                      {change.reason}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {change.by === 'ai' ? 'AI' : 'by hand'}
                      {change.before != null && change.after != null
                        ? ` · ${formatClock(change.before)} → ${formatClock(change.after)}`
                        : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function Renders({ renders }: { renders: EditRecordRender[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Renders</CardTitle>
        <CardDescription>
          Every render the Studio sent for this episode, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {renders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No renders yet.</p>
        ) : (
          <Table data-test="edit-record-renders">
            <TableHeader>
              <TableRow>
                <TableHead>Preset</TableHead>
                <TableHead>Language</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>QA</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">File</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {renders.map((render) => (
                <TableRow
                  key={render.id}
                  data-test="edit-record-render"
                  data-render-id={render.id}
                >
                  <TableCell>
                    <span className="font-medium">
                      {PRESET_LABEL[render.preset as RenderPreset] ??
                        render.preset}
                    </span>
                    {render.primary ? (
                      <Badge className="ml-2" data-test="render-primary">
                        Primary
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="uppercase">{render.language}</TableCell>
                  <TableCell className="tabular-nums">
                    {render.durationSeconds === null
                      ? '—'
                      : formatClock(render.durationSeconds)}
                  </TableCell>
                  <TableCell>
                    <QaBadge render={render} />
                  </TableCell>
                  <TableCell
                    className="capitalize"
                    data-test="render-status"
                    title={render.failureReason ?? undefined}
                  >
                    {render.status}
                  </TableCell>
                  <TableCell className="text-right">
                    {render.downloadUrl ? (
                      <a
                        href={render.downloadUrl}
                        className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                        data-test="render-download"
                        download
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        Download
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function QaBadge({ render }: { render: EditRecordRender }) {
  if (!render.qa) {
    return <span className="text-xs text-muted-foreground">Not run</span>;
  }

  const issues = render.qa.issues.length;

  return render.qa.pass ? (
    <Badge
      variant="outline"
      className="border-green-600 text-green-700 dark:text-green-400"
      data-test="render-qa"
      data-qa="pass"
    >
      Passed{issues > 0 ? ` · ${issues} note${issues === 1 ? '' : 's'}` : ''}
    </Badge>
  ) : (
    <Badge variant="destructive" data-test="render-qa" data-qa="fail">
      Failed · {issues} issue{issues === 1 ? '' : 's'}
    </Badge>
  );
}

function Figure(props: {
  label: string;
  test: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4" data-test={props.test}>
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className="text-lg font-semibold tabular-nums">{props.value}</p>
      {props.detail ? (
        <p className="text-xs text-muted-foreground">{props.detail}</p>
      ) : null}
    </div>
  );
}
