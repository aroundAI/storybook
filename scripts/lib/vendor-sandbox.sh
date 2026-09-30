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
  encryption_key=$(grep -m1 '^ENCRYPTION_KEY=' "$file" | cut -d= -f2- || true)
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
# The local job queue (FILM-1806): ElasticMQ for SQS, dynamodb-local for the
# WebSocket connections table, and the runner's gateway for API Gateway.
VENDOR_URL_SQS=http://127.0.0.1:4120
VENDOR_URL_DYNAMODB=http://127.0.0.1:4122
VENDOR_URL_APIGATEWAY=http://127.0.0.1:4121
LLM_JOBS_QUEUE_URL=http://127.0.0.1:4120/000000000000/StorybookLlmJobsQueue
VOICE_QUEUE_URL=http://127.0.0.1:4120/000000000000/StorybookVoiceQueue
PUBLISH_QUEUE_URL=http://127.0.0.1:4120/000000000000/StorybookPublishQueue
CONNECTIONS_TABLE_NAME=StorybookConnections
WEBSOCKET_ENDPOINT=http://127.0.0.1:4121
NEXT_PUBLIC_WEBSOCKET_URL=ws://127.0.0.1:4121
AWS_REGION=us-east-1
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

  # 60 s: tsx compiles the sandbox on its first start, which took over 30 s
  # once while a full unit run shared the machine (2026-09-29; ~2 s alone).
  for _ in $(seq 1 60); do
    if grep -q '\[sandbox\] seed' "$dir/sandbox.log" 2> /dev/null &&
      curl -sf "$SANDBOX_CONTROL_URL/__sandbox/state" > /dev/null 2>&1; then
      echo "    $(grep -m1 '\[sandbox\] seed' "$dir/sandbox.log")"
      return 0
    fi
    sleep 1
  done

  echo "The vendor sandbox did not start in 60s; see $dir/sandbox.log"
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

# ---------------------------------------------------------------------------
# The local job queue (FILM-1806): two emulator containers and the runner
# that feeds the app's own workers from them.

QUEUE_CONTAINER="storybook-elasticmq"
DYNAMO_CONTAINER="storybook-dynamodb"
QUEUE_IMAGE="softwaremill/elasticmq-native:1.6.12"
DYNAMO_IMAGE="amazon/dynamodb-local:2.5.3"

start_container() {
  local name="$1"
  shift
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
    docker start "$name" > /dev/null
  else
    docker run -d --name "$name" "$@" > /dev/null
  fi
}

# The public bucket the workers' R2 writes land in locally (FILM-1806). It is
# created through the storage API with the local service key; an existing
# bucket is left as it is.
ensure_local_r2_bucket() {
  local root="$1" status api service code
  status=$(cd "$root/apps/web" && supabase status -o env 2> /dev/null || true)
  api=$(printf '%s\n' "$status" | sed -n 's/^API_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' | head -n 1)
  service=$(printf '%s\n' "$status" | sed -n 's/^SERVICE_ROLE_KEY="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' | head -n 1)
  if [ -z "$api" ] || [ -z "$service" ]; then
    echo "    local Supabase is not running; no local R2 bucket"
    return 0
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$api/storage/v1/bucket" \
    -H "Authorization: Bearer $service" -H "apikey: $service" \
    -H 'Content-Type: application/json' \
    -d '{"id":"r2-local","name":"r2-local","public":true}')
  case "$code" in
    200) echo "    created the public bucket r2-local" ;;
    400 | 409) echo "    bucket r2-local is there" ;;
    *) echo "    could not create bucket r2-local (HTTP $code)"; return 1 ;;
  esac
}

start_local_queue() {
  local root="$1"
  local dir="$root/.sandbox"
  mkdir -p "$dir"

  # Always recreated: a container made from another checkout keeps a bind
  # mount of that checkout's elasticmq.conf, and `docker start` then fails
  # with "not a directory" once that checkout is gone. It holds no state.
  docker rm -f "$QUEUE_CONTAINER" > /dev/null 2>&1 || true

  # Loopback only, like the sandbox.
  start_container "$QUEUE_CONTAINER" -p 127.0.0.1:4120:9324 \
    -v "$root/apps/vendor-sandbox/queue/elasticmq.conf:/opt/elasticmq.conf:ro" "$QUEUE_IMAGE"
  start_container "$DYNAMO_CONTAINER" -p 127.0.0.1:4122:8000 "$DYNAMO_IMAGE" -jar DynamoDBLocal.jar -inMemory -sharedDb

  for _ in $(seq 1 30); do
    if curl -s -o /dev/null "http://127.0.0.1:4120/?Action=ListQueues" && curl -s -o /dev/null http://127.0.0.1:4122; then
      break
    fi
    sleep 1
  done

  if pid=$(workers_pid "$dir"); then
    echo "    workers already running (pid $pid)"
    return 0
  fi

  # The runner and the app's workers are bundled with esbuild, as SST bundles
  # each worker, then run with node. The egress guard, preloaded, makes sure
  # none of them reaches past this machine.
  (
    cd "$root/apps/vendor-sandbox" || exit 1
    ./node_modules/.bin/esbuild src/queue/main.ts --bundle --platform=node --format=cjs \
      --target=node20 --outfile="$dir/workers.cjs" --log-level=error > "$dir/workers.log" 2>&1 || exit 1
    NODE_OPTIONS="--import $root/apps/vendor-sandbox/scripts/egress-guard.mjs" \
      EGRESS_GUARD_LOG="$dir/workers-egress-blocked.log" \
      nohup node --enable-source-maps "$dir/workers.cjs" < /dev/null >> "$dir/workers.log" 2>&1 &
    echo $! > "$dir/workers.pid"
  ) || return 1

  for _ in $(seq 1 60); do
    if grep -q '\[local-workers\] ready' "$dir/workers.log" 2> /dev/null; then
      echo "    $(grep -m1 '\[local-workers\] ready' "$dir/workers.log")"
      return 0
    fi
    if ! workers_pid "$dir" > /dev/null; then break; fi
    sleep 1
  done
  echo "The local job queue did not start; see $dir/workers.log"
  return 1
}

workers_pid() {
  local pidfile="$1/workers.pid"
  [ -f "$pidfile" ] || return 1
  local pid
  pid=$(cat "$pidfile")
  kill -0 "$pid" 2> /dev/null || return 1
  echo "$pid"
}

stop_local_queue() {
  local dir="$1/.sandbox"
  local pid
  if pid=$(workers_pid "$dir"); then
    pkill -P "$pid" 2> /dev/null || true
    kill "$pid" 2> /dev/null || true
  fi
  rm -f "$dir/workers.pid"
  docker rm -f "$QUEUE_CONTAINER" "$DYNAMO_CONTAINER" > /dev/null 2>&1 || true
}

local_queue_status() {
  local dir="$1/.sandbox"
  if pid=$(workers_pid "$dir"); then
    echo "Local job queue: workers pid $pid, SQS 127.0.0.1:4120, DynamoDB 127.0.0.1:4122, gateway ws://127.0.0.1:4121"
  else
    echo "Local job queue: down"
  fi
}
