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
                the mutation would prove nothing — or, for an E2E guard, no
                test passed because every one it selects skipped
  AMBIGUOUS     a `find` matches more than once (or an edit names another
                file), so the mutation might not break what the guard tests;
                checked before any test runs
  TIMED OUT     the guard never finished: Playwright's --global-timeout ended
                it, or its command ran past kill_limit() and was killed with
                everything it started; the run goes on to the next entry

Any outcome other than RED fails the run, except a TIMED OUT from an entry
marked `known_flake`. See README.md.
"""
import argparse
import glob
import json
import os
import shutil
import re
import signal
import subprocess
import sys
import tempfile
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


# Seconds one guard command may run. Read at call time, so --self-test can
# shorten it.
GUARD_TIMEOUT = 900


class GuardTimedOut(Exception):
    """A guard command ran past its limit; `output` is what it printed."""

    def __init__(self, cmd, output, limit=None):
        super().__init__(f'{" ".join(cmd)} ran past {limit or GUARD_TIMEOUT}s')
        self.output = output


# Attempts an E2E guard gets on each run: the baseline passes if any attempt
# does, and a mutation counts as caught only if every attempt fails — a single
# flaky failure proves nothing either way. run.py makes the attempts, one
# Playwright command each (`--retries=0`), not Playwright's own retries.
#
# KB-165: with `--retries=2` under one 600s --global-timeout, the budget was
# shared by three attempts, and a failed attempt costs far more than the
# 2-minute test timeout: Playwright then gives after-hooks and fixture
# teardown, worker cleanup and trace saving a test timeout each
# (playwright/lib/worker/workerMain.js). On a stalled runner three failing
# attempts ran past 600s, Playwright ended the run during the third, and the
# line reporter — which prints an attempt's error only once the test is
# final — had printed nothing since `[1/1]`: it read as a frozen worker. It
# was not one; reproduced locally, every attempt had failed on a timeout.
E2E_ATTEMPTS = 3

# Seconds Playwright may spend on one attempt (its --global-timeout), unless
# the entry sets `timeout`: the test timeout and one more for its teardown,
# with a minute to spare. It is enforced by Playwright's runner, outside the
# worker, so it also ends an attempt whose worker stopped answering — which
# no test timeout can, because those run inside the worker.
E2E_ATTEMPT_TIMEOUT = 300

# Playwright's line when --global-timeout ends a run. It exits 1, so without
# this check a hang under a mutation would be counted as RED.
PLAYWRIGHT_GLOBAL_TIMEOUT = re.compile(
    r'Timed out waiting (\d+)s for the test suite to run')


# Seconds past an E2E entry's --global-timeout before its command is killed.
# Playwright ends a run at its global timeout and exits within seconds (KB-95's
# 150s budget came back TIMED OUT at 153-154s on #517 and #520). When its own
# runner process freezes, nothing ends it: on #521 KB-95 ran to the flat 900s
# GUARD_TIMEOUT, 12 minutes over budget, and its shard hit the job timeout.
E2E_KILL_GRACE = 90


def kill_limit(entry):
    """Seconds an entry's guard command may run before it is killed."""
    if entry['kind'] == 'e2e':
        return entry.get('timeout', E2E_ATTEMPT_TIMEOUT) + E2E_KILL_GRACE
    return GUARD_TIMEOUT


def run(cmd, cwd, env=None, limit=None):
    """Runs a guard command; raises GuardTimedOut if it outlives `limit`
    seconds (GUARD_TIMEOUT when not given).

    It runs in its own process group, and a timeout kills the whole group:
    killing `npx` alone left Playwright and its browser running, and they
    would go on driving the shared dev server under the next guard.
    """
    limit = limit or GUARD_TIMEOUT
    process = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE, text=True,
                               start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=limit)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        try:
            # What was printed before the kill, once the pipes close
            stdout, stderr = process.communicate(timeout=30)
        except subprocess.TimeoutExpired as held:
            # Something outside the group still holds a pipe (Playwright
            # starts its browser in a session of its own); keep what was read
            stdout, stderr = (part.decode(errors='replace') if part else ''
                              for part in (held.stdout, held.stderr))
        raise GuardTimedOut(cmd, stdout + stderr, limit=limit)
    output = stdout + stderr
    ended = PLAYWRIGHT_GLOBAL_TIMEOUT.search(output)
    if ended:
        raise GuardTimedOut(cmd, output, limit=ended.group(1))
    return process.returncode, output


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


def unknown_names(entries, only):
    """The `--only` values that are not exactly the name of an entry.

    `--only` once matched any entry whose name *contained* the value, so a
    short id like "U1" also ran another feature's E2E guard, which seeded the
    shared database without its lock while local CI was using it. A value
    now has to be a whole name, and one that names nothing stops the run
    before anything executes.
    """
    names = {entry['name'] for entry in entries}
    return [name for name in (only or []) if name not in names]


