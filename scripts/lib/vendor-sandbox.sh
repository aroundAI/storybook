#!/usr/bin/env bash
#
# The local vendor sandbox (FILM-1803): start, stop and status for
# scripts/local-env.sh, and the local.env block that points the app at it.
# Sourced, not run. Everything here is local: the sandbox binds 127.0.0.1,
# and the block names only loopback addresses and a placeholder key.

# SANDBOX_PORT_BASE shifts every sandbox port (apps/vendor-sandbox/src/main.ts).
SANDBOX_CONTROL_URL="http://127.0.0.1:${SANDBOX_PORT_BASE:-4100}"
SANDBOX_BLOCK_START='# >>> vendor-sandbox (FILM-1803)'
SANDBOX_BLOCK_END='# <<< vendor-sandbox'
SANDBOX_ENV_HOOKS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/vendor-sandbox-env.d"

# Writes the sandbox block into an env file, replacing any earlier one, so a
# machine whose local.env predates a new line still gets it on the next `up`.
# Lines outside the markers are never touched. An ENCRYPTION_KEY already in
# the file is kept (regenerating it would make stored keys unreadable); one
# is generated only when there is none.
ensure_sandbox_env() {
  local file="$1"
  touch "$file"

  local encryption_key
  encryption_key=$(grep -m1 '^ENCRYPTION_KEY=' "$file" | cut -d= -f2-)
  local key_outside=''
  if [ -n "$encryption_key" ] &&
    awk -v s="$SANDBOX_BLOCK_START" -v e="$SANDBOX_BLOCK_END" \
      '$0==s{inside=1} $0==e{inside=0; next} !inside && /^ENCRYPTION_KEY=/{found=1} END{exit !found}' "$file"; then
    key_outside=1
  fi
  [ -n "$encryption_key" ] || encryption_key=$(openssl rand -base64 32)

  local rest
  rest=$(awk -v s="$SANDBOX_BLOCK_START" -v e="$SANDBOX_BLOCK_END" \
    '$0==s{skip=1; next} $0==e{skip=0; next} !skip' "$file")

  {
    printf '%s\n' "$rest" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
    cat <<ENVEOF

$SANDBOX_BLOCK_START
# Rewritten by scripts/local-env.sh on every \`up\`; edit outside the markers.
# The app reaches these only with NODE_ENV=development or test and
# VENDOR_SANDBOX=1, outside a Lambda (FILM-1801). The key is a placeholder:
# the sandbox accepts any key, and no real vendor ever sees it.
VENDOR_SANDBOX=1
VENDOR_URL_GEMINI=http://127.0.0.1:4112
VENDOR_URL_OPENAI=http://127.0.0.1:4110
VENDOR_URL_ELEVENLABS=http://127.0.0.1:4113
GEMINI_API_KEY=sandbox-local-key
ENVEOF
    # Other stand-ins add their lines here: each executable file in
    # scripts/lib/vendor-sandbox-env.d/ prints lines for the block (FILM-1802
    # adds its VENDOR_URL_* and fake OAuth client ids this way).
    local hook
    for hook in "$SANDBOX_ENV_HOOKS"/*.sh; do
      [ -f "$hook" ] && bash "$hook"
    done
    # Saving a vendor key (settings, BYOK) encrypts it: a machine-local key.
    [ -n "$key_outside" ] || echo "ENCRYPTION_KEY=$encryption_key"
    echo "$SANDBOX_BLOCK_END"
  } > "$file.tmp" && mv "$file.tmp" "$file"
}

sandbox_pid() {
  local pidfile="$1/pid"
  [ -f "$pidfile" ] || return 1
  local pid
  pid=$(cat "$pidfile")
  kill -0 "$pid" 2> /dev/null || return 1
  echo "$pid"
}

# Starts the sandbox in the background, tracked by pid - never found or
# killed by port, which on this machine can belong to Docker.
start_sandbox() {
  local root="$1"
  local dir="$root/.sandbox"
  mkdir -p "$dir"

  if pid=$(sandbox_pid "$dir"); then
    echo "    already running (pid $pid)"
    return 0
  fi

  # Something else on the port (another checkout's sandbox, left running)
  # would answer the readiness check below for a sandbox that never started
  if curl -s -o /dev/null "$SANDBOX_CONTROL_URL/" 2> /dev/null; then
    echo "Something already answers on $SANDBOX_CONTROL_URL; stop it, or set SANDBOX_PORT_BASE"
    return 1
  fi

  # Only tsx goes to the background, with no inherited stdin and its output
  # in the log: a caller that pipes `local-env.sh up` (to tee, to a CI log)
  # must not be held open by it, and the pid recorded must be the sandbox's.
  (
    cd "$root/apps/vendor-sandbox" || exit 1
    nohup ./node_modules/.bin/tsx src/main.ts < /dev/null > "$dir/sandbox.log" 2>&1 &
    echo $! > "$dir/pid"
  ) || return 1

  for _ in $(seq 1 30); do
    if grep -q '\[sandbox\] seed' "$dir/sandbox.log" 2> /dev/null &&
      curl -sf "$SANDBOX_CONTROL_URL/__sandbox/state" > /dev/null 2>&1; then
      echo "    $(grep -m1 '\[sandbox\] seed' "$dir/sandbox.log")"
      return 0
    fi
    sleep 1
  done

  echo "The vendor sandbox did not start in 30s; see $dir/sandbox.log"
  return 1
}

stop_sandbox() {
  local dir="$1/.sandbox"
  local pid
  if pid=$(sandbox_pid "$dir"); then
    pkill -P "$pid" 2> /dev/null || true
    kill "$pid" 2> /dev/null || true
  fi
  rm -f "$dir/pid"
}

sandbox_status() {
  local dir="$1/.sandbox"
  if pid=$(sandbox_pid "$dir"); then
    echo "Vendor sandbox: pid $pid, $SANDBOX_CONTROL_URL/__sandbox"
  else
    echo "Vendor sandbox: down"
  fi
}
