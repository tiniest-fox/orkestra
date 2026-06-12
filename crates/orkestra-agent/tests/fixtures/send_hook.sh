#!/bin/bash
# Shared helper sourced by mock PTY scripts.
# Defines send_hook(): sends a JSON payload to the hook server socket via the settings file.
# Requires SETTINGS_FILE to be set in the sourcing script's scope.

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
