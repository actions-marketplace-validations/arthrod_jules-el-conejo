#!/usr/bin/env bash
# Shell logic for the Jules Invoke composite action (action.yaml).
#
# Every value arrives through JULES_* environment variables that action.yaml sets
# in each step's `env:` block. Nothing is interpolated into this script with
# GitHub expressions, so input values are only ever data, never shell code.
#
# Usage: jules.sh validate|create|delete|cleanup
set -euo pipefail

JULES_API_BASE_URL="${JULES_API_BASE_URL:-https://jules.googleapis.com/v1alpha}"
WORK_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
# Where the action checks out the repository when the caller has not. See
# cmd_validate for why it is never the caller's workspace itself.
CHECKOUT_DIR=.jules-action-checkout

# Messages quote input values, so escape them as workflow command data: an
# unescaped newline would end the annotation and start a new command line.
error() {
  local message="$*"
  message=${message//"%"/%25}
  message=${message//$'\r'/%0D}
  message=${message//$'\n'/%0A}
  echo "::error::$message"
  exit 1
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# The override exists for tests; only the real API and loopback mocks are allowed,
# so a stray environment variable cannot send the API key somewhere else. The
# authority must end right after the host (or numeric port), which rules out
# userinfo forms such as http://localhost:1@other.host/.
check_base_url() {
  local allowed='^(https://jules\.googleapis\.com|http://(127\.0\.0\.1|localhost):[0-9]+)(/|$)'
  if ! [[ "$JULES_API_BASE_URL" =~ $allowed ]]; then
    error "JULES_API_BASE_URL must be https://jules.googleapis.com/... or a loopback URL, got: $JULES_API_BASE_URL"
  fi
}

SCRATCH_FILES=()
remove_scratch_files() {
  if [ "${#SCRATCH_FILES[@]}" -gt 0 ]; then
    rm -f "${SCRATCH_FILES[@]}"
  fi
}
trap remove_scratch_files EXIT

# Sets REPLY to a new scratch file, removed on exit. mktemp creates it with
# O_EXCL and mode 0600, so a file or symlink planted at a guessable path in a
# shared temp dir cannot redirect the write.
make_scratch_file() {
  REPLY=$(mktemp "$WORK_DIR/jules_$1.XXXXXX") ||
    error "Could not create a scratch file in $WORK_DIR"
  SCRATCH_FILES+=("$REPLY")
}

# Writes the API key header to a private file so the key never shows up in
# curl's argv (visible to other processes on shared runners).
prepare_auth() {
  make_scratch_file api_key_header
  KEY_HEADER_FILE=$REPLY
  printf 'X-Goog-Api-Key: %s\n' "$JULES_API_KEY" > "$KEY_HEADER_FILE"
}

# api_request <retry-policy> <curl args...>
# Sets HTTP_CODE and BODY. Policies:
#   connect   - retry only when the request never left this machine (curl exit
#               6: DNS, 7: connect). Used for create: POST /sessions is not
#               idempotent, and a retry after a lost response would start a
#               duplicate session and a duplicate PR.
#   transient - let curl also retry timeouts, 408, 429 and 5xx. Idempotent
#               calls only (delete).
api_request() {
  local policy="$1" response status attempt=1
  shift
  local -a retry=()
  if [ "$policy" = "transient" ]; then
    retry=(--retry 3 --retry-delay 1 --retry-connrefused)
  fi

  while :; do
    status=0
    response=$(curl -sS --connect-timeout 10 --max-time 60 \
      ${retry[@]+"${retry[@]}"} \
      -H @"$KEY_HEADER_FILE" \
      -w '\n%{http_code}' "$@") || status=$?
    if [ "$status" -eq 0 ]; then
      break
    fi
    if [ "$policy" = "connect" ] && [ "$attempt" -lt 3 ] &&
      { [ "$status" -eq 6 ] || [ "$status" -eq 7 ]; }; then
      attempt=$((attempt + 1))
      sleep 1
      continue
    fi
    # Any other create failure (timeout, TLS, a reply cut off after the POST
    # went out) may have started a session, so say so instead of "unreachable".
    if [ "$policy" = "connect" ] && [ "$status" -ne 6 ] && [ "$status" -ne 7 ]; then
      error "The Jules API request failed (curl exit $status) and may already have reached Jules. Check https://jules.google.com for a new session before re-running."
    fi
    error "Could not reach the Jules API (curl exit $status)"
  done

  HTTP_CODE=$(printf '%s\n' "$response" | tail -1)
  BODY=$(printf '%s\n' "$response" | sed '$d')
}

# Fails with a bounded, single-line annotation; the full body goes to the log
# with workflow commands disabled, since it is not ours.
fail_http() {
  local summary token
  summary=$(printf '%s' "${BODY:0:1000}" | tr '\r\n' '  ')
  if [ "${#BODY}" -gt 1000 ]; then
    summary="$summary... (truncated, full body in the log)"
  fi
  token="jules-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
  echo "::stop-commands::$token"
  printf '%s\n' "$BODY"
  echo "::$token::"
  error "Jules API returned HTTP $HTTP_CODE: $summary"
}

# The parse_* helpers set globals instead of printing, because error() inside
# $(...) would only exit the subshell and its ::error:: line would be captured.

# Sets MODE to create or delete; GitHub's own `==` is case-insensitive, so
# `Create` keeps working.
parse_mode() {
  case "$(lowercase "${JULES_MODE:-}")" in
    create) MODE=create ;;
    delete) MODE=delete ;;
    *) error "mode must be \"create\" or \"delete\", got: ${JULES_MODE:-}" ;;
  esac
}

# Sets REPLY to true or false. Empty means false; anything else fails closed
# rather than silently turning, say, plan approval off.
parse_bool() {
  case "$(lowercase "$2")" in
    true) REPLY=true ;;
    false | "") REPLY=false ;;
    *) error "$1 must be true or false, got: $2" ;;
  esac
}