def needs_sandbox(entry):
    """An entry that drives the vendor sandbox (FILM-1804). CI starts no
    sandbox, so there its spec skips, passes with and without the mutation,
    and would be reported STAYED GREEN; it is selected only on request."""
    return entry.get('needs') == 'sandbox'


def duplicate_names(entries):
    """Names used by more than one entry: `--only` could not tell them apart."""
    seen, duplicates = set(), set()
    for entry in entries:
        (duplicates if entry['name'] in seen else seen).add(entry['name'])
    return sorted(duplicates)


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
        # One attempt per command; run_attempts() makes E2E_ATTEMPTS of them.
        cmd = ['npx', 'playwright', 'test', entry['spec'], '--project=chromium',
               '--reporter=line', '--retries=0', '-g', entry['grep'],
               f'--global-timeout={entry.get("timeout", E2E_ATTEMPT_TIMEOUT) * 1000}']
        return cmd, os.path.join(ROOT, 'apps/e2e'), env

    raise ValueError(f'no guard command for kind {kind}')


# Seconds to wait after a mutation is written before the guard runs, per
# attempt. Unit guards run at once; an E2E guard gets 4s, then 20s if the
# first attempt stayed green.
E2E_WAITS = (4, 20)

# Playwright's summary line for tests that ran and passed, after the line
# reporter's cursor escapes. `flaky` passed on a retry, which a baseline allows.
PLAYWRIGHT_PASSED = re.compile(
    r'^(?:\x1b\[[0-9;]*[A-Za-z])*\s*\d+ (?:passed|flaky)\b', re.MULTILINE)


def nothing_passed(entry, output):
    """An E2E baseline whose tests all skipped. Playwright exits 0 for it, and
    the mutated run skips the same way, so the guard reads as STAYED GREEN with
    no test ever run — K11 did, on a runner without ENCRYPTION_KEY."""
    return entry['kind'] == 'e2e' and not PLAYWRIGHT_PASSED.search(output)


# The error line Playwright prints for each failed attempt, and the ones that
# say only that a page did not finish navigating in time.
PLAYWRIGHT_ERROR = re.compile(r'^\s*(\w*Error): (.*)$', re.MULTILINE)
NAVIGATION_TIMEOUT = re.compile(
    r'page\.(?:goto|reload|goBack|goForward|waitForURL|waitForNavigation|waitForLoadState)'
    r': Timeout \d+ms exceeded')

# The line Playwright prints when the test, not one call in it, ran out of time.
TEST_TIMEOUT = re.compile(r'Test timeout of \d+ms exceeded')

# Seconds a baseline waits before its next attempt after one that failed only
# on time. The stalls behind them pass (see the job's comment in
# .github/workflows/workflow.yml); Playwright's own retries came seconds apart.
BASELINE_RETRY_PAUSE = 30


def navigation_timeouts_only(output):
    """True when an E2E attempt failed, and every error is a page that did not
    finish navigating in time. On #520 and #514 a baseline went NOT GREEN on
    `page.goto` and `page.waitForURL` timeouts while the runner stalled — the
    server log showed the pages served, or PostgREST rejecting a token as
    issued in the future. An assertion or a refused connection says something
    about the code or the server, and is not this."""
    errors = PLAYWRIGHT_ERROR.findall(output)
    return bool(errors) and all(
        name == 'TimeoutError' and NAVIGATION_TIMEOUT.match(message)
        for name, message in errors)


def failed_on_time(output):
    """An attempt that failed only because something took too long: a
    navigation timeout, or the test timeout (whose follow-on errors, such as
    a page closed under a pending `goto`, are its consequence). On a stalled
    runner this is what every attempt of a healthy guard does (KB-165)."""
    return bool(TEST_TIMEOUT.search(output)) or navigation_timeouts_only(output)


# The dev server the E2E guards share leaks: React's dev-only async debug
# tracking keeps ~32MB per spec run (KB-165), so a shard's server grows by
# gigabytes and the runner's last guards stall or meet Next's own mid-guard
# restart. When E2E_DEV_SERVER_CTL names scripts/ci/next-dev-server.sh, the
# runner reads the server's RSS before each E2E guard and restarts it there,
# between guards, once it passes E2E_DEV_SERVER_MAX_RSS_MB.
#
# The default limit is 45% of the machine's memory: ~3.2GB on CI's 7GB
# runner, and out of reach on a developer's machine. From the measurements:
# - too late: Next's own restart, at 80% of the 4GB heap (~3.5GB of heap,
#   so more RSS than that), fired mid-guard and failed the shard (run
#   36936270679), and #533's run stalled before reaching it;
# - the rest of the runner: Supabase ~1.2GB (docker stats, local),
#   ClickHouse ~0.5GB fresh, Chromium ~0.5GB and the OS, which leaves the
#   server ~4GB of the 7GB at most;
# - too early: a freshly started server measured 1.6-3.0GB RSS locally
#   (macOS, which counts more than Linux), so a limit far below 3GB would
#   restart before every guard, and each restart costs a cold compile.
# Every reading is logged before each guard, so CI's own numbers can retune
# it through E2E_DEV_SERVER_MAX_RSS_MB.
DEV_SERVER_MAX_RSS_SHARE = 0.45


