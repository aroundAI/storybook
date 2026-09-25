#!/usr/bin/env python3
"""Mutation guards: prove that each test still catches the bug it was written for.

A test that passed once can stop guarding after a later change — FILM-1610's
double-click test kept passing after the thing it guarded was removed, and
only a re-run with the fix taken out showed it. This runner makes that check
repeatable: for each entry it breaks the code on purpose, runs the guard, and
requires the guard to FAIL. It restores every file afterwards, whatever
happens.

    python3 tooling/mutation-guards/run.py --kind unit      # CI: Unit Tests job
    python3 tooling/mutation-guards/run.py --kind pgtap     # CI: Supabase DB job
    python3 tooling/mutation-guards/run.py --kind e2e       # CI: E2E guards job; needs a dev server
    python3 tooling/mutation-guards/run.py --self-test      # the runner's own red check

Outcomes per entry:
  RED           the guard failed under its mutation — it guards
  STAYED GREEN  the guard passed with its fix removed — a finding
  MISSING       the mutation's target text is gone — the code moved; update
                the entry with it, or the guard is guarding nothing
  NOT GREEN     the guard fails even without the mutation, so a failure under
                the mutation would prove nothing
  AMBIGUOUS     a `find` matches more than once (or an edit names another
                file), so the mutation might not break what the guard tests;
                checked before any test runs

Any outcome other than RED fails the run. See README.md.
"""
import argparse
import glob
import json
import os
import shutil
import re
import subprocess
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
HERE = os.path.dirname(os.path.abspath(__file__))
PGTAP_DIR = os.path.join(ROOT, 'apps/web/supabase/tests/database')


def load_env_file(path):
    env = {}
    if not os.path.exists(path):
        return env
    for line in open(path):
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            env[key] = value
    return env


def supabase_cli():
    # CI installs the pinned CLI on PATH; locally it comes through npx.
    return ['supabase'] if shutil.which('supabase') else ['npx', 'supabase']


def run(cmd, cwd, env=None, timeout=900):
    result = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True,
                            text=True, timeout=timeout)
    return result.returncode, result.stdout + result.stderr


def edits_of(entry):
    if 'edits' in entry:
        return entry['edits']
    return [{'find': entry['find'], 'replace': entry['replace']}]


def find_problems(entry, source):
    """Why an entry's edits cannot name exactly one place, or [] if they can.

    Each `find` is counted in the text as the earlier edits leave it, which is
    what the mutation sees. A `find` that matches more than once is refused
    rather than applied to its first match: after a rebase the first match
    can be another copy of the same line, and the guard then breaks code its
    test never reads (#350). A per-edit `file` is refused too — the runner
    applies every edit to the entry's own `file`, so one naming another file
    would silently mutate the wrong one.
    """
    problems = []
    text = source
    for index, edit in enumerate(edits_of(entry)):
        if edit.get('file', entry['file']) != entry['file']:
            problems.append(f'edit {index}: names file {edit["file"]}, but every '
                            f'edit applies to {entry["file"]}')
            continue
        count = text.count(edit['find'])
        if count > 1:
            lines, start = [], 0
            for _ in range(count):
                at = text.index(edit['find'], start)
                lines.append(text.count('\n', 0, at) + 1)
                start = at + 1
            problems.append(f'edit {index}: `find` matches {count} times in '
                            f'{entry["file"]} (lines {", ".join(map(str, lines))}); '
                            'extend it until it names one place')
        text = text.replace(edit['find'], edit['replace'], 1)
    return problems


def guard_command(entry, base_env):
    kind = entry['kind']
    env = dict(base_env)

    if kind == 'unit':
        cmd = ['npx', 'vitest', 'run', entry['test']]
        if entry.get('pattern'):
            cmd += ['-t', entry['pattern']]
        return cmd, os.path.join(ROOT, entry['cwd']), env

    if kind == 'e2e':
        env.update(load_env_file(os.path.join(ROOT, 'deployment/config/local.env')))
        env.setdefault('PLAYWRIGHT_BASE_URL', 'http://localhost:3100')
        env.update(entry.get('env', {}))
        cmd = ['npx', 'playwright', 'test', entry['spec'], '--project=chromium',
               # Two retries on both runs: the baseline passes if any
               # attempt does, and a mutation counts as caught only if every
               # attempt fails — a single flaky failure proves nothing
               # either way.
               '--reporter=line', '--retries=2', '-g', entry['grep']]
        return cmd, os.path.join(ROOT, 'apps/e2e'), env

    raise ValueError(f'no guard command for kind {kind}')