# Sets REQUIRE_PLAN_APPROVAL, INCLUDE_LAST_COMMIT, INCLUDE_COMMIT_LOG and
# AUTOMATION_MODE. The API rejects unknown AutomationMode names itself, so only
# the enum-name shape is checked here.
parse_create_options() {
  parse_bool require_plan_approval "${JULES_REQUIRE_PLAN_APPROVAL:-}"
  REQUIRE_PLAN_APPROVAL=$REPLY
  parse_bool include_last_commit "${JULES_INCLUDE_LAST_COMMIT:-}"
  INCLUDE_LAST_COMMIT=$REPLY
  parse_bool include_commit_log "${JULES_INCLUDE_COMMIT_LOG:-}"
  INCLUDE_COMMIT_LOG=$REPLY

  AUTOMATION_MODE="${JULES_AUTOMATION_MODE:-AUTO_CREATE_PR}"
  local enum_name='^[A-Z][A-Z0-9_]*$'
  if ! [[ "$AUTOMATION_MODE" =~ $enum_name ]]; then
    error "automation_mode must be an AutomationMode name such as AUTO_CREATE_PR or AUTOMATION_MODE_UNSPECIFIED, got: $AUTOMATION_MODE"
  fi
}

# Sets SESSION_ID (bare id) and SESSION_NAME (sessions/<id>).
parse_session_id() {
  local value="${JULES_SESSION_ID:-}" pattern='^(sessions/)?[A-Za-z0-9_-]+$'
  if [ -z "$value" ]; then
    error "session_id is required for delete mode"
  fi
  if ! [[ "$value" =~ $pattern ]]; then
    error "session_id must look like 1234567890 or sessions/1234567890, got: $value"
  fi
  SESSION_ID="${value#sessions/}"
  SESSION_NAME="sessions/$SESSION_ID"
}