def default_rss_limit_mb():
    total = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
    return int(total * DEV_SERVER_MAX_RSS_SHARE / 2 ** 20)


def dev_server_restart_due(rss_mb, limit_mb):
    """Restart when the server's RSS is known and over the limit. An unread
    RSS (None) never restarts: a guard run is not stopped for a reading."""
    return rss_mb is not None and rss_mb > limit_mb


def dev_server_rss(ctl):
    try:
        out = subprocess.run([ctl, 'rss'], capture_output=True, text=True,
                             timeout=30).stdout.strip()
        return int(out)
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return None


def restart_dev_server_if_due(env):
    """Before an E2E guard, never during one: restarts the dev server when
    its RSS is over the limit. Returns True when it restarted. Does nothing
    without E2E_DEV_SERVER_CTL (a developer's own server is theirs)."""
    ctl = env.get('E2E_DEV_SERVER_CTL')
    if not ctl:
        return False
    ctl = os.path.join(ROOT, ctl)
    limit = int(env.get('E2E_DEV_SERVER_MAX_RSS_MB') or default_rss_limit_mb())
    rss = dev_server_rss(ctl)
    if not dev_server_restart_due(rss, limit):
        print(f'  [dev server] RSS {rss if rss is not None else "unread"} MB, limit {limit} MB', flush=True)
        return False
    print(f'  [dev server] RSS {rss} MB is over the {limit} MB limit: restarting '
          'it before the next guard', flush=True)
    started = time.monotonic()
    done = subprocess.run([ctl, 'restart'], capture_output=True, text=True)
    print(f'  [dev server] restart exited {done.returncode} after '
          f'{time.monotonic() - started:.0f}s; RSS now {dev_server_rss(ctl)} MB: '
          f'{done.stdout.strip()[-300:]}', flush=True)
    return True


def run_attempts(entry, cmd, cwd, env, pause_after_timeout=False, after_restart=False):
    """Runs a guard: (exit code, output, attempts made). A unit guard runs
    once. An E2E guard makes up to E2E_ATTEMPTS attempts, each its own
    Playwright command with its own --global-timeout, and stops at the first
    that passes; the exit code is that attempt's, or the last one's. Every
    attempt's output is kept under a header, so a failure says what each
    attempt did. With `pause_after_timeout` (the baseline), an attempt that
    failed only on time is followed by a pause before the next.

    With `after_restart` (the first baseline on a freshly restarted dev
    server), a first attempt that failed only on time does not count: it paid
    for compiling every route the guard visits, cold.

    An attempt Playwright or the kill limit ended raises GuardTimedOut, with
    the earlier attempts' output in front of its own."""
    attempts = E2E_ATTEMPTS if entry['kind'] == 'e2e' else 1
    printed = ''
    attempt = 0
    while attempt < attempts:
        attempt += 1
        started = time.monotonic()
        try:
            code, output = run(cmd, cwd, env, limit=kill_limit(entry))
        except GuardTimedOut as timed_out:
            timed_out.output = (printed + f'--- attempt {attempt}/{attempts}: did not '
                                f'finish ---\n{timed_out.output}')
            raise
        if attempts > 1:
            verdict = 'passed' if code == 0 else 'failed'
            output = (f'--- attempt {attempt}/{attempts}: {verdict} '
                      f'({time.monotonic() - started:.0f}s) ---\n{output}')
        printed += output if printed == '' else '\n' + output
        if code == 0:
            return code, printed, attempt
        if after_restart and attempt == 1 and attempts > 1 and failed_on_time(output):
            attempts += 1
            printed += '\n--- the attempt above compiled a restarted server cold; not counted ---'
        if pause_after_timeout and attempt < attempts and failed_on_time(output):
            time.sleep(BASELINE_RETRY_PAUSE)
    return code, printed, attempts


