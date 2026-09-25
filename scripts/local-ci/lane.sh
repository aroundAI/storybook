# Sourced by env.sh (and again after local.env is loaded, which would
# otherwise put lane A's hosts back). Picks the local-CI lane from $LANE:
#
#   A (default)  the stack scripts/local-env.sh starts: Supabase 5532x,
#                ClickHouse on 8123, the web app on 3000, db.lock
#   B            a second stack (scripts/local-ci/lane-b.sh up): Supabase
#                project storybook-b on 5542x, ClickHouse storybook-clickhouse-b
#                on 18123, the web app on 3001, db-b.lock
#
# Lane A exports nothing, so every command it runs is the one it ran before
# lanes existed. Lane B is only environment: the Supabase CLI reads
# SUPABASE_<SECTION>_<KEY> over config.toml, so a PR's own apps/web/supabase
# (its migrations, seeds and pgTAP files, mutated in place by the guards) is
# used unchanged and its worktree stays clean.
LANE=${LANE:-A}
case "$LANE" in
  A)
    LANE_SFX=""; WEB_PORT=3000; CH_URL=http://localhost:8123 ;;
  B)
    LANE_SFX="-b"; WEB_PORT=3001; CH_URL=http://localhost:18123
    export SUPABASE_PROJECT_ID=storybook-b
    export SUPABASE_API_PORT=55421 SUPABASE_DB_PORT=55422 SUPABASE_STUDIO_PORT=55423
    export SUPABASE_LOCAL_SMTP_PORT=55424 SUPABASE_LOCAL_SMTP_SMTP_PORT=55425 SUPABASE_LOCAL_SMTP_POP3_PORT=55426
    export SUPABASE_ANALYTICS_PORT=55427 SUPABASE_DB_SHADOW_PORT=55420 SUPABASE_DB_POOLER_PORT=55429
    export SUPABASE_EDGE_RUNTIME_INSPECTOR_PORT=8184
    export SUPABASE_AUTH_SITE_URL=http://localhost:3001
    export SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS=http://localhost:3001,http://localhost:3001/auth/callback,http://localhost:3001/update-password
    # the app (NEXT_PUBLIC_* are baked in at build) and the E2E suite
    export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55421 NEXT_PUBLIC_SITE_URL=http://localhost:3001
    export SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:55422/postgres
    export EMAIL_PORT=55425
    export E2E_SUPABASE_URL=http://127.0.0.1:55421 MAILBOX_URL=http://127.0.0.1:55424
    export PLAYWRIGHT_BASE_URL=http://localhost:3001
    export CLICKHOUSE_HOST=http://localhost:18123 ;;
  *) echo "LANE must be A or B, not '$LANE'" >&2; exit 2 ;;
esac
