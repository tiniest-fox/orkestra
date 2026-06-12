#!/bin/bash
# Mock claude for PTY integration tests.
# Mimics real Claude Code PTY behavior: parses flags, writes a JSONL transcript,
# fires UserPromptSubmit and Stop hooks via the socket path found in the settings file.

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

# Encode working dir to match compute_transcript_path in run_pty.rs:
# replaces every '/' or '.' with '-'.
WORKDIR="$(pwd)"
ENCODED_CWD="${WORKDIR//\//-}"
ENCODED_CWD="${ENCODED_CWD//./-}"
TRANSCRIPT_DIR="$HOME/.claude/projects/$ENCODED_CWD"
mkdir -p "$TRANSCRIPT_DIR"
TRANSCRIPT="$TRANSCRIPT_DIR/${SESSION_ID}.jsonl"

# Send a JSON payload to the hook server socket found in the settings file.
# Args: $1=hook_key (e.g. "UserPromptSubmit" or "Stop"), $2=json_payload_string
send_hook() {
    local hook_key="$1"
    local payload="$2"
    if [ -n "$SETTINGS_FILE" ] && [ -f "$SETTINGS_FILE" ]; then
        python3 - "$SETTINGS_FILE" "$hook_key" "$payload" <<'PYEOF'
import sys, json, re, socket as sock_mod

settings_file, hook_key, payload = sys.argv[1:]

try:
    with open(settings_file) as f:
        d = json.load(f)
    hook_entry = d.get("hooks", {}).get(hook_key, [{}])[0]
    cmd = hook_entry.get("hooks", [{}])[0].get("command", "")
    m = re.search(r"nc -U (\S+)", cmd)
    if not m:
        sys.exit(0)
    socket_path = m.group(1)
    s = sock_mod.socket(sock_mod.AF_UNIX, sock_mod.SOCK_STREAM)
    s.connect(socket_path)
    s.sendall(payload.encode())
    s.close()
except Exception:
    pass
PYEOF
    fi
}

TASK_ID="${ORK_TASK_ID:-}"

# On resume, write bookkeeping bytes to transcript BEFORE reading stdin.
# These simulate Claude Code's TUI re-init writes (mode, permission-mode) that
# grow the transcript without representing real turns. The old byte-growth
# heuristic would treat these as "ready" before stdin is read; the hook-gated
# readiness path waits for UserPromptSubmit instead.
if [ "$IS_RESUME" = true ]; then
    printf '{"type":"system","subtype":"mode","mode":"normal"}\n' >> "$TRANSCRIPT"
    printf '{"type":"system","subtype":"permission-mode","mode":"default"}\n' >> "$TRANSCRIPT"
    sleep 1
fi

# On fresh start, write one bookkeeping byte to simulate cold-boot TUI init.
if [ "$IS_RESUME" != true ]; then
    printf '{"type":"system","subtype":"mode","mode":"normal"}\n' >> "$TRANSCRIPT"
fi

# Read prompt from PTY stdin (with timeout so we don't block if the write is slow).
# On resume, the transcript file already exists — we append new lines to it below.
read -r -t 5 PROMPT || true

# Fire UserPromptSubmit hook — simulates real Claude Code firing the hook when the
# prompt is submitted to the model (AFTER reading stdin, BEFORE writing output).
send_hook "UserPromptSubmit" "$(printf '{"event":"user_prompt_submit","task_id":"%s","session_id":"%s"}' "$TASK_ID" "$SESSION_ID")"

# Write JSONL transcript with structured output that the Claude parser can extract.
# Use >> so resume runs append to the existing transcript rather than overwriting it.
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Working on it."}]}}\n' >> "$TRANSCRIPT"
printf '{"structured_output":{"type":"summary","content":"Test output from mock claude"}}\n' >> "$TRANSCRIPT"

# Fire Stop hook using the same socket infrastructure.
send_hook "Stop" "$(printf '{"event":"stop","task_id":"%s","session_id":"%s","transcript_path":"%s"}' "$TASK_ID" "$SESSION_ID" "$TRANSCRIPT")"

# Small delay to let the hook server process the event before the process exits
sleep 0.3
