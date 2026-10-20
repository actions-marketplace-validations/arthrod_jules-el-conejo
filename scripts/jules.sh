#!/usr/bin/env bash
# Shell logic for the Jules Invoke composite action (action.yaml).
#
# Every value arrives through JULES_* environment variables that action.yaml sets
# in each step's `env:` block. Nothing is interpolated into this script with
# GitHub expressions, so input values are only ever data, never shell code.
#
# Usage: jules.sh validate|create|delete
set -euo pipefail

JULES_API_BASE_URL="${JULES_API_BASE_URL:-https://jules.googleapis.com/v1alpha}"
WORK_DIR="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

error() {
  echo "::error::$*"
  exit 1
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

# The override exists for tests; only the real API and loopback mocks are allowed,
# so a stray environment variable cannot send the API key somewhere else.
check_base_url() {
  case "$JULES_API_BASE_URL" in
    https://jules.googleapis.com/* | http://127.0.0.1:* | http://localhost:*) ;;
    *) error "JULES_API_BASE_URL must be https://jules.googleapis.com/... or a loopback URL, got: $JULES_API_BASE_URL" ;;
  esac
}

# Runs curl, then splits the trailing status line written by -w into
# HTTP_CODE and the response body into BODY.
api_request() {
  local response
  response=$(curl -s -w "\n%{http_code}" "$@")
  HTTP_CODE=$(printf '%s\n' "$response" | tail -1)
  BODY=$(printf '%s\n' "$response" | sed '$d')
  if [ "$HTTP_CODE" -ge 400 ]; then
    error "Jules API returned HTTP $HTTP_CODE: $BODY"
  fi
}

cmd_validate() {
  local mode="${JULES_MODE:-}"
  if [ "$mode" = "create" ] && [ -z "${JULES_PROMPT:-}" ]; then
    error "prompt is required for create mode"
  fi
  if [ "$mode" = "delete" ] && [ -z "${JULES_SESSION_ID:-}" ]; then
    error "session_id is required for delete mode"
  fi
}

build_prompt() {
  local prompt_file="$1"
  printf '%s\n' "${JULES_PROMPT:-}" > "$prompt_file"

  if [ "$(lowercase "${JULES_INCLUDE_LAST_COMMIT:-false}")" = "true" ]; then
    {
      # shellcheck disable=SC2016 # literal backticks
      printf '\n\nContent of the latest commit (in the format of `git show`):\n'
      echo '```'
      git show
      echo '```'
    } >> "$prompt_file"
  fi

  if [ "$(lowercase "${JULES_INCLUDE_COMMIT_LOG:-false}")" = "true" ]; then
    {
      # shellcheck disable=SC2016 # literal backticks
      printf '\n\nLog of the last 20 commits (in the format of `git log --stat`):\n'
      echo '```'
      git log -20 --stat
      echo '```'
    } >> "$prompt_file"
  fi
}

build_payload() {
  local prompt_file="$1" plan_approval=false
  if [ "${JULES_REQUIRE_PLAN_APPROVAL:-false}" = "true" ]; then
    plan_approval=true
  fi

  # --rawfile keeps large prompts (git show/log) out of argv; trailing newlines
  # are trimmed to match the previous "$(cat prompt.txt)" behaviour.
  jq -n \
    --rawfile prompt "$prompt_file" \
    --arg title "${JULES_TITLE:-}" \
    --arg starting_branch "${JULES_STARTING_BRANCH:-}" \
    --arg repository "${JULES_REPOSITORY:-}" \
    --argjson require_plan_approval "$plan_approval" \
    --arg automation_mode "${JULES_AUTOMATION_MODE:-}" \
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
  local prompt_file="$WORK_DIR/jules_prompt.txt"
  local payload_file="$WORK_DIR/jules_payload.json"
  build_prompt "$prompt_file"
  build_payload "$prompt_file" > "$payload_file"

  api_request "$JULES_API_BASE_URL/sessions" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Goog-Api-Key: ${JULES_API_KEY:-}" \
    -d @"$payload_file"

  echo "$BODY" | jq .

  local session_name session_id
  session_name=$(echo "$BODY" | jq -r '.name // empty')
  session_id=$(echo "$BODY" | jq -r '.id // empty')

  {
    echo "session_id=$session_id"
    echo "session_name=$session_name"
    # Multiline output requires heredoc delimiter
    echo "response<<JULES_EOF"
    echo "$BODY"
    echo "JULES_EOF"
  } >> "$GITHUB_OUTPUT"
}

cmd_delete() {
  check_base_url
  local session_name="${JULES_SESSION_ID:-}"
  # Normalize: ensure it has the sessions/ prefix
  if [[ "$session_name" != sessions/* ]]; then
    session_name="sessions/$session_name"
  fi

  api_request "$JULES_API_BASE_URL/$session_name" \
    -X DELETE \
    -H "X-Goog-Api-Key: ${JULES_API_KEY:-}"

  echo "Session $session_name deleted successfully"
}

case "${1:-}" in
  validate) cmd_validate ;;
  create) cmd_create ;;
  delete) cmd_delete ;;
  *)
    echo "usage: jules.sh validate|create|delete" >&2
    exit 2
    ;;
esac