require_prompt() {
  if [ -z "${JULES_PROMPT:-}" ]; then
    error "prompt is required for create mode"
  fi
}

require_api_key() {
  if [ -z "${JULES_API_KEY:-}" ]; then
    error "jules_api_key is required"
  fi
}

cmd_validate() {
  check_base_url
  parse_mode
  if [ "$MODE" = "create" ]; then
    require_prompt
  else
    parse_session_id
  fi
  require_api_key
  parse_create_options

  # Git context needs a checkout. On an existing repo actions/checkout cleans
  # it and drops persisted credentials; in a directory without .git it deletes
  # everything. So reuse the caller's checkout, or use a fresh subdirectory.
  local needs_checkout=false context_dir=.
  if [ "$MODE" = "create" ] &&
    { [ "$INCLUDE_LAST_COMMIT" = "true" ] || [ "$INCLUDE_COMMIT_LOG" = "true" ]; } &&
    ! git rev-parse --is-inside-work-tree > /dev/null 2>&1; then
    # The cleanup step always runs, so an existing directory is not ours;
    # checkout would empty it and cleanup would delete it.
    if [ -e "$CHECKOUT_DIR" ] || [ -L "$CHECKOUT_DIR" ]; then
      error "include_last_commit and include_commit_log need a checkout, but $CHECKOUT_DIR already exists in the workspace. Remove it, or check out the repository before this step."
    fi
    needs_checkout=true
    context_dir=$CHECKOUT_DIR
  fi

  {
    echo "mode=$MODE"
    echo "needs_checkout=$needs_checkout"
    echo "git_context_dir=$context_dir"
    echo "require_plan_approval=$REQUIRE_PLAN_APPROVAL"
    echo "include_last_commit=$INCLUDE_LAST_COMMIT"
    echo "include_commit_log=$INCLUDE_COMMIT_LOG"
    echo "automation_mode=$AUTOMATION_MODE"
    if [ "$MODE" = "delete" ]; then
      echo "session_id=$SESSION_ID"
      echo "session_name=$SESSION_NAME"
    fi
  } >> "$GITHUB_OUTPUT"
}

build_prompt() {
  local prompt_file="$1"
  printf '%s\n' "${JULES_PROMPT:-}" > "$prompt_file"

  if [ "$INCLUDE_LAST_COMMIT" = "true" ]; then
    {
      # shellcheck disable=SC2016 # literal backticks
      printf '\n\nContent of the latest commit (in the format of `git show`):\n'
      echo '```'
      git -C "${JULES_GIT_CONTEXT_DIR:-.}" show
      echo '```'
    } >> "$prompt_file"
  fi

  if [ "$INCLUDE_COMMIT_LOG" = "true" ]; then
    {
      # shellcheck disable=SC2016 # literal backticks
      printf '\n\nLog of the last 20 commits (in the format of `git log --stat`):\n'
      echo '```'
      git -C "${JULES_GIT_CONTEXT_DIR:-.}" log -20 --stat
      echo '```'
    } >> "$prompt_file"
  fi
}

build_payload() {
  local prompt_file="$1"

  # --rawfile keeps large prompts (git show/log) out of argv; trailing newlines
  # are trimmed to match the previous "$(cat prompt.txt)" behaviour.
  jq -n \
    --rawfile prompt "$prompt_file" \
    --arg title "${JULES_TITLE:-}" \
    --arg starting_branch "${JULES_STARTING_BRANCH:-}" \
    --arg repository "${JULES_REPOSITORY:-}" \
    --argjson require_plan_approval "$REQUIRE_PLAN_APPROVAL" \
    --arg automation_mode "$AUTOMATION_MODE" \
    '{
      prompt: ($prompt | sub("\n+$"; "")),
      sourceContext: {
        source: "sources/github/\($repository)",
        githubRepoContext: { startingBranch: $starting_branch }
      },
      requirePlanApproval: $require_plan_approval,
      automationMode: $automation_mode
    } + (if $title == "" then {} else { title: $title } end)'
}

