#!/usr/bin/env python3
"""remerge-index.py <old-pr-head>: after a rebase that took main's specs/INDEX.md,
re-apply the PR's own INDEX changes onto it.

Three-way (base = merge-base(old head, origin/main)). Non-conflicting changes
merge as git would. In a conflicting hunk, markdown table rows are matched by
their first cell; per cell: a number becomes main + (pr - base), anything else
takes the PR's value if the PR changed it, main's otherwise. Rows only one side
has are kept. Anything that is not a table row in a conflict stops the script.
"""
import subprocess, sys, re, tempfile, os

F = 'specs/INDEX.md'
old = sys.argv[1]
git = lambda *a: subprocess.run(['git', *a], capture_output=True, text=True, check=True).stdout
base = git('merge-base', old, 'origin/main').strip()
files = {}
tmp = tempfile.mkdtemp()
for name, rev in [('main', 'origin/main'), ('base', base), ('pr', old)]:
    p = os.path.join(tmp, name); open(p, 'w').write(git('show', f'{rev}:{F}')); files[name] = p
r = subprocess.run(['git', 'merge-file', '-p', '--diff3', '-L', 'main', '-L', 'base', '-L', 'pr',
                    files['main'], files['base'], files['pr']], capture_output=True, text=True)
out, lines, i = [], r.stdout.split('\n'), 0

def key(row): return row.split('|')[1].strip() if row.startswith('|') else None
num = re.compile(r'^\s*(\*\*)?(-?\d+)(\*\*)?\s*$')

def merge_row(m, b, p):
    mc, bc, pc = m.split('|'), b.split('|'), p.split('|')
    if not (len(mc) == len(bc) == len(pc)): return p if p != b else m
    res = []
    for x, y, z in zip(mc, bc, pc):
        mx, my, mz = num.match(x), num.match(y), num.match(z)
        if mx and my and mz:
            v = int(mx.group(2)) + int(mz.group(2)) - int(my.group(2))
            bold = '**' if mx.group(1) else ''
            res.append(f' {bold}{v}{bold} ')
        else:
            res.append(z if z != y else x)
    return '|'.join(res)

while i < len(lines):
    l = lines[i]
    if not l.startswith('<<<<<<< '):
        out.append(l); i += 1; continue
    sec = {'main': [], 'base': [], 'pr': []}; cur = 'main'; i += 1
    while not lines[i].startswith('>>>>>>> '):
        if lines[i].startswith('||||||| '): cur = 'base'
        elif lines[i] == '=======': cur = 'pr'
        else: sec[cur].append(lines[i])
        i += 1
    i += 1
    allrows = [x for s in sec.values() for x in s if x.strip()]
    if any(not x.startswith('|') for x in allrows):
        sys.exit(f'non-table conflict in {F}; resolve by hand:\n' + '\n'.join(allrows[:10]))
    bm = {key(x): x for x in sec['base']}; pm = {key(x): x for x in sec['pr']}
    done = set()
    for m in sec['main']:
        k = key(m)
        if k in pm and k in bm: out.append(merge_row(m, bm[k], pm[k]))
        elif k in pm: out.append(pm[k])
        else: out.append(m)
        done.add(k)
    for p in sec['pr']:
        if key(p) not in done and key(p) not in bm: out.append(p)

open(F, 'w').write('\n'.join(out))
print(f'{F}: re-merged onto main')
