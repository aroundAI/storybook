#!/bin/bash
# status.sh: one-screen summary of local CI runs and the merge train
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
echo "time: $(date '+%H:%M')  docker: $(docker info >/dev/null 2>&1 && echo up || echo DOWN)  lock: $(cat "$STATE/db.lock/owner" 2>/dev/null || echo free)"
for d in "$STATE"/runs/*/; do
  pr=$(basename "$d"); rows=$(cat "$d"static.rows "$d"services.rows 2>/dev/null)
  ok=$(printf '%s\n' "$rows" | grep -c '^✅'); bad=$(printf '%s\n' "$rows" | grep '^❌' | cut -d'|' -f2,3 | tr '\n' ';')
  if [ -f "$d/report.md" ]; then st="DONE"; elif [ -n "$rows" ]; then st="running: $(printf '%s\n' "$rows" | tail -1 | cut -d'|' -f2,3)"; else st="queued"; fi
  echo "#$pr  ✅$ok ${bad:+❌ $bad}  $st"
done
[ -f "$STATE/train.log" ] && echo "train: $(tail -1 "$STATE/train.log")"
