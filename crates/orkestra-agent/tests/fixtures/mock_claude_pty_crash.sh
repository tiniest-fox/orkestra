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