def run_code_mutation(entry, base_env, after_restart=False):
    path = os.path.join(ROOT, entry['file'])
    source = open(path).read()

    problems = find_problems(entry, source)
    if problems:
        return 'AMBIGUOUS', '\n'.join(problems)

    # Baseline: the guard must pass on the real code, or its failure under
    # the mutation would be counted as detection when it is not.
    cmd, cwd, env = guard_command(entry, base_env)
    code, output, attempts = run_attempts(entry, cmd, cwd, env, pause_after_timeout=True,
                                          after_restart=after_restart)
    if code == 0 and attempts > 1:
        entry['baseline_attempts'] = attempts
    if code != 0:
        return 'NOT GREEN', output
    if nothing_passed(entry, output):
        return 'NOT GREEN', ('No test passed on the real code: every test the '
                             'guard selects was skipped, so it cannot fail '
                             'either. Give the run what the skip asks for.\n'
                             + output)

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
        cmd, cwd, env = guard_command(entry, base_env)
        # An E2E guard mutates a file under a running dev server, and the test
        # can start before the recompile lands and see the unmutated bundle:
        # a random STAYED GREEN (KB-3, seen once on #290, green 12 of 12 on
        # re-run). Nothing tells us the change was served, so a first green
        # gets a second run after a much longer wait before it is believed.
        #
        # An attempt that fails on a timeout counts as failed, the same as
        # one that fails an assertion: the baseline has just shown the same
        # test passing on the real code within the same limits, and a
        # mutation that keeps the page from ever reaching the asserted state
        # is caught by exactly that timeout. What does not count is an
        # attempt that never finished (Playwright's --global-timeout or the
        # kill limit): that is TIMED OUT, never RED.
        waits = E2E_WAITS if entry['kind'] == 'e2e' else (0,)
        for wait in waits:
            time.sleep(wait)
            code, output, _ = run_attempts(entry, cmd, cwd, env)
            if code != 0:
                break
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


def counts_as_failure(entry, status):
    """Every outcome but RED fails the run, except a TIMED OUT from an entry
    marked `known_flake` (a KB id): a hang proves nothing either way, and one
    known to hang at random should not abort a merge. Its other outcomes —
    NOT GREEN, STAYED GREEN — still fail."""
    if status == 'RED':
        return False
    return not (status == 'TIMED OUT' and entry.get('known_flake'))


def run_entry(entry, base_env, after_restart=False):
    # A hung guard is an outcome, not a crash: the mutation is restored by
    # the `finally` it passes through, and the run goes on to the next entry.
    try:
        if entry['kind'] == 'pgtap':
            return run_pgtap_mutation(entry)
        return run_code_mutation(entry, base_env, after_restart)
    except GuardTimedOut as timed_out:
        return 'TIMED OUT', f'{timed_out}\n{timed_out.output}'


def run_guard(entry, base_env):
    """One entry, as the run makes it: an E2E guard first gets a dev server
    under its memory limit, restarted here if need be, and a cold first
    attempt on a restarted server is not counted against it."""
    restarted = entry['kind'] == 'e2e' and restart_dev_server_if_due(base_env)
    return run_entry(entry, base_env, after_restart=restarted)


def load_entries():
    entries = []
    for path in sorted(glob.glob(os.path.join(HERE, '*.json'))):
        data = json.load(open(path))
        for entry in data['mutations']:
            entry['feature'] = data['feature']
            entries.append(entry)
    return entries


DURATIONS = os.path.join(HERE, 'e2e-durations.tsv')


def load_durations(path=DURATIONS):
    """Measured seconds per E2E entry name, from CI (see durations.py). A
    TSV, not JSON: load_entries reads every *.json here as a guard file."""
    durations = {}
    if os.path.exists(path):
        for line in open(path):
            seconds, _, name = line.rstrip('\n').partition('\t')
            if name and not line.startswith('#'):
                durations[name] = float(seconds)
    return durations