def run_code_mutation(entry, base_env):
    path = os.path.join(ROOT, entry['file'])
    source = open(path).read()

    problems = find_problems(entry, source)
    if problems:
        return 'AMBIGUOUS', '\n'.join(problems)

    # Baseline: the guard must pass on the real code, or its failure under
    # the mutation would be counted as detection when it is not.
    cmd, cwd, env = guard_command(entry, base_env)
    code, output = run(cmd, cwd, env)
    if code != 0:
        return 'NOT GREEN', output

    mutated = source
    for edit in edits_of(entry):
        if mutated.count(edit['find']) < 1:
            return 'MISSING', ''
        mutated = mutated.replace(edit['find'], edit['replace'], 1)

    backup = path + '.mutation-guard.bak'
    shutil.copyfile(path, backup)
    try:
        with open(path, 'w') as handle:
            handle.write(mutated)
        if entry['kind'] == 'e2e':
            time.sleep(4)  # let the dev server pick the change up
        cmd, cwd, env = guard_command(entry, base_env)
        code, output = run(cmd, cwd, env)
        return ('RED' if code != 0 else 'STAYED GREEN'), output
    finally:
        shutil.copyfile(backup, path)
        os.remove(backup)


def pgtap_setup_files():
    """The suite's setup files (`00000-*.sql`), which register the test
    helpers extension every test file needs.

    They run first only when the whole directory runs. A single file on a
    fresh database — which is what CI's Supabase DB job has — fails on
    "extension basejump-supabase_test_helpers is not available". It passed
    locally only because a database that had once run the full suite kept
    the extension; the runner's first CI run caught the difference.
    They are safe to run repeatedly.
    """
    return sorted(glob.glob(os.path.join(PGTAP_DIR, '00000-*.sql')))


# The CLI runs pg_prove in a throwaway container. On GitHub's runners Docker
# sometimes fails to remove that container after pg_prove has finished
# ("Error waiting for container: unable to remove filesystem ... exit 125"),
# and the CLI then exits 1 whatever the tests said. Seen on #350, on a
# different guard each run: a false NOT GREEN on the real code, and on the
# mutated run a false RED, which is worse.
DOCKER_TEARDOWN = re.compile(
    r'Error waiting for container|unable to remove filesystem')
PG_PROVE_RESULT = re.compile(r'^Result: (PASS|FAIL)\s*$', re.MULTILINE)


def pgtap_outcome(code, output):
    """The pgTAP verdict, or None when a teardown error left no verdict.

    A clean exit is taken as is. After a teardown error, pg_prove's own
    `Result:` line is the verdict; without one, the run is unknown.
    """
    if not DOCKER_TEARDOWN.search(output):
        return code
    result = PG_PROVE_RESULT.findall(output)
    if not result:
        return None
    return 0 if result[-1] == 'PASS' else 1


def run_pgtap(path, attempts=3):
    for _ in range(attempts):
        code, output = run(
            supabase_cli() + ['test', 'db', *pgtap_setup_files(), path],
            os.path.join(ROOT, 'apps/web'))
        outcome = pgtap_outcome(code, output)
        if outcome is not None:
            return outcome, output
    return code, output


def run_pgtap_mutation(entry):
    """Runs a pgTAP file with SQL applied first, inside its own transaction.

    Every pgTAP file here begins a transaction and rolls back, so the
    mutation never outlives the run.
    """
    test_path = os.path.join(ROOT, entry['test'])
    source = open(test_path).read()

    code, output = run_pgtap(test_path)
    if code != 0:
        return 'NOT GREEN', output

    marker = source[source.index('select plan('):]
    marker = marker[:marker.index(';') + 1]
    mutated = source.replace(
        marker, marker + '\nset local role postgres;\n' + entry['sql'] + '\n', 1)

    temp = os.path.join(PGTAP_DIR, 'zz-mutation-guard.test.sql')
    with open(temp, 'w') as handle:
        handle.write(mutated)
    try:
        code, output = run_pgtap(temp)
        return ('RED' if code != 0 else 'STAYED GREEN'), output
    finally:
        os.remove(temp)


def run_entry(entry, base_env):
    if entry['kind'] == 'pgtap':
        return run_pgtap_mutation(entry)
    return run_code_mutation(entry, base_env)


def load_entries():
    entries = []
    for path in sorted(glob.glob(os.path.join(HERE, '*.json'))):
        data = json.load(open(path))
        for entry in data['mutations']:
            entry['feature'] = data['feature']
            entries.append(entry)
    return entries


def mutated_files(entry):
    """Every file an entry rewrites: its `file`, and each `edits` item's own
    `file` where one names a different file. None for a pgTAP entry."""
    files = [entry['file']] if 'file' in entry else []
    files += [edit['file'] for edit in entry.get('edits', []) if 'file' in edit]
    return files or [None]


