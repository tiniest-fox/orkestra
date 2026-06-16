#!/bin/bash
# Mock claude for PTY crash recovery tests.
# Writes transcript and args sidecar, fires UserPromptSubmit hook, then exits
# WITHOUT firing the Stop hook. Simulates a crash where the process dies mid-execution.

SESSION_ID=""
SETTINGS_FILE=""
IS_RESUME=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --session-id)    SESSION_ID="$2"; shift 2;;
        --resume)        SESSION_ID="$2"; IS_RESUME=true; shift 2;;
        --settings)      SETTINGS_FILE="$2"; shift 2;;
        --permission-mode|--model) shift 2;;
        *) shift;;
    esac
done

# Write args to sidecar file for test verification
if [ -n "$ORK_CAPTURE_ARGS_FILE" ]; then
    if [ "$IS_RESUME" = true ]; then
        echo "--resume $SESSION_ID" >> "$ORK_CAPTURE_ARGS_FILE"
    else
        echo "--session-id $SESSION_ID" >> "$ORK_CAPTURE_ARGS_FILE"
    fi
fi

# Encode working dir (same as normal mock)
WORKDIR="$(pwd)"
ENCODED_CWD="${WORKDIR//\//-}"
ENCODED_CWD="${ENCODED_CWD//./-}"
TRANSCRIPT_DIR="$HOME/.claude/projects/$ENCODED_CWD"
mkdir -p "$TRANSCRIPT_DIR"
TRANSCRIPT="$TRANSCRIPT_DIR/${SESSION_ID}.jsonl"

# shellcheck source=send_hook.sh
source "$(dirname "$0")/send_hook.sh"

TASK_ID="${ORK_TASK_ID:-}"

# On resume, write bookkeeping bytes before reading stdin (same as normal mock).
if [ "$IS_RESUME" = true ]; then
    printf '{"type":"system","subtype":"mode","mode":"normal"}\n' >> "$TRANSCRIPT"
    printf '{"type":"system","subtype":"permission-mode","mode":"default"}\n' >> "$TRANSCRIPT"
    sleep 1
fi

# On fresh start, write one bookkeeping byte to simulate cold-boot TUI init.
if [ "$IS_RESUME" != true ]; then
    printf '{"type":"system","subtype":"mode","mode":"normal"}\n' >> "$TRANSCRIPT"
fi

# Read prompt from PTY stdin
read -r -t 5 PROMPT || true

# Fire UserPromptSubmit hook — proves readiness detection works even for crashes
# (hook fires, then process exits without Stop; dead-process detection handles cleanup).
send_hook "UserPromptSubmit" "$(printf '{"event":"user_prompt_submit","task_id":"%s","session_id":"%s"}' "$TASK_ID" "$SESSION_ID")"

# Write valid transcript (same as normal mock)
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Working on it."}]}}\n' >> "$TRANSCRIPT"
printf '{"structured_output":{"type":"summary","content":"Test output from mock claude"}}\n' >> "$TRANSCRIPT"

# Exit WITHOUT firing Stop hook — simulates crash
sleep 0.3