def shard_entries(entries, index, count, durations):
    """Shard `index` of `count` (1-based), split by measured duration.

    Round-robin by position put 36 minutes of guards on one shard and 16 on
    another in the same run (#514, #518), and the long shards are the ones
    the 45-minute job timeout cancelled (#519, #521). Longest first, each
    entry goes to the shard with the least time so far; an entry with no
    measurement counts as the median. Every shard computes the same split
    from the same entries, and runs its own in their original order."""
    known = sorted(durations[e['name']] for e in entries if e['name'] in durations)
    default = known[len(known) // 2] if known else 120.0
    cost = {e['name']: durations.get(e['name'], default) for e in entries}
    loads = [0.0] * count
    shard_of = {}
    for entry in sorted(entries, key=lambda e: (-cost[e['name']], e['name'])):
        target = min(range(count), key=lambda i: (loads[i], i))
        loads[target] += cost[entry['name']]
        shard_of[entry['name']] = target
    return [e for e in entries if shard_of[e['name']] == index - 1]


def self_test_steadiness(base_env, toothless):
    """The baseline retry, the kill limit and the duration split."""
    goto = ('    TimeoutError: page.goto: Timeout 60000ms exceeded.\n'
            '    Call log:\n      - navigating to "http://localhost:3100/@x/y/e/z", '
            'waiting until "load"\n')
    wait_url = '    TimeoutError: page.waitForURL: Timeout 60000ms exceeded.\n'
    assertion = ('    Error: expect(locator).toBeVisible() failed\n\n'
                 '    Locator: getByTestId("x")\n')
    for label, output, want in [
        ('page.goto timeouts on every attempt (#520)',
         f'Retry #1 ───\n{goto}Retry #2 ───\n{goto}    Error Context: x.md\n', True),
        ('page.waitForURL timeout (#514)', wait_url, True),
        ('a navigation timeout and an assertion', goto + assertion, False),
        ('an assertion', assertion, False),
        ('a test timeout that closed the page',
         '    Test timeout of 120000ms exceeded.\n'
         '    Error: page.goto: Target page, context or browser has been closed\n', False),
        ('a refused connection',
         '    Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3100/\n', False),
        ('a locator timeout, not a navigation',
         '    TimeoutError: locator.click: Timeout 10000ms exceeded.\n', False),
        ('no error at all', '  1 failed\n', False),
    ]:
        if navigation_timeouts_only(output) != want:
            print(f'SELF-TEST FAILED: navigation_timeouts_only {label}: expected {want}')
            return 1
    test_timeout = ('    Test timeout of 120000ms exceeded.\n'
                    '    Error: page.goto: Target page, context or browser has been closed\n')
    for label, output, want in [
        ('a test timeout that closed the page (KB-165)', test_timeout, True),
        ('a navigation timeout', goto, True),
        ('an assertion', assertion, False),
        ('a locator timeout, not a navigation',
         '    TimeoutError: locator.click: Timeout 10000ms exceeded.\n', False),
    ]:
        if failed_on_time(output) != want:
            print(f'SELF-TEST FAILED: failed_on_time {label}: expected {want}')
            return 1

    # The attempts end to end, on a real (no-op) mutation: each guard command
    # is one attempt and prints the next scripted outcome (KB-165: attempts
    # were Playwright's retries, sharing one --global-timeout).
    global guard_command, BASELINE_RETRY_PAUSE, E2E_WAITS
    script = {'goto': f"printf '%s' '{goto}'; exit 1",
              'timeout': f"printf '%s' '{test_timeout}'; exit 1",
              'assert': f"printf '%s' '{assertion}'; exit 1",
              'pass': 'echo "  1 passed (2.0s)"', 'fail': 'exit 1',
              'ended': "echo 'Timed out waiting 300s for the test suite to run'; exit 1"}
    saved = guard_command, BASELINE_RETRY_PAUSE, E2E_WAITS, time.sleep
    pauses = []
    BASELINE_RETRY_PAUSE, E2E_WAITS = 0.0123, (0,)
    # Only the baseline's pauses are counted: subprocess also sleeps while it
    # polls a command run with a timeout (the dev server's RSS reading).
    real_sleep = time.sleep
    time.sleep = lambda seconds: (pauses.append(seconds) if seconds == BASELINE_RETRY_PAUSE
                                  else real_sleep(seconds))
    try:
        for label, outcomes, want in [
            ('every mutated attempt fails: RED after three',
             ['pass', 'fail', 'fail', 'fail'], ('RED', None, 4, 0)),
            ('every mutated attempt times out: still RED (KB-165)',
             ['pass', 'timeout', 'timeout', 'timeout'], ('RED', None, 4, 0)),
            ('one mutated attempt passes: STAYED GREEN',
             ['pass', 'fail', 'pass'], ('STAYED GREEN', None, 3, 0)),
            ('three failed baselines: NOT GREEN, no pause after an assertion',
             ['assert', 'assert', 'assert'], ('NOT GREEN', None, 3, 0)),
            ('baseline passes on its third attempt, after two timeouts and pauses',
             ['timeout', 'goto', 'pass', 'fail', 'fail', 'fail'], ('RED', 3, 6, 2)),
            ('an attempt Playwright ended: TIMED OUT, never RED',
             ['pass', 'fail', 'ended'], ('TIMED OUT', None, 3, 0)),
            # A restarted dev server compiles cold: its first baseline attempt
            # failing on time is not counted, so a fourth may run (KB-165).
            ('after a restart, three timeouts then a pass: the cold one is not counted',
             ['timeout', 'timeout', 'timeout', 'pass', 'fail', 'fail', 'fail'],
             ('RED', 4, 7, 3)),
            ('without a restart, the same three timeouts: NOT GREEN',
             ['timeout', 'timeout', 'timeout', 'pass'], ('NOT GREEN', None, 3, 2)),
            ('after a restart, a failed assertion still counts',
             ['assert', 'assert', 'assert', 'pass'], ('NOT GREEN', None, 3, 0)),
        ]:
            pauses.clear()
            with tempfile.TemporaryDirectory() as scratch:
                counter = os.path.join(scratch, 'runs')
                cases = ' '.join(f'{n}) {script[o]};;' for n, o in enumerate(outcomes, 1))
                command = (f'n=$(( $(cat {counter} 2>/dev/null || echo 0) + 1 )); '
                           f'echo $n > {counter}; case $n in {cases} esac')
                guard_command = lambda entry, env: (['sh', '-c', command], ROOT, env)
                entry = dict(toothless, kind='e2e', name=f'self-test: {label}')
                # 'after a restart': a stand-in server control reports an RSS
                # over the limit, so run_guard restarts it before the guard.
                restarted = label.startswith('after a restart')
                ctl = os.path.join(scratch, 'ctl')
                with open(ctl, 'w') as handle:
                    handle.write(f'#!/bin/sh\ncase "$1" in rss) echo '
                                 f'{9999 if restarted else 100};; esac\n')
                os.chmod(ctl, 0o755)
                status, output = run_guard(entry, dict(base_env, E2E_DEV_SERVER_CTL=ctl,
                                                       E2E_DEV_SERVER_MAX_RSS_MB='1000'))
                runs = int(open(counter).read())
            got = (status, entry.get('baseline_attempts'), runs, len(pauses))
            if got != want:
                print(f'SELF-TEST FAILED: attempts, {label}: got (status, baseline '
                      f'attempts, commands, pauses) {got}, expected {want}')
                return 1
            if status == 'TIMED OUT' and '--- attempt 1/3: failed' not in output:
                print('SELF-TEST FAILED: a TIMED OUT dropped the attempts before it')
                return 1
    finally:
        guard_command, BASELINE_RETRY_PAUSE, E2E_WAITS, time.sleep = saved

    for label, rss, limit, want in [
        ('under the limit', 2999, 3000, False),
        ('at the limit', 3000, 3000, False),
        ('over the limit', 3001, 3000, True),
        ('an RSS that could not be read', None, 3000, False),
    ]:
        if dev_server_restart_due(rss, limit) != want:
            print(f'SELF-TEST FAILED: dev_server_restart_due {label}: expected {want}')
            return 1
    # The restart end to end, against a stand-in for next-dev-server.sh that
    # prints a scripted RSS and records each restart.
    with tempfile.TemporaryDirectory() as scratch:
        ctl, restarts = os.path.join(scratch, 'ctl'), os.path.join(scratch, 'restarts')
        with open(ctl, 'w') as handle:
            handle.write(f'#!/bin/sh\ncase "$1" in rss) echo "$FAKE_RSS";; '
                         f'restart) echo restarted >> {restarts};; esac\n')
        os.chmod(ctl, 0o755)
        for label, env, want in [
            ('over the default limit restarts',
             {'E2E_DEV_SERVER_CTL': ctl, 'FAKE_RSS': str(default_rss_limit_mb() + 1)}, 1),
            ('under the default limit does not',
             {'E2E_DEV_SERVER_CTL': ctl, 'FAKE_RSS': str(default_rss_limit_mb() - 1)}, 0),
            ('a configured limit is read',
             {'E2E_DEV_SERVER_CTL': ctl, 'FAKE_RSS': '2500',
              'E2E_DEV_SERVER_MAX_RSS_MB': '2000'}, 1),
            ('an unreadable RSS does not', {'E2E_DEV_SERVER_CTL': ctl, 'FAKE_RSS': 'n/a'}, 0),
            ('no server control, no restart', {'FAKE_RSS': '9999'}, 0),
        ]:
            if os.path.exists(restarts):
                os.remove(restarts)
            saved_environ = dict(os.environ)
            os.environ.update(env)
            try:
                restarted = restart_dev_server_if_due(env)
            finally:
                os.environ.clear()
                os.environ.update(saved_environ)
            made = len(open(restarts).read().split()) if os.path.exists(restarts) else 0
            if (restarted, made) != (bool(want), want):
                print(f'SELF-TEST FAILED: restart_dev_server_if_due {label}: '
                      f'returned {restarted} after {made} restart(s), expected {want}')
                return 1

    for label, entry, want in [
        ('e2e default', {'kind': 'e2e'}, E2E_ATTEMPT_TIMEOUT + E2E_KILL_GRACE),
        ('e2e with its own budget', {'kind': 'e2e', 'timeout': 150}, 150 + E2E_KILL_GRACE),
        ('unit', {'kind': 'unit'}, GUARD_TIMEOUT),
    ]:
        if kill_limit(entry) != want:
            print(f'SELF-TEST FAILED: kill_limit {label}: {kill_limit(entry)}, expected {want}')
            return 1

    named = [{'name': n} for n in 'abcde']
    durations = {'a': 300, 'b': 200, 'c': 100, 'd': 100}  # e unmeasured: the median, 200
    # Longest first: a 300 -> 1; b 200 -> 2; e 200 -> 3; c 100 -> 2 (lowest
    # index on a tie); d 100 -> 3. Each shard keeps the original order.
    for index, want in [(1, ['a']), (2, ['b', 'c']), (3, ['d', 'e'])]:
        got = [e['name'] for e in shard_entries(named, index, 3, durations)]
        if got != want:
            print(f'SELF-TEST FAILED: shard_entries {index}/3: {got}, expected {want}')
            return 1
    e2e = [e for e in load_entries() if e['kind'] == 'e2e' and not needs_sandbox(e)]
    measured = load_durations()
    for count in (5, 6, 7):
        shards = [shard_entries(e2e, i, count, measured) for i in range(1, count + 1)]
        names = sorted(e['name'] for shard in shards for e in shard)
        if names != sorted(e['name'] for e in e2e):
            print(f'SELF-TEST FAILED: --shard I/{count} does not run every entry exactly once')
            return 1
    return 0


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

    named = [{'name': 'U1 tag scope dropped'}, {'name': 'KB-U1 a longer name'}]
    for label, only, want in [
        ('exact name', ['U1 tag scope dropped'], []),
        ('part of a name', ['U1'], ['U1']),
        ('one good, one not', ['U1 tag scope dropped', 'nope'], ['nope']),
        ('no --only', None, []),
    ]:
        got = unknown_names(named, only)
        if got != want:
            print(f'SELF-TEST FAILED: unknown_names {label}: {got!r}, expected {want!r}')
            return 1
    if duplicate_names(named + [{'name': 'U1 tag scope dropped'}]) != ['U1 tag scope dropped']:
        print('SELF-TEST FAILED: duplicate_names missed a repeated name')
        return 1
    e2e, cursor = {'kind': 'e2e'}, '\x1b[1A\x1b[2K'
    for label, entry, output, want in [
        ('passed', e2e, '  1 passed (9.1s)\n', False),
        ('passed after a cursor escape', e2e, f'{cursor}  2 passed (9.1s)\n', False),
        ('flaky', e2e, f'{cursor}  1 flaky\n', False),
        ('all skipped', e2e, f'{cursor}  1 skipped\n', True),
        ('"passed" in a title only', e2e, '  ✓ 1 passed check › x\n  1 skipped\n', True),
        ('a unit guard', {'kind': 'unit'}, ' Tests  1 skipped\n', False),
    ]:
        if nothing_passed(entry, output) != want:
            print(f'SELF-TEST FAILED: nothing_passed {label}: expected {want}')
            return 1
    if not needs_sandbox({'needs': 'sandbox'}) or needs_sandbox({'kind': 'e2e'}):
        print('SELF-TEST FAILED: needs_sandbox does not tell a sandbox entry apart')
        return 1
    duplicates = duplicate_names(load_entries())
    if duplicates:
        print('SELF-TEST FAILED: entry names must be unique for --only:',
              *duplicates, sep='\n  ')
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
    # A command that outlives its timeout is killed with everything it
    # started, and what it printed is kept: a Playwright run leaves a browser
    # behind, which would go on driving the shared dev server.
    global GUARD_TIMEOUT, guard_command
    saved, GUARD_TIMEOUT = GUARD_TIMEOUT, 1
    real_command = guard_command
    try:
        started = time.monotonic()
        try:
            run(['sh', '-c', 'echo started; sleep 60; echo finished'], ROOT)
            print('SELF-TEST FAILED: a hung command returned instead of timing out')
            return 1
        except GuardTimedOut as timed_out:
            if 'started' not in timed_out.output or time.monotonic() - started > 10:
                print('SELF-TEST FAILED: a timed-out command lost its output or '
                      'left a child holding its pipes')
                return 1
        # A guard that hangs is reported and the run goes on (#506's queue run
        # crashed on one, and the shard's later guards never ran). The
        # guard's command is one that cannot finish in time, whatever the
        # machine's speed.
        guard_command = lambda entry, env: (['sleep', '60'], ROOT, env)
        status, _ = run_entry(dict(toothless, name='self-test: a hung guard'), base_env)
    finally:
        GUARD_TIMEOUT = saved
        guard_command = real_command
    if status != 'TIMED OUT':
        print(f'SELF-TEST FAILED: a guard past its timeout came back {status}')
        return 1

    # Playwright ending a run at --global-timeout exits 1; read as a failure
    # under the mutation, that would be RED for a guard that never finished.
    try:
        run(['sh', '-c', 'echo "  Timed out waiting 150s for the test suite to run"; '
             'echo "  1 did not run"; exit 1'], ROOT)
        print('SELF-TEST FAILED: Playwright\'s global timeout was read as an exit code')
        return 1
    except GuardTimedOut as timed_out:
        if '150s' not in str(timed_out) or 'did not run' not in timed_out.output:
            print(f'SELF-TEST FAILED: global timeout reported as {timed_out}')
            return 1
    for label, entry, status, want in [
        ('RED', {}, 'RED', False),
        ('TIMED OUT', {}, 'TIMED OUT', True),
        ('TIMED OUT, known flake', {'known_flake': 'KB-165'}, 'TIMED OUT', False),
        ('NOT GREEN, known flake', {'known_flake': 'KB-165'}, 'NOT GREEN', True),
        ('STAYED GREEN, known flake', {'known_flake': 'KB-165'}, 'STAYED GREEN', True),
    ]:
        if counts_as_failure(entry, status) != want:
            print(f'SELF-TEST FAILED: counts_as_failure {label}: expected {want}')
            return 1
    e2e_entry = {'kind': 'e2e', 'spec': 's', 'grep': 'g'}
    # One attempt per Playwright command, each under its own budget (KB-165).
    for entry, want in [(e2e_entry, f'--global-timeout={E2E_ATTEMPT_TIMEOUT * 1000}'),
                        (e2e_entry, '--retries=0'),
                        (dict(e2e_entry, timeout=150), '--global-timeout=150000')]:
        if want not in guard_command(entry, {})[0]:
            print(f'SELF-TEST FAILED: an e2e guard command lacks {want}')
            return 1

    if self_test_steadiness(base_env, toothless):
        return 1

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
    parser.add_argument('--only', action='append', metavar='NAME',
                        help="run only the entry with exactly this name (repeatable); "
                             'a name that matches no entry is refused')
    parser.add_argument('--file-prefix', action='append', metavar='PREFIX',
                        help='run only entries whose every mutated file starts with '
                             'one of these, e.g. specs/ for the docs-only CI job')
    parser.add_argument('--with-sandbox', action='store_true',
                        help='include entries marked "needs": "sandbox" (FILM-1804), '
                             'which need the vendor sandbox and a local.env app; '
                             'CI has neither, so they run only when asked for, '
                             'here or by name with --only')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--shard', metavar='I/N',
                        help='run shard I of N (1-based), split by e2e-durations.tsv, '
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

    all_entries = load_entries()
    unknown = unknown_names(all_entries, args.only)
    if unknown:
        for name in unknown:
            print(f'--only {name!r} names no entry.')
            near = [e['name'] for e in all_entries if name.lower() in e['name'].lower()]
            if near:
                print('  Did you mean one of:', *near[:10], sep='\n    ')
        print('Nothing was run: --only takes a whole entry name, not part of one.')
        return 1

    entries = [
        entry for entry in all_entries
        if (not args.kind or entry['kind'] in args.kind)
        and (not args.only or entry['name'] in args.only)
        and (args.with_sandbox or args.only or not needs_sandbox(entry))
        and (not args.file_prefix
             or all(path is not None and path.startswith(tuple(args.file_prefix))
                    for path in mutated_files(entry)))
    ]

    if args.shard:
        index, count = (int(part) for part in args.shard.split('/'))
        if not 1 <= index <= count:
            print(f'--shard {args.shard}: I must be between 1 and N')
            return 1
        entries = shard_entries(entries, index, count, load_durations())

    if not entries:
        print('No mutation guards selected.')
        return 1

    failures, excused = [], []
    for entry in entries:
        started = time.monotonic()
        status, output = run_guard(entry, base_env)
        # The seconds are what durations.py reads back to rebalance shards.
        retried = f' [baseline passed on attempt {entry["baseline_attempts"]}]' \
            if entry.get('baseline_attempts') else ''
        print(f'{status:13} [{entry["kind"]}] {entry["feature"]}: {entry["name"]}'
              f' ({time.monotonic() - started:.0f}s){retried}', flush=True)
        if counts_as_failure(entry, status):
            failures.append((entry, status, output))
        elif status != 'RED':
            excused.append((entry, status, output))

    for entry, status, output in excused:
        print(f'\n--- {status}, not counted: {entry["name"]} is a known flake '
              f'({entry["known_flake"]}). Tail of its output:')
        print(output[-3000:])

    print(f'\n{len(entries) - len(failures) - len(excused)} of {len(entries)} guards '
          'went red under their mutation'
          + (f'; {len(excused)} known flake(s) timed out, not counted' if excused else ''))
    retried = [entry['name'] for entry in entries if entry.get('baseline_attempts')]
    if retried:
        print(f'{len(retried)} baseline(s) passed only after a failed attempt:',
              *retried, sep='\n  ')
    for entry, status, output in failures:
        print(f'\n--- {status}: {entry["name"]}')
        if status == 'STAYED GREEN':
            print('The guard passed with its fix removed. Tail of its output:')
            print(output[-1500:])
        elif status == 'NOT GREEN':
            print('The guard fails on the real code. Tail of its output:')
            print(output[-1500:])
        elif status == 'TIMED OUT':
            print('The guard never finished, so it proved nothing either way. '
                  'Tail of what it printed before it was killed:')
            command, _, printed = output.partition('\n')
            print(command)
            print(printed[-3000:])
        elif status == 'AMBIGUOUS':
            print(output)
        else:
            print(f'Target text not found in {entry.get("file")}. Update the entry.')

    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
