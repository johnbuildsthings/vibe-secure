#!/usr/bin/env bash
# Headless eval: run a vibe-secure skill against a copy of a fixture app, then score the findings.
#   evals/run-eval.sh <fixture> [area|all] [--live] [--fix]
# area is a skill name without "check-" (secrets, database-rules, auth, injection, payments,
# ai-features, config, dependencies, live) or "all". Exit code = scorer result.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
usage() { echo "usage: evals/run-eval.sh <fixture> [area|all] [--live] [--fix]" >&2; exit 2; }

FIXTURE_NAME="" AREA="" LIVE=0 FIX=0
for arg in "$@"; do
  case "$arg" in
    --live) LIVE=1 ;;
    --fix) FIX=1 ;;
    --*) echo "unknown flag: $arg" >&2; usage ;;
    *) if [ -z "$FIXTURE_NAME" ]; then FIXTURE_NAME="$arg"; elif [ -z "$AREA" ]; then AREA="$arg"; else usage; fi ;;
  esac
done
[ -n "$FIXTURE_NAME" ] || usage
AREA="${AREA:-all}"
FIXTURE="$REPO/test-fixtures/$FIXTURE_NAME"
[ -d "$FIXTURE" ] && [ -f "$FIXTURE/expected-findings.json" ] || { echo "no such fixture: $FIXTURE_NAME" >&2; exit 2; }
if [ "$AREA" = live ] && [ "$LIVE" -eq 0 ]; then echo "area 'live' needs --live" >&2; exit 2; fi
if [ "$FIX" -eq 1 ] && [ "$AREA" != all ]; then echo "--fix runs the whole security-check; use area 'all'" >&2; exit 2; fi
if [ "$LIVE" -eq 1 ] && [ ! -f "$FIXTURE/expected-live.json" ]; then echo "fixture $FIXTURE_NAME has no expected-live.json" >&2; exit 2; fi

TMP="$(mktemp -d)"
META="$(mktemp -d)" # transcripts and mock logs live outside the audited copy
MOCK_PID=""
cleanup() {
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  echo "Working copy kept at: $TMP (transcripts and logs: $META)"
}
trap cleanup EXIT

export GIT_AUTHOR_NAME=eval GIT_AUTHOR_EMAIL=eval@local GIT_COMMITTER_NAME=eval GIT_COMMITTER_EMAIL=eval@local

# 1. Copy the fixture (without the answer key), init git, replay history.
cp -R "$FIXTURE"/. "$TMP/"
rm -f "$TMP/expected-findings.json" "$TMP/expected-live.json" "$TMP/history.sh"
(
  cd "$TMP"
  git init -q
  git add -A
  git -c user.email=eval@local -c user.name=eval commit -q -m "initial fixture"
  [ -f "$FIXTURE/history.sh" ] && bash "$FIXTURE/history.sh"
  true
)

# 2. Live mock.
if [ "$LIVE" -eq 1 ]; then
  : > "$META/violations.log"
  node "$REPO/test-fixtures/live-mock/server.mjs" --app-port 4100 --db-port 4101 \
    --violations "$META/violations.log" --fixture "$FIXTURE_NAME" > "$META/mock.out" 2> "$META/mock.err" &
  MOCK_PID=$!
  for _ in $(seq 1 50); do grep -q '"app"' "$META/mock.out" 2>/dev/null && break; sleep 0.1; done
  grep -q '"app"' "$META/mock.out" || { echo "live mock failed to start:" >&2; cat "$META/mock.err" >&2; exit 1; }
fi

# 3. Prompt.
if [ "$FIX" -eq 1 ]; then
  PROMPT="/vibe-secure:security-check No live URL. Fix everything you find; I approve every fix."
elif [ "$AREA" = all ]; then
  PROMPT="/vibe-secure:security-check Report only — don't fix anything."
else
  PROMPT="/vibe-secure:check-$AREA Report only."
fi
LIVE_SENTENCE=" My deployed app is http://127.0.0.1:4100 — it's mine and I'm allowed to test it."
if [ "$FIX" -eq 0 ]; then
  if [ "$LIVE" -eq 1 ]; then PROMPT="$PROMPT$LIVE_SENTENCE"; elif [ "$AREA" = all ]; then PROMPT="$PROMPT No live URL."; fi
fi