cmd_create() {
  check_base_url
  require_prompt
  require_api_key
  parse_create_options
  local prompt_file payload_file
  make_scratch_file prompt
  prompt_file=$REPLY
  make_scratch_file payload
  payload_file=$REPLY
  build_prompt "$prompt_file"
  build_payload "$prompt_file" > "$payload_file"

  prepare_auth
  api_request connect "$JULES_API_BASE_URL/sessions" \
    -X POST \
    -H "Content-Type: application/json" \
    -d @"$payload_file"
  case "$HTTP_CODE" in
    2??) ;;
    *) fail_http ;;
  esac

  if [ -n "$BODY" ] && ! printf '%s' "$BODY" | jq -e 'type == "object"' > /dev/null 2>&1; then
    error "Jules API returned a response that is not a JSON object: ${BODY:0:200}"
  fi
  [ -n "$BODY" ] || BODY='{}'
  echo "$BODY" | jq .

  local session_name session_id
  session_name=$(printf '%s' "$BODY" | jq -r '.name // empty')
  if [ -z "$session_name" ]; then
    error "Jules API response did not include a session name"
  fi
  # `//` treats "" as present, so an empty id falls back explicitly.
  session_id=$(printf '%s' "$BODY" | jq -r 'if (.id // "") != "" then .id else (.name | sub("^sessions/"; "")) end')

  local session_url delimiter
  session_url=$(printf '%s' "$BODY" | jq -r '.url // ""')

  # These become single-line key=value outputs; a value with a newline would
  # add lines of its own to GITHUB_OUTPUT, so odd shapes fail instead.
  local name_shape='^sessions/[A-Za-z0-9_-]+$' id_shape='^[A-Za-z0-9_-]+$'
  local url_shape='^https://[^[:space:]]+$'
  if ! [[ "$session_name" =~ $name_shape ]] || ! [[ "$session_id" =~ $id_shape ]]; then
    error "Jules API returned an unexpected session name or id: $session_name / $session_id"
  fi
  if [ -n "$session_url" ] && ! [[ "$session_url" =~ $url_shape ]]; then
    error "Jules API returned an unexpected session url: $session_url"
  fi
  # Multiline output needs a heredoc delimiter; a random one cannot collide
  # with a line of the response.
  delimiter="JULES_$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')"
  {
    echo "session_id=$session_id"
    echo "session_name=$session_name"
    echo "session_url=$session_url"
    echo "response<<$delimiter"
    echo "$BODY"
    echo "$delimiter"
  } >> "$GITHUB_OUTPUT"
}

cmd_delete() {
  check_base_url
  require_api_key
  parse_session_id

  prepare_auth
  api_request transient "$JULES_API_BASE_URL/$SESSION_NAME" -X DELETE
  case "$HTTP_CODE" in
    2??) echo "Session $SESSION_NAME deleted successfully" ;;
    # Deleting is about the end state; also covers a retry that lands after a
    # delete which succeeded but whose response was lost.
    404) echo "::warning::Jules session $SESSION_NAME was not found; treating it as already deleted" ;;
    *) fail_http ;;
  esac

  {
    echo "session_id=$SESSION_ID"
    echo "session_name=$SESSION_NAME"
  } >> "$GITHUB_OUTPUT"
}

# Removes the action's own checkout. Any other value, including ".", the
# caller's checkout, leaves the workspace alone.
cmd_cleanup() {
  if [ "${JULES_GIT_CONTEXT_DIR:-}" = "$CHECKOUT_DIR" ]; then
    rm -rf -- "$CHECKOUT_DIR"
  fi
}

case "${1:-}" in
  validate) cmd_validate ;;
  create) cmd_create ;;
  delete) cmd_delete ;;
  cleanup) cmd_cleanup ;;
  *)
    echo "usage: jules.sh validate|create|delete|cleanup" >&2
    exit 2
    ;;
esac
