#!/usr/bin/env python3
"""Rebuilds e2e-durations.tsv, which `run.py --shard` splits the E2E guards by.

    python3 tooling/mutation-guards/durations.py RUN_ID [RUN_ID ...]

Reads the 🧬 E2E guards jobs of those workflow runs (`gh run view`), takes
each entry's RED runs, and writes its median seconds. A guard that timed out
or was NOT GREEN says nothing about how long it usually takes, so only RED
runs count. Entries no run measured are left out; run.py counts them as the
median. Rerun it with recent green merge-queue runs when guards are added or
a shard's guard step drifts past ~30 minutes.
"""
import json
import os
import re
import statistics
import subprocess
import sys
from datetime import datetime

sys.dont_write_bytecode = True  # no __pycache__ beside the guard files
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run import DURATIONS, load_entries  # noqa: E402

STAMP = re.compile(r'(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d+Z (.*)$')
OUTCOME = re.compile(
    r'^(RED|NOT GREEN|STAYED GREEN|TIMED OUT|MISSING|AMBIGUOUS)\s+\[e2e\] '
    r'(.*?)(?: \((\d+)s\))?(?: \[baseline retried[^]]*\])?$')
STEP = re.compile(r'##\[group\]Run .*(run\.py --kind e2e|SCOPED)')


def guard_seconds(log):
    """(name as printed, outcome, seconds) per guard in one job's log. The
    seconds are run.py's own when it printed them; in older logs, the time
    since the previous guard's line (or the step's start)."""
    found, last = [], None
    for line in log.splitlines():
        stamped = STAMP.search(line)
        if not stamped:
            continue
        when = datetime.fromisoformat(stamped.group(1))
        text = stamped.group(2)
        if last is None:
            if STEP.search(text):
                last = when
            continue
        outcome = OUTCOME.match(text)
        if outcome:
            name, printed = outcome.group(2), outcome.group(3)
            seconds = int(printed) if printed else (when - last).total_seconds()
            found.append((name, outcome.group(1), seconds))
            last = when
    return found


def job_logs(run_id):
    jobs = json.loads(subprocess.check_output(
        ['gh', 'run', 'view', run_id, '--json', 'jobs']))['jobs']
    for job in jobs:
        if 'E2E guards' in job['name']:
            yield subprocess.run(
                ['gh', 'run', 'view', '--job', str(job['databaseId']), '--log'],
                capture_output=True, text=True, check=True).stdout


def main(run_ids):
    if not run_ids:
        print(__doc__)
        return 1
    printed_name = {f'{e["feature"]}: {e["name"]}': e['name']
                    for e in load_entries() if e['kind'] == 'e2e'}
    seconds = {}
    for run_id in run_ids:
        for log in job_logs(run_id):
            for printed, outcome, value in guard_seconds(log):
                if outcome == 'RED' and printed in printed_name:
                    seconds.setdefault(printed_name[printed], []).append(value)
    with open(DURATIONS, 'w') as handle:
        handle.write(f'# median seconds per E2E guard, RED runs of: {" ".join(run_ids)}\n'
                     '# written by durations.py; read by run.py --shard\n')
        for name in sorted(seconds):
            handle.write(f'{statistics.median(seconds[name]):.0f}\t{name}\n')
    print(f'{len(seconds)} of {len(printed_name)} E2E entries measured -> {DURATIONS}')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
