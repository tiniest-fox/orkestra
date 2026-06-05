#!/bin/bash
# Mock claude that exits immediately without writing a transcript or firing a hook.
# Used to test the PTY fail-fast path when Claude Code fails to start.
exit 1
