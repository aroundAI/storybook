#!/bin/bash
# FIFO lock for the shared local Supabase/ClickHouse.
#   dblock.sh acquire <name> "<what>"   blocks until it's your turn
#   dblock.sh release <name>
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"; L=$STATE/db$LANE_SFX.lock; Q=$STATE/lockq$LANE_SFX
case "$1" in
acquire)
  # local CI for a PR (localci-*) jumps the queue: a leading 0 sorts before every plain timestamp
  pri=; case "$2" in localci-*) pri=0 ;; esac
  ticket="$Q/$pri$(date +%s%N 2>/dev/null || date +%s)-$2"; touch "$ticket"
  while :; do
    first=$(ls "$Q" | sort | head -1)
    if [ "$Q/$first" = "$ticket" ] && mkdir "$L" 2>/dev/null; then
      echo "$2 $3 $(date)" > "$L/owner"; rm -f "$ticket"; echo "acquired"; exit 0
    fi
    # drop stale tickets (>3h) so a dead waiter can't block the queue
    find "$Q" -type f -mmin +180 -delete 2>/dev/null
    sleep 10
  done ;;
release)
  if grep -q "^$2 " "$L/owner" 2>/dev/null; then rm -rf "$L"; echo released; else echo "not owner: $(cat $L/owner 2>/dev/null)"; fi ;;
esac