def self_test(base_env):
    """The runner's own red check: a mutation that changes nothing must be
    reported as STAYED GREEN. If it came back RED, the runner would be
    counting any failure — a broken command, a missing tool — as a guard
    doing its job."""
    teardown = ('time="…" level=error msg="Error waiting for container: '
                'unable to remove filesystem for a84d…: directory not empty"\n'
                'error running container: exit 125\n')
    for label, got, want in [
        ('clean pass', pgtap_outcome(0, 'Result: PASS\n'), 0),
        ('clean fail', pgtap_outcome(1, 'Result: FAIL\n'), 1),
        ('teardown after PASS', pgtap_outcome(1, 'Result: PASS\n' + teardown), 0),
        ('teardown after FAIL', pgtap_outcome(1, 'Result: FAIL\n' + teardown), 1),
        ('teardown, no verdict', pgtap_outcome(1, teardown), None),
    ]:
        if got != want:
            print(f'SELF-TEST FAILED: pgtap_outcome {label}: {got!r}, expected {want!r}')
            return 1

    source = 'a = 1\nb = 2\na = 3\n'
    for label, entry, want in [
        ('unique find', {'file': 'x', 'find': 'b = 2', 'replace': 'b = 0'}, 0),
        ('find twice', {'file': 'x', 'find': 'a = ', 'replace': 'a = 0'}, 1),
        ('ambiguous only after an earlier edit',
         {'file': 'x', 'edits': [{'find': 'b = 2', 'replace': 'a = 2'},
                                 {'find': 'a = 2', 'replace': 'a = 9'}]}, 0),
        ('second find ambiguous after the first edit',
         {'file': 'x', 'edits': [{'find': 'b = 2', 'replace': 'a = 3'},
                                 {'find': 'a = 3', 'replace': 'a = 9'}]}, 1),
        ('edit names another file',
         {'file': 'x', 'edits': [{'file': 'y', 'find': 'b = 2', 'replace': ''}]}, 1),
    ]:
        got = len(find_problems(entry, source))
        if got != want:
            print(f'SELF-TEST FAILED: find_problems {label}: {got} problems, expected {want}')
            return 1

    # Every real entry, statically: CI runs --self-test in one job, while the
    # entries themselves are split across shards and kinds.
    ambiguous = []
    for entry in load_entries():
        if 'file' in entry:
            problems = find_problems(entry, open(os.path.join(ROOT, entry['file'])).read())
            ambiguous += [f'{entry["feature"]}: {entry["name"]}: {p}' for p in problems]
    if ambiguous:
        print('SELF-TEST FAILED: entries whose mutation does not name one place:',
              *ambiguous, sep='\n  ')
        return 1

    toothless = {
        'name': 'self-test: a no-op mutation',
        'kind': 'unit',
        'file': 'packages/features/content-analytics/src/lib/watched-metrics.ts',
        'find': 'export const WATCHED_METRIC_KEYS',
        'replace': 'export const WATCHED_METRIC_KEYS',
        'cwd': 'packages/features/content-analytics',
        'test': '__tests__/watched-metrics.test.ts',
    }
    status, output = run_entry(toothless, base_env)
    if status != 'STAYED GREEN':
        print(f'SELF-TEST FAILED: a no-op mutation came back {status}')
        print(output[-2000:])
        return 1
    print('self-test passed: a no-op mutation is reported as STAYED GREEN')
    return 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=['unit', 'pgtap', 'e2e'],
                        action='append', help='run only these kinds')
    parser.add_argument('--only', action='append',
                        help='run only entries whose name contains this')
    parser.add_argument('--file-prefix', action='append', metavar='PREFIX',
                        help='run only entries whose every mutated file starts with '
                             'one of these, e.g. specs/ for the docs-only CI job')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--shard', metavar='I/N',
                        help='run every Nth selected entry, starting at I (1-based), '
                             'so parallel CI jobs split the E2E guards')
    args = parser.parse_args()

    base_env = dict(os.environ)

    if args.self_test:
        return self_test(base_env)

    # Only the files entries mutate can have a backup; a whole-repo glob
    # would walk node_modules for nothing.
    leftovers = sorted({
        os.path.join(ROOT, entry['file']) + '.mutation-guard.bak'
        for entry in load_entries() if 'file' in entry
    })
    leftovers = [path for path in leftovers if os.path.exists(path)]
    if leftovers:
        print('Refusing to run: a previous run left backups behind:', *leftovers, sep='\n  ')
        return 1

    entries = [
        entry for entry in load_entries()
        if (not args.kind or entry['kind'] in args.kind)
        and (not args.only or any(o in entry['name'] for o in args.only))
        and (not args.file_prefix
             or all(path is not None and path.startswith(tuple(args.file_prefix))
                    for path in mutated_files(entry)))
    ]

    if args.shard:
        index, count = (int(part) for part in args.shard.split('/'))
        if not 1 <= index <= count:
            print(f'--shard {args.shard}: I must be between 1 and N')
            return 1
        entries = entries[index - 1::count]

    if not entries:
        print('No mutation guards selected.')
        return 1

    failures = []
    for entry in entries:
        status, output = run_entry(entry, base_env)
        print(f'{status:13} [{entry["kind"]}] {entry["feature"]}: {entry["name"]}', flush=True)
        if status != 'RED':
            failures.append((entry, status, output))

    print(f'\n{len(entries) - len(failures)} of {len(entries)} guards went red under their mutation')
    for entry, status, output in failures:
        print(f'\n--- {status}: {entry["name"]}')
        if status == 'STAYED GREEN':
            print('The guard passed with its fix removed. Tail of its output:')
            print(output[-1500:])
        elif status == 'NOT GREEN':
            print('The guard fails on the real code. Tail of its output:')
            print(output[-1500:])
        elif status == 'AMBIGUOUS':
            print(output)
        else:
            print(f'Target text not found in {entry.get("file")}. Update the entry.')

    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