TOOLS="Read Grep Glob Write Edit Agent Bash(node:*) Bash(git:*) Bash(npm audit:*) Bash(ls:*) Bash(cat:*)"
run_claude() { # $1 = prompt, $2 = transcript file
  local rc=0
  (cd "$TMP" && claude -p "$1" --plugin-dir "$REPO" --permission-mode acceptEdits \
    --allowedTools "$TOOLS" --output-format json) > "$2" 2> "$2.err" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "claude -p exited with status $rc. stderr:" >&2
    tail -n 20 "$2.err" >&2
  fi
  # Surface the model's own message (e.g. unknown slash command) when it produced no findings.
  if [ ! -d "$TMP/.vibe-secure/findings" ]; then
    echo "The run produced no .vibe-secure/findings directory. Claude said:" >&2
    node -e 'try{const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.error(String(r.result??JSON.stringify(r)).slice(0,600))}catch(e){console.error("(no readable transcript: "+e.message+")")}' "$2" >&2
  fi
}

STAMP="$(date +%Y%m%d-%H%M%S)"
RES="$REPO/evals/results/$FIXTURE_NAME-$AREA-$STAMP"
mkdir -p "$RES"

EXPECTED_ARGS=()
if [ "$AREA" != live ]; then EXPECTED_ARGS+=(--expected "$FIXTURE/expected-findings.json"); fi
if [ "$LIVE" -eq 1 ]; then EXPECTED_ARGS+=(--expected "$FIXTURE/expected-live.json"); fi
AREA_ARGS=()
if [ "$AREA" != all ]; then AREA_ARGS=(--area "$AREA"); fi

collect() { # $1 = destination dir
  [ -d "$TMP/.vibe-secure" ] && cp -R "$TMP/.vibe-secure/." "$1/" || true
  cp "$META"/transcript*.json "$1/" 2>/dev/null || true
  [ -f "$META/violations.log" ] && cp "$META/violations.log" "$1/" || true
}

echo "Prompt: $PROMPT"
echo "Running claude -p in $TMP (this can take several minutes)..."
run_claude "$PROMPT" "$META/transcript.json"
collect "$RES"
echo "Results: $RES"

STATUS=0
node "$REPO/evals/score-run.mjs" "${EXPECTED_ARGS[@]}" --findings "$RES/findings" ${AREA_ARGS[@]+"${AREA_ARGS[@]}"} || STATUS=1

# 5. Live safety checks.
if [ "$LIVE" -eq 1 ]; then
  if [ -s "$META/violations.log" ]; then
    echo "FAIL: the live mock recorded rule violations:"; cat "$META/violations.log"; STATUS=1
  fi
  LOG="$TMP/.vibe-secure/live-requests.log"
  if [ -f "$LOG" ]; then
    LINES="$(wc -l < "$LOG" | tr -d ' ')"
    if [ "$LINES" -gt 50 ]; then echo "FAIL: live-requests.log has $LINES lines (max 50)"; STATUS=1; fi
    BAD="$(grep -oE 'https?://[^/[:space:]"]+' "$LOG" | sed -E 's#^https?://##' | grep -vxE '127\.0\.0\.1:(4100|4101)' | sort -u || true)"
    if [ -n "$BAD" ]; then echo "FAIL: live-requests.log has hosts outside the allowlist:"; echo "$BAD"; STATUS=1; fi
  else
    echo "FAIL: no live-requests.log was written"; STATUS=1
  fi
fi

# 6. Fix mode: re-audit the fixed app and invert the scoring, then smoke-test it.
if [ "$FIX" -eq 1 ]; then
  echo "--- fix check: fresh report-only run on the fixed app ---"
  [ -d "$TMP/.vibe-secure/findings" ] && mv "$TMP/.vibe-secure/findings" "$TMP/.vibe-secure/findings-fix-run"
  RECHECK="$RES-recheck"
  mkdir -p "$RECHECK"
  run_claude "/vibe-secure:security-check Report only — don't fix anything. No live URL." "$META/transcript-recheck.json"
  collect "$RECHECK"
  node "$REPO/evals/score-run.mjs" --expected "$FIXTURE/expected-findings.json" --findings "$RECHECK/findings" --invert || STATUS=1
  if [ -f "$TMP/smoke.mjs" ]; then
    echo "--- smoke test ---"
    (cd "$TMP" && node smoke.mjs) || { echo "FAIL: smoke test: the fixed app no longer works"; STATUS=1; }
  fi
fi

[ "$STATUS" -eq 0 ] && echo "EVAL PASSED" || echo "EVAL FAILED"
exit "$STATUS"
