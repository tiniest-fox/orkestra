#!/bin/bash
# Mock claude for PTY integration tests.
# Mimics real Claude Code PTY behavior: parses flags, writes a JSONL transcript,
# fires the Stop hook via the socket path found in the settings file.

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

# On resume, simulate TUI replay time: the runner must wait for the transcript to
# grow past its pre-existing size, not just detect file existence. The delay here
# gives the runner's initial prompt write a chance to be swallowed so that the
# Enter-retry path re-delivers the prompt after we start reading stdin.
if [ "$IS_RESUME" = true ]; then
    sleep 1
fi

# Read prompt from PTY stdin (with timeout so we don't block if the write is slow).
# On resume, the transcript file already exists — we append new lines to it below.
read -r -t 5 PROMPT || true

# Write JSONL transcript with structured output that the Claude parser can extract.
# Use >> so resume runs append to the existing transcript rather than overwriting it.
printf '{"type":"assistant","message":{"content":[{"type":"text","text":"Working on it."}]}}\n' >> "$TRANSCRIPT"
printf '{"structured_output":{"type":"summary","content":"Test output from mock claude"}}\n' >> "$TRANSCRIPT"

# Fire Stop hook using the socket path extracted from the settings file.
# The settings file holds a hook command that uses nc -U; we parse the socket path
# and use Python3's socket module directly so nc is not required.
if [ -n "$SETTINGS_FILE" ] && [ -f "$SETTINGS_FILE" ]; then
    TASK_ID="${ORK_TASK_ID:-}"
    python3 - "$SETTINGS_FILE" "$TASK_ID" "$SESSION_ID" "$TRANSCRIPT" <<'PYEOF'
import sys, json, re, socket as sock_mod

settings_file, task_id, session_id, transcript_path = sys.argv[1:]

try:
    with open(settings_file) as f:
        d = json.load(f)
    hook_entry = d.get("hooks", {}).get("Stop", [{}])[0]
    cmd = hook_entry.get("hooks", [{}])[0].get("command", "")
    m = re.search(r"nc -U (\S+)", cmd)
    if not m:
        sys.exit(0)
    socket_path = m.group(1)
    payload = json.dumps({
        "event": "stop",
        "task_id": task_id,
        "session_id": session_id,
        "transcript_path": transcript_path,
    })
    s = sock_mod.socket(sock_mod.AF_UNIX, sock_mod.SOCK_STREAM)
    s.connect(socket_path)
    s.sendall(payload.encode())
    s.close()
except Exception:
    pass
PYEOF
fi

# Small delay to let the hook server process the event before the process exits
sleep 0.3
