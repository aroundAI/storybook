#!/bin/bash
# stop.sh ends a pipeline's whole process tree, children before parent, so
# nothing it started outlives it. A stand-in pipeline starts a child, which
# starts a grandchild; the stop must end all three. The stand-in and every
# descendant carry a marker in their command line, so the check is by name.
set -u
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
STOP="$HERE/../local-ci/stop.sh"
MARK="stop-test-$$-$RANDOM"
TMP=$(mktemp -d)
trap 'pkill -f "$MARK" 2>/dev/null; rm -rf "$TMP"' EXIT

cat > "$TMP/parent-$MARK.sh" <<EOF
#!/bin/bash
bash -c 'exec -a "child-$MARK" sleep 300' &
bash -c 'bash -c "exec -a grandchild-$MARK sleep 300" & wait' &
wait
EOF
chmod +x "$TMP/parent-$MARK.sh"

"$TMP/parent-$MARK.sh" &
sleep 1

before=$(pgrep -f "$MARK" | wc -l | tr -d ' ')
[ "$before" -ge 4 ] || { echo "FAIL: the stand-in tree did not start ($before processes)"; exit 1; }

LOCAL_CI_STOP_MATCH="parent-$MARK.sh" "$STOP" 424242 --keep-run > /dev/null 2>&1
code=$?

after=$(pgrep -f "$MARK" | grep -vx "$$" | wc -l | tr -d ' ')

[ "$code" -eq 0 ] || { echo "FAIL: stop.sh exited $code"; exit 1; }
[ "$after" -eq 0 ] || { echo "FAIL: $after process(es) outlived the stop"; pgrep -fl "$MARK"; exit 1; }

# The premise, so the test cannot pass by accident: killing only the parent by
# name leaves its children running.
"$TMP/parent-$MARK.sh" &
sleep 1
pkill -f "parent-$MARK.sh"
sleep 1
orphans=$(pgrep -f "$MARK" | grep -vx "$$" | wc -l | tr -d ' ')
pkill -f "$MARK" 2>/dev/null
[ "$orphans" -gt 0 ] || { echo "FAIL: killing only the parent left nothing behind, so this test proves nothing"; exit 1; }

echo "ok: the whole tree ($before processes) was stopped"
